/**
 * nba-context-builder.js — assembles a rich game context payload for NBA picks.
 *
 * Mirrors the role of context-builder.js for MLB, but scoped to NBA.
 * Consumes nba-api.js for team stats, game logs and ESPN injuries.
 *
 * Returns a structured object the Oracle (or a future NBA-specific prompt)
 * can include in its LLM call. Always returns a `context_meta` block exposing
 * data freshness/completeness so the admin UI and downstream validators can
 * gate decisions on quality.
 */

import {
  getNbaLeagueTeamStats,
  getNbaTeamRecentGames,
  getNbaLeagueInjuries,
  findTeamInjuries,
} from './nba-api.js';
import { resolveNbaStatsTeamId, isNbaStatsTeamId } from './nba-team-map.js';

const CURRENT_SEASON = '2025-26';

function daysRest(lastGameDate, gameDateStr) {
  if (!lastGameDate || !gameDateStr) return null;
  const last = new Date(lastGameDate);
  const game = new Date(gameDateStr);
  if (isNaN(last.getTime()) || isNaN(game.getTime())) return null;
  return Math.round((game - last) / (1000 * 60 * 60 * 24));
}

function recentFormSummary(games) {
  if (!games.length) return null;
  const wins   = games.filter(g => g.wl === 'W').length;
  const avgPts = games.reduce((s, g) => s + (g.pts ?? 0), 0) / games.length;
  const oppGames = games.filter(g => g.opp_pts != null);
  const avgOpp = oppGames.length
    ? oppGames.reduce((s, g) => s + g.opp_pts, 0) / oppGames.length
    : null;
  const pmGames = games.filter(g => g.plus_minus != null);
  const avgPm = pmGames.length
    ? pmGames.reduce((s, g) => s + g.plus_minus, 0) / pmGames.length
    : null;
  return {
    record: `${wins}-${games.length - wins}`,
    avgPts: Math.round(avgPts * 10) / 10,
    avgOppPts: avgOpp != null ? Math.round(avgOpp * 10) / 10 : null,
    avgPlusMinus: avgPm != null ? Math.round(avgPm * 10) / 10 : null,
    games: games.map(g => ({
      date: g.game_date,
      matchup: g.matchup,
      result: g.wl,
      pts: g.pts,
      opp_pts: g.opp_pts,
      plus_minus: g.plus_minus,
    })),
  };
}

/**
 * Look up team season stats. Game IDs can come from ESPN (small int) or
 * stats.nba.com (1610612xxx) — falling back to abbreviation prevents the
 * "data unavailable" failure mode on Railway where ESPN is the primary source.
 */
function lookupTeamStats(teamStats, teamId, teamAbbr) {
  if (!Array.isArray(teamStats) || teamStats.length === 0) return null;
  if (teamId != null) {
    const byId = teamStats.find(t => String(t.team_id) === String(teamId));
    if (byId) return byId;
  }
  if (teamAbbr) {
    const byAbbr = teamStats.find(t => String(t.team_abbr).toUpperCase() === String(teamAbbr).toUpperCase());
    if (byAbbr) return byAbbr;
  }
  return null;
}

function rankInjuriesBySeverity(injuries) {
  const order = { out_for_season: 0, out: 1, doubtful: 2, questionable: 3, game_time_decision: 4, probable: 5, day_to_day: 6, unknown: 7 };
  return [...injuries].sort((a, b) => {
    const ra = order[a.statusKey] ?? 99;
    const rb = order[b.statusKey] ?? 99;
    return ra - rb;
  });
}

function summariseInjuries(record) {
  if (!record || !Array.isArray(record.injuries)) {
    return { ok: false, count: 0, items: [], severeCount: 0 };
  }
  const items = rankInjuriesBySeverity(record.injuries);
  const severeCount = items.filter(i => i.statusKey === 'out' || i.statusKey === 'doubtful' || i.statusKey === 'out_for_season').length;
  return { ok: true, count: items.length, items, severeCount };
}

function fractionPresent(...vals) {
  const total = vals.length || 1;
  const present = vals.filter(v => v != null).length;
  return Math.round((present / total) * 100) / 100;
}

/**
 * buildNbaGameContext({ homeTeamId, awayTeamId, homeTeamAbbr, awayTeamAbbr, gameDate, season?, marketOdds? })
 *
 * Returns { season, gameDate, home, away, context_meta }.
 * `context_meta` is always present and describes data freshness and completeness
 * per source. Callers should propagate it to the admin response so quality gates
 * can be enforced server-side and visualised in the UI.
 */
