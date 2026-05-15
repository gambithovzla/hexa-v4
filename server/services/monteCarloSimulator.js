/**
 * monteCarloSimulator.js — forward bankroll simulation via empirical bootstrap.
 *
 * Pure Node, zero dependencies. Pulls unit returns from a sample of resolved
 * picks and projects N alternative futures over a horizon of H picks. Used
 * by the admin Equity Dashboard to answer "given my historical edge, what
 * does my bankroll look like in 6 months?" — including P(ruin), expected
 * max drawdown, and percentile bands.
 *
 * Bootstrap rationale:
 *   The historical units distribution already encodes both the edge (mean)
 *   and the variance (spread of wins vs losses). Sampling with replacement
 *   preserves both without parametric assumptions (no normality, no fixed
 *   odds, no fixed win rate). Trade-off: any regime change in the future
 *   would not be modelled — this is a "what if the past keeps repeating?"
 *   forecast, not a true predictive model.
 *
 * Memory profile:
 *   Worst case (N=10_000, H=2_000, stepCount=50) keeps ~50 * 10k * 8B = 4MB
 *   for percentile columns plus ~20 sample paths * 50 steps. Safe for Node.
 *
 * Public API:
 *   simulateBankroll({ outcomeSamples, horizonPicks, ...options }) → object
 */

const DEFAULTS = {
  nSims:            10_000,
  startingBankroll: 1_000,
  stakeStrategy:    'percent',  // 'flat' | 'percent'
  flatStake:        10,          // USD per pick when strategy = 'flat'
  percentStake:     0.02,        // 2% of current bankroll when strategy = 'percent'
  ruinThreshold:    0,           // bankroll <= this → ruined
  pathSamples:      20,          // how many individual paths to return for viz
  percentileSteps:  50,          // how many timesteps to record percentiles at
  histogramBins:    30,          // bins for terminal-bankroll histogram
};

const HARD_LIMITS = {
  maxNSims:        50_000,
  maxHorizon:      5_000,
  minSamples:      10,
};

