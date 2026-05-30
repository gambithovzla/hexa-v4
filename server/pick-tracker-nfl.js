/**
 * pick-tracker-nfl.js — Live progress for pending NFL picks (moneyline, spread, total).
 *
 * Mirrors pick-tracker-nba.js. Uses ESPN scoreboard rows from nfl-api.js (same
 * source as the resolver) and reuses parseLivePick + calculatePickProgress from
 * the frozen pick-tracker.js after normalizing a game row into the live-feed
 * shape those helpers expect.
 *
 * NFL games are weekly, so live lookup goes through getNflGamesForDate(gameDate)
 * (single-day) — the pending pick carries its own game_date.
 */

import { getNflGamesForDate } from './nfl-api.js';
import { parseLivePick, calculatePickProgress } from './pick-tracker.js';
import { tokenMatchesTeam } from './pick-resolver.js';

function isNflGameLive(game) {
  if (game?.game_status_id === 2) return true;
  const status = String(game?.status ?? '').toLowerCase();
  return /in progress|halftime|end of|q\d|\bot\b|overtime/.test(status);
}

function isNflGameFinal(game) {
  if (game?.game_status_id === 3) return true;
  return /final/i.test(String(game?.status ?? ''));
}

export function nflGameToLiveData(game) {
  const isFinal = isNflGameFinal(game);
  const isLive = isNflGameLive(game);
  let status = 'scheduled';
  if (isFinal) status = 'final';
  else if (isLive) status = 'live';

  return {
    gamePk: game.game_id,
    status,
    home: { name: game.home_team_name ?? '', abbreviation: game.home_team_abbr ?? '', score: game.home_score ?? 0 },
    away: { name: game.away_team_name ?? '', abbreviation: game.away_team_abbr ?? '', score: game.away_score ?? 0 },
    livePeriod: game.live_period ?? null,
    liveClock: game.live_clock ?? null,
    statusDetail: game.status ?? null,
  };
}

export function findNflGameForPick(pick, games) {
  const gamePkInt = pick.game_pk != null ? Number(pick.game_pk) : null;
  if (Number.isFinite(gamePkInt) && gamePkInt > 0) {
    const byId = games.find(g => parseInt(String(g.game_id), 10) === gamePkInt);
    if (byId) return byId;
  }
  if (!pick.matchup) return null;
  const parts = pick.matchup.split(/\s+[@vs.]+\s+/i);
  if (parts.length < 2) return null;
  const [awayToken, homeToken] = parts.map(p => p.trim());
  return games.find(g =>
    tokenMatchesTeam(awayToken, g.away_team_name ?? '', g.away_team_abbr ?? '') &&
    tokenMatchesTeam(homeToken, g.home_team_name ?? '', g.home_team_abbr ?? '')
  ) ?? null;
}

export async function getNflLiveGameData(gameId, dateStr) {
  const games = await getNflGamesForDate(dateStr);
  const game = games.find(g => String(g.game_id) === String(gameId));
  if (!game) return null;
  return nflGameToLiveData(game);
}

function formatTotalDetails(liveData) {
  const homeScore = liveData.home?.score ?? 0;
  const awayScore = liveData.away?.score ?? 0;
  return `${liveData.away.abbreviation} ${awayScore} — ${liveData.home.abbreviation} ${homeScore} (${homeScore + awayScore} pts)`;
}

function patchProgressDetails(parsed, progress, liveData) {
  if (parsed?.type === 'total' && progress?.details) {
    return { ...progress, details: formatTotalDetails(liveData) };
  }
  if ((parsed?.type === 'moneyline' || parsed?.type === 'runline') && progress?.details) {
    const homeScore = liveData.home?.score ?? 0;
    const awayScore = liveData.away?.score ?? 0;
    return {
      ...progress,
      details: `${liveData.away.abbreviation} ${awayScore} — ${liveData.home.abbreviation} ${homeScore}`,
    };
  }
  return progress;
}

/**
 * @param {object} pick — row from picks (+ game_pk, game_date)
 * @param {Map<string, object[]>} gamesByDate — cache date → scoreboard rows
 */
export async function buildNflPickLiveProgressEntry(pick, gamesByDate) {
  const base = { pickId: pick.id, pick: pick.pick, matchup: pick.matchup, sport: 'nfl' };

  const lookupDate = pick.game_date ?? null;
  if (!lookupDate) return { ...base, progress: null, status: 'no_game_date' };

  let games = gamesByDate.get(lookupDate);
  if (!games) {
    games = await getNflGamesForDate(lookupDate);
    gamesByDate.set(lookupDate, games);
  }

  const nflGame = findNflGameForPick(pick, games);
  if (!nflGame) return { ...base, progress: null, status: 'no_game_found' };

  const liveData = nflGameToLiveData(nflGame);
  const liveStatus = String(liveData.status ?? '').toLowerCase();

  if (liveStatus === 'scheduled') {
    return { ...base, gamePk: nflGame.game_id, progress: null, status: 'not_started' };
  }

  const parsed = parseLivePick(pick.pick);
  if (!parsed) {
    return { ...base, gamePk: nflGame.game_id, progress: null, status: 'unknown_pick' };
  }
  if (parsed.type === 'player_prop') {
    return { ...base, gamePk: nflGame.game_id, progress: null, status: 'unsupported_market', label: pick.pick };
  }

  const progress = patchProgressDetails(parsed, calculatePickProgress(parsed, liveData), liveData);

  return {
    ...base,
    gamePk: nflGame.game_id,
    confidence: pick.oracle_confidence,
    period: nflGame.live_period ?? null,
    clock: nflGame.live_clock ?? null,
    ...progress,
  };
}
