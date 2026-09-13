/**
 * nflPropDistributions.js — probability distributions for NFL player props.
 *
 * A prop is a question about one player's stat line: "more or less than 274.5
 * passing yards?". Answering it honestly needs a *distribution*, not a point
 * estimate — a QB projected for 275 yards clears 274.5 barely more than half the
 * time, while one projected for 275 with half the week-to-week variance clears it
 * far more often when the line sits at 240. The market prices that spread; a model
 * that only compares a mean to a line cannot.
 *
 * Families, chosen per stat shape:
 *   - yards          → Gamma (non-negative, right-skewed: the 180-yard rushing
 *                      game exists, the -20 yard game does not)
 *   - counts         → Negative Binomial when the stat is overdispersed
 *                      (variance > mean, the NFL norm for receptions/carries),
 *                      else Poisson
 *   - occurrence     → Bernoulli via Poisson(λ) → P(at least one), for anytime TD
 *
 * All CDFs are built on one numerical core: the regularized incomplete gamma
 * function (Numerical Recipes gser/gcf), plus the regularized incomplete beta for
 * the Negative Binomial. Pure, dependency-free, unit-tested against known values.
 *
 * Everything returns null rather than NaN on invalid input — callers treat null as
 * "no opinion" and fall back to the market.
 */

const EPS = 3e-14;
const ITMAX = 300;
const FPMIN = 1e-300;
const SQRT2 = Math.SQRT2;

const LANCZOS = [
  76.18009172947146, -86.50532032941677, 24.01409824083091,
  -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
];