// ── Tiny seedable RNG (Mulberry32). Math.random() if seed is null. ──────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// Linear-interpolated quantile from a sorted array.
function quantile(sorted, q) {
  const n = sorted.length;
  if (n === 0) return null;
  if (q <= 0) return sorted[0];
  if (q >= 1) return sorted[n - 1];
  const idx = (n - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/**
 * Run the simulation.
 *
 * @param {Object}  opts
 * @param {number[]} opts.outcomeSamples
 *    Historical per-pick unit returns. Each entry is the units won/lost on
 *    one resolved pick (e.g. +0.91, -1.0, 0.0). MUST be a flat array — the
 *    simulator does not look at dates, market, or sport.
 * @param {number}  opts.horizonPicks       Number of picks to project forward.
 * @param {number=} opts.nSims              Default 10_000.
 * @param {number=} opts.startingBankroll   USD.
 * @param {'flat'|'percent'=} opts.stakeStrategy
 *    'flat':    stake = flatStake USD per pick.
 *    'percent': stake = percentStake * currentBankroll. Compounds, allows ruin.
 * @param {number=} opts.flatStake          USD per pick when strategy='flat'.
 * @param {number=} opts.percentStake       Fraction of bankroll (0-1).
 * @param {number=} opts.ruinThreshold      Bankroll <= this → path is ruined.
 * @param {number=} opts.seed               Optional uint32 for reproducibility.
 *
 * @returns {{
 *   config:       Object,
 *   percentiles:  Array<{ t, p10, p25, p50, p75, p90 }>,
 *   histogram:    Array<{ bin, binStart, binEnd, count }>,
 *   samplePaths:  { tIndices: number[], paths: number[][] },
 *   summary: {
 *     pRuin, pProfit, meanTerminal, medianTerminal,
 *     p10Terminal, p25Terminal, p75Terminal, p90Terminal,
 *     bestCase, worstCase, expectedMaxDrawdown,
 *     historicalMeanUnits, historicalStdUnits,
 *   }
 * }}
 */
export function simulateBankroll(opts = {}) {
  const samples = opts.outcomeSamples;
  if (!Array.isArray(samples) || samples.length < HARD_LIMITS.minSamples) {
    throw new Error(`outcomeSamples must contain at least ${HARD_LIMITS.minSamples} entries`);
  }

  const cfg = { ...DEFAULTS, ...opts };
  const H = Number(cfg.horizonPicks);
  if (!Number.isInteger(H) || H < 1 || H > HARD_LIMITS.maxHorizon) {
    throw new Error(`horizonPicks must be an integer in [1, ${HARD_LIMITS.maxHorizon}]`);
  }
  const N = Math.min(Math.max(1, Math.floor(cfg.nSims)), HARD_LIMITS.maxNSims);
  if (cfg.stakeStrategy !== 'flat' && cfg.stakeStrategy !== 'percent') {
    throw new Error(`stakeStrategy must be 'flat' or 'percent'`);
  }
  if (cfg.stakeStrategy === 'percent' && (cfg.percentStake <= 0 || cfg.percentStake > 1)) {
    throw new Error('percentStake must be in (0, 1]');
  }
  if (cfg.stakeStrategy === 'flat' && cfg.flatStake <= 0) {
    throw new Error('flatStake must be > 0');
  }
  if (cfg.startingBankroll <= 0) {
    throw new Error('startingBankroll must be > 0');
  }

  const rng = cfg.seed != null ? mulberry32(cfg.seed) : Math.random;
  const M = samples.length;

  // ── Pre-compute which timesteps to record for percentiles ────────────────
  const stepCount = Math.min(cfg.percentileSteps, H + 1);
  const sampledTimesteps = [];
  for (let s = 0; s < stepCount; s++) {
    sampledTimesteps.push(stepCount === 1 ? 0 : Math.round((s / (stepCount - 1)) * H));
  }
  const tToSampleIdx = new Map();
  sampledTimesteps.forEach((t, idx) => tToSampleIdx.set(t, idx));
  const valuesAtT = sampledTimesteps.map(() => new Float64Array(N));

  // ── Pick path indices to retain for spaghetti viz ────────────────────────
  const pathCount = Math.min(cfg.pathSamples, N);
  const pathsToKeep = new Set();
  while (pathsToKeep.size < pathCount) {
    pathsToKeep.add(Math.floor(rng() * N));
  }
  const samplePaths = [];

  const terminals = new Float64Array(N);
  const maxDDs    = new Float64Array(N);
  let ruined = 0;

  // ── Main loop ────────────────────────────────────────────────────────────
  for (let i = 0; i < N; i++) {
    let bankroll = cfg.startingBankroll;
    let peak     = bankroll;
    let maxDD    = 0;
    let isRuined = false;

    const keepPath = pathsToKeep.has(i);
    const pathBuf  = keepPath ? new Float64Array(stepCount) : null;

    if (tToSampleIdx.has(0)) {
      const si = tToSampleIdx.get(0);
      valuesAtT[si][i] = bankroll;
      if (keepPath) pathBuf[si] = bankroll;
    }

    for (let t = 1; t <= H; t++) {
      if (!isRuined) {
        const u = samples[Math.floor(rng() * M)];
        let delta;
        if (cfg.stakeStrategy === 'flat') {
          delta = cfg.flatStake * u;
        } else {
          delta = cfg.percentStake * bankroll * u;
        }
        bankroll += delta;
        if (bankroll <= cfg.ruinThreshold) {
          bankroll = 0;
          isRuined = true;
        }
      }
      if (bankroll > peak) peak = bankroll;
      const dd = bankroll - peak;
      if (dd < maxDD) maxDD = dd;

      if (tToSampleIdx.has(t)) {
        const si = tToSampleIdx.get(t);
        valuesAtT[si][i] = bankroll;
        if (keepPath) pathBuf[si] = bankroll;
      }
    }

    terminals[i] = bankroll;
    maxDDs[i]    = maxDD;
    if (bankroll <= cfg.ruinThreshold) ruined++;
    if (keepPath) samplePaths.push(Array.from(pathBuf));
  }

  // ── Aggregate ────────────────────────────────────────────────────────────
  const percentiles = sampledTimesteps.map((t, si) => {
    const sorted = Array.from(valuesAtT[si]).sort((a, b) => a - b);
    return {
      t,
      p10: quantile(sorted, 0.10),
      p25: quantile(sorted, 0.25),
      p50: quantile(sorted, 0.50),
      p75: quantile(sorted, 0.75),
      p90: quantile(sorted, 0.90),
    };
  });

  const termArr     = Array.from(terminals);
  const termSorted  = [...termArr].sort((a, b) => a - b);
  const minT        = termSorted[0];
  const maxT        = termSorted[N - 1];

  // Terminal histogram
  const bins      = Math.max(1, Math.floor(cfg.histogramBins));
  const range     = maxT - minT;
  const binWidth  = range > 0 ? range / bins : 1;
  const histogram = Array.from({ length: bins }, (_, b) => ({
    bin:      b,
    binStart: minT + b * binWidth,
    binEnd:   minT + (b + 1) * binWidth,
    count:    0,
  }));
  for (let i = 0; i < N; i++) {
    let b = range > 0 ? Math.floor((terminals[i] - minT) / binWidth) : 0;
    if (b >= bins) b = bins - 1;
    if (b < 0)     b = 0;
    histogram[b].count++;
  }

  // Summary stats
  const meanTerminal      = termArr.reduce((a, b) => a + b, 0) / N;
  const meanMaxDD         = Array.from(maxDDs).reduce((a, b) => a + b, 0) / N;
  const profitable        = termArr.filter((v) => v > cfg.startingBankroll).length;
  const histMean          = samples.reduce((a, b) => a + b, 0) / M;
  let histVar             = 0;
  for (const u of samples) histVar += (u - histMean) ** 2;
  histVar /= Math.max(M - 1, 1);
  const histStd           = Math.sqrt(histVar);

  return {
    config: {
      nSims:                N,
      horizonPicks:         H,
      startingBankroll:     cfg.startingBankroll,
      stakeStrategy:        cfg.stakeStrategy,
      flatStake:            cfg.flatStake,
      percentStake:         cfg.percentStake,
      ruinThreshold:        cfg.ruinThreshold,
      historicalSampleSize: M,
      seed:                 cfg.seed ?? null,
    },
    percentiles,
    histogram,
    samplePaths: {
      tIndices: sampledTimesteps,
      paths:    samplePaths,
    },
    summary: {
      pRuin:               ruined / N,
      pProfit:             profitable / N,
      meanTerminal,
      medianTerminal:      quantile(termSorted, 0.50),
      p10Terminal:         quantile(termSorted, 0.10),
      p25Terminal:         quantile(termSorted, 0.25),
      p75Terminal:         quantile(termSorted, 0.75),
      p90Terminal:         quantile(termSorted, 0.90),
      bestCase:            termSorted[N - 1],
      worstCase:           termSorted[0],
      expectedMaxDrawdown: meanMaxDD,
      historicalMeanUnits: histMean,
      historicalStdUnits:  histStd,
    },
  };
}
