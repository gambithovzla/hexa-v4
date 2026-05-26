// Tests for hitMath.js — Poisson-binomial hit distribution.
// Run: node --test server/services/parlayEngine/__tests__/hitMath.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeHitDistribution, poissonBinomialPmf } from '../hitMath.js';

describe('poissonBinomialPmf', () => {
  it('reduces to the binomial when all probabilities are equal', () => {
    // 3 legs at p=0.5 → distribution [1/8, 3/8, 3/8, 1/8]
    const dist = poissonBinomialPmf([0.5, 0.5, 0.5]);
    assert.equal(dist.length, 4);
    const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
    approx(dist[0], 0.125);
    approx(dist[1], 0.375);
    approx(dist[2], 0.375);
    approx(dist[3], 0.125);
  });

  it('always sums to 1', () => {
    const dist = poissonBinomialPmf([0.7, 0.55, 0.62, 0.8, 0.6]);
    const sum = dist.reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `sum=${sum}`);
  });
});

describe('computeHitDistribution', () => {
  it('expected hits equals the sum of leg probabilities', () => {
    const d = computeHitDistribution([0.65, 0.65, 0.65, 0.65, 0.65]);
    assert.equal(d.n, 5);
    assert.equal(d.expected_hits, 3.25);
  });

  it('p_all equals the product of probabilities (independence)', () => {
    const d = computeHitDistribution([0.7, 0.6]);
    assert.ok(Math.abs(d.p_all - 0.42) < 1e-4, `p_all=${d.p_all}`);
  });

  it('matches the known low odds of a 10-leg 65% parlay', () => {
    const d = computeHitDistribution(Array(10).fill(0.65));
    // 0.65^10 ≈ 0.0135
    assert.ok(d.p_all > 0.012 && d.p_all < 0.015, `p_all=${d.p_all}`);
    assert.equal(d.expected_hits, 6.5);
    // P(>=8 of 10) ≈ 0.262
    assert.ok(Math.abs(d.p_at_least[8] - 0.262) < 0.01, `p>=8=${d.p_at_least[8]}`);
  });

  it('handles empty input gracefully', () => {
    const d = computeHitDistribution([]);
    assert.equal(d.n, 0);
    assert.equal(d.p_all, 0);
  });
});
