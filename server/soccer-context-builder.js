/**
 * soccer-context-builder.js — assembles a per-game context payload for soccer picks.
 *
 * League-aware by design: every function takes a `leagueSlug` and delegates to
 * soccer-api.js (one ESPN wrapper for all six leagues). Mirrors nhl-context-builder.js
 * but with soccer-specific dimensions:
 *   - NO weather block (outdoor, but weather is not modeled in this version)
 *   - NO "starter confirmed" gate (lineups come ~1h pre-kick, too late for most flows)
 *   - league style profile injected from soccer-league-map.js (avgGoals, drawPct, style)
 *   - xG/xGA: null until FBref/Understat integration in a later sprint
 *   - 3-way market awareness: context_meta tracks threeWay odds completeness
 */

import { getSoccerGamesForDate, getSoccerStandings, getSoccerTeams } from './soccer-api.js';
import { getSoccerLeague, isSupportedLeague } from './soccer-league-map.js';
import { findSoccerTeam } from './soccer-team-map.js';
import { getSoccerGameXg } from './soccer-xg-fetcher.js';
import { getSoccerMatchAvailability, isSoccerLineupsEnabled } from './soccer-lineups-api.js';

function recentFormSummary(games) {
  if (!games?.length) return null;
  const wins   = games.filter(g => g.result === 'W').length;
  const draws  = games.filter(g => g.result === 'D').length;
  const losses = games.filter(g => g.result === 'L').length;
  const gf = games.filter(g => g.goalsFor  != null).map(g => g.goalsFor);
  const ga = games.filter(g => g.goalsAgainst != null).map(g => g.goalsAgainst);
  const avg = arr => arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 100) / 100 : null;
  return {
    record: `${wins}W-${draws}D-${losses}L`,
    avgGoalsFor: avg(gf),
    avgGoalsAgainst: avg(ga),
    games: games.map(g => ({
      date: g.date,
      opponent: g.opponent,
      homeAway: g.homeAway,
      result: g.result,
      goalsFor: g.goalsFor,
      goalsAgainst: g.goalsAgainst,
    })),
  };
}

function fractionPresent(...vals) {
  const present = vals.filter(v => v != null).length;
  return vals.length ? Math.round((present / vals.length) * 100) / 100 : 0;
}

/**
 * Extract recent form for a team from standings/scoreboard data.
 * ESPN soccer scoreboard doesn't give per-team game logs directly, so we
 * derive what we can from the standings `form` string (e.g. "WDLWW").
 */
function parseEspnFormString(formStr) {
  if (!formStr || typeof formStr !== 'string') return null;
  const results = formStr.toUpperCase().split('').filter(c => 'WDL'.includes(c)).slice(0, 6);
  if (!results.length) return null;
  const wins   = results.filter(r => r === 'W').length;
  const draws  = results.filter(r => r === 'D').length;
  const losses = results.filter(r => r === 'L').length;
  return {
    record: `${wins}W-${draws}D-${losses}L`,
    recent: results.join(''),
    avgGoalsFor: null,
    avgGoalsAgainst: null,
  };
}

function extractTeamFromStandings(standingsPayload, teamName, leagueSlug) {
  if (!standingsPayload) return null;
  try {
    const groups = standingsPayload?.standings?.entries ?? standingsPayload?.entries ?? [];
    const entries = Array.isArray(groups) ? groups : [];
    for (const entry of entries) {
      const eName = entry?.team?.displayName ?? entry?.team?.name ?? '';
      const seeded = findSoccerTeam(eName, leagueSlug);
      const canonical = seeded?.name ?? eName;
      const target    = findSoccerTeam(teamName, leagueSlug);
      if (canonical === (target?.name ?? teamName)) {
        const stats = {};
        for (const s of (entry?.stats ?? [])) {
          stats[s.name] = s.value;
        }
        return {
          wins:   stats.wins   ?? null,
          draws:  stats.draws  ?? null,
          losses: stats.losses ?? null,
          goalsFor:     stats.pointsFor   ?? stats.goalsFor     ?? null,
          goalsAgainst: stats.pointsAgainst ?? stats.goalsAgainst ?? null,
          goalDiff:     stats.pointDifferential ?? null,
          points:       stats.points ?? null,
          form:         parseEspnFormString(stats.form ?? null),
        };
      }
    }
  } catch {
    // standings shape is fragile; return null gracefully
  }
  return null;
}

function buildTeamBlock(teamName, teamId, statsFromStandings, leagueSlug) {
  const seeded = findSoccerTeam(teamName, leagueSlug);
  return {
    teamId: teamId ?? null,
    teamName: seeded?.name ?? teamName ?? null,
    teamAbbr: seeded?.short ?? null,
    wins:        statsFromStandings?.wins        ?? null,
    draws:       statsFromStandings?.draws       ?? null,
    losses:      statsFromStandings?.losses      ?? null,
    goalsFor:    statsFromStandings?.goalsFor    ?? null,
    goalsAgainst: statsFromStandings?.goalsAgainst ?? null,
    goalDiff:    statsFromStandings?.goalDiff    ?? null,
    points:      statsFromStandings?.points      ?? null,
    recentForm:  statsFromStandings?.form        ?? null,
    // xG/xGA: null until FBref/Understat integration
    xG:  null,
    xGA: null,
    // Availability (Sprint 11.3 — API-Football): 'unknown' until lineups confirm
    // ~1h pre-kick. Injuries + suspensions (yellow accumulation / red card) are
    // unique to soccer and invisible to ESPN.
    lineupStatus: 'unknown',
    formation: null,
    injuries: [],
    suspensions: [],
  };
}

