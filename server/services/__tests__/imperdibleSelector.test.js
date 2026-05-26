import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeConviction,
  evaluateGate,
  rankCandidates,
  agreementBonus,
  mlProbForPick,
  varianceKey,
  MARKET_VARIANCE,
} from '../imperdibleSelector.js';

test('agreement: tight signals get a bonus, wide spread gets penalized', () => {
  assert.equal(agreementBonus(0), 6);
  assert.equal(agreementBonus(5), 6);
  assert.ok(agreementBonus(15) < 0);
  assert.equal(agreementBonus(25), -15);
  assert.equal(agreementBonus(40), -15);
});

test('mlProbForPick inverts probability when the model picks the other side', () => {
  assert.equal(mlProbForPick({ prob: 70, agree: true }), 70);
  assert.equal(mlProbForPick({ prob: 70, agree: false }), 30);
  assert.equal(mlProbForPick({ prob: 0.66, agree: true }), 66);
  assert.equal(mlProbForPick({ prob: null, agree: true }), null);
});

test('variance key maps props to their kind', () => {
  assert.equal(varianceKey('moneyline'), 'moneyline');
  assert.equal(varianceKey('playerprop', 'hits'), 'playerprop_hits');
  assert.equal(varianceKey('playerprop', 'strikeouts'), 'playerprop_strikeouts');
  assert.equal(varianceKey('playerprop', 'rbi'), 'playerprop_other');
});

test('edge is NOT rewarded: a market-disagreement pick scores below an agreeing one', () => {
  // Same model prob, same market type. One agrees with the market, one has a
  // big edge (model >> market). The agreeing pick must win.
  const agreeing = computeConviction({
    modelProb: 68, impliedProb: 66, mlProb: 67, dataQuality: 90,
    marketType: 'moneyline', lineupConfirmed: true,
  });
  const edgy = computeConviction({
    modelProb: 68, impliedProb: 48, mlProb: 67, dataQuality: 90,
    marketType: 'moneyline', lineupConfirmed: true,
  });
  assert.ok(agreeing.conviction > edgy.conviction,
    `agreeing ${agreeing.conviction} should beat edgy ${edgy.conviction}`);
});

test('a high-variance prop is penalized versus an equal-probability moneyline', () => {
  const ml = computeConviction({
    modelProb: 66, impliedProb: 64, mlProb: 65, dataQuality: 90,
    marketType: 'moneyline', lineupConfirmed: true,
  });
  const prop = computeConviction({
    modelProb: 66, impliedProb: 64, mlProb: 65, dataQuality: 90,
    marketType: 'playerprop', propKind: 'hits', lineupConfirmed: true,
  });
  assert.ok(ml.conviction > prop.conviction);
  assert.equal(ml.variancePenalty, MARKET_VARIANCE.moneyline);
  assert.equal(prop.variancePenalty, MARKET_VARIANCE.playerprop_hits);
});

test('unconfirmed lineup is effectively disqualified', () => {
  const score = computeConviction({
    modelProb: 75, impliedProb: 72, mlProb: 74, dataQuality: 95,
    marketType: 'moneyline', lineupConfirmed: false,
  });
  assert.equal(score.conviction, 0);
  const gate = evaluateGate({ ...score, lineupConfirmed: false });
  assert.equal(gate.pass, false);
  assert.ok(gate.failedReasons.includes('lineup_not_confirmed'));
});

test('gate fails when the market disagrees (low implied prob)', () => {
  const score = computeConviction({
    modelProb: 70, impliedProb: 50, mlProb: 60, dataQuality: 90,
    marketType: 'moneyline', lineupConfirmed: true,
  });
  const gate = evaluateGate({ ...score, lineupConfirmed: true });
  assert.equal(gate.pass, false);
  assert.ok(gate.failedReasons.includes('market_disagrees'));
});

test('gate fails when the ML sidecar is against the pick', () => {
  const score = computeConviction({
    modelProb: 70, impliedProb: 66, mlProb: 40, dataQuality: 90,
    marketType: 'moneyline', lineupConfirmed: true,
  });
  const gate = evaluateGate({ ...score, lineupConfirmed: true });
  assert.equal(gate.pass, false);
  assert.ok(gate.failedReasons.includes('ml_against_pick'));
});

test('a true lock (all signals aligned, confirmed, clean) clears the gate', () => {
  const score = computeConviction({
    modelProb: 72, impliedProb: 70, mlProb: 71, dataQuality: 92,
    marketType: 'moneyline', lineupConfirmed: true,
  });
  const gate = evaluateGate({ ...score, lineupConfirmed: true });
  assert.equal(gate.pass, true, JSON.stringify({ score, gate }));
});

test('rankCandidates orders by conviction, never by edge', () => {
  const list = [
    { candidateId: 'a', conviction: 70, consensusProb: 68, variancePenalty: 0, agreement: { spread: 4 } },
    { candidateId: 'b', conviction: 80, consensusProb: 70, variancePenalty: 5, agreement: { spread: 2 } },
    { candidateId: 'c', conviction: 80, consensusProb: 70, variancePenalty: 0, agreement: { spread: 8 } },
  ];
  const ranked = rankCandidates(list);
  assert.equal(ranked[0].candidateId, 'c'); // tie at 80/70 → lower variance wins
  assert.equal(ranked[1].candidateId, 'b');
  assert.equal(ranked[2].candidateId, 'a');
});
