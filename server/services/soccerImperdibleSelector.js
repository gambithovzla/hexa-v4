/**
 * server/services/soccerImperdibleSelector.js — deterministic conviction scorer
 * for the soccer "Pick Imperdible" lock-of-the-slate mode.
 *
 * Mirrors nflImperdibleSelector.js with soccer-specific calibration:
 *   - markets: moneyline (1X2), total (over/under 2.5), btts — no player props.
 *   - soccer is the MOST efficient market of all sports (Oracle cap 62%), so the
 *     conviction thresholds are the lowest: a soccer "lock" sits near 60, not 70.
 *   - the availability gate is LINEUP-CONFIRMED, but confirmed lineups arrive
 *     only ~1h pre-kick via API-Football (Sprint 11.3, not wired yet). So
 *     `requireLineupConfirmed` DEFAULTS TO FALSE here — when 11.3 lands, flip it
 *     true and feed `lineupConfirmed`. The HARD gate that actually fires is
 *     `requireModelCertified`: no trained soccer sidecar model → no lock (avoids
 *     a market-only fake lock). The soccer models are pre-trained from
 *     football-data history (Sprint 11.2), so this gate passes in production.
 *
 * Philosophy is identical to MLB/NFL: a lock is where independent signals AGREE
 * the outcome is highly likely. Edge (model-vs-market disagreement) is NOT a
 * positive input — disagreement lowers conviction.
 *
 * Pure (no I/O) → unit-testable. Orchestration lives in soccerImperdibleEngine.js.
 * Reuses the sport-agnostic scalar helpers from imperdibleSelector.js.
 *
 * NOTE (calibration): thresholds are a strict starting point. The soccer lock
 * gate needs 4–6 weeks of in-season resolved data to tune the way MLB's were;
 * until then it is deliberately strict so locks fire rarely.
 */

import { agreementBonus, mlProbForPick, rankCandidates } from './imperdibleSelector.js';

// Variance penalty in conviction points, by soccer market. Lower = safer to
// stake heavily. 1X2 on a heavy favorite is the most unmissable; BTTS and the
// 2.5 total are noisier (a single late goal flips them).
export const SOCCER_MARKET_VARIANCE = {
  moneyline: 0,   // 1X2 home/away win on a clear favorite
  total:     4,   // over/under 2.5 — one goal flips it
  overunder: 4,   // alias: the parlay candidate builder emits 'overunder'
  btts:      5,   // both-teams-to-score — high variance
};

export const SOCCER_DEFAULT_THRESHOLDS = {
  minModelProb: 58,        // soccer model probs rarely exceed ~65% (efficient market)
  minConsensusProb: 58,
  minImpliedProb: 58,      // ~ a -140 market favorite
  minMlProb: 52,           // shadow validator is capped at 62
  minDataQuality: 55,
  minConviction: 60,       // a lock sits near the 62% soccer ceiling
  requireLineupConfirmed: false, // no confirmed-lineup source until Sprint 11.3
  requireModelCertified: true,   // no sidecar model → no lock
  minPayoutDecimal: null,
  requireImpliedProb: false,
};

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function round(v, d = 1) { if (!Number.isFinite(v)) return null; const f = 10 ** d; return Math.round(v * f) / f; }
function toNum(v) { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

export function soccerVarianceKey(marketType) {
  return SOCCER_MARKET_VARIANCE[marketType] != null ? marketType : 'total';
}

/**
 * Core conviction computation. Returns a 0–99 conviction plus its components.
 * Signals: model (sidecar XGBoost) 0.45, market implied (de-vig) 0.30,
 * independent ML (shadow validator, moneyline only) 0.25 — re-normalized over
 * present signals.
 */
export function computeSoccerConviction({
  modelProb,
  impliedProb = null,
  mlProb = null,
  dataQuality = null,
  marketType,
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

  const totalWeight = signals.reduce((s, x) => s + x.weight, 0);
  const consensusProb = signals.reduce((s, x) => s + x.value * x.weight, 0) / totalWeight;

  const values = signals.map((s) => s.value);
  const spread = Math.max(...values) - Math.min(...values);
  const bonus = agreementBonus(spread);

  const qualityFactor = 0.80 + 0.20 * (quality / 100);
  const vKey = soccerVarianceKey(marketType);
  const variancePenalty = SOCCER_MARKET_VARIANCE[vKey];

  let convictionRaw = consensusProb * qualityFactor + bonus - variancePenalty;
  // A lineup we can't confirm is only penalized when the caller demands it
  // (requireLineupConfirmed) — handled in the gate, not here, because soccer
  // has no confirmed-lineup source yet. (Mirror of NFL's QB handling, but soft.)

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
 * consensus, conviction, model certification, and — only if required — lineup).
 */
export function evaluateSoccerGate(scored, thresholds = null) {
  const t = { ...SOCCER_DEFAULT_THRESHOLDS, ...(thresholds ?? {}) };
  const failed = [];

  if (t.requireLineupConfirmed && !scored.lineupConfirmed) failed.push('lineup_not_confirmed');
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
export { rankCandidates as rankSoccerCandidates, mlProbForPick };
