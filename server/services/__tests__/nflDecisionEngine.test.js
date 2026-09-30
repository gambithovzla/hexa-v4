import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateNflDecision } from '../nflDecisionEngine.js';

const now = '2026-09-29T19:00:00Z';
const kickoffAt = '2026-09-29T20:15:00Z';
const quote = {
  bookmaker: 'bet365', market: 'spread', side: 'home', line: -3.5,
  decimalOdds: 1.91, observedAt: now,
};
const model = { probability: 0.57, line: -3.5, certified: true, version: 'v2' };
const base = { quote, model, kickoffAt, now, qbConfirmed: true, dataQuality: 0.9, bankroll: 1000 };

test('price changes the decision for the same prediction', () => {
  const good = evaluateNflDecision(base);
  assert.equal(good.decision, 'BET');
  assert.equal(good.stake, 2.5);
  assert.ok(good.expectedValue > 0.08);
  const bad = evaluateNflDecision({ ...base, quote: { ...quote, decimalOdds: 1.65 } });
  assert.equal(bad.decision, 'NO_BET');
  assert.ok(bad.reasons.includes('edge_below_minimum'));
});

test('integer spread needs push probability before a bet', () => {
  const result = evaluateNflDecision({ ...base, quote: { ...quote, line: -3 }, model: { ...model, line: -3 } });
  assert.equal(result.decision, 'WATCH');
  assert.ok(result.reasons.includes('push_probability_missing'));
  assert.equal(result.probability.win, null);
});

test('a stale or mismatched quote cannot authorize a bet', () => {
  const stale = evaluateNflDecision({ ...base, quote: { ...quote, observedAt: '2026-09-29T18:50:00Z' } });
  assert.equal(stale.decision, 'WATCH');
  const wrongLine = evaluateNflDecision({ ...base, quote: { ...quote, line: -2.5 } });
  assert.equal(wrongLine.decision, 'WATCH');
  assert.ok(wrongLine.reasons.includes('model_line_mismatch'));
  const wrongBook = evaluateNflDecision({ ...base, quote: { ...quote, bookmaker: 'consensus' } });
  assert.equal(wrongBook.decision, 'NO_BET');
});

test('missing certification or QB confirmation leaves a watch, not a stake', () => {
  const uncertified = evaluateNflDecision({ ...base, model: { ...model, certified: false } });
  assert.equal(uncertified.decision, 'WATCH');
  assert.equal(uncertified.stake, 0);
  const qbUnknown = evaluateNflDecision({ ...base, qbConfirmed: false });
  assert.equal(qbUnknown.decision, 'WATCH');
});

test('combined exposure caps the fixed stake', () => {
  const reduced = evaluateNflDecision({ ...base, slateExposure: 19 });
  assert.equal(reduced.stake, 1);
  const full = evaluateNflDecision({ ...base, slateExposure: 20 });
  assert.equal(full.decision, 'NO_BET');
  assert.ok(full.reasons.includes('exposure_limit'));
});

test('missing probability and preseason cannot authorize a bet', () => {
  const missing = evaluateNflDecision({ ...base, model: { ...model, probability: null } });
  assert.equal(missing.decision, 'WATCH');
  assert.equal(missing.model.probability, null);
  assert.ok(missing.reasons.includes('model_unavailable'));
  const preseason = evaluateNflDecision({ ...base, isPreseason: true });
  assert.equal(preseason.decision, 'NO_BET');
  assert.ok(preseason.reasons.includes('preseason_out_of_distribution'));
});
