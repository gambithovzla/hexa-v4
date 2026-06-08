/**
 * soccer-context-builder.js — assembles a per-game context payload for soccer picks.
 *
 * League-aware by design: every function takes a `leagueSlug` and delegates to
 * soccer-api.js (one ESPN wrapper for all six leagues). Mirrors nhl-context-builder.js
 * but with soccer-specific dimensions:
 *   - weather block (outdoor venues via Open-Meteo; roofed venues weather-neutral)
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
import { getSoccerWeather } from './soccer-weather-api.js';

// European/relegation spots per league — source of truth for motivation/stakes analysis.
// playoffPos: Bundesliga/Ligue 1 have a 16th-place relegation playoff vs 3rd-tier.
// mls: true skips European spots / relegation in favour of conference playoff logic.
const LEAGUE_SPOTS = {
  'eng.1': { totalTeams: 20, ucl: 4, uel: 6, uecl: 7,    relegation: 3, playoffPos: null },
  'esp.1': { totalTeams: 20, ucl: 4, uel: 6, uecl: null,  relegation: 3, playoffPos: null },
  'ger.1': { totalTeams: 18, ucl: 4, uel: 6, uecl: null,  relegation: 2, playoffPos: 16  },
  'ita.1': { totalTeams: 20, ucl: 4, uel: 6, uecl: 7,    relegation: 3, playoffPos: null },
  'fra.1': { totalTeams: 18, ucl: 3, uel: 5, uecl: 6,    relegation: 2, playoffPos: 16  },
  'usa.1': { totalTeams: 14, ucl: null, uel: null, uecl: null, relegation: 0, playoffPos: 9, mls: true },
};

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
    for (let idx = 0; idx < entries.length; idx++) {
      const entry = entries[idx];
      const eName = entry?.team?.displayName ?? entry?.team?.name ?? '';
      const seeded = findSoccerTeam(eName, leagueSlug);
      const canonical = seeded?.name ?? eName;
      const target    = findSoccerTeam(teamName, leagueSlug);
      if (canonical === (target?.name ?? teamName)) {
        const stats = {};
        for (const s of (entry?.stats ?? [])) stats[s.name] = s.value;
        const rank = typeof stats.rank === 'number' ? stats.rank : (idx + 1);
        return {
          wins:         stats.wins   ?? null,
          draws:        stats.draws  ?? null,
          losses:       stats.losses ?? null,
          goalsFor:     stats.pointsFor   ?? stats.goalsFor     ?? null,
          goalsAgainst: stats.pointsAgainst ?? stats.goalsAgainst ?? null,
          goalDiff:     stats.pointDifferential ?? null,
          points:       stats.points ?? null,
          form:         parseEspnFormString(stats.form ?? null),
          position:     rank,
          gamesPlayed:  stats.gamesPlayed ?? stats.played ?? null,
        };
      }
    }
  } catch {
    // standings shape is fragile; return null gracefully
  }
  return null;
}

/**
 * Build a flat standings table [{position, points}] sorted by position.
 * Used by buildMotivationBlock to compute gaps to relevant cutoff positions.
 */
function extractFullStandings(standingsPayload) {
  if (!standingsPayload) return [];
  try {
    const entries = standingsPayload?.standings?.entries ?? standingsPayload?.entries ?? [];
    if (!Array.isArray(entries)) return [];
    return entries
      .map((entry, idx) => {
        const stats = {};
        for (const s of (entry?.stats ?? [])) stats[s.name] = s.value;
        const rank = typeof stats.rank === 'number' ? stats.rank : (idx + 1);
        const pts = typeof stats.points === 'number' ? stats.points : null;
        return { position: rank, points: pts };
      })
      .filter(e => e.points != null)
      .sort((a, b) => a.position - b.position);
  } catch {
    return [];
  }
}

/**
 * Categorise a team's stakes given its table position and the full standings.
 * Returns { position, totalTeams, gapToTop, gapToUcl, gapToRelegation, tags }.
 * tags[] examples: ['TITLE LEADERS'], ['UCL PLACE (3)'], ['RELEGATION ZONE (18/20)'],
 *   ['MID-TABLE (11/20)'], ['RELEGATION BATTLE (+2pts off drop)'].
 */
