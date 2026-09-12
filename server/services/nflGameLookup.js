/**
 * nflGameLookup.js — resolving an NFL game (or the day's slate) from whatever
 * locator a caller happens to hold.
 *
 * NFL schedules are weekly, so a `date` is often the day the client asked on
 * rather than kickoff day (Thu/Sun/Mon) — a Saturday lookup matched no games at
 * all and the analyze route answered 404 for a game the selector had just shown.
 * These helpers try every locator in turn and end on ESPN's per-event summary,
 * so a bare game id always resolves.
 */

import { getNflGamesForWeek, getNflGamesForDate, getNflGameById } from '../nfl-api.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * findNflGame({ gameId, season, seasonType, week, date }) → game | null
 * Order: explicit week → explicit date → current week → per-event summary.
 */
export async function findNflGame({ gameId, season = null, seasonType = null, week = null, date = null } = {}) {
  if (gameId == null || gameId === '') return null;
  const wanted = String(gameId);
  const inList = games => (Array.isArray(games) ? games.find(g => String(g.game_id) === wanted) ?? null : null);

  const hasWeek = season != null || seasonType != null || week != null;
  const attempts = [];
  if (hasWeek) attempts.push(() => getNflGamesForWeek({ season, seasonType, week }));
  if (date && ISO_DATE.test(String(date))) attempts.push(() => getNflGamesForDate(date));
  if (!hasWeek) attempts.push(() => getNflGamesForWeek({}));

  for (const attempt of attempts) {
    const hit = inList(await attempt());
    if (hit) return hit;
  }
  return await getNflGameById(wanted);
}

/**
 * resolveNflSlate({ season, seasonType, week, date }) → game[]
 * Week locators win, then the date; an empty answer falls through to the current
 * week, since NFL days without games (Tue–Wed, or the day before kickoff) would
 * otherwise render an empty board.
 */
export async function resolveNflSlate({ season = null, seasonType = null, week = null, date = null } = {}) {
  if (season != null || seasonType != null || week != null) {
    const byWeek = await getNflGamesForWeek({ season, seasonType, week });
    if (byWeek.length) return byWeek;
  }
  if (date && ISO_DATE.test(String(date))) {
    const byDate = await getNflGamesForDate(date);
    if (byDate.length) return byDate;
  }
  return await getNflGamesForWeek({});
}
