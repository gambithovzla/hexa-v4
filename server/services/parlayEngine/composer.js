import { pairKey } from './correl.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key];
    (acc[k] = acc[k] ?? []).push(item);
    return acc;
  }, {});
}

/** Sorted join of candidateIds — used to detect duplicate combinations. */
function comboKey(legs) {
  return legs.map(l => l.candidateId).sort().join('|');
}

// ── Scoring ───────────────────────────────────────────────────────────────

const MODE_MULTIPLIERS = {
  conservative: { corr: 1.3, risk: 1.0, length: 1.5 },
  balanced:     { corr: 1.0, risk: 1.2, length: 1.0 },
  aggressive:   { corr: 0.8, risk: 1.5, length: 0.7 },
  dreamer:      { corr: 0.5, risk: 1.8, length: 0.5 },
};

/**
 * Score a parlay combination.
 * Returns the total score and a full breakdown for logging and LLM context.
 */
function scoreParlay(legs, correlations, riskDistances, mode, N) {
  const mm = MODE_MULTIPLIERS[mode] ?? MODE_MULTIPLIERS.balanced;

  // 1. Confidence-weighted edge sum
  let edgeSum = 0;
  for (const leg of legs) {
    edgeSum += (leg.edge ?? 0) * (leg.modelProbability / 100);
  }

  // 2. Correlation bonuses / penalties
  let corrBonus = 0;
  let negCorrPenalty = 0;
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const c = correlations[pairKey(legs[i], legs[j])] ?? 0;
      if (c > 0.1) corrBonus += c * 3;
      if (c < -0.1) negCorrPenalty += Math.abs(c) * 6;
    }
  }

  // 3. Risk diversification bonus (higher euclidean distance = more orthogonal)
  let riskDivBonus = 0;
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      riskDivBonus += (riskDistances[pairKey(legs[i], legs[j])] ?? 0) * 2;
    }
  }

  // 4. Length penalty (variance grows exponentially with N)
  // N=3 → 0.4, N=5 → 3.4, N=7 → 8.9
  const lengthPenalty = Math.pow(Math.max(0, N - 2), 1.5) * 0.4;

  // 5. Data quality penalty
  let dqPenalty = 0;
  for (const leg of legs) {
    if (leg.dataQualityScore < 60) dqPenalty += 0.8;
  }

  // 6. Game script coherence bonus
  const scripts = legs.map(l => l.gameScript).filter(s => s && s !== 'neutral');
  const uniqueScripts = new Set(scripts);
  let scriptBonus = 0;
  if (uniqueScripts.size === 1 && scripts.length >= 2) scriptBonus = 3;
  if (uniqueScripts.size >= 3) scriptBonus = -2;

  const total =
    edgeSum
    + corrBonus      * mm.corr
    + riskDivBonus   * 0.5 * mm.risk
    - negCorrPenalty
    - lengthPenalty  * mm.length
    - dqPenalty
    + scriptBonus;

  return {
    total,
    breakdown: {
      edge_sum:          edgeSum,
      corr_bonus:        corrBonus,
      risk_div_bonus:    riskDivBonus,
      length_penalty:    lengthPenalty,
      neg_corr_penalty:  negCorrPenalty,
      dq_penalty:        dqPenalty,
      script_bonus:      scriptBonus,
    },
  };
}

// ── Validity rules (no-go) ────────────────────────────────────────────────

const MIN_EDGE_BY_MODE = { conservative: 3, balanced: 2, aggressive: 2, dreamer: 1.5 };

// Max legs allowed from a single game per mode
const MAX_LEGS_PER_GAME = { conservative: 2, balanced: 3, aggressive: 4, dreamer: 5 };

// Minimum pairwise correlation required between legs from the same game per mode.
// More lenient modes allow independent player props (hits, Ks, bases) to coexist.
const SGP_MIN_CORR = { conservative: 0.15, balanced: 0.0, aggressive: -0.2, dreamer: -0.3 };

/**
 * Check whether a set of legs is a valid parlay under the given mode.
 * Returns { valid: true } or { valid: false, reason: string }.
 */
