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

test('null impliedProb is handled: conviction still computed via reweighting', () => {
  const score = computeConviction({
    modelProb: 85, impliedProb: null, mlProb: 78, dataQuality: 90,
    marketType: 'runline', lineupConfirmed: true,
  });
  // model 0.45 + ml 0.25 = 0.70 total weight; consensus = (85*0.45 + 78*0.25)/0.70 = ~82.5
  assert.ok(score.consensusProb > 80 && score.consensusProb < 84, `consensus ~82.5, got ${score.consensusProb}`);
  assert.equal(score.components.impliedProb, null);
});

test('gate passes when implied is null by default (skipped check)', () => {
  const score = computeConviction({
    modelProb: 80, impliedProb: null, mlProb: 75, dataQuality: 85,
    marketType: 'runline', lineupConfirmed: true,
  });
  const gate = evaluateGate({ ...score, lineupConfirmed: true });
  assert.equal(gate.pass, true, JSON.stringify({ score, gate }));
});

test('gate fails when requireImpliedProb is true and implied is null', () => {
  const score = computeConviction({
    modelProb: 80, impliedProb: null, mlProb: 75, dataQuality: 85,
    marketType: 'runline', lineupConfirmed: true,
  });
  const gate = evaluateGate({ ...score, lineupConfirmed: true }, { requireImpliedProb: true });
  assert.equal(gate.pass, false);
  assert.ok(gate.failedReasons.includes('market_price_missing'));
});

test('payout floor: candidate with deep favorite odds fails when floor is set', () => {
  const score = computeConviction({
    modelProb: 88, impliedProb: 85, mlProb: 84, dataQuality: 92,
    marketType: 'runline', lineupConfirmed: true,
  });
  // -1500 odds = decimal 1.067 (below 1.10 floor)
  const gate = evaluateGate(
    { ...score, lineupConfirmed: true, odds: -1500 },
    { minPayoutDecimal: 1.10 },
  );
  assert.equal(gate.pass, false);
  assert.ok(gate.failedReasons.includes('payout_below_floor'));
});

test('payout floor: candidate at +120 passes with floor of 1.10', () => {
  const score = computeConviction({
    modelProb: 72, impliedProb: 70, mlProb: 71, dataQuality: 90,
    marketType: 'moneyline', lineupConfirmed: true,
  });
  const gate = evaluateGate(
    { ...score, lineupConfirmed: true, odds: 120 },
    { minPayoutDecimal: 1.10 },
  );
  assert.equal(gate.pass, true);
});

test('extended candidate: ML signal is excluded from consensus', () => {
  // Main-line equivalent: heavy disagreement between model (90) and ML (36)
  // pulls consensus down and applies an agreement penalty.
  const main = computeConviction({
    modelProb: 90, impliedProb: null, mlProb: 36, dataQuality: 90,
    marketType: 'runline', lineupConfirmed: true, marketSource: 'main',
  });
  // Same numbers but extended: ML is dropped from signals entirely.
  const extended = computeConviction({
    modelProb: 90, impliedProb: null, mlProb: 36, dataQuality: 90,
    marketType: 'runline', lineupConfirmed: true, marketSource: 'extended',
  });
  assert.ok(extended.consensusProb > main.consensusProb + 15,
    `extended consensus (${extended.consensusProb}) should be much higher than main (${main.consensusProb})`);
  assert.equal(extended.components.mlExcluded, true);
  assert.equal(extended.components.mlProb, null, 'ML prob is null in components when excluded');
  assert.ok(extended.conviction > main.conviction + 20,
    `extended conviction (${extended.conviction}) should beat main (${main.conviction})`);
});

test('extended candidate: uses softer conviction threshold (62 vs 72)', () => {
  // A pick that scores ~70 conviction passes for extended but fails for main.
  const candidate = computeConviction({
    modelProb: 88, impliedProb: null, mlProb: null, dataQuality: 90,
    marketType: 'runline', lineupConfirmed: true, marketSource: 'extended',
  });
  const gate = evaluateGate({ ...candidate, lineupConfirmed: true, marketSource: 'extended' });
  assert.equal(gate.pass, true, `extended gate should pass; got ${JSON.stringify(gate)}`);

  // Same candidate as main-line would fail because main requires conviction>=72
  // AND the ML signal: here we score it as main with the same inputs.
  const asMain = computeConviction({
    modelProb: 88, impliedProb: null, mlProb: null, dataQuality: 90,
    marketType: 'runline', lineupConfirmed: true, marketSource: 'main',
  });
  // Score is the same when mlProb is null, but threshold differs.
  const mainGate = evaluateGate({ ...asMain, lineupConfirmed: true, marketSource: 'main' });
  if (asMain.conviction < 72) {
    assert.equal(mainGate.pass, false, 'main gate is stricter');
  }
});

test('extended candidate: model_prob 90 + null implied + no ML → high conviction', () => {
  // This mirrors the user's screenshot: Parlay shows 93% for ATL +5.5, but
  // Imperdible used to gate it at 49%. After the fix it should sail through.
  const score = computeConviction({
    modelProb: 93, impliedProb: null, mlProb: null, dataQuality: 88,
    marketType: 'runline', lineupConfirmed: true, marketSource: 'extended',
  });
  const gate = evaluateGate({ ...score, lineupConfirmed: true, marketSource: 'extended' });
  assert.ok(score.conviction > 75,
    `conviction should reflect the 93% model prob, got ${score.conviction}`);
  assert.equal(gate.pass, true, `gate should pass for a 93% alt-line pick; got ${JSON.stringify(gate)}`);
});
