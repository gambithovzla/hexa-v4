import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNflConviction,
  evaluateNflGate,
  rankNflCandidates,
  nflVarianceKey,
  NFL_MARKET_VARIANCE,
  NFL_DEFAULT_THRESHOLDS,
} from '../nflImperdibleSelector.js';

test('nflVarianceKey maps known markets, falls back to overunder', () => {
  assert.equal(nflVarianceKey('moneyline'), 'moneyline');
  assert.equal(nflVarianceKey('spread'), 'spread');
  assert.equal(nflVarianceKey('overunder'), 'overunder');
  assert.equal(nflVarianceKey('weird'), 'overunder');
});

test('edge is NOT rewarded: an agreeing pick beats an edgy one', () => {
  const agreeing = computeNflConviction({
    modelProb: 66, impliedProb: 64, mlProb: 65, dataQuality: 90,
    marketType: 'moneyline', qbConfirmed: true,
  });
  const edgy = computeNflConviction({
    modelProb: 66, impliedProb: 48, mlProb: 65, dataQuality: 90,
    marketType: 'moneyline', qbConfirmed: true,
  });
  assert.ok(agreeing.conviction > edgy.conviction,
    `agreeing ${agreeing.conviction} should beat edgy ${edgy.conviction}`);
});

test('moneyline is penalized less than a total at equal probability', () => {
  const ml = computeNflConviction({
    modelProb: 66, impliedProb: 64, mlProb: 65, dataQuality: 90,
    marketType: 'moneyline', qbConfirmed: true,
  });
  const tot = computeNflConviction({
    modelProb: 66, impliedProb: 64, dataQuality: 90,
    marketType: 'overunder', qbConfirmed: true,
  });
  assert.equal(ml.variancePenalty, NFL_MARKET_VARIANCE.moneyline);
  assert.equal(tot.variancePenalty, NFL_MARKET_VARIANCE.overunder);
  assert.ok(ml.conviction > tot.conviction);
});

test('unconfirmed QB collapses conviction (−100 penalty clamps to 0)', () => {
  const confirmed = computeNflConviction({
    modelProb: 68, impliedProb: 66, mlProb: 67, dataQuality: 90,
    marketType: 'moneyline', qbConfirmed: true,
  });
  const unconfirmed = computeNflConviction({
    modelProb: 68, impliedProb: 66, mlProb: 67, dataQuality: 90,
    marketType: 'moneyline', qbConfirmed: false,
  });
  assert.ok(confirmed.conviction > 50);
  assert.equal(unconfirmed.conviction, 0);
});

test('consensus re-normalizes over present signals (2-signal total vs 3-signal ML)', () => {
  // total has no validator signal → consensus is model+implied only.
  const tot = computeNflConviction({
    modelProb: 70, impliedProb: 60, dataQuality: 80,
    marketType: 'overunder', qbConfirmed: true,
  });
  // 0.45*70 + 0.30*60 = 49.5 over weight 0.75 = 66.0
  assert.equal(tot.consensusProb, 66);
});

test('gate: a clean heavy-favorite moneyline lock passes', () => {
  // ~ -200 favorite with model+market+validator tightly agreeing. The 70
  // conviction floor is deliberately strict — a thin 67/64/66 consensus lands
  // at 69.9 and misses, so a real lock needs a genuine heavy favorite.
  const scored = {
    ...computeNflConviction({
      modelProb: 70, impliedProb: 67, mlProb: 69, dataQuality: 90,
      marketType: 'moneyline', qbConfirmed: true,
    }),
    qbConfirmed: true,
    modelCertified: true,
  };
  const gate = evaluateNflGate(scored);
  assert.equal(gate.pass, true, JSON.stringify(gate.failedReasons));
});

test('gate: missing sidecar model (uncertified) fails with model_unavailable', () => {
  const scored = {
    ...computeNflConviction({
      modelProb: 67, impliedProb: 64, mlProb: 66, dataQuality: 85,
      marketType: 'moneyline', qbConfirmed: true,
    }),
    qbConfirmed: true,
    modelCertified: false,
  };
  const gate = evaluateNflGate(scored);
  assert.equal(gate.pass, false);
  assert.ok(gate.failedReasons.includes('model_unavailable'));
});

test('gate: unconfirmed QB fails with qb_not_confirmed', () => {
  const scored = {
    ...computeNflConviction({
      modelProb: 67, impliedProb: 64, mlProb: 66, dataQuality: 85,
      marketType: 'moneyline', qbConfirmed: false,
    }),
    qbConfirmed: false,
    modelCertified: true,
  };
  const gate = evaluateNflGate(scored);
  assert.equal(gate.pass, false);
  assert.ok(gate.failedReasons.includes('qb_not_confirmed'));
});

test('gate: a coin-flip pick fails the conviction floor', () => {
  const scored = {
    ...computeNflConviction({
      modelProb: 52, impliedProb: 51, mlProb: 50, dataQuality: 80,
      marketType: 'spread', qbConfirmed: true,
    }),
    qbConfirmed: true,
    modelCertified: true,
  };
  const gate = evaluateNflGate(scored);
  assert.equal(gate.pass, false);
  assert.ok(gate.failedReasons.includes('conviction_below_min') || gate.failedReasons.includes('model_prob_below_min'));
});

test('rankNflCandidates orders by conviction desc', () => {
  const a = { conviction: 75, consensusProb: 70, variancePenalty: 0, agreement: { spread: 3 } };
  const b = { conviction: 80, consensusProb: 72, variancePenalty: 2, agreement: { spread: 4 } };
  const c = { conviction: 70, consensusProb: 68, variancePenalty: 0, agreement: { spread: 2 } };
  const ranked = rankNflCandidates([a, b, c]);
  assert.deepEqual(ranked.map((x) => x.conviction), [80, 75, 70]);
});

test('thresholds are NFL-calibrated (strict floors)', () => {
  assert.equal(NFL_DEFAULT_THRESHOLDS.requireQbConfirmed, true);
  assert.equal(NFL_DEFAULT_THRESHOLDS.requireModelCertified, true);
  assert.ok(NFL_DEFAULT_THRESHOLDS.minConviction >= 70);
});
