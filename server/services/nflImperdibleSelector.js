/**
 * server/services/nflImperdibleSelector.js — deterministic conviction scorer for
 * the NFL "Pick Imperdible" lock-of-the-slate mode.
 *
 * Mirrors imperdibleSelector.js (MLB) with NFL-specific calibration:
 *   - the market-variance map covers NFL markets only (moneyline / spread /
 *     total); no runline, no player props in this MVP.
 *   - the availability gate is QB-CONFIRMED (the dominant NFL variable) — the
 *     analog of MLB's lineup-confirmed gate. A QB who is OUT is *confirmed*
 *     information (the backup is known); only questionable/doubtful/GTD is the
 *     genuine uncertainty that voids a lock.
 *   - thresholds account for NFL's tighter probability range and 72% Oracle cap.
 *   - a model-certified gate prevents a "lock" when the sidecar is down and the
 *     candidate probability silently fell back to the market (no independent
 *     model → no lock).
 *
 * Philosophy is identical to MLB: a lock is where independent signals AGREE the
 * outcome is highly likely. Edge (model-vs-market disagreement) is NOT a positive
 * input — disagreement lowers conviction.
 *
 * Pure (no I/O) → unit-testable. Orchestration lives in nflImperdibleEngine.js.
 * Reuses the truly-generic scalar helpers from imperdibleSelector.js.
 *
 * NOTE (calibration): the thresholds below are a starting point. The NFL lock
 * gate needs 4–6 weeks of in-season resolved data to tune minConviction /
 * minModelProb the way MLB's were. Until then it is deliberately strict so locks
 * fire rarely.
 */

import { agreementBonus, mlProbForPick, rankCandidates } from './imperdibleSelector.js';

// Variance penalty in conviction points, by NFL market. Lower = safer to stake
// heavily. Moneyline (cleanest market, a heavy favorite) is the most unmissable;
// totals are noisiest (weather, pace, garbage-time scoring).
export const NFL_MARKET_VARIANCE = {
  moneyline: 0,
  spread:    2,   // primary NFL market; key numbers 3/7 add modest variance
  overunder: 4,
};

export const NFL_DEFAULT_THRESHOLDS = {
  minModelProb: 62,       // NFL model probs rarely exceed ~70% even for big favorites
  minConsensusProb: 63,
  minImpliedProb: 60,     // ~ a -150 market favorite
  minMlProb: 55,
  minDataQuality: 60,
  minConviction: 70,      // a lock must sit near the 72% NFL confidence ceiling
  requireQbConfirmed: true,
  requireModelCertified: true, // no sidecar model → no lock (avoids market-only fake)
  minPayoutDecimal: null,
  requireImpliedProb: false,
};

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function round(v, d = 1) { if (!Number.isFinite(v)) return null; const f = 10 ** d; return Math.round(v * f) / f; }
function toNum(v) { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

export function nflVarianceKey(marketType) {
  return NFL_MARKET_VARIANCE[marketType] != null ? marketType : 'overunder';
}

/**
 * Core conviction computation. Returns a 0–99 conviction plus its components.
 * Signals: model (sidecar XGBoost) 0.45, market implied 0.30, independent ML
 * (shadow validator, moneyline only) 0.25 — re-normalized over present signals.
 */
export function computeNflConviction({
  modelProb,
  impliedProb = null,
  mlProb = null,
  dataQuality = null,
  marketType,
  qbConfirmed = false,
}) {
  const model = toNum(modelProb);
  if (model == null) {
    return { conviction: 0, consensusProb: null, agreement: null, variancePenalty: null, components: null };
  }
  const implied = toNum(impliedProb);
  const ml = toNum(mlProb);
  const quality = clamp(toNum(dataQuality) ?? 50, 0, 100);

  const signals = [{ value: model, weight: 0.45 }];
  if (implied != null) signals.push({ value: implied, weight: 0.30 });
  if (ml != null) signals.push({ value: ml, weight: 0.25 });

  const totalWeight = signals.reduce((s, x) => s + x.weight, 0);
  const consensusProb = signals.reduce((s, x) => s + x.value * x.weight, 0) / totalWeight;

  const values = signals.map((s) => s.value);
  const spread = Math.max(...values) - Math.min(...values);
  const bonus = agreementBonus(spread);

  const qualityFactor = 0.80 + 0.20 * (quality / 100);
  const vKey = nflVarianceKey(marketType);
  const variancePenalty = NFL_MARKET_VARIANCE[vKey];

  let convictionRaw = consensusProb * qualityFactor + bonus - variancePenalty;
  if (!qbConfirmed) convictionRaw -= 100;

  return {
    conviction: round(clamp(convictionRaw, 0, 99), 1),
    consensusProb: round(consensusProb, 1),
    agreement: { spread: round(spread, 1), bonus },
    variancePenalty,
    components: {
      modelProb: round(model, 1),
      impliedProb: implied != null ? round(implied, 1) : null,
      mlProb: ml != null ? round(ml, 1) : null,
      dataQuality: round(quality, 1),
      qualityFactor: round(qualityFactor, 3),
      varianceKey: vKey,
    },
  };
}

/**
 * Hard gate. Returns { pass, failedReasons }. Conditions on a missing signal are
 * skipped rather than failed, except those that define a lock (model prob,
 * consensus, conviction, QB confirmation, model certification).
 */
export function evaluateNflGate(scored, thresholds = null) {
  const t = { ...NFL_DEFAULT_THRESHOLDS, ...(thresholds ?? {}) };
  const failed = [];

  if (t.requireQbConfirmed && !scored.qbConfirmed) failed.push('qb_not_confirmed');
  if (t.requireModelCertified && !scored.modelCertified) failed.push('model_unavailable');
  if ((scored.components?.modelProb ?? 0) < t.minModelProb) failed.push('model_prob_below_min');
  if ((scored.consensusProb ?? 0) < t.minConsensusProb) failed.push('consensus_below_min');
  if ((scored.conviction ?? 0) < t.minConviction) failed.push('conviction_below_min');
  if ((scored.components?.dataQuality ?? 0) < t.minDataQuality) failed.push('data_quality_below_min');

  const implied = scored.components?.impliedProb;
  if (implied != null && implied < t.minImpliedProb) failed.push('market_disagrees');
  if (implied == null && t.requireImpliedProb) failed.push('market_price_missing');

  const ml = scored.components?.mlProb;
  if (ml != null && ml < t.minMlProb) failed.push('ml_against_pick');

  if (t.minPayoutDecimal != null) {
    const dec = scored.decimalOdds ?? null;
    if (dec != null && dec < t.minPayoutDecimal) failed.push('payout_below_floor');
  }

  return { pass: failed.length === 0, failedReasons: failed };
}

// Ranking is sport-agnostic (conviction → consensus → variance → agreement).
export { rankCandidates as rankNflCandidates, mlProbForPick };