export function buildMotivationBlock(teamPoints, teamPosition, fullStandings, leagueSlug) {
  if (!teamPosition || !fullStandings.length || teamPoints == null) return null;
  const config = LEAGUE_SPOTS[leagueSlug];
  if (!config) return null;

  const totalTeams = fullStandings.length || config.totalTeams;
  const leaderPoints = fullStandings[0]?.points ?? null;
  if (leaderPoints == null) return null;

  const gapToTop = leaderPoints - teamPoints;
  const tags = [];

  // MLS: conference-based playoffs, no European spots, no relegation
  if (config.mls) {
    const playoffCutoff = config.playoffPos ?? 9;
    const playoffBoundaryPts = fullStandings[Math.min(playoffCutoff - 1, fullStandings.length - 1)]?.points ?? null;
    if (teamPosition <= playoffCutoff) {
      tags.push(`PLAYOFF ZONE (${teamPosition}/${totalTeams})`);
    } else {
      const deficit = playoffBoundaryPts != null ? playoffBoundaryPts - teamPoints : null;
      tags.push(`OUT OF PLAYOFFS (${teamPosition}/${totalTeams}${deficit != null ? `, -${deficit}pts` : ''})`);
    }
    return { position: teamPosition, totalTeams, gapToTop, gapToUcl: null, gapToRelegation: null, tags };
  }

  const uclCutoff  = config.ucl  ?? 0;
  const uelCutoff  = config.uel  ?? 0;
  const ueclCutoff = config.uecl ?? 0;
  const uclBoundaryPts  = uclCutoff  > 0 ? (fullStandings[uclCutoff  - 1]?.points ?? null) : null;
  const uelBoundaryPts  = uelCutoff  > 0 ? (fullStandings[uelCutoff  - 1]?.points ?? null) : null;
  const gapToUcl = uclBoundaryPts != null ? uclBoundaryPts - teamPoints : null;

  // Title
  if (teamPosition === 1) {
    tags.push('TITLE LEADERS');
  } else if (gapToTop <= 5) {
    tags.push(`TITLE RACE (-${gapToTop}pts)`);
  }

  // European
  if (teamPosition <= uclCutoff) {
    tags.push(`UCL PLACE (${teamPosition})`);
  } else if (uclBoundaryPts != null && teamPoints >= uclBoundaryPts - 3) {
    tags.push(`UCL CONTENDER (-${uclBoundaryPts - teamPoints}pts)`);
  } else if (uelCutoff > 0 && teamPosition <= uelCutoff) {
    tags.push(`UEL PLACE (${teamPosition})`);
  } else if (uelBoundaryPts != null && teamPoints >= uelBoundaryPts - 3 && teamPosition > uclCutoff) {
    tags.push(`UEL CONTENDER (-${uelBoundaryPts - teamPoints}pts)`);
  } else if (ueclCutoff > 0 && teamPosition <= ueclCutoff) {
    tags.push(`UECL PLACE (${teamPosition})`);
  }

  // Relegation playoff (Bundesliga/Ligue 1 position 16)
  if (config.playoffPos) {
    const poPts = fullStandings[config.playoffPos - 1]?.points ?? null;
    if (teamPosition === config.playoffPos) {
      tags.push('RELEGATION PLAYOFF PLACE');
    } else if (poPts != null && Math.abs(teamPoints - poPts) <= 2 &&
               teamPosition > uelCutoff && teamPosition < config.playoffPos) {
      tags.push(`NEAR PLAYOFF ZONE (+${teamPoints - poPts}pts)`);
    }
  }

  // Relegation zone
  let gapToRelegation = null;
  if (config.relegation > 0) {
    const relegStart = totalTeams - config.relegation + 1;
    const safetyLine = fullStandings[Math.max(0, totalTeams - config.relegation - 1)]?.points ?? null;
    gapToRelegation = safetyLine != null ? teamPoints - safetyLine : null;
    if (teamPosition >= relegStart) {
      tags.push(`RELEGATION ZONE (${teamPosition}/${totalTeams})`);
    } else if (gapToRelegation != null && gapToRelegation <= 3) {
      tags.push(`RELEGATION BATTLE (+${gapToRelegation}pts off drop)`);
    }
  }

  // Mid-table / dead rubber
  if (!tags.length) tags.push(`MID-TABLE (${teamPosition}/${totalTeams})`);

  return { position: teamPosition, totalTeams, gapToTop, gapToUcl, gapToRelegation, tags };
}