export function isParlayValid(legs, correlations, mode, { allowSGP = true } = {}) {
  // 1. No strong negative correlation between any pair
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const c = correlations[pairKey(legs[i], legs[j])] ?? 0;
      if (c < -0.5) return { valid: false, reason: 'strong_negative_correlation' };
    }
  }

  // 2. SGP rules (same-game parlay constraints)
  const maxPerGame = MAX_LEGS_PER_GAME[mode] ?? 3;
  const minSgpCorr = SGP_MIN_CORR[mode] ?? 0.0;
  const byGame = groupBy(legs, 'gamePk');
  for (const [, group] of Object.entries(byGame)) {
    if (!allowSGP && group.length > 1) {
      return { valid: false, reason: 'sgp_not_allowed' };
    }
    if (group.length > maxPerGame) {
      return { valid: false, reason: 'too_many_same_game' };
    }
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const c = correlations[pairKey(group[i], group[j])] ?? 0;
        if (c < minSgpCorr) return { valid: false, reason: 'sgp_without_positive_correlation' };
      }
    }
  }

  // 3. Conservative mode rejects any high-risk leg
  if (mode === 'conservative' && legs.some(l => l.modelRisk === 'high')) {
    return { valid: false, reason: 'high_risk_leg_in_conservative_mode' };
  }

  // 4. Minimum edge per leg for the mode
  const minEdge = MIN_EDGE_BY_MODE[mode] ?? 2;
  if (legs.some(l => (l.edge ?? -999) < minEdge)) {
    return { valid: false, reason: 'edge_below_minimum' };
  }

  return { valid: true };
}

// ── Greedy builder ────────────────────────────────────────────────────────

/**
 * Build a parlay greedily starting from `seed`.
 * At each step, add the candidate that maximally increases the parlay score.
 */