/**
 * buildSoccerGameContext({
 *   leagueSlug,          // e.g. 'eng.1'
 *   homeTeamName,        // display name from ESPN
 *   awayTeamName,
 *   homeTeamId?,         // ESPN numeric id (optional)
 *   awayTeamId?,
 *   gameDate,            // 'YYYY-MM-DD'
 *   marketOdds?,         // { threeWay, total, btts } from soccer-odds.js
 * })
 *
 * Returns { league, leagueMeta, gameDate, home, away, context_meta }.
 */
export async function buildSoccerGameContext({
  leagueSlug,
  homeTeamName,
  awayTeamName,
  homeTeamId = null,
  awayTeamId = null,
  gameDate,
  marketOdds = null,
}) {
  if (!isSupportedLeague(leagueSlug)) {
    throw new Error(`[soccer-context] unsupported league: ${leagueSlug}`);
  }

  const startedAt = Date.now();
  const leagueMeta = getSoccerLeague(leagueSlug);

  const [standingsPayload, xgData, availability] = await Promise.all([
    getSoccerStandings(leagueSlug).catch(err => {
      console.warn(`[soccer-context] standings failed (${leagueSlug}): ${err.message}`);
      return null;
    }),
    getSoccerGameXg(leagueSlug, homeTeamName, awayTeamName).catch(() => ({ home: null, away: null })),
    getSoccerMatchAvailability({ leagueSlug, date: gameDate, homeName: homeTeamName, awayName: awayTeamName })
      .catch(() => null),
  ]);

  const homeStats = extractTeamFromStandings(standingsPayload, homeTeamName, leagueSlug);
  const awayStats = extractTeamFromStandings(standingsPayload, awayTeamName, leagueSlug);

  const home = buildTeamBlock(homeTeamName, homeTeamId, homeStats, leagueSlug);
  const away = buildTeamBlock(awayTeamName, awayTeamId, awayStats, leagueSlug);

  // Enrich xG from Understat (null if league unsupported or fetch failed)
  if (xgData?.home) {
    home.xG  = xgData.home.xG  ?? null;
    home.xGA = xgData.home.xGA ?? null;
  }
  if (xgData?.away) {
    away.xG  = xgData.away.xG  ?? null;
    away.xGA = xgData.away.xGA ?? null;
  }

  // Enrich availability from API-Football (lineups + injuries + suspensions).
  // Null when the feature is off (no key), MLS coverage gaps, or fetch failure.
  if (availability?.home) {
    home.lineupStatus = availability.home.lineupStatus ?? home.lineupStatus;
    home.formation    = availability.home.formation ?? null;
    home.injuries     = availability.home.injuries ?? [];
    home.suspensions  = availability.home.suspensions ?? [];
  }
  if (availability?.away) {
    away.lineupStatus = availability.away.lineupStatus ?? away.lineupStatus;
    away.formation    = availability.away.formation ?? null;
    away.injuries     = availability.away.injuries ?? [];
    away.suspensions  = availability.away.suspensions ?? [];
  }
  const lineupsConfirmed = !!availability?.lineupsConfirmed;

  const staleFlags = [];
  if (!homeStats) staleFlags.push('home_team_stats_missing');
  if (!awayStats) staleFlags.push('away_team_stats_missing');
  if (!home.recentForm) staleFlags.push('home_recent_form_missing');
  if (!away.recentForm) staleFlags.push('away_recent_form_missing');
  if (!marketOdds?.threeWay) staleFlags.push('three_way_odds_missing');
  const xgAvailable = !!(xgData?.home?.xG || xgData?.away?.xG);
  if (!xgAvailable) staleFlags.push('xg_unavailable');
  const lineupsAvailable = !!availability;
  if (isSoccerLineupsEnabled() && !lineupsConfirmed) staleFlags.push('lineups_unconfirmed');
  if (!lineupsAvailable) staleFlags.push('availability_unavailable');

  const completeness = {
    teamStats:  fractionPresent(homeStats, awayStats),
    recentForm: fractionPresent(home.recentForm, away.recentForm),
    marketOdds: marketOdds?.threeWay ? 1 : 0,
    xG: xgAvailable ? 1 : 0,
    lineups: lineupsConfirmed ? 1 : 0,
  };
  const overall = +(
    (completeness.teamStats  * 0.35 +
     completeness.recentForm * 0.20 +
     completeness.marketOdds * 0.20 +
     completeness.xG         * 0.10 +
     completeness.lineups    * 0.15).toFixed(2)
  );

  const context_meta = {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    league: leagueSlug,
    sources: {
      teamStats: {
        ok: !!(homeStats && awayStats),
        source: standingsPayload ? 'espn-standings' : 'unavailable',
      },
      recentForm: {
        ok: !!(home.recentForm && away.recentForm),
        source: 'espn-standings-form',
      },
      xG: { ok: xgAvailable, source: xgAvailable ? 'understat' : 'unavailable — MLS or fetch failed' },
      marketOdds: {
        ok: !!(marketOdds?.threeWay),
        source: marketOdds?.source ?? null,
        provided: marketOdds ? (marketOdds.provided ?? 'server') : null,
      },
      availability: {
        ok: lineupsAvailable,
        lineupsConfirmed,
        source: lineupsAvailable ? 'api-football' : (isSoccerLineupsEnabled() ? 'no-fixture-match' : 'disabled — no API_FOOTBALL_KEY'),
        fixtureId: availability?.fixtureId ?? null,
      },
    },
    completeness,
    overallCompleteness: overall,
    staleFlags,
  };

  return {
    league: leagueSlug,
    leagueMeta,
    gameDate,
    home,
    away,
    context_meta,
  };
}

export default { buildSoccerGameContext };