function buildTeamBlock(teamName, teamId, statsFromStandings, leagueSlug) {
  const seeded = findSoccerTeam(teamName, leagueSlug);
  return {
    teamId:       teamId ?? null,
    teamName:     seeded?.name ?? teamName ?? null,
    teamAbbr:     seeded?.short ?? null,
    wins:         statsFromStandings?.wins        ?? null,
    draws:        statsFromStandings?.draws       ?? null,
    losses:       statsFromStandings?.losses      ?? null,
    goalsFor:     statsFromStandings?.goalsFor    ?? null,
    goalsAgainst: statsFromStandings?.goalsAgainst ?? null,
    goalDiff:     statsFromStandings?.goalDiff    ?? null,
    points:       statsFromStandings?.points      ?? null,
    recentForm:   statsFromStandings?.form        ?? null,
    position:     statsFromStandings?.position    ?? null,
    gamesPlayed:  statsFromStandings?.gamesPlayed ?? null,
    // xG/xGA from Understat (null for MLS or when fetch fails)
    xG:  null,
    xGA: null,
    // Rolling xG averages (last 5 / last 7 matches) — null until Understat enrichment
    xG_7: null, xGA_7: null,
    xG_5: null, xGA_5: null,
    // PPDA (Passes Per Defensive Action) — lower = more intense pressing
    ppda: null, ppdaAllowed: null,
    lineupStatus: 'unknown',
    formation:    null,
    injuries:     [],
    suspensions:  [],
    congestion:   null,
    venueSplits:  null,
    // Stakes / motivation — populated below once the full standings table is extracted.
    motivation:   null,
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
  gameTime = null,
  marketOdds = null,
}) {
  if (!isSupportedLeague(leagueSlug)) {
    throw new Error(`[soccer-context] unsupported league: ${leagueSlug}`);
  }

  const startedAt = Date.now();
  const leagueMeta = getSoccerLeague(leagueSlug);

  const [standingsPayload, xgData, availability, weather] = await Promise.all([
    getSoccerStandings(leagueSlug).catch(err => {
      console.warn(`[soccer-context] standings failed (${leagueSlug}): ${err.message}`);
      return null;
    }),
    getSoccerGameXg(leagueSlug, homeTeamName, awayTeamName).catch(() => ({ home: null, away: null })),
    getSoccerMatchAvailability({ leagueSlug, date: gameDate, homeName: homeTeamName, awayName: awayTeamName })
      .catch(() => null),
    getSoccerWeather({ homeTeamName, leagueSlug, gameTime: gameTime ?? gameDate }).catch(() => null),
  ]);

  const homeStats = extractTeamFromStandings(standingsPayload, homeTeamName, leagueSlug);
  const awayStats = extractTeamFromStandings(standingsPayload, awayTeamName, leagueSlug);

  const home = buildTeamBlock(homeTeamName, homeTeamId, homeStats, leagueSlug);
  const away = buildTeamBlock(awayTeamName, awayTeamId, awayStats, leagueSlug);

  // Stakes / motivation: derived from the full standings table (no new data source).
  const fullStandings = extractFullStandings(standingsPayload);
  home.motivation = buildMotivationBlock(home.points, homeStats?.position ?? null, fullStandings, leagueSlug);
  away.motivation = buildMotivationBlock(away.points, awayStats?.position ?? null, fullStandings, leagueSlug);

  // Enrich xG, rolling xG, and PPDA from Understat (null if MLS or fetch failed)
  if (xgData?.home) {
    home.xG          = xgData.home.xG          ?? null;
    home.xGA         = xgData.home.xGA         ?? null;
    home.xG_7        = xgData.home.xG_7        ?? null;
    home.xGA_7       = xgData.home.xGA_7       ?? null;
    home.xG_5        = xgData.home.xG_5        ?? null;
    home.xGA_5       = xgData.home.xGA_5       ?? null;
    home.ppda        = xgData.home.ppda        ?? null;
    home.ppdaAllowed = xgData.home.ppdaAllowed ?? null;
  }
  if (xgData?.away) {
    away.xG          = xgData.away.xG          ?? null;
    away.xGA         = xgData.away.xGA         ?? null;
    away.xG_7        = xgData.away.xG_7        ?? null;
    away.xGA_7       = xgData.away.xGA_7       ?? null;
    away.xG_5        = xgData.away.xG_5        ?? null;
    away.xGA_5       = xgData.away.xGA_5       ?? null;
    away.ppda        = xgData.away.ppda        ?? null;
    away.ppdaAllowed = xgData.away.ppdaAllowed ?? null;
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
  // Referee (free from the fixture) + season stats (per-game YC/RC/pen) + H2H.
  const referee = availability?.referee ?? null;
  const refereeStats = availability?.refereeStats ?? null;
  const h2h = availability?.h2h ?? null;
  const congestion = availability?.congestion ?? null;
  if (congestion?.home) home.congestion = congestion.home;
  if (congestion?.away) away.congestion = congestion.away;
  const venueSplits = availability?.venueSplits ?? null;
  if (venueSplits?.home) home.venueSplits = venueSplits.home;
  if (venueSplits?.away) away.venueSplits = venueSplits.away;

  const staleFlags = [];
  if (!homeStats) staleFlags.push('home_team_stats_missing');
  if (!awayStats) staleFlags.push('away_team_stats_missing');
  if (!home.recentForm) staleFlags.push('home_recent_form_missing');
  if (!away.recentForm) staleFlags.push('away_recent_form_missing');
  const motivationAvailable = !!(home.motivation && away.motivation);
  if (standingsPayload && !motivationAvailable) staleFlags.push('motivation_unavailable');
  if (!marketOdds?.threeWay) staleFlags.push('three_way_odds_missing');
  const xgAvailable = !!(xgData?.home?.xG || xgData?.away?.xG);
  if (!xgAvailable) staleFlags.push('xg_unavailable');
  const lineupsAvailable = !!availability;
  if (isSoccerLineupsEnabled() && !lineupsConfirmed) staleFlags.push('lineups_unconfirmed');
  if (!lineupsAvailable) staleFlags.push('availability_unavailable');
  const isRoofed = !!weather?.roof;
  const weatherAvailable = !!weather;            // mapped venue (roofed or with a forecast)
  if (!weatherAvailable) staleFlags.push('weather_unavailable');
  // Only flag referee/H2H as missing when the fixture matched but the datum is
  // absent — a total availability miss is already covered above.
  if (availability && !referee) staleFlags.push('referee_unavailable');
  if (availability && referee && !refereeStats) staleFlags.push('referee_stats_unavailable');
  if (availability && !h2h) staleFlags.push('h2h_unavailable');
  if (availability && !congestion) staleFlags.push('congestion_unavailable');
  if (availability && !venueSplits) staleFlags.push('venue_splits_unavailable');

  const completeness = {
    teamStats:  fractionPresent(homeStats, awayStats),
    recentForm: fractionPresent(home.recentForm, away.recentForm),
    marketOdds: marketOdds?.threeWay ? 1 : 0,
    xG: xgAvailable ? 1 : 0,
    lineups: lineupsConfirmed ? 1 : 0,
    weather: weatherAvailable ? 1 : 0,
  };
  const overall = +(
    (completeness.teamStats  * 0.30 +
     completeness.recentForm * 0.20 +
     completeness.marketOdds * 0.20 +
     completeness.xG         * 0.10 +
     completeness.lineups    * 0.15 +
     completeness.weather    * 0.05).toFixed(2)
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
      weather: {
        ok: weatherAvailable,
        source: weatherAvailable ? (isRoofed ? 'roofed-venue' : 'open-meteo') : 'unavailable — venue unmapped',
        roof: isRoofed,
        stadium: weather?.stadium ?? null,
      },
      referee: {
        ok: !!referee,
        source: referee ? 'api-football' : (availability ? 'not-assigned-yet' : null),
      },
      refereeStats: {
        ok: !!refereeStats,
        source: refereeStats ? 'api-football' : (referee ? 'lookup-failed' : null),
        gamesOfficiated: refereeStats?.gamesOfficiated ?? null,
      },
      h2h: {
        ok: !!h2h,
        source: h2h ? 'api-football' : (availability ? 'no-history' : null),
        meetings: h2h?.meetings ?? 0,
      },
      congestion: {
        ok: !!congestion,
        source: congestion ? 'api-football' : (availability ? 'no-recent-fixtures' : null),
      },
      venueSplits: {
        ok: !!venueSplits,
        source: venueSplits ? 'api-football' : (availability ? 'no-team-statistics' : null),
      },
      motivation: {
        ok: motivationAvailable,
        source: motivationAvailable ? 'espn-standings' : (standingsPayload ? 'position-missing' : 'standings-unavailable'),
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
    weather: weather ?? null,
    referee: referee ?? null,
    refereeStats: refereeStats ?? null,
    h2h: h2h ?? null,
    context_meta,
  };
}

export default { buildSoccerGameContext };