function greedyBuild(seed, eligible, N, mode, correlations, riskDistances, validityOpts) {
  const legs = [seed];
  const remaining = eligible.filter(c => c.candidateId !== seed.candidateId);

  while (legs.length < N) {
    let bestScore = -Infinity;
    let bestIdx = -1;

    for (let k = 0; k < remaining.length; k++) {
      const trial = [...legs, remaining[k]];
      if (!isParlayValid(trial, correlations, mode, validityOpts).valid) continue;
      const { total } = scoreParlay(trial, correlations, riskDistances, mode, N);
      if (total > bestScore) {
        bestScore = total;
        bestIdx = k;
      }
    }

    if (bestIdx === -1) break; // no valid candidate can be added
    legs.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return legs;
}

// ── 2-opt local search ────────────────────────────────────────────────────

/**
 * Improve a parlay by swapping one leg at a time.
 * Restarts after each accepted swap. Stops when no swap improves the score.
 */
function localSearch(initialLegs, eligible, N, mode, correlations, riskDistances, validityOpts) {
  let legs = [...initialLegs];
  let { total: currentScore } = scoreParlay(legs, correlations, riskDistances, mode, N);

  let improved = true;
  while (improved) {
    improved = false;
    const inParlay = new Set(legs.map(l => l.candidateId));
    const swapCandidates = eligible.filter(c => !inParlay.has(c.candidateId));

    search:
    for (let i = 0; i < legs.length; i++) {
      for (const cand of swapCandidates) {
        const trial = legs.map((l, idx) => (idx === i ? cand : l));
        if (!isParlayValid(trial, correlations, mode, validityOpts).valid) continue;
        const { total } = scoreParlay(trial, correlations, riskDistances, mode, N);
        if (total > currentScore) {
          legs = trial;
          currentScore = total;
          improved = true;
          break search; // restart outer loop from improved position
        }
      }
    }
  }

  return legs;
}

// ── Parlay assembler ──────────────────────────────────────────────────────

function buildComposedParlay(index, legs, correlations, riskDistances, mode, N) {
  const { total: score, breakdown: scoreBreakdown } = scoreParlay(
    legs, correlations, riskDistances, mode, N,
  );

  const combinedMarginalProbability = legs.reduce(
    (p, leg) => p * (leg.modelProbability / 100), 1,
  );
  const combinedDecimalOdds = legs.reduce(
    (p, leg) => p * (leg.decimalOdds ?? 1), 1,
  );
  const naiveExpectedValue = combinedMarginalProbability * combinedDecimalOdds - 1;

  return {
    index,
    legs,
    score,
    scoreBreakdown,
    combinedMarginalProbability,
    combinedDecimalOdds,
    naiveExpectedValue,
  };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Compose up to 3 optimal parlays from a pool of enriched candidates.
 *
 * @param {object}   opts
 * @param {object[]} opts.candidates         ParlayCandidate[] (Fase 1+2 enriched)
 * @param {object}   opts.correlationMatrix  { correlations, riskDistances } from Fase 3
 * @param {number}   opts.N                  Requested number of legs
 * @param {string}   opts.mode               'conservative'|'balanced'|'aggressive'|'dreamer'
 * @param {object}   [opts.filters]          { minEdge, minConfidence, minDataQuality, allowSGP }
 * @returns {{ parlays: ComposedParlay[], meta: object }}
 */
export function composeParlays({
  candidates,
  correlationMatrix,
  N,
  mode = 'balanced',
  filters = {},
}) {
  const {
    minEdge       = MIN_EDGE_BY_MODE[mode] ?? 2,
    minConfidence = 55,
    minDataQuality = 50,
    allowSGP      = true,
  } = filters;

  const { correlations, riskDistances } = correlationMatrix;
  const validityOpts = { allowSGP };

  // --- Step 1: filter eligible candidates
  const eligible = candidates.filter(c =>
    (c.edge ?? -999) >= minEdge &&
    c.modelProbability >= minConfidence &&
    (c.dataQualityScore ?? 0) >= minDataQuality,
  );

  console.log(`[parlay-synergy] composer: ${eligible.length}/${candidates.length} eligible after filters (mode=${mode}, N=${N})`);

  if (eligible.length < N) {
    console.warn(`[parlay-synergy] composer: not enough eligible candidates (${eligible.length}) for N=${N}`);
    return { parlays: [], meta: { eligibleCount: eligible.length, rejectedByNoGo: 0 } };
  }

  // --- Step 2: sort seeds by edge adjusted for xgb agreement
  const sorted = [...eligible].sort((a, b) => {
    const scoreA = (a.edge ?? 0) * (a.xgbAgreement ? 1.1 : 1.0);
    const scoreB = (b.edge ?? 0) * (b.xgbAgreement ? 1.1 : 1.0);
    return scoreB - scoreA;
  });

  // --- Step 3: build combinations from up to 5 seeds, keep top-3 distinct
  const seen = new Set();
  const results = [];
  let rejectedByNoGo = 0;
  const seedCount = Math.min(5, sorted.length);

  for (let s = 0; s < seedCount && results.length < 3; s++) {
    const seed = sorted[s];

    // Greedy construction
    let legs = greedyBuild(seed, eligible, N, mode, correlations, riskDistances, validityOpts);

    if (legs.length < N) {
      rejectedByNoGo++;
      continue; // couldn't fill N legs from this seed
    }

    // 2-opt local search improvement
    legs = localSearch(legs, eligible, N, mode, correlations, riskDistances, validityOpts);

    // Final validity check (local search preserves validity, but verify)
    const validity = isParlayValid(legs, correlations, mode, validityOpts);
    if (!validity.valid) {
      rejectedByNoGo++;
      console.warn(`[parlay-synergy] composer: combination rejected (${validity.reason})`);
      continue;
    }

    // Deduplicate
    const key = comboKey(legs);
    if (seen.has(key)) continue;
    seen.add(key);

    results.push(buildComposedParlay(results.length, legs, correlations, riskDistances, mode, N));
  }

  // Sort by score descending and re-index
  results.sort((a, b) => b.score - a.score);
  results.forEach((p, i) => { p.index = i; });

  for (const p of results) {
    console.log(
      `[parlay-synergy] composer parlay #${p.index}: score=${p.score.toFixed(2)}`,
      `edge_sum=${p.scoreBreakdown.edge_sum.toFixed(2)}`,
      `corr_bonus=${p.scoreBreakdown.corr_bonus.toFixed(2)}`,
      `risk_div=${p.scoreBreakdown.risk_div_bonus.toFixed(2)}`,
      `len_penalty=${p.scoreBreakdown.length_penalty.toFixed(2)}`,
    );
  }

  return {
    parlays: results,
    meta: {
      eligibleCount: eligible.length,
      rejectedByNoGo,
    },
  };
}
