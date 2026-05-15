/**
 * pick-tracker-nba.js — Live progress for pending NBA picks (moneyline, spread, total).
 *
 * Uses ESPN/NBA scoreboard data from nba-api.js (same source as the resolver).
 * Reuses parseLivePick + calculatePickProgress from pick-tracker.js after normalizing
 * game rows into the live-feed shape those helpers expect.
 */

import { getNbaGamesForDate } from './nba-api.js';
import { parseLivePick, calculatePickProgress } from './pick-tracker.js';
import { tokenMatchesTeam } from './pick-resolver.js';

function isNbaGameLive(game) {
  if (game?.game_status_id === 2) return true;
  const status = String(game?.status ?? '').toLowerCase();
  return /in progress|halftime|end q|q\d|overtime|\bot\b/.test(status);
}

function isNbaGameFinal(game) {
  if (game?.game_status_id === 3) return true;
  return /final/i.test(String(game?.status ?? ''));
}

export function nbaGameToLiveData(game) {
  const isLive = isNbaGameLive(game);
  const isFinal = isNbaGameFinal(game);
  let status = 'scheduled';
  if (isFinal) status = 'final';
  else if (isLive) status = 'live';

  return {
    gamePk: game.game_id,
    status,
    home: {
      name: game.home_team_name ?? '',
      abbreviation: game.home_team_abbr ?? '',
      score: game.home_score ?? 0,
    },
    away: {
      name: game.away_team_name ?? '',
      abbreviation: game.away_team_abbr ?? '',
      score: game.away_score ?? 0,
    },
    livePeriod: game.live_period ?? null,
    liveClock: game.live_clock ?? null,
    statusDetail: game.status ?? null,
  };
}

export function findNbaGameForPick(pick, games) {
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

export async function getNbaLiveGameData(gameId, dateStr) {
  const games = await getNbaGamesForDate(dateStr);
  const game = games.find(g => String(g.game_id) === String(gameId));
  if (!game) return null;
  return nbaGameToLiveData(game);
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
export async function buildNbaPickLiveProgressEntry(pick, gamesByDate) {
  const base = {
    pickId: pick.id,
    pick: pick.pick,
    matchup: pick.matchup,
    sport: 'nba',
  };

  const lookupDate = pick.game_date ?? null;
  if (!lookupDate) {
    return { ...base, progress: null, status: 'no_game_date' };
  }

  let games = gamesByDate.get(lookupDate);
  if (!games) {
    games = await getNbaGamesForDate(lookupDate);
    gamesByDate.set(lookupDate, games);
  }

  const nbaGame = findNbaGameForPick(pick, games);
  if (!nbaGame) {
    return { ...base, progress: null, status: 'no_game_found' };
  }

  const liveData = nbaGameToLiveData(nbaGame);
  const liveStatus = String(liveData.status ?? '').toLowerCase();

  if (liveStatus === 'scheduled') {
    return {
      ...base,
      gamePk: nbaGame.game_id,
      progress: null,
      status: 'not_started',
    };
  }

  const parsed = parseLivePick(pick.pick);
  if (!parsed) {
    return {
      ...base,
      gamePk: nbaGame.game_id,
      progress: null,
      status: 'unknown_pick',
    };
  }

  if (parsed.type === 'player_prop') {
    return {
      ...base,
      gamePk: nbaGame.game_id,
      progress: null,
      status: 'unsupported_market',
      label: pick.pick,
    };
  }

  const progress = patchProgressDetails(parsed, calculatePickProgress(parsed, liveData), liveData);

  return {
    ...base,
    gamePk: nbaGame.game_id,
    confidence: pick.oracle_confidence,
    period: nbaGame.live_period ?? null,
    clock: nbaGame.live_clock ?? null,
    ...progress,
  };
}
