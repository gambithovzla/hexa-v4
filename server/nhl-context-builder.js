/**
 * nhl-context-builder.js — assembles a rich game context payload for NHL picks.
 *
 * Mirrors nfl-context-builder.js / nba-context-builder.js, scoped to NHL.
 * Consumes nhl-api.js for team stats (standings-derived), recent form, and ESPN
 * injuries. Always returns a `context_meta` block exposing data freshness and
 * completeness so the admin UI and downstream guards can gate on quality.
 *
 * NHL-specific shape vs NFL:
 *   - NO weather dimension — hockey is played indoors (weather-neutral always).
 *   - GOALIE availability is the dominant variable (the disposability gate),
 *     surfaced from injuries (position 'G') the way the NFL builder surfaces QB.
 *   - rest / back-to-back derived from the schedule (dense 82-game calendar).
 *   - PP% / PK% (special teams) present but null until a richer source lands.
 */

import {
  getNhlTeamStats,
  getNhlTeamRecentGames,
  getNhlLeagueInjuries,
  findTeamInjuries,
} from './nhl-api.js';
import { resolveNhlTeamId, getNhlTeam } from './nhl-team-map.js';

function diffDays(fromDateStr, toDateStr) {
  if (!fromDateStr || !toDateStr) return null;
  const a = new Date(fromDateStr);
  const b = new Date(toDateStr);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function recentFormSummary(games) {
  if (!games?.length) return null;
  const wins = games.filter(g => g.result === 'W').length;
  const losses = games.filter(g => g.result === 'L').length;
  const gf = games.filter(g => g.goals_for != null);
  const ga = games.filter(g => g.goals_against != null);
  const avg = arr => (arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 100) / 100 : null);
  return {
    record: `${wins}-${losses}`,
    avgGoalsFor: avg(gf.map(g => g.goals_for)),
    avgGoalsAgainst: avg(ga.map(g => g.goals_against)),
    games: games.map(g => ({
      date: g.game_date,
      opponent: g.opponent,
      homeAway: g.home_away,
      result: g.result,
      goalsFor: g.goals_for,
      goalsAgainst: g.goals_against,
    })),
  };
}

function rankInjuriesBySeverity(injuries) {
  const order = { out_for_season: 0, out: 1, doubtful: 2, questionable: 3, game_time_decision: 4, probable: 5, day_to_day: 6, unknown: 7 };
  return [...injuries].sort((a, b) => (order[a.statusKey] ?? 99) - (order[b.statusKey] ?? 99));
}

function summariseInjuries(record) {
  if (!record || !Array.isArray(record.injuries)) {
    return { ok: false, count: 0, items: [], severeCount: 0, goalieStatus: null };
  }
  const items = rankInjuriesBySeverity(record.injuries);
  const severeCount = items.filter(i => ['out', 'doubtful', 'out_for_season'].includes(i.statusKey)).length;
  // Goalie is the dominant NHL variable — surface the most severe goalie injury, if any.
  const g = items.find(i => String(i.position).toUpperCase() === 'G');
  const goalieStatus = g ? { playerName: g.playerName, status: g.status, statusKey: g.statusKey } : null;
  return { ok: true, count: items.length, items, severeCount, goalieStatus };
}

function fractionPresent(...vals) {
  const total = vals.length || 1;
  const present = vals.filter(v => v != null).length;
  return Math.round((present / total) * 100) / 100;
}

function lookupTeamStats(teamStats, teamId, teamAbbr) {
  if (!Array.isArray(teamStats) || teamStats.length === 0) return null;
  if (teamAbbr) {
    const byAbbr = teamStats.find(t => String(t.team_abbr).toUpperCase() === String(teamAbbr).toUpperCase());
    if (byAbbr) return byAbbr;
  }
  if (teamId != null) {
    const byId = teamStats.find(t => String(t.team_id) === String(teamId));
    if (byId) return byId;
  }
  return null;
}

function buildTeamBlock(stats, recentGames, injuries, teamId, teamAbbr, gameDate) {
  const meta = getNhlTeam({ teamId, teamAbbr }) ?? {};
  const lastGame = recentGames[0] ?? null;
  const rest = diffDays(lastGame?.game_date, gameDate);
  return {
    teamId: teamId ?? null,
    teamAbbr: stats?.team_abbr ?? meta.abbr ?? teamAbbr ?? null,
    teamName: stats?.team_name ?? meta.name ?? null,
    conference: stats?.conference ?? meta.conference ?? null,
    division: stats?.division ?? meta.division ?? null,
    record: stats ? `${stats.wins ?? 0}-${stats.losses ?? 0}-${stats.ot_losses ?? 0}` : null,
    points: stats?.points ?? null,
    pointsPct: stats?.points_pct ?? null,
    goalsForPerGame: stats?.gf_per_game ?? null,
    goalsAgainstPerGame: stats?.ga_per_game ?? null,
    goalDiff: stats?.goal_diff ?? null,
    // richer-source (null until special-teams fetcher):
    ppPct: stats?.pp_pct ?? null,
    pkPct: stats?.pk_pct ?? null,
    shotsForPerGame: stats?.shots_for_per_game ?? null,
    shotsAgainstPerGame: stats?.shots_against_per_game ?? null,
    faceoffPct: stats?.faceoff_pct ?? null,
    restDays: rest,
    isBackToBack: rest != null ? rest <= 1 : null,
    recentForm: recentFormSummary(recentGames),
    injuries,
    goalieStatus: injuries.goalieStatus,
  };
}

