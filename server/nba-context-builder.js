/**
 * nba-context-builder.js — assembles a rich game context payload for NBA picks.
 *
 * Mirrors the role of context-builder.js for MLB, but scoped to NBA.
 * Consumes nba-api.js for team stats and recent game logs.
 *
 * Returns a structured object the Oracle (or a future NBA-specific prompt)
 * can include in its LLM call.
 */

import {
  getNbaLeagueTeamStats,
  getNbaTeamRecentGames,
} from './nba-api.js';

const CURRENT_SEASON = '2025-26';

/**
 * Compute simple rest-days metric from recent game log.
 * lastGameDate is a string like 'OCT 14, 2025' from the NBA game log.
 */
function daysRest(lastGameDate, gameDateStr) {
  if (!lastGameDate || !gameDateStr) return null;
  const last = new Date(lastGameDate);
  const game = new Date(gameDateStr);
  if (isNaN(last.getTime()) || isNaN(game.getTime())) return null;
  return Math.round((game - last) / (1000 * 60 * 60 * 24));
}

/**
 * Summarise the last N games into a concise object for the LLM.
 */
function recentFormSummary(games) {
  if (!games.length) return null;
  const wins   = games.filter(g => g.wl === 'W').length;
  const avgPts = games.reduce((s, g) => s + (g.pts ?? 0), 0) / games.length;
  const avgOpp = games.reduce((s, g) => s + (g.opp_pts ?? 0), 0) / games.length;
  const avgPm  = games.reduce((s, g) => s + (g.plus_minus ?? 0), 0) / games.length;
  return {
    record: `${wins}-${games.length - wins}`,
    avgPts: Math.round(avgPts * 10) / 10,
    avgOppPts: Math.round(avgOpp * 10) / 10,
    avgPlusMinus: Math.round(avgPm * 10) / 10,
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
 * buildNbaGameContext({ homeTeamId, awayTeamId, gameDate, season? })
 *
 * Fetches team efficiency stats + last-10 game logs for both teams,
 * then assembles a single payload object ready to be serialised into
 * an LLM prompt.
 *
 * All NBA API calls are cached in nba-api.js, so repeated calls within
 * a session are cheap.
 */
export async function buildNbaGameContext({ homeTeamId, awayTeamId, gameDate, season = CURRENT_SEASON }) {
  const [teamStats, homeGames, awayGames] = await Promise.all([
    getNbaLeagueTeamStats(season),
    getNbaTeamRecentGames(homeTeamId, season, 10),
    getNbaTeamRecentGames(awayTeamId, season, 10),
  ]);

  const statsById = Object.fromEntries(teamStats.map(t => [String(t.team_id), t]));
  const homeStats = statsById[String(homeTeamId)] ?? null;
  const awayStats = statsById[String(awayTeamId)] ?? null;

  const homeLastGame = homeGames[0] ?? null;
  const awayLastGame = awayGames[0] ?? null;

  return {
    season,
    gameDate,
    home: {
      teamId: homeTeamId,
      teamAbbr: homeStats?.team_abbr ?? null,
      teamName: homeStats?.team_name ?? null,
      record: homeStats ? `${homeStats.wins}-${homeStats.losses}` : null,
      offRating: homeStats?.off_rating ?? null,
      defRating: homeStats?.def_rating ?? null,
      netRating: homeStats?.net_rating ?? null,
      pace: homeStats?.pace ?? null,
      tsPct: homeStats?.ts_pct ?? null,
      rebPct: homeStats?.reb_pct ?? null,
      astPct: homeStats?.ast_pct ?? null,
      daysRest: daysRest(homeLastGame?.game_date, gameDate),
      recentForm: recentFormSummary(homeGames),
    },
    away: {
      teamId: awayTeamId,
      teamAbbr: awayStats?.team_abbr ?? null,
      teamName: awayStats?.team_name ?? null,
      record: awayStats ? `${awayStats.wins}-${awayStats.losses}` : null,
      offRating: awayStats?.off_rating ?? null,
      defRating: awayStats?.def_rating ?? null,
      netRating: awayStats?.net_rating ?? null,
      pace: awayStats?.pace ?? null,
      tsPct: awayStats?.ts_pct ?? null,
      rebPct: awayStats?.reb_pct ?? null,
      astPct: awayStats?.ast_pct ?? null,
      daysRest: daysRest(awayLastGame?.game_date, gameDate),
      recentForm: recentFormSummary(awayGames),
    },
  };
}
