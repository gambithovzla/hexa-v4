/**
 * server/services/pickOfTheDay.js — "Pick del Día para Ganar".
 *
 * A different objective from the edge engine and from the Imperdible lock:
 * find THE single best pick of the day to *win*, in an odds window that still
 * pays decently. Use case: a daily $100 stake where only a WIN matters and the
 * payout should not be a throwaway favourite.
 *
 * It optimizes for probability of hitting (max acierto), NOT raw edge — but it
 * is NOT edge-blind, because a price floor without an edge check loses money:
 *
 *   A -150 line implies a ~60% break-even. Betting -150 winners at exactly 60%
 *   nets zero before the vig and loses after it. The ONLY way the mode makes
 *   money is when the model's own probability clears that break-even by a
 *   margin. That anti-vig gate is what turns "acierto" into profit — without it
 *   you ship pretty picks that bleed slowly.
 *
 * So the selection is: candidates whose ODDS sit inside the payout window AND
 * whose MODEL probability beats the odds' break-even by a safety margin, ranked
 * by win probability (then by payout). One pick, or an honest PASS.
 *
 * Pure module (no I/O) — unit-tested in isolation. It consumes the same scored
 * candidate shape produced by imperdibleEngine (conviction + consensusProb +
 * components.{modelProb,impliedProb,dataQuality} + odds), so the orchestration
 * can reuse the existing per-sport candidate generation.
 */

export const DEFAULT_POTD_CONFIG = {
  // Payout window in American odds. floor = heaviest favourite allowed (pays
  // the least we accept); ceiling = longest underdog allowed (riskiest).
  oddsFloorAmerican: -150,
  oddsCeilingAmerican: 120,
  // Anti-vig margin: the model probability must exceed the odds' break-even by
  // at least this many percentage points. This is the profit guarantee — a
  // -150 (60% break-even) pick needs the model at >= 63%.
  antiVigMarginPts: 3,
  // Floors so a noisy/low-data candidate can never be the pick of the day.
  minModelProb: 60,
  minDataQuality: 55,
  // Require a confirmed lineup/availability when the candidate carries the flag.
  requireLineupConfirmed: true,
};

