/**
 * parlayResolver.js — auto-resolve Parlay Architect runs by grading each leg
 * with the same engine used for individual picks (resolvePickFromFinalState).
 *
 * Aggregation rules (standard parlay):
 *   - any leg = 'loss'  → parlay = 'loss' (short-circuit)
 *   - any leg = 'pending' (game not final or unresolvable yet) → stays 'pending'
 *   - all legs ∈ {'win','push'} (with at least one 'win') → 'win'
 *   - all legs = 'push' → 'push'
 * legs_hit counts 'win' legs only.
 */

import pool from '../db.js';
import { getTodayGames } from '../mlb-api.js';
import { getLiveGameData } from '../live-feed.js';
import {
  buildResolverGameFromLiveData,
  resolvePickFromFinalState,
} from '../pick-resolver.js';

function normalizeDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * Aggregate per-leg results into a single parlay outcome.
 *
 * @param {Array<{result: 'win'|'loss'|'push'|null|undefined}>} legResults
 * @returns {{ status: 'win'|'loss'|'push'|'pending', legsHit: number, legsResolved: number }}
 */
export function aggregateParlay(legResults) {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let pending = 0;
  for (const lr of legResults) {
    const r = lr?.result;
    if (r === 'win') wins++;
    else if (r === 'loss') losses++;
    else if (r === 'push') pushes++;
    else pending++;
  }
  const legsResolved = wins + losses + pushes;

  if (losses > 0) return { status: 'loss', legsHit: wins, legsResolved };
  if (pending > 0) return { status: 'pending', legsHit: wins, legsResolved };
  if (wins > 0)   return { status: 'win',  legsHit: wins, legsResolved };
  return { status: 'push', legsHit: 0, legsResolved };
}

/**
 * Resolve all legs of a parlay against final game state.
 *
 * Caches `getTodayGames(date)` and `getLiveGameData(gamePk)` calls — pass the
 * same caches across multiple parlays in a batch to avoid duplicate fetches.
 *
 * @param {object[]} legs — chosen_legs[]; each must have { gamePk, pick, gameDate, matchup }
 * @param {object}   ctx
 * @param {Map<string, object[]>=} ctx.gamesByDate
 * @param {Map<string, object>=}   ctx.liveDataCache
 * @param {string=} ctx.fallbackDate — used when a leg has no gameDate
 *
 * @returns {Promise<{ legResults: object[], aggregate: ReturnType<typeof aggregateParlay> }>}
 */
export async function resolveParlayLegs(legs, ctx = {}) {
  const gamesByDate    = ctx.gamesByDate    ?? new Map();
  const liveDataCache  = ctx.liveDataCache  ?? new Map();
  const fallbackDate   = normalizeDate(ctx.fallbackDate);

  async function getGamesFor(date) {
    if (!date) return [];
    if (gamesByDate.has(date)) return gamesByDate.get(date);
    try {
      const games = await getTodayGames(date);
      gamesByDate.set(date, games);
      return games;
    } catch (err) {
      console.warn(`[parlay-resolver] getTodayGames(${date}) failed: ${err.message}`);
      gamesByDate.set(date, []);
      return [];
    }
  }

  async function getLiveCached(gamePk) {
    if (gamePk == null) return null;
    const key = String(gamePk);
    if (liveDataCache.has(key)) return liveDataCache.get(key);
    try {
      const live = await getLiveGameData(gamePk);
      liveDataCache.set(key, live);
      return live;
    } catch (err) {
      console.warn(`[parlay-resolver] getLiveGameData(${gamePk}) failed: ${err.message}`);
      liveDataCache.set(key, null);
      return null;
    }
  }

  const legResults = [];

  for (const leg of legs ?? []) {
    const candidateId = leg?.candidateId ?? null;
    const gamePk = leg?.gamePk != null ? Number(leg.gamePk) : null;
    const date = normalizeDate(leg?.gameDate) ?? fallbackDate;
    const pickText = leg?.pick ?? '';

    if (!gamePk || !pickText) {
      legResults.push({
        candidateId, gamePk, pick: pickText,
        result: null, status: 'unparseable',
        reason: 'missing gamePk or pick text',
      });
      continue;
    }

    const games = await getGamesFor(date);
    let game = games.find(g => Number(g?.gamePk) === gamePk) ?? null;

    let liveData = null;
    let finalGame = game;

    if (game && String(game.status?.simplified ?? '').toLowerCase() !== 'final') {
      liveData = await getLiveCached(gamePk);
      if (liveData?.status === 'final') {
        finalGame = buildResolverGameFromLiveData(liveData, game.gameDate);
      }
    }

    // Schedule may not list a game (rescheduled/postponed/etc.) — fall back to
    // live feed alone, which is enough to grade ML/RL/OU and player props.
    if (!finalGame) {
      liveData = await getLiveCached(gamePk);
      if (liveData?.status === 'final') {
        finalGame = buildResolverGameFromLiveData(liveData, date);
      }
    }

    if (!finalGame || String(finalGame.status?.simplified ?? '').toLowerCase() !== 'final') {
      legResults.push({
        candidateId, gamePk, pick: pickText,
        result: null, status: 'pending',
        reason: 'game not final',
      });
      continue;
    }

    if (!liveData) liveData = await getLiveCached(gamePk);

    try {
      const { parsed, result, propResult } = resolvePickFromFinalState(
        pickText,
        finalGame,
        liveData?.playerStats ?? null,
      );

      if (!result) {
        legResults.push({
          candidateId, gamePk, pick: pickText,
          result: null,
          status: parsed ? 'unresolved' : 'unparseable',
          reason: parsed ? 'grader returned no result' : 'pick string did not parse',
        });
        continue;
      }

      legResults.push({
        candidateId, gamePk, pick: pickText,
        result,
        status: 'resolved',
        ...(propResult ? {
          actual: propResult.actual ?? null,
          line: propResult.line ?? null,
          propType: propResult.propType ?? null,
        } : {
          homeScore: finalGame.teams?.home?.score ?? null,
          awayScore: finalGame.teams?.away?.score ?? null,
        }),
      });
    } catch (err) {
      legResults.push({
        candidateId, gamePk, pick: pickText,
        result: null, status: 'error',
        reason: err.message,
      });
    }
  }

  return { legResults, aggregate: aggregateParlay(legResults) };
}

