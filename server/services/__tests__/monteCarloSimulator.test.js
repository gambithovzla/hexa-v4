// Tests for simulateBankroll — pure function, no DB, no network.
// Run: node --test server/services/__tests__/monteCarloSimulator.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { simulateBankroll } from '../monteCarloSimulator.js';

// A 55% winrate flat-bet-equivalent sample: +1 / -1 outcomes.
const POSITIVE_EDGE = Array.from({ length: 100 }, (_, i) => (i < 55 ? 1 : -1));
// A 45% winrate sample — negative edge.
const NEGATIVE_EDGE = Array.from({ length: 100 }, (_, i) => (i < 45 ? 1 : -1));
// Realistic mixed odds sample (units): a few odds-adjusted wins, some losses.
const MIXED = [0.91, 0.91, -1, 1.05, -1, 0.91, -1, 0.83, 1.20, -1, 0.91, -1, -1, 0.91, 1.10];

describe('simulateBankroll — validation', () => {
  it('rejects empty or too-small outcome samples', () => {
    assert.throws(() => simulateBankroll({ outcomeSamples: [], horizonPicks: 10 }), /at least 10/);
    assert.throws(() => simulateBankroll({ outcomeSamples: [1, -1, 1], horizonPicks: 10 }), /at least 10/);
  });

  it('rejects invalid horizonPicks', () => {
    assert.throws(() => simulateBankroll({ outcomeSamples: MIXED, horizonPicks: 0 }), /horizonPicks/);
    assert.throws(() => simulateBankroll({ outcomeSamples: MIXED, horizonPicks: -1 }), /horizonPicks/);
    assert.throws(() => simulateBankroll({ outcomeSamples: MIXED, horizonPicks: 10_000 }), /horizonPicks/);
    assert.throws(() => simulateBankroll({ outcomeSamples: MIXED, horizonPicks: 1.5 }), /horizonPicks/);
  });

  it('rejects unknown stake strategies', () => {
    assert.throws(() =>
      simulateBankroll({ outcomeSamples: MIXED, horizonPicks: 10, stakeStrategy: 'kelly' })
    , /stakeStrategy/);
  });

  it('rejects out-of-range percentStake', () => {
    assert.throws(() =>
      simulateBankroll({ outcomeSamples: MIXED, horizonPicks: 10, stakeStrategy: 'percent', percentStake: 0 })
    , /percentStake/);
    assert.throws(() =>
      simulateBankroll({ outcomeSamples: MIXED, horizonPicks: 10, stakeStrategy: 'percent', percentStake: 1.5 })
    , /percentStake/);
  });
});

describe('simulateBankroll — determinism', () => {
  it('produces identical output for identical seed', () => {
    const a = simulateBankroll({ outcomeSamples: MIXED, horizonPicks: 50, nSims: 500, seed: 42 });
    const b = simulateBankroll({ outcomeSamples: MIXED, horizonPicks: 50, nSims: 500, seed: 42 });
    assert.equal(a.summary.meanTerminal, b.summary.meanTerminal);
    assert.equal(a.summary.pRuin, b.summary.pRuin);
    assert.equal(a.summary.medianTerminal, b.summary.medianTerminal);
  });

  it('produces different output for different seeds', () => {
    const a = simulateBankroll({ outcomeSamples: MIXED, horizonPicks: 50, nSims: 500, seed: 1 });
    const b = simulateBankroll({ outcomeSamples: MIXED, horizonPicks: 50, nSims: 500, seed: 2 });
    // Same seed family → same overall direction, but mean must differ at least by 1e-9
    assert.notEqual(a.summary.meanTerminal, b.summary.meanTerminal);
  });
});

describe('simulateBankroll — empirical correctness', () => {
  it('flat staking: mean terminal ≈ start + horizonPicks * historicalMeanUnits * flatStake', () => {
    const start = 1_000;
    const stake = 10;
    const H = 200;
    const r = simulateBankroll({
      outcomeSamples:   POSITIVE_EDGE,
      horizonPicks:     H,
      nSims:            5_000,
      startingBankroll: start,
      stakeStrategy:    'flat',
      flatStake:        stake,
      seed:             7,
    });
    const expected = start + H * 0.10 * stake; // 55% win @ ±1 → mean unit = 0.10
    const diff = Math.abs(r.summary.meanTerminal - expected);
    // Allow 5% relative noise from MC error
    assert.ok(diff / expected < 0.05, `mean terminal ${r.summary.meanTerminal} vs expected ${expected}`);
  });

  it('positive edge: P(profit) > 0.5 with long horizon', () => {
    const r = simulateBankroll({
      outcomeSamples: POSITIVE_EDGE,
      horizonPicks:   500,
      nSims:          3_000,
      stakeStrategy:  'flat',
      flatStake:      10,
      seed:           11,
    });
    assert.ok(r.summary.pProfit > 0.8, `expected P(profit) > 0.8, got ${r.summary.pProfit}`);
  });

  it('negative edge: P(profit) < 0.5 with long horizon', () => {
    const r = simulateBankroll({
      outcomeSamples: NEGATIVE_EDGE,
      horizonPicks:   500,
      nSims:          3_000,
      stakeStrategy:  'flat',
      flatStake:      10,
      seed:           13,
    });
    assert.ok(r.summary.pProfit < 0.2, `expected P(profit) < 0.2, got ${r.summary.pProfit}`);
  });

  it('percent staking: bankroll never goes below ruinThreshold and triggers ruin when set', () => {
    // Note: percent staking on bounded ±1 outcomes is a multiplicative random walk —
    // bankroll asymptotes toward 0 but never reaches it exactly. So we need a non-zero
    // ruinThreshold to actually observe `pRuin > 0`.
    const r = simulateBankroll({
      outcomeSamples:   NEGATIVE_EDGE,
      horizonPicks:     500,
      nSims:            1_000,
      startingBankroll: 1_000,
      stakeStrategy:    'percent',
      percentStake:     0.10,
      ruinThreshold:    100,    // ruined when bankroll drops below $100
      seed:             17,
    });
    assert.ok(r.summary.worstCase >= 0,  `worst case ${r.summary.worstCase} must be ≥ 0`);
    assert.ok(r.summary.pRuin > 0,        'aggressive % staking on neg edge w/ $100 floor should produce ruin');
  });
});