export async function buildNbaGameContext({
  homeTeamId,
  awayTeamId,
  homeTeamAbbr = null,
  awayTeamAbbr = null,
  gameDate,
  season = CURRENT_SEASON,
  marketOdds = null,
}) {
  const startedAt = Date.now();

  const homeStatsTeamId = resolveNbaStatsTeamId({ teamId: homeTeamId, teamAbbr: homeTeamAbbr });
  const awayStatsTeamId = resolveNbaStatsTeamId({ teamId: awayTeamId, teamAbbr: awayTeamAbbr });

  const [teamStats, homeGames, awayGames, injuriesPayload] = await Promise.all([
    getNbaLeagueTeamStats(season).catch(err => {
      console.warn(`[nba-context] team stats fetch failed: ${err.message}`);
      return [];
    }),
    getNbaTeamRecentGames(homeStatsTeamId, season, 10).catch(err => {
      console.warn(`[nba-context] home recent games failed: ${err.message}`);
      return [];
    }),
    getNbaTeamRecentGames(awayStatsTeamId, season, 10).catch(err => {
      console.warn(`[nba-context] away recent games failed: ${err.message}`);
      return [];
    }),
    getNbaLeagueInjuries().catch(err => {
      console.warn(`[nba-context] injuries fetch failed: ${err.message}`);
      return { byTeamId: {}, byAbbr: {}, fetchedAt: null, source: 'unavailable', stale: true };
    }),
  ]);

  const homeStats = lookupTeamStats(teamStats, homeStatsTeamId, homeTeamAbbr);
  const awayStats = lookupTeamStats(teamStats, awayStatsTeamId, awayTeamAbbr);

  const homeLastGame = homeGames[0] ?? null;
  const awayLastGame = awayGames[0] ?? null;

  const homeInjuriesRecord = findTeamInjuries(injuriesPayload, { teamId: homeTeamId, teamAbbr: homeTeamAbbr });
  const awayInjuriesRecord = findTeamInjuries(injuriesPayload, { teamId: awayTeamId, teamAbbr: awayTeamAbbr });
  const homeInjuries = summariseInjuries(homeInjuriesRecord);
  const awayInjuries = summariseInjuries(awayInjuriesRecord);

  const home = {
    teamId: homeStatsTeamId ?? homeTeamId,
    teamAbbr: homeStats?.team_abbr ?? homeTeamAbbr ?? null,
    teamName: homeStats?.team_name ?? null,
    record: homeStats ? `${homeStats.wins}-${homeStats.losses}` : null,
    offRating: homeStats?.off_rating ?? null,
    defRating: homeStats?.def_rating ?? null,
    netRating: homeStats?.net_rating ?? null,
    pace:      homeStats?.pace ?? null,
    tsPct:     homeStats?.ts_pct ?? null,
    rebPct:    homeStats?.reb_pct ?? null,
    astPct:    homeStats?.ast_pct ?? null,
    daysRest:  daysRest(homeLastGame?.game_date, gameDate),
    recentForm: recentFormSummary(homeGames),
    injuries:  homeInjuries,
  };

  const away = {
    teamId: awayStatsTeamId ?? awayTeamId,
    teamAbbr: awayStats?.team_abbr ?? awayTeamAbbr ?? null,
    teamName: awayStats?.team_name ?? null,
    record: awayStats ? `${awayStats.wins}-${awayStats.losses}` : null,
    offRating: awayStats?.off_rating ?? null,
    defRating: awayStats?.def_rating ?? null,
    netRating: awayStats?.net_rating ?? null,
    pace:      awayStats?.pace ?? null,
    tsPct:     awayStats?.ts_pct ?? null,
    rebPct:    awayStats?.reb_pct ?? null,
    astPct:    awayStats?.ast_pct ?? null,
    daysRest:  daysRest(awayLastGame?.game_date, gameDate),
    recentForm: recentFormSummary(awayGames),
    injuries:  awayInjuries,
  };

  const staleFlags = [];
  if (!homeStats) staleFlags.push('home_team_stats_missing');
  if (!awayStats) staleFlags.push('away_team_stats_missing');
  if (!homeGames.length) staleFlags.push('home_recent_games_missing');
  if (!awayGames.length) staleFlags.push('away_recent_games_missing');
  if (injuriesPayload.source === 'unavailable') staleFlags.push('injuries_unavailable');
  else if (injuriesPayload.stale)               staleFlags.push('injuries_stale');
  if (!marketOdds) staleFlags.push('market_odds_missing');

  const completeness = {
    teamStats:    fractionPresent(homeStats, awayStats),
    recentForm:   fractionPresent(homeGames.length ? 1 : null, awayGames.length ? 1 : null),
    injuries:     injuriesPayload.source === 'espn' ? 1 : 0,
    marketOdds:   marketOdds ? 1 : 0,
  };
  const overall = +(
    (completeness.teamStats * 0.4 +
     completeness.recentForm * 0.3 +
     completeness.injuries * 0.15 +
     completeness.marketOdds * 0.15).toFixed(2)
  );

  const context_meta = {
    generatedAt: new Date().toISOString(),
    durationMs:  Date.now() - startedAt,
    teamIds: {
      home: {
        input: homeTeamId ?? null,
        stats: homeStatsTeamId ?? null,
        mapped: !!(homeStatsTeamId && homeTeamId && !isNbaStatsTeamId(homeTeamId)),
      },
      away: {
        input: awayTeamId ?? null,
        stats: awayStatsTeamId ?? null,
        mapped: !!(awayStatsTeamId && awayTeamId && !isNbaStatsTeamId(awayTeamId)),
      },
    },
    sources: {
      teamStats:   { ok: !!(homeStats && awayStats), source: 'stats.nba.com', n: teamStats.length },
      recentForm:  { ok: !!(homeGames.length && awayGames.length), source: 'stats.nba.com', n: { home: homeGames.length, away: awayGames.length } },
      injuries:    {
        ok: injuriesPayload.source === 'espn',
        source: injuriesPayload.source,
        stale: !!injuriesPayload.stale,
        fetchedAt: injuriesPayload.fetchedAt,
        count: { home: homeInjuries.count, away: awayInjuries.count },
        severe: { home: homeInjuries.severeCount, away: awayInjuries.severeCount },
      },
      marketOdds:  { ok: !!marketOdds, source: marketOdds?.source ?? null, provided: marketOdds ? (marketOdds.provided ?? 'server') : null },
    },
    completeness,
    overallCompleteness: overall,
    staleFlags,
  };

  return { season, gameDate, home, away, context_meta };
}
