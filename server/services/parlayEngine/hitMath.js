// Poisson-binomial hit distribution for a parlay.
//
// A parlay's legs each have an independent hit probability p_i. The number of
// legs that hit follows a Poisson-binomial distribution (sum of independent
// Bernoulli trials with different probabilities). This lets us tell the user,
// honestly, how many legs they should expect to hit and how unlikely a full
// sweep really is — the math no prompt can beat.

/**
 * Exact Poisson-binomial PMF via the convolution recurrence.
 * @param {number[]} probs  per-leg hit probabilities in [0,1]
 * @returns {number[]} dist where dist[k] = P(exactly k legs hit), length = n+1
 */
export function poissonBinomialPmf(probs) {
  let dist = [1];
  for (const p of probs) {
    const q = 1 - p;
    const next = new Array(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) {
      next[k]     += dist[k] * q;
      next[k + 1] += dist[k] * p;
    }
    dist = next;
  }
  return dist;
}

/**
 * Compute the full hit distribution and the headline numbers for a parlay.
 *
 * @param {number[]} legProbabilities  per-leg hit probabilities in [0,1]
 * @returns {{
 *   n: number,
 *   expected_hits: number,
 *   p_all: number,
 *   p_at_least: Record<number, number>,
 *   distribution: number[],
 * }}
 */
export function computeHitDistribution(legProbabilities) {
  const probs = legProbabilities
    .map(Number)
    .filter(Number.isFinite)
    .map(p => Math.min(0.999, Math.max(0.001, p)));

  const n = probs.length;
  if (n === 0) {
    return { n: 0, expected_hits: 0, p_all: 0, p_at_least: {}, distribution: [] };
  }

  const dist = poissonBinomialPmf(probs);
  const expectedHits = probs.reduce((s, p) => s + p, 0);
  const cumAtLeast = (k) => dist.slice(Math.max(0, k)).reduce((s, v) => s + v, 0);

  const round = (v) => Math.round(v * 10000) / 10000;
  const pAtLeast = {};
  for (const k of [n, n - 1, n - 2].filter(k => k >= 1)) {
    pAtLeast[k] = round(cumAtLeast(k));
  }

  return {
    n,
    expected_hits: Math.round(expectedHits * 100) / 100,
    p_all: round(dist[n]),
    p_at_least: pAtLeast,
    distribution: dist.map(round),
  };
}
