/**
 * resolveAllSports.js — runs every sport's pick resolver in one pass.
 *
 * The background jobs run each resolver inside its own window (NFL only on
 * Thu/Sun/Mon evenings, the rest overnight ET). The manual "resolve picks"
 * button has no such excuse: it used to call the MLB resolver alone, so a user
 * whose pending picks were NFL, NHL, soccer or tennis clicked it and nothing
 * happened. This runs all of them, on demand, ignoring the time windows.
 *
 * Every resolver is already idempotent and skips games that are not final, so
 * repeated calls are safe. One sport failing never stops the others.
 */

import pool from '../db.js';
import { resolvePendingPicks } from '../pick-resolver.js';
import { resolveNbaPendingPicks } from '../pick-resolver-nba.js';
import { resolveNflPendingPicks } from '../pick-resolver-nfl.js';
import { resolveNhlPendingPicks } from '../pick-resolver-nhl.js';
import { resolveSoccerPendingPicks } from '../pick-resolver-soccer.js';
import { resolveTennisPendingPicks } from '../pick-resolver-tennis.js';

const DEFAULT_RESOLVERS = {
  mlb: resolvePendingPicks,
  nba: resolveNbaPendingPicks,
  nfl: resolveNflPendingPicks,
  nhl: resolveNhlPendingPicks,
  soccer: resolveSoccerPendingPicks,
  tennis: resolveTennisPendingPicks,
};

const EMPTY = { resolved: 0, wins: 0, losses: 0, pushes: 0, voids: 0, skipped: [], errors: [] };

/**
 * What is still pending after the sweep, split by when the game is.
 *
 * A sweep that resolves nothing is usually correct — picks on games that are
 * still to be played or in progress cannot resolve — but that is invisible from
 * a bare count, which is how "nothing resolved" reads as a bug. Only `past`
 * picks are genuinely stuck and worth chasing.
 */
async function countPendingBySport() {
  const today = `(NOW() AT TIME ZONE 'America/New_York')::date`;
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(sport, 'mlb') AS sport,
              COUNT(*)::int AS pending,
              COUNT(*) FILTER (WHERE game_date > ${today})::int AS future,
              COUNT(*) FILTER (WHERE game_date = ${today})::int AS today,
              COUNT(*) FILTER (WHERE game_date < ${today})::int AS past,
              COUNT(*) FILTER (WHERE game_date IS NULL)::int AS undated
         FROM picks
        WHERE result = 'pending' AND deleted_at IS NULL
        GROUP BY 1`
    );
    const bySport = {};
    const totals = { pending: 0, future: 0, today: 0, past: 0, undated: 0 };
    for (const r of rows) {
      bySport[r.sport] = { pending: r.pending, future: r.future, today: r.today, past: r.past, undated: r.undated };
      for (const key of Object.keys(totals)) totals[key] += r[key] ?? 0;
    }
    return { ...totals, bySport };
  } catch (err) {
    console.warn(`[resolve-all] pending count failed: ${err.message}`);
    return { pending: 0, future: 0, today: 0, past: 0, undated: 0, bySport: {} };
  }
}

/**
 * @param {object} [opts]
 * @param {object} [opts.resolvers]  sport → resolver fn (injectable for tests)
 * @param {string} [opts.sport]      resolve a single sport instead of all
 * @param {function} [opts.countPending]  pending-by-sport counter (injectable)
 * @returns {Promise<{resolved,wins,losses,pushes,voids,skipped,errors,bySport,stillPending}>}
 */
export async function resolveAllSportsPicks({
  resolvers = DEFAULT_RESOLVERS,
  sport = null,
  countPending = countPendingBySport,
} = {}) {
  const entries = sport
    ? Object.entries(resolvers).filter(([key]) => key === String(sport).toLowerCase())
    : Object.entries(resolvers);

  const settled = await Promise.all(entries.map(async ([key, run]) => {
    try {
      return [key, { ...EMPTY, ...(await run()) }];
    } catch (err) {
      console.error(`[resolve-all] ${key} resolver failed: ${err.message}`);
      return [key, { ...EMPTY, errors: [`${key}: ${err.message}`] }];
    }
  }));

  const bySport = Object.fromEntries(settled);
  const total = { resolved: 0, wins: 0, losses: 0, pushes: 0, voids: 0, skipped: [], errors: [] };
  for (const [key, s] of settled) {
    total.resolved += s.resolved ?? 0;
    total.wins += s.wins ?? 0;
    total.losses += s.losses ?? 0;
    total.pushes += s.pushes ?? 0;
    total.voids += s.voids ?? 0;
    for (const e of s.errors ?? []) total.errors.push(`[${key}] ${e}`);
    for (const sk of s.skipped ?? []) total.skipped.push({ ...sk, sport: key });
  }

  return { ...total, bySport, stillPending: await countPending() };
}
