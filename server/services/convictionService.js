/**
 * convictionService.js — conviction tier from model agreement.
 *
 * Tier = how many of the available models (Oracle + legacy shadow validator
 * + Python sidecar) landed on the same side as the Oracle pick. The Oracle
 * always counts as 1; the denominator shrinks when a model didn't run.
 * Mirrors the Imperdible insight: agreement, not edge, predicts hit rate.
 */

import pool from '../db.js';

/**
 * @param {object} opts
 * @param {boolean|null} opts.agreeLegacy  shadow validator agrees with Oracle pick
 * @param {boolean|null} opts.agreePython  Python sidecar agrees with Oracle pick
 * @returns {string|null} e.g. '3/3', '2/3', '1/3', '2/2', '1/2' — null when no model ran
 */
export function computeConvictionTier({ agreeLegacy, agreePython }) {
  const signals = [agreeLegacy, agreePython].filter((v) => v === true || v === false);
  if (signals.length === 0) return null;
  const agreeing = signals.filter(Boolean).length;
  const total = 1 + signals.length;
  const score = 1 + agreeing;
  return `${score}/${total}`;
}

/**
 * Backfills picks.conviction_tier from recent shadow_model_runs rows.
 * Idempotent; intended to run as a periodic background job (the shadow run
 * lands asynchronously after the pick is saved, so the tier is swept in).
 */
export async function syncConvictionTiers({ days = 3 } = {}) {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (pick_id)
         pick_id, pick_agree_legacy, pick_agree_python
       FROM shadow_model_runs
       WHERE pick_id IS NOT NULL
         AND created_at > NOW() - ($1 || ' days')::INTERVAL
       ORDER BY pick_id, created_at DESC`,
      [String(days)]
    );

    let updated = 0;
    for (const r of rows) {
      const tier = computeConvictionTier({
        agreeLegacy: r.pick_agree_legacy,
        agreePython: r.pick_agree_python,
      });
      if (!tier) continue;
      const result = await pool.query(
        `UPDATE picks SET conviction_tier = $1
         WHERE id = $2 AND conviction_tier IS DISTINCT FROM $1`,
        [tier, r.pick_id]
      );
      updated += result.rowCount ?? 0;
    }
    if (updated > 0) console.log(`[conviction] synced ${updated} pick tiers`);
    return { scanned: rows.length, updated };
  } catch (err) {
    console.warn('[conviction] syncConvictionTiers failed:', err.message);
    return { error: err.message };
  }
}
