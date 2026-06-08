import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSoccerConviction,
  evaluateSoccerGate,
  rankSoccerCandidates,
  soccerVarianceKey,
  SOCCER_MARKET_VARIANCE,
  SOCCER_DEFAULT_THRESHOLDS,
} from '../soccerImperdibleSelector.js';

test('soccerVarianceKey maps known markets, falls back to total', () => {
  assert.equal(soccerVarianceKey('moneyline'), 'moneyline');
  assert.equal(soccerVarianceKey('total'), 'total');
  assert.equal(soccerVarianceKey('overunder'), 'overunder'); // parlay builder emits this
  assert.equal(soccerVarianceKey('btts'), 'btts');
  assert.equal(soccerVarianceKey('weird'), 'total');
});

test('edge is NOT rewarded: an agreeing pick beats an edgy one', () => {
  const agreeing = computeSoccerConviction({
    modelProb: 62, impliedProb: 61, mlProb: 60, dataQuality: 90, marketType: 'moneyline',
  });
  const edgy = computeSoccerConviction({
    modelProb: 62, impliedProb: 45, mlProb: 60, dataQuality: 90, marketType: 'moneyline',
  });
  assert.ok(agreeing.conviction > edgy.conviction,
    `agreeing ${agreeing.conviction} should beat edgy ${edgy.conviction}`);
});

test('1X2 moneyline is penalized less than total/btts at equal probability', () => {
  const common = { modelProb: 62, impliedProb: 61, dataQuality: 90 };
  const ml  = computeSoccerConviction({ ...common, marketType: 'moneyline' });
  const tot = computeSoccerConviction({ ...common, marketType: 'total' });
  const bt  = computeSoccerConviction({ ...common, marketType: 'btts' });
  assert.ok(ml.conviction > tot.conviction);
  assert.ok(tot.conviction > bt.conviction);
  assert.equal(ml.variancePenalty, 0);
  assert.equal(bt.variancePenalty, 5);
});

test('missing model probability yields zero conviction', () => {
  const r = computeSoccerConviction({ modelProb: null, impliedProb: 60, marketType: 'moneyline' });
  assert.equal(r.conviction, 0);
  assert.equal(r.components, null);
});

test('consensus re-normalizes over present signals (no ml)', () => {
  const r = computeSoccerConviction({ modelProb: 64, impliedProb: 60, marketType: 'moneyline' });
  // weights 0.45 model + 0.30 implied → consensus = (0.45*64 + 0.30*60)/0.75 = 62.4
  assert.ok(Math.abs(r.consensusProb - 62.4) < 0.2, `consensus ${r.consensusProb}`);
});

test('gate passes a strong, model-certified, lineup-not-required lock', () => {
  const scored = {
    conviction: 64, consensusProb: 62, lineupConfirmed: false, modelCertified: true,
    components: { modelProb: 63, impliedProb: 61, mlProb: 58, dataQuality: 80 },
  };
  const { pass, failedReasons } = evaluateSoccerGate(scored);
  assert.equal(pass, true, `failed: ${failedReasons.join(',')}`);
});

test('gate fails without a certified model (no sidecar → no lock)', () => {
  const scored = {
    conviction: 64, consensusProb: 62, lineupConfirmed: true, modelCertified: false,
    components: { modelProb: 63, impliedProb: 61, mlProb: 58, dataQuality: 80 },
  };
  const { pass, failedReasons } = evaluateSoccerGate(scored);
  assert.equal(pass, false);
  assert.ok(failedReasons.includes('model_unavailable'));
});

test('gate fails on low conviction and on market disagreement', () => {
  const weak = evaluateSoccerGate({
    conviction: 50, consensusProb: 55, modelCertified: true,
    components: { modelProb: 56, impliedProb: 40, mlProb: 55, dataQuality: 80 },
  });
  assert.equal(weak.pass, false);
  assert.ok(weak.failedReasons.includes('conviction_below_min'));
  assert.ok(weak.failedReasons.includes('market_disagrees'));
});

test('requireLineupConfirmed (Sprint 11.3 future) blocks when lineup unknown', () => {
  const scored = {
    conviction: 64, consensusProb: 62, lineupConfirmed: false, modelCertified: true,
    components: { modelProb: 63, impliedProb: 61, mlProb: 58, dataQuality: 80 },
  };
  const { pass, failedReasons } = evaluateSoccerGate(scored, { requireLineupConfirmed: true });
  assert.equal(pass, false);
  assert.ok(failedReasons.includes('lineup_not_confirmed'));
});

test('rankSoccerCandidates orders by conviction desc', () => {
  const ranked = rankSoccerCandidates([
    { conviction: 60, consensusProb: 60, variancePenalty: 0, agreement: { bonus: 0 } },
    { conviction: 64, consensusProb: 62, variancePenalty: 0, agreement: { bonus: 1 } },
  ]);
  assert.equal(ranked[0].conviction, 64);
});

test('thresholds + variance map are exported and soccer-tuned', () => {
  assert.equal(SOCCER_DEFAULT_THRESHOLDS.minConviction, 60);
  assert.equal(SOCCER_DEFAULT_THRESHOLDS.requireLineupConfirmed, false);
  assert.equal(SOCCER_DEFAULT_THRESHOLDS.requireModelCertified, true);
  assert.equal(SOCCER_MARKET_VARIANCE.moneyline, 0);
});
