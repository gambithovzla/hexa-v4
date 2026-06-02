/**
 * pick-resolver-tennis.js — Resolves pending Tennis picks against final scores.
 *
 * Tennis is an individual sport, so this resolver does NOT reuse the frozen
 * team-based resolvePickFromFinalState/tokenMatchesTeam. It has its own logic:
 *   - Match Winner  — the picked player must win the match.
 *   - Set Handicap (±1.5 sets) — adjusted set margin vs the line (half-point,
 *     never a push). e.g. "-1.5 sets" needs a 2+ set margin (2-0 in Bo3).
 *   - Total Games  — sum of all games across all sets vs the line.
 *
 * THE CRITICAL DIFFERENCE — retirements & walkovers:
 *   A tennis match can end without a normal completion (a player retires
 *   mid-match or withdraws). ESPN flags these via status names
 *   (STATUS_RETIRED / STATUS_WALKOVER / STATUS_ABANDONED / STATUS_CANCELED).
 *   H.E.X.A. policy v1: ALWAYS void such picks → result='void' (no action).
 *   'void' is intentionally NOT in ('won','lost','push','win','loss'), so it is
 *   excluded from every ROI/equity/win-rate aggregation — a true no-action.
 *
 * Exported:
 *   resolveTennisPick(pickText, match) → { result, market }   (pure, unit-tested)
 *   resolveTennisPendingPicks()        → { resolved, wins, losses, pushes, voids, errors[] }
 */

import pool from './db.js';
import { getTennisMatchesForDate } from './tennis-api.js';
import { resolveTennisPick, words, overlap } from './tennis-resolution.js';

// resolveTennisPick (pure) is re-exported so existing importers keep working.
export { resolveTennisPick };

// ── Async resolver job ────────────────────────────────────────────────────────

function isMatchResolvable(match) {
  if (!match) return false;
  if (match.isVoidStatus) return true;               // void is terminal
  return match.status === 'final' && Boolean(match.winner);
}

function findMatchForPick(pick, matches) {
  const gamePkInt = pick.game_pk != null ? Number(pick.game_pk) : null;
  if (Number.isFinite(gamePkInt) && gamePkInt > 0) {
    const byId = matches.find(m => parseInt(String(m.matchId), 10) === gamePkInt);
    if (byId) return byId;
  }
  // Fallback: match by player names in the "A vs B" matchup string.
  if (!pick.matchup) return null;
  const parts = pick.matchup.split(/\s+(?:vs\.?|v|@)\s+/i);
  if (parts.length < 2) return null;
  const aWords = words(parts[0]);
  const bWords = words(parts[1]);
  return matches.find(m => {
    const an = m.players?.a?.name ?? '';
    const bn = m.players?.b?.name ?? '';
    return (overlap(aWords, an) > 0 && overlap(bWords, bn) > 0)
        || (overlap(aWords, bn) > 0 && overlap(bWords, an) > 0);
  }) ?? null;
}

async function writePickResult(pickId, result) {
  await pool.query(`UPDATE picks SET result = $1, updated_at = NOW() WHERE id = $2`, [result, pickId]);
}

/**
 * Scans all pending Tennis picks, fetches final scores from ESPN, and writes
 * win/loss/push/void outcomes. Safe to call repeatedly — only processes
 * result='pending' AND sport='tennis'. Skips matches not yet final.
 *
 * @returns {Promise<{ resolved, wins, losses, pushes, voids, errors }>}
 */
export async function resolveTennisPendingPicks() {
  const summary = { resolved: 0, wins: 0, losses: 0, pushes: 0, voids: 0, errors: [] };

  const { rows: picks } = await pool.query(
    `SELECT id, matchup, pick, game_pk, league AS tour, game_date::text AS game_date
     FROM picks
     WHERE result = 'pending' AND sport = 'tennis' AND deleted_at IS NULL`
  );

  if (picks.length === 0) {
    console.log('[pick-resolver-tennis] No pending tennis picks found.');
    return summary;
  }

  console.log(`[pick-resolver-tennis] Found ${picks.length} pending tennis pick(s).`);

  // Group by tour+date so each ESPN scoreboard is fetched once.
  const byKey = {};
  for (const pick of picks) {
    const date = pick.game_date?.slice(0, 10) ?? null;
    const tour = (pick.tour ?? '').toLowerCase();
    if (!date) { summary.errors.push(`Pick #${pick.id}: missing game_date`); continue; }
    if (tour !== 'atp' && tour !== 'wta') { summary.errors.push(`Pick #${pick.id}: missing/invalid tour (${pick.tour})`); continue; }
    (byKey[`${tour}:${date}`] ??= []).push(pick);
  }

  const cache = new Map();
  async function getMatchesCached(tour, date) {
    const key = `${tour}:${date}`;
    if (cache.has(key)) return cache.get(key);
    const matches = await getTennisMatchesForDate(tour, date);
    cache.set(key, matches);
    return matches;
  }

  for (const [key, keyPicks] of Object.entries(byKey)) {
    const [tour, date] = key.split(':');
    let matches;
    try {
      matches = await getMatchesCached(tour, date);
    } catch (err) {
      const msg = `Failed to fetch tennis matches for ${key}: ${err.message}`;
      console.error(`[pick-resolver-tennis] ${msg}`);
      summary.errors.push(msg);
      continue;
    }

    for (const pick of keyPicks) {
      try {
        const match = findMatchForPick(pick, matches);
        if (!match) {
          console.log(`[pick-resolver-tennis] Pick #${pick.id} "${pick.matchup}": no matching match for ${key}`);
          continue;
        }
        if (!isMatchResolvable(match)) {
          console.log(`[pick-resolver-tennis] Pick #${pick.id} "${pick.matchup}": not final (status: ${match.status}${match.statusName ? `/${match.statusName}` : ''})`);
          continue;
        }

        const { result, market } = resolveTennisPick(pick.pick, match);
        if (!result) {
          console.log(`[pick-resolver-tennis] Pick #${pick.id} "${pick.pick}" — could not resolve (market=${market})`);
          continue;
        }

        await writePickResult(pick.id, result);
        summary.resolved++;
        if (result === 'win')  summary.wins++;
        if (result === 'loss') summary.losses++;
        if (result === 'push') summary.pushes++;
        if (result === 'void') summary.voids++;

        console.log(
          `[pick-resolver-tennis] Pick #${pick.id} "${pick.pick}" → ${result.toUpperCase()} ` +
          `(${market}; ${match.players?.a?.name ?? 'A'} vs ${match.players?.b?.name ?? 'B'}` +
          `${match.isVoidStatus ? ` — ${match.statusName}` : ''})`
        );
      } catch (err) {
        const msg = `Pick #${pick.id}: ${err.message}`;
        console.error(`[pick-resolver-tennis] ${msg}`);
        summary.errors.push(msg);
      }
    }
  }

  console.log(
    `[pick-resolver-tennis] Done. resolved=${summary.resolved} ` +
    `wins=${summary.wins} losses=${summary.losses} pushes=${summary.pushes} voids=${summary.voids} errors=${summary.errors.length}`
  );
  return summary;
}
