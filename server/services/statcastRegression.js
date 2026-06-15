/**
 * Pure Statcast regression signals — actual vs expected outcome gaps.
 *
 * Extracted from context-builder.js so they can be unit-tested without dragging
 * in the full context fetch chain (DB, MLB API, Savant, weather, …). The Oracle
 * prompt already references "overperformance — regression risk" but the gap that
 * justifies it was never actually computed; these helpers fill that.
 */

// wOBA-point thresholds for the actual-vs-expected regression signal.
export const REGRESSION_GAP_NOTABLE = 0.030;
export const REGRESSION_GAP_SIGNIFICANT = 0.050;

// Minimum whiff%-vs-K% divergence (in percentage points) to surface a K-rate note.
export const KRATE_DIVERGENCE_PP = 6;

/**
 * Compares realized wOBA against expected wOBA (xwOBA) to flag regression
 * candidates.
 *
 * Sign convention is role-aware:
 *  - Batter: gap = wOBA − xwOBA. Positive gap = results above contact quality →
 *    DOWNSIDE regression risk. Negative gap = unlucky → positive regression candidate.
 *  - Pitcher (wOBA_against vs xwOBA_against): the same arithmetic inverts in meaning.
 *    A pitcher allowing LESS than expected (gap < 0) has overperformed (gotten lucky) →
 *    his results should regress UP (worse). gap > 0 = unlucky → pitching better than results.
 *
 * @param {number|null} actual   — realized wOBA / wOBA against
 * @param {number|null} expected — xwOBA / xwOBA against
 * @param {'batter'|'pitcher'} role
 * @returns {{ gap:number, magnitude:'notable'|'significant', overperforming:boolean, text:string }|null}
 */
export function statcastRegressionSignal(actual, expected, role) {
  if (actual == null || expected == null) return null;
  const a = Number(actual);
  const e = Number(expected);
  if (!Number.isFinite(a) || !Number.isFinite(e)) return null;

  const gap = a - e;
  const abs = Math.abs(gap);
  if (abs < REGRESSION_GAP_NOTABLE) return null;

  const magnitude = abs >= REGRESSION_GAP_SIGNIFICANT ? 'significant' : 'notable';
  const signed = `${gap > 0 ? '+' : ''}${gap.toFixed(3)}`;

  // A positive batter gap = overperforming; a positive pitcher gap = the opposite.
  const overperforming = role === 'pitcher' ? gap < 0 : gap > 0;

  let text;
  if (role === 'pitcher') {
    text = overperforming
      ? `allowing ${signed} wOBA vs expected (xwOBA against) — OVERPERFORMING, results may regress UP (${magnitude})`
      : `allowing ${signed} wOBA vs expected (xwOBA against) — UNDERPERFORMING, pitching better than results show (${magnitude})`;
  } else {
    text = overperforming
      ? `wOBA ${signed} vs xwOBA — OVERPERFORMING contact quality, downside regression risk (${magnitude})`
      : `wOBA ${signed} vs xwOBA — UNDERPERFORMING, positive regression candidate (${magnitude})`;
  }

  return { gap, magnitude, overperforming, text };
}

/**
 * Normalizes a rate that Savant returns either as a decimal (0.285) or a whole
 * percentage (28.5) into percentage points.
 */
function rateToPercentPoints(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n <= 1 ? n * 100 : n;
}

/**
 * Divergence between swing-and-miss (whiff%) and realized strikeout rate (K%).
 * Whiff% is the leading indicator; when it materially exceeds K%, the pitcher has
 * generated more swing-and-miss than his strikeout total reflects → K-prop OVER
 * upside. The inverse (K% >> whiff%) means Ks lean on called strikes and may not
 * hold without CSW support.
 *
 * @param {number|null} whiffPercent
 * @param {number|null} kPercent
 * @returns {{ diff:number, direction:'k-upside'|'k-downside', text:string }|null}
 */
export function strikeoutRateSignal(whiffPercent, kPercent) {
  const whiff = rateToPercentPoints(whiffPercent);
  const k = rateToPercentPoints(kPercent);
  if (whiff == null || k == null) return null;

  const diff = whiff - k;
  if (Math.abs(diff) < KRATE_DIVERGENCE_PP) return null;

  if (diff > 0) {
    return {
      diff,
      direction: 'k-upside',
      text: `Whiff% ${whiff.toFixed(1)}% exceeds K% ${k.toFixed(1)}% by ${diff.toFixed(1)}pp — swing-and-miss ahead of strikeout rate, K-prop OVER upside`,
    };
  }
  return {
    diff,
    direction: 'k-downside',
    text: `K% ${k.toFixed(1)}% exceeds Whiff% ${whiff.toFixed(1)}% by ${Math.abs(diff).toFixed(1)}pp — strikeouts lean on called strikes, K-prop downside risk if CSW thins`,
  };
}