function toNum(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** American odds → implied probability in percent (with vig). */
export function impliedProbFromAmerican(american) {
  const n = toNum(american);
  if (n == null || n === 0) return null;
  const prob = n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
  return round(prob * 100, 2);
}

/** American odds → decimal payout (profit multiple + 1). */
export function decimalFromAmerican(american) {
  const n = toNum(american);
  if (n == null || n === 0) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

/**
 * Is a price inside the payout window? Expressed via implied probability so the
 * American-odds sign never trips us up: a heavier favourite has a HIGHER implied
 * prob than the floor; a longer dog has a LOWER implied prob than the ceiling.
 */
export function isOddsInWindow(american, config = DEFAULT_POTD_CONFIG) {
  const implied = impliedProbFromAmerican(american);
  if (implied == null) return false;
  const floorImplied = impliedProbFromAmerican(config.oddsFloorAmerican);     // e.g. -150 → 60%
  const ceilingImplied = impliedProbFromAmerican(config.oddsCeilingAmerican); // e.g. +120 → 45.45%
  // implied must be no greater than the floor (not a heavier favourite) and no
  // smaller than the ceiling (not a longer underdog).
  return implied <= floorImplied + 1e-9 && implied >= ceilingImplied - 1e-9;
}

/**
 * Per-candidate evaluation against the Pick-of-the-Day rules.
 * Returns { eligible, reasons, winProbability, breakeven, payoutDecimal }.
 */
export function evaluatePickOfTheDayCandidate(scored, config = DEFAULT_POTD_CONFIG) {
  const cfg = { ...DEFAULT_POTD_CONFIG, ...(config ?? {}) };
  const reasons = [];

  const odds = toNum(scored?.odds);
  const modelProb = toNum(scored?.components?.modelProb ?? scored?.modelProb);
  const dataQuality = toNum(scored?.components?.dataQuality ?? scored?.dataQuality) ?? 50;
  // Best single estimate of "the pick hits": the blended consensus when present,
  // else the model's own probability.
  const winProbability = toNum(scored?.consensusProb) ?? modelProb;
  const breakeven = impliedProbFromAmerican(odds);
  const payoutDecimal = decimalFromAmerican(odds);

  if (odds == null) reasons.push('no_market_price');
  if (modelProb == null) reasons.push('no_model_prob');

  if (odds != null && !isOddsInWindow(odds, cfg)) {
    reasons.push(breakeven != null && breakeven > impliedProbFromAmerican(cfg.oddsFloorAmerican)
      ? 'odds_too_short'   // heavier favourite than the floor — pays too little
      : 'odds_too_long');  // longer underdog than the ceiling — too risky
  }

  if (modelProb != null && modelProb < cfg.minModelProb) reasons.push('model_prob_below_min');
  if (dataQuality < cfg.minDataQuality) reasons.push('data_quality_below_min');
  if (cfg.requireLineupConfirmed && scored?.lineupConfirmed === false) reasons.push('lineup_not_confirmed');

  // Anti-vig gate: the money-maker. Model must beat the odds' break-even by margin.
  if (modelProb != null && breakeven != null && modelProb < breakeven + cfg.antiVigMarginPts) {
    reasons.push('no_edge_over_breakeven');
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    winProbability: round(winProbability, 1),
    breakeven,
    edgeOverBreakeven: modelProb != null && breakeven != null ? round(modelProb - breakeven, 1) : null,
    payoutDecimal: round(payoutDecimal, 3),
  };
}

/**
 * Rank eligible candidates for "best to win": win probability first (acierto),
 * then payout (his cut is 15% of winnings, so a higher price pays more), then
 * lower market variance as a final tiebreak.
 */
export function rankByWinThenPayout(evaluated) {
  return [...evaluated].sort((a, b) => {
    if ((b.winProbability ?? 0) !== (a.winProbability ?? 0)) {
      return (b.winProbability ?? 0) - (a.winProbability ?? 0);
    }
    if ((b.payoutDecimal ?? 0) !== (a.payoutDecimal ?? 0)) {
      return (b.payoutDecimal ?? 0) - (a.payoutDecimal ?? 0);
    }
    return (a.scored?.variancePenalty ?? 99) - (b.scored?.variancePenalty ?? 99);
  });
}

/**
 * Select the single Pick of the Day from a list of scored candidates (one slate,
 * possibly across sports). Returns an honest PASS when nothing clears the gate —
 * a forced pick on a bad day is exactly how the bankroll bleeds.
 *
 * @returns {{ status: 'PICK'|'PASS', pick: object|null, reason: string|null,
 *             considered: number, eligibleCount: number, rejected: Array }}
 */
export function selectPickOfTheDay(scoredList, config = DEFAULT_POTD_CONFIG) {
  const cfg = { ...DEFAULT_POTD_CONFIG, ...(config ?? {}) };
  const list = Array.isArray(scoredList) ? scoredList : [];

  const evaluated = list.map((scored) => ({
    scored,
    ...evaluatePickOfTheDayCandidate(scored, cfg),
  }));

  const eligible = evaluated.filter((e) => e.eligible);
  if (eligible.length === 0) {
    return {
      status: 'PASS',
      pick: null,
      reason: 'no_candidate_clears_gate',
      considered: list.length,
      eligibleCount: 0,
      rejected: evaluated.map((e) => ({
        pick: e.scored?.pick ?? e.scored?.detail ?? null,
        odds: e.scored?.odds ?? null,
        reasons: e.reasons,
      })),
    };
  }

  const ranked = rankByWinThenPayout(eligible);
  const best = ranked[0];

  return {
    status: 'PICK',
    pick: {
      pick: best.scored?.pick ?? best.scored?.detail ?? null,
      marketType: best.scored?.marketType ?? best.scored?.market_type ?? null,
      side: best.scored?.side ?? null,
      sport: best.scored?.sport ?? null,
      gamePk: best.scored?.gamePk ?? best.scored?.game_pk ?? null,
      odds: best.scored?.odds ?? null,
      winProbability: best.winProbability,
      breakeven: best.breakeven,
      edgeOverBreakeven: best.edgeOverBreakeven,
      payoutDecimal: best.payoutDecimal,
      conviction: best.scored?.conviction ?? null,
      components: best.scored?.components ?? null,
    },
    reason: null,
    considered: list.length,
    eligibleCount: eligible.length,
    rejected: ranked.slice(1).map((e) => ({
      pick: e.scored?.pick ?? e.scored?.detail ?? null,
      odds: e.scored?.odds ?? null,
      winProbability: e.winProbability,
    })),
  };
}