/** Natural log of the gamma function (Lanczos approximation, ~1e-15 relative). */
export function lnGamma(x) {
  if (!Number.isFinite(x) || x <= 0) return NaN;
  let y = x;
  const tmp0 = x + 5.5;
  const tmp = tmp0 - (x + 0.5) * Math.log(tmp0);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += LANCZOS[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function gammaSeries(a, x) {
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 0; n < ITMAX; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

function gammaContinuedFraction(a, x) {
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= ITMAX; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/** Regularized lower incomplete gamma P(a, x) = γ(a,x)/Γ(a). */
export function lowerGammaRegularized(a, x) {
  if (!Number.isFinite(a) || !Number.isFinite(x) || a <= 0 || x < 0) return null;
  if (x === 0) return 0;
  return x < a + 1 ? gammaSeries(a, x) : 1 - gammaContinuedFraction(a, x);
}

/** Complementary error function, via the incomplete gamma identity. */
export function erfc(x) {
  if (!Number.isFinite(x)) return NaN;
  if (x === 0) return 1;
  const p = lowerGammaRegularized(0.5, x * x);
  if (p == null) return NaN;
  return x > 0 ? 1 - p : 1 + p;
}

/** Standard normal CDF. */
export function normalCdf(z) {
  if (!Number.isFinite(z)) return null;
  return 0.5 * erfc(-z / SQRT2);
}

function betaContinuedFraction(a, b, x) {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= ITMAX; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function incompleteBeta(a, b, x) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(x)) return null;
  if (a <= 0 || b <= 0) return null;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

// ── Distribution CDFs ─────────────────────────────────────────────────────────

/** P(X <= x) for X ~ Gamma(shape, scale). */
export function gammaCdf(x, shape, scale) {
  if (!Number.isFinite(x) || !(shape > 0) || !(scale > 0)) return null;
  if (x <= 0) return 0;
  return lowerGammaRegularized(shape, x / scale);
}

/** P(X <= k) for X ~ Poisson(lambda). */
export function poissonCdf(k, lambda) {
  if (!Number.isFinite(k) || !(lambda > 0)) return null;
  const floorK = Math.floor(k);
  if (floorK < 0) return 0;
  // P(X <= k) = Q(k+1, λ) = 1 - P(k+1, λ)
  const p = lowerGammaRegularized(floorK + 1, lambda);
  return p == null ? null : 1 - p;
}

/** P(X = k) for X ~ Poisson(lambda). */
export function poissonPmf(k, lambda) {
  if (!Number.isFinite(k) || !(lambda > 0) || k < 0) return null;
  const n = Math.round(k);
  return Math.exp(-lambda + n * Math.log(lambda) - lnGamma(n + 1));
}

/**
 * P(X <= k) for a Negative Binomial matched to (mean, variance).
 * Requires variance > mean (overdispersion); otherwise the caller should use
 * Poisson. Parameterized p = mean/variance, r = mean²/(variance-mean), so
 * P(X <= k) = I_p(r, k+1).
 */
export function negBinomialCdf(k, mean, variance) {
  if (!Number.isFinite(k) || !(mean > 0) || !(variance > mean)) return null;
  const floorK = Math.floor(k);
  if (floorK < 0) return 0;
  const p = mean / variance;
  const r = (mean * mean) / (variance - mean);
  return incompleteBeta(r, floorK + 1, p);
}

/** P(X = k) for a Negative Binomial matched to (mean, variance). */
export function negBinomialPmf(k, mean, variance) {
  if (!Number.isFinite(k) || !(mean > 0) || !(variance > mean) || k < 0) return null;
  const n = Math.round(k);
  const p = mean / variance;
  const r = (mean * mean) / (variance - mean);
  return Math.exp(
    lnGamma(n + r) - lnGamma(r) - lnGamma(n + 1) + r * Math.log(p) + n * Math.log(1 - p)
  );
}

// ── Over/under helpers ────────────────────────────────────────────────────────

function clamp01(p) {
  if (p == null || !Number.isFinite(p)) return null;
  return Math.min(1, Math.max(0, p));
}

/**
 * P(stat > line) for a continuous, non-negative, right-skewed stat (yards).
 * Push probability is zero for the half-point lines books actually post; an
 * integer line is treated as a strict inequality, which is how books grade
 * yardage (exactly 50.0 yards on a 50 line is a push, but that mass is
 * negligible for a continuous fit and is reported as 0).
 */
export function probOverGamma(line, mean, sd) {
  if (!Number.isFinite(line) || !(mean > 0) || !(sd > 0)) return null;
  const shape = (mean / sd) ** 2;
  const scale = (sd * sd) / mean;
  const cdf = gammaCdf(line, shape, scale);
  return cdf == null ? null : clamp01(1 - cdf);
}

/** P(stat > line) for a symmetric continuous stat. */
export function probOverNormal(line, mean, sd) {
  if (!Number.isFinite(line) || !Number.isFinite(mean) || !(sd > 0)) return null;
  const cdf = normalCdf((line - mean) / sd);
  return cdf == null ? null : clamp01(1 - cdf);
}

/**
 * Discrete over/under with explicit push mass.
 * A half line (5.5) cannot push. An integer line (5) pushes on exactly 5.
 * @returns {{ over, under, push }|null} probabilities summing to 1
 */
export function probOverCount(line, mean, variance) {
  if (!Number.isFinite(line) || !(mean > 0)) return null;
  const overdispersed = Number.isFinite(variance) && variance > mean * 1.05;
  const cdfAt = (k) =>
    overdispersed ? negBinomialCdf(k, mean, variance) : poissonCdf(k, mean);
  const pmfAt = (k) =>
    overdispersed ? negBinomialPmf(k, mean, variance) : poissonPmf(k, mean);

  const isInteger = Number.isInteger(line);
  if (isInteger) {
    const cdf = cdfAt(line);
    const pushMass = pmfAt(line);
    if (cdf == null || pushMass == null) return null;
    const over = clamp01(1 - cdf);
    const push = clamp01(pushMass);
    return { over, under: clamp01(1 - over - push), push };
  }
  const cdf = cdfAt(Math.floor(line));
  if (cdf == null) return null;
  const over = clamp01(1 - cdf);
  return { over, under: clamp01(1 - over), push: 0 };
}

/**
 * P(at least one occurrence) given an expected count — the anytime-touchdown
 * shape. A player expected to score 0.6 TDs scores *at least one* only 45% of
 * the time, because two-TD games eat part of that mean. Treating 0.6 as if it
 * were a 60% chance is the single most common anytime-TD pricing error.
 */
export function probAtLeastOne(expectedCount) {
  if (!Number.isFinite(expectedCount) || expectedCount < 0) return null;
  if (expectedCount === 0) return 0;
  return clamp01(1 - Math.exp(-expectedCount));
}

/** Inverse of probAtLeastOne — recover the Poisson mean from a hit probability. */
export function expectedCountFromHitProb(prob) {
  const p = clamp01(prob);
  if (p == null || p >= 1) return null;
  return -Math.log(1 - p);
}