/**
 * buildNhlGameContext({ homeTeamId, awayTeamId, homeTeamAbbr, awayTeamAbbr, gameDate, season?, marketOdds? })
 *
 * Returns { season, gameDate, home, away, context_meta }.
 */
export async function buildNhlGameContext({
  homeTeamId,
  awayTeamId,
  homeTeamAbbr = null,
  awayTeamAbbr = null,
  gameDate,
  season = null,
  marketOdds = null,
}) {
  const startedAt = Date.now();

  const homeId = resolveNhlTeamId({ teamId: homeTeamId, teamAbbr: homeTeamAbbr });
  const awayId = resolveNhlTeamId({ teamId: awayTeamId, teamAbbr: awayTeamAbbr });

  const [teamStats, homeGames, awayGames, injuriesPayload] = await Promise.all([
    getNhlTeamStats(season).catch(err => {
      console.warn(`[nhl-context] team stats failed: ${err.message}`);
      return [];
    }),
    getNhlTeamRecentGames(homeId, season, 8).catch(err => {
      console.warn(`[nhl-context] home recent games failed: ${err.message}`);
      return [];
    }),
    getNhlTeamRecentGames(awayId, season, 8).catch(err => {
      console.warn(`[nhl-context] away recent games failed: ${err.message}`);
      return [];
    }),
    getNhlLeagueInjuries().catch(err => {
      console.warn(`[nhl-context] injuries failed: ${err.message}`);
      return { byTeamId: {}, byAbbr: {}, fetchedAt: null, source: 'unavailable', stale: true };
    }),
  ]);

  const homeStats = lookupTeamStats(teamStats, homeId, homeTeamAbbr);
  const awayStats = lookupTeamStats(teamStats, awayId, awayTeamAbbr);

  const homeInjuries = summariseInjuries(findTeamInjuries(injuriesPayload, { teamId: homeId, teamAbbr: homeTeamAbbr }));
  const awayInjuries = summariseInjuries(findTeamInjuries(injuriesPayload, { teamId: awayId, teamAbbr: awayTeamAbbr }));

  const home = buildTeamBlock(homeStats, homeGames, homeInjuries, homeId, homeTeamAbbr, gameDate);
  const away = buildTeamBlock(awayStats, awayGames, awayInjuries, awayId, awayTeamAbbr, gameDate);

  const staleFlags = [];
  if (!homeStats) staleFlags.push('home_team_stats_missing');
  if (!awayStats) staleFlags.push('away_team_stats_missing');
  if (!homeGames.length) staleFlags.push('home_recent_games_missing');
  if (!awayGames.length) staleFlags.push('away_recent_games_missing');
  if (injuriesPayload.source === 'unavailable') staleFlags.push('injuries_unavailable');
  else if (injuriesPayload.stale) staleFlags.push('injuries_stale');
  if (!homeStats?.pp_pct && !awayStats?.pp_pct) staleFlags.push('special_teams_unavailable');
  if (!marketOdds) staleFlags.push('market_odds_missing');

  const completeness = {
    teamStats: fractionPresent(homeStats, awayStats),
    recentForm: fractionPresent(homeGames.length ? 1 : null, awayGames.length ? 1 : null),
    injuries: injuriesPayload.source === 'espn' ? 1 : 0,
    specialTeams: (homeStats?.pp_pct != null && awayStats?.pp_pct != null) ? 1 : 0,
    marketOdds: marketOdds ? 1 : 0,
  };
  const overall = +(
    (completeness.teamStats * 0.40 +
     completeness.recentForm * 0.25 +
     completeness.injuries * 0.20 +
     completeness.specialTeams * 0.05 +
     completeness.marketOdds * 0.10).toFixed(2)
  );

  const context_meta = {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    teamIds: {
      home: { input: homeTeamId ?? null, resolved: homeId ?? null },
      away: { input: awayTeamId ?? null, resolved: awayId ?? null },
    },
    sources: {
      teamStats: { ok: !!(homeStats && awayStats), source: 'espn-standings', n: teamStats.length },
      recentForm: { ok: !!(homeGames.length && awayGames.length), source: 'espn', n: { home: homeGames.length, away: awayGames.length } },
      injuries: {
        ok: injuriesPayload.source === 'espn',
        source: injuriesPayload.source,
        stale: !!injuriesPayload.stale,
        fetchedAt: injuriesPayload.fetchedAt,
        count: { home: homeInjuries.count, away: awayInjuries.count },
        severe: { home: homeInjuries.severeCount, away: awayInjuries.severeCount },
        goalie: { home: homeInjuries.goalieStatus, away: awayInjuries.goalieStatus },
      },
      marketOdds: { ok: !!marketOdds, source: marketOdds?.source ?? null, provided: marketOdds ? (marketOdds.provided ?? 'server') : null },
    },
    completeness,
    overallCompleteness: overall,
    staleFlags,
  };

  return { season, gameDate, home, away, context_meta };
}
