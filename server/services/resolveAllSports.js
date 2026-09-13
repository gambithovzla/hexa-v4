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

const EMPTY = { resolved: 0, wins: 0, losses: 0, pushes: 0, voids: 0, errors: [] };

/**
 * @param {object} [opts]
 * @param {object} [opts.resolvers]  sport → resolver fn (injectable for tests)
 * @param {string} [opts.sport]      resolve a single sport instead of all
 * @returns {Promise<{resolved,wins,losses,pushes,voids,errors,bySport}>}
 */
export async function resolveAllSportsPicks({ resolvers = DEFAULT_RESOLVERS, sport = null } = {}) {
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
  const total = { resolved: 0, wins: 0, losses: 0, pushes: 0, voids: 0, errors: [] };
  for (const [key, s] of settled) {
    total.resolved += s.resolved ?? 0;
    total.wins += s.wins ?? 0;
    total.losses += s.losses ?? 0;
    total.pushes += s.pushes ?? 0;
    total.voids += s.voids ?? 0;
    for (const e of s.errors ?? []) total.errors.push(`[${key}] ${e}`);
  }

  return { ...total, bySport };
}