describe('simulateBankroll — output shape', () => {
  it('returns the right number of percentile timesteps', () => {
    const r = simulateBankroll({
      outcomeSamples:  MIXED,
      horizonPicks:    100,
      nSims:           500,
      percentileSteps: 25,
      seed:            3,
    });
    assert.equal(r.percentiles.length, 25);
    assert.equal(r.percentiles[0].t, 0);
    assert.equal(r.percentiles[r.percentiles.length - 1].t, 100);
  });

  it('percentiles are ordered: p10 ≤ p25 ≤ p50 ≤ p75 ≤ p90 at every step', () => {
    const r = simulateBankroll({
      outcomeSamples: MIXED,
      horizonPicks:   100,
      nSims:          1_000,
      seed:           19,
    });
    for (const p of r.percentiles) {
      assert.ok(p.p10 <= p.p25, `p10 ${p.p10} ≤ p25 ${p.p25}`);
      assert.ok(p.p25 <= p.p50, `p25 ${p.p25} ≤ p50 ${p.p50}`);
      assert.ok(p.p50 <= p.p75, `p50 ${p.p50} ≤ p75 ${p.p75}`);
      assert.ok(p.p75 <= p.p90, `p75 ${p.p75} ≤ p90 ${p.p90}`);
    }
  });

  it('histogram bin counts sum to nSims', () => {
    const r = simulateBankroll({
      outcomeSamples: MIXED,
      horizonPicks:   50,
      nSims:          1_000,
      seed:           5,
    });
    const total = r.histogram.reduce((a, b) => a + b.count, 0);
    assert.equal(total, 1_000);
  });

  it('sample paths length matches percentileSteps and pathSamples count', () => {
    const r = simulateBankroll({
      outcomeSamples:  MIXED,
      horizonPicks:    100,
      nSims:           500,
      pathSamples:     15,
      percentileSteps: 20,
      seed:            29,
    });
    assert.equal(r.samplePaths.tIndices.length, 20);
    assert.equal(r.samplePaths.paths.length, 15);
    for (const path of r.samplePaths.paths) {
      assert.equal(path.length, 20);
      assert.equal(path[0], r.config.startingBankroll);
    }
  });

  it('config echoes all the inputs', () => {
    const r = simulateBankroll({
      outcomeSamples:   MIXED,
      horizonPicks:     50,
      nSims:            200,
      startingBankroll: 5_000,
      stakeStrategy:    'percent',
      percentStake:     0.03,
      seed:             123,
    });
    assert.equal(r.config.horizonPicks, 50);
    assert.equal(r.config.nSims, 200);
    assert.equal(r.config.startingBankroll, 5_000);
    assert.equal(r.config.stakeStrategy, 'percent');
    assert.equal(r.config.percentStake, 0.03);
    assert.equal(r.config.historicalSampleSize, MIXED.length);
    assert.equal(r.config.seed, 123);
  });
});

describe('simulateBankroll — drawdown', () => {
  it('expected max drawdown is non-positive', () => {
    const r = simulateBankroll({
      outcomeSamples: MIXED,
      horizonPicks:   100,
      nSims:          1_000,
      seed:           37,
    });
    assert.ok(r.summary.expectedMaxDrawdown <= 0);
  });

  it('higher variance sample → larger absolute drawdown', () => {
    const lowVar  = Array.from({ length: 100 }, (_, i) => (i < 50 ? 0.5 : -0.5));
    const highVar = Array.from({ length: 100 }, (_, i) => (i < 50 ? 3   : -3));
    const a = simulateBankroll({
      outcomeSamples: lowVar,  horizonPicks: 200, nSims: 1_000,
      stakeStrategy: 'flat', flatStake: 10, seed: 41,
    });
    const b = simulateBankroll({
      outcomeSamples: highVar, horizonPicks: 200, nSims: 1_000,
      stakeStrategy: 'flat', flatStake: 10, seed: 41,
    });
    assert.ok(Math.abs(b.summary.expectedMaxDrawdown) > Math.abs(a.summary.expectedMaxDrawdown));
  });
});
