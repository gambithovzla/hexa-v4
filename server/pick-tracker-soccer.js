/**
 * pick-tracker-soccer.js — Live progress for pending soccer picks (1X2, total, BTTS).
 *
 * Mirrors pick-tracker-nfl.js. Uses getSoccerGamesForDate from soccer-api.js
 * (same source as the resolver) and reuses parseLivePick + calculatePickProgress
 * from the frozen pick-tracker.js after normalizing the ESPN soccer game row
 * into the live-feed shape those helpers expect.
 *
 * Soccer games are daily across six leagues. The pending pick carries its
 * game_date and league — both used to fetch the right ESPN scoreboard.
 * Status detail from ESPN: "1st Half", "Half Time", "2nd Half", "Full Time".
 */

import { getSoccerGamesForDate } from './soccer-api.js';
import { parseLivePick, calculatePickProgress } from './pick-tracker.js';
import { tokenMatchesTeam } from './pick-resolver.js';

function isSoccerGameLive(game) {
  return game?.status === 'live';
}

function isSoccerGameFinal(game) {
  return game?.status === 'final';
}

export function soccerGameToLiveData(game) {
  const isFinal = isSoccerGameFinal(game);
  const isLive  = isSoccerGameLive(game);
  let status = 'scheduled';
  if (isFinal) status = 'final';
  else if (isLive) status = 'live';

  const home = game.teams?.home ?? {};
  const away = game.teams?.away ?? {};

  return {
    gamePk: game.gamePk ?? game.gameId,
    status,
    home: {
      name: home.name ?? '',
      abbreviation: home.abbreviation ?? home.name?.slice(0, 4).toUpperCase() ?? 'HOME',
      score: home.score ?? 0,
    },
    away: {
      name: away.name ?? '',
      abbreviation: away.abbreviation ?? away.name?.slice(0, 4).toUpperCase() ?? 'AWAY',
      score: away.score ?? 0,
    },
    livePeriod: game.statusDetail ?? null,
    liveClock:  null,
    statusDetail: game.statusDetail ?? null,
  };
}

export function findSoccerGameForPick(pick, games) {
  const gamePkInt = pick.game_pk != null ? Number(pick.game_pk) : null;
  if (Number.isFinite(gamePkInt) && gamePkInt > 0) {
    const byId = games.find(g => Number(g.gamePk ?? g.gameId) === gamePkInt);
    if (byId) return byId;
  }
  if (!pick.matchup) return null;
  const parts = pick.matchup.split(/\s+[@vs.]+\s+/i);
  if (parts.length < 2) return null;
  const [awayToken, homeToken] = parts.map(p => p.trim());
  return games.find(g => {
    const h = g.teams?.home ?? {};
    const a = g.teams?.away ?? {};
    return (
      tokenMatchesTeam(awayToken, a.name ?? '', a.abbreviation ?? '') &&
      tokenMatchesTeam(homeToken, h.name ?? '', h.abbreviation ?? '')
    );
  }) ?? null;
}

function formatSoccerDetails(liveData) {
  const hs     = liveData.home?.score ?? 0;
  const as_    = liveData.away?.score ?? 0;
  const period = liveData.livePeriod ?? '';
  const score  = `${liveData.away.abbreviation} ${as_} – ${liveData.home.abbreviation} ${hs}`;
  return period ? `${score} (${period})` : score;
}

function patchProgressDetails(parsed, progress, liveData) {
  if (!progress) return null;
  return { ...progress, details: formatSoccerDetails(liveData) };
}

/**
 * @param {object} pick             — row from picks (sport='soccer', game_pk, game_date, league)
 * @param {Map<string, object[]>}   gamesByLeagueDate — cache "leagueSlug:date" → scoreboard rows
 */
export async function buildSoccerPickLiveProgressEntry(pick, gamesByLeagueDate) {
  const base = { pickId: pick.id, pick: pick.pick, matchup: pick.matchup, sport: 'soccer' };

  const lookupDate = pick.game_date ?? null;
  const leagueSlug = pick.league ?? 'eng.1';
  if (!lookupDate) return { ...base, progress: null, status: 'no_game_date' };

  const cacheKey = `${leagueSlug}:${lookupDate}`;
  let games = gamesByLeagueDate.get(cacheKey);
  if (!games) {
    try {
      games = await getSoccerGamesForDate(leagueSlug, lookupDate);
    } catch {
      games = [];
    }
    gamesByLeagueDate.set(cacheKey, games);
  }

  const soccerGame = findSoccerGameForPick(pick, games);
  if (!soccerGame) return { ...base, progress: null, status: 'no_game_found' };

  const liveData   = soccerGameToLiveData(soccerGame);
  const liveStatus = String(liveData.status ?? '').toLowerCase();

  if (liveStatus === 'scheduled') {
    return { ...base, gamePk: soccerGame.gamePk, progress: null, status: 'not_started' };
  }

  const parsed = parseLivePick(pick.pick);
  if (!parsed) {
    return { ...base, gamePk: soccerGame.gamePk, progress: null, status: 'unknown_pick' };
  }
  if (parsed.type === 'player_prop') {
    return { ...base, gamePk: soccerGame.gamePk, progress: null, status: 'unsupported_market', label: pick.pick };
  }

  const progress = patchProgressDetails(
    parsed,
    calculatePickProgress(parsed, liveData),
    liveData,
  );

  return {
    ...base,
    gamePk: soccerGame.gamePk,
    confidence: pick.oracle_confidence,
    period: liveData.livePeriod ?? null,
    clock: null,
    ...progress,
  };
}
