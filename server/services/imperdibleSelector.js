/**
 * server/services/imperdibleSelector.js — deterministic conviction scorer for
 * the "Pick Imperdible" mode.
 *
 * Philosophy (inverts the value/edge logic on purpose): a true lock is NOT
 * where the model disagrees with the market (that is an edge bet — by
 * definition the market thinks you are wrong). A lock is where every
 * independent signal AGREES the outcome is highly likely:
 *
 *   - the deterministic model probability is high,
 *   - the market implied probability also says strong favorite,
 *   - the ML sidecar (python + legacy) agrees with the side,
 *   - the data behind the projection is clean,
 *   - the market itself is low-variance (a moneyline favorite is far more
 *     "unmissable" than a single-player hits prop on a 0.5 line).
 *
 * Edge is deliberately NOT a positive input. Disagreement between model and
 * market lowers conviction instead of raising it.
 *
 * This module is pure (no I/O) so it can be unit-tested in isolation. The
 * orchestration (context build, odds, sidecar calls, persistence) lives in
 * imperdibleEngine.js.
 */

// Variance penalty in conviction points, by market family. Lower = safer to
// stake heavily on. Player props are noisier (single-PA / single-game outcomes)
// so they must clear a much higher bar before they can be the lock of the day.
export const MARKET_VARIANCE = {
  moneyline: 0,
  overunder: 3,
  runline: 5,
  team_total: 4,
  playerprop_strikeouts: 8,
  playerprop_hits: 11,
  playerprop_other: 12,
};

export const DEFAULT_THRESHOLDS = {
  minModelProb: 65,
  minConsensusProb: 66,
  minImpliedProb: 58,
  minMlProb: 55,
  minDataQuality: 60,
  minConviction: 72,
  requireLineupConfirmed: true,
  // Optional payout floor (decimal odds). null = disabled. Set e.g. to 1.10
  // to reject locks where you would risk $10 to win $1.
  minPayoutDecimal: null,
  // When a candidate has no market implied probability (e.g. alt-line with
  // no price), the gate skips the market_disagrees check by default. Setting
  // this to true requires impliedProb to be present.
  requireImpliedProb: false,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toNum(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function varianceKey(marketType, propKind = null) {
  if (marketType === 'playerprop') {
    if (propKind === 'strikeouts') return 'playerprop_strikeouts';
    if (propKind === 'hits') return 'playerprop_hits';
    return 'playerprop_other';
  }
  return marketType;
}

/**
 * Bonus/penalty based on how tightly the available signals agree.
 * Tight agreement (all within 5 pts) → up to +6; wide disagreement → up to −15.
 */
export function agreementBonus(spread) {
  if (spread == null) return 0;
  if (spread <= 5) return 6;
  if (spread >= 25) return -15;
  return round(6 + (spread - 5) * -1.05, 2);
}

/**
 * Translate an ML-aligned opinion into a single "probability the pick hits"
 * number. If the model picks the opposite side, its probability is inverted
 * (a 70% conviction on the WRONG side is ~30% support for our pick).
 */
export function mlProbForPick({ prob, agree }) {
  const p = toNum(prob);
  if (p == null) return null;
  const normalized = p > 1 ? p : p * 100;
  return agree === false ? round(100 - normalized, 1) : round(normalized, 1);
}

/**
 * Core conviction computation. Returns a 0–99 conviction plus its components
 * for transparency / persistence / UI.
 */
export function computeConviction({
  modelProb,
  impliedProb = null,
  mlProb = null,
  dataQuality = null,
  marketType,
  propKind = null,
  lineupConfirmed = false,
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

  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const consensusProb = signals.reduce((sum, s) => sum + s.value * s.weight, 0) / totalWeight;

  const values = signals.map((s) => s.value);
  const spread = Math.max(...values) - Math.min(...values);
  const bonus = agreementBonus(spread);

  const qualityFactor = 0.80 + 0.20 * (quality / 100);
  const vKey = varianceKey(marketType, propKind);
  const variancePenalty = MARKET_VARIANCE[vKey] ?? MARKET_VARIANCE.playerprop_other;

  let convictionRaw = consensusProb * qualityFactor + bonus - variancePenalty;
  if (!lineupConfirmed) convictionRaw -= 100;

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
 * Hard gate. Returns { pass, failedReasons }. A candidate must clear EVERY
 * condition to be eligible as the lock of the day. Conditions that depend on a
 * missing signal (e.g. no market odds) are skipped rather than failed, except
 * the ones that define "lock" (model prob, consensus, conviction, lineup).
 */
function decimalFromAmerican(american) {
  const n = Number(american);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

export function evaluateGate(scored, thresholds = DEFAULT_THRESHOLDS) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const failed = [];

  if (t.requireLineupConfirmed && !scored.lineupConfirmed) failed.push('lineup_not_confirmed');
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
    const dec = scored.decimalOdds ?? decimalFromAmerican(scored.odds);
    if (dec != null && dec < t.minPayoutDecimal) failed.push('payout_below_floor');
  }

  return { pass: failed.length === 0, failedReasons: failed };
}

/**
 * Rank scored candidates by conviction desc, then consensus, then lower
 * variance, then higher market agreement (lower spread). Edge is never used.
 */
export function rankCandidates(scoredList) {
  return [...scoredList].sort((a, b) => {
    if (b.conviction !== a.conviction) return b.conviction - a.conviction;
    if ((b.consensusProb ?? 0) !== (a.consensusProb ?? 0)) return (b.consensusProb ?? 0) - (a.consensusProb ?? 0);
    if ((a.variancePenalty ?? 99) !== (b.variancePenalty ?? 99)) return (a.variancePenalty ?? 99) - (b.variancePenalty ?? 99);
    return (a.agreement?.spread ?? 99) - (b.agreement?.spread ?? 99);
  });
}