/**
 * Resolve a single parlay_synergy_runs row by id.
 *
 * @param {object} opts
 * @param {number} opts.runId
 * @param {object=} opts.row — if already loaded, skip the SELECT
 * @param {Map=} opts.gamesByDate
 * @param {Map=} opts.liveDataCache
 *
 * @returns {Promise<{ runId, status, legsHit, legsResolved, totalLegs, persisted, legResults }>}
 */
export async function resolveParlayRunById({ runId, row = null, gamesByDate, liveDataCache }) {
  let parlayRow = row;
  if (!parlayRow) {
    const { rows } = await pool.query(
      `SELECT id, game_date, chosen_legs, resolved
         FROM parlay_synergy_runs
        WHERE id = $1`,
      [runId],
    );
    parlayRow = rows[0] ?? null;
  }
  if (!parlayRow) throw new Error(`parlay_synergy_runs id=${runId} not found`);

  const legs = parlayRow.chosen_legs ?? [];
  const totalLegs = Array.isArray(legs) ? legs.length : 0;

  const { legResults, aggregate } = await resolveParlayLegs(legs, {
    gamesByDate, liveDataCache,
    fallbackDate: parlayRow.game_date,
  });

  const finalized = aggregate.status !== 'pending';
  const hit = aggregate.status === 'win';

  if (finalized) {
    await pool.query(
      `UPDATE parlay_synergy_runs
          SET resolved    = true,
              hit         = $1,
              legs_hit    = $2,
              leg_results = $3::jsonb,
              resolved_at = NOW()
        WHERE id = $4`,
      [hit, aggregate.legsHit, JSON.stringify(legResults), runId],
    );
  } else {
    // Persist partial leg_results so the UI can show per-leg progress while
    // some games are still in-flight, but leave resolved=false.
    await pool.query(
      `UPDATE parlay_synergy_runs
          SET leg_results = $1::jsonb
        WHERE id = $2`,
      [JSON.stringify(legResults), runId],
    );
  }

  return {
    runId,
    status: aggregate.status,
    legsHit: aggregate.legsHit,
    legsResolved: aggregate.legsResolved,
    totalLegs,
    persisted: finalized,
    legResults,
  };
}

/**
 * Scan all unresolved parlay_synergy_runs rows and try to resolve each.
 * Shares game/live-data caches across rows.
 */
export async function resolvePendingParlays({ limit = 200 } = {}) {
  const summary = { scanned: 0, finalized: 0, wins: 0, losses: 0, pushes: 0, stillPending: 0, errors: [] };

  const { rows } = await pool.query(
    `SELECT id, game_date, chosen_legs
       FROM parlay_synergy_runs
      WHERE resolved = false
      ORDER BY game_date DESC, id ASC
      LIMIT $1`,
    [limit],
  );
  if (rows.length === 0) {
    console.log('[parlay-resolver] No pending parlay runs.');
    return summary;
  }
  console.log(`[parlay-resolver] Scanning ${rows.length} pending parlay run(s)...`);

  const gamesByDate   = new Map();
  const liveDataCache = new Map();

  for (const row of rows) {
    summary.scanned++;
    try {
      const out = await resolveParlayRunById({ runId: row.id, row, gamesByDate, liveDataCache });
      if (out.status === 'pending') {
        summary.stillPending++;
        continue;
      }
      summary.finalized++;
      if (out.status === 'win')  summary.wins++;
      if (out.status === 'loss') summary.losses++;
      if (out.status === 'push') summary.pushes++;
      console.log(
        `[parlay-resolver] run #${row.id}: ${out.status.toUpperCase()} ` +
        `(${out.legsHit}/${out.totalLegs} legs hit)`
      );
    } catch (err) {
      const msg = `run #${row.id}: ${err.message}`;
      console.error(`[parlay-resolver] ${msg}`);
      summary.errors.push(msg);
    }
  }

  console.log(
    `[parlay-resolver] Done — scanned: ${summary.scanned}, finalized: ${summary.finalized} ` +
    `(W:${summary.wins} L:${summary.losses} P:${summary.pushes}), pending: ${summary.stillPending}, ` +
    `errors: ${summary.errors.length}`
  );
  return summary;
}
