import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeNflParlay,
  NFL_LEG_CONFIDENCE_MIN,
  NFL_LEG_CONFIDENCE_MAX,
} from '../services/nflParlayOracle.js';

const leg = (confidence, game = 'BUF @ KC') => ({ game, pick: 'KC -3.5', confidence, reasoning: 'x' });

test('combined confidence is the product of the legs, not what the model claimed', () => {
  const out = normalizeNflParlay({
    parlay: { legs: [leg(0.62), leg(0.60), leg(0.58)], combined_confidence: 0.55 },
  });
  assert.equal(out.parlay.combined_confidence, 0.216);
});

test('leg confidence above the NFL ceiling is clamped', () => {
  const out = normalizeNflParlay({ parlay: { legs: [leg(0.91), leg(0.60)] } });
  assert.equal(out.parlay.legs[0].confidence, NFL_LEG_CONFIDENCE_MAX);
});

test('leg confidence below the floor is clamped', () => {
  const out = normalizeNflParlay({ parlay: { legs: [leg(0.12), leg(0.60)] } });
  assert.equal(out.parlay.legs[0].confidence, NFL_LEG_CONFIDENCE_MIN);
});

test('percent-scale confidence is read as a probability', () => {
  const out = normalizeNflParlay({ parlay: { legs: [leg(65), leg(60)] } });
  assert.equal(out.parlay.legs[0].confidence, 0.65);
  assert.equal(out.parlay.legs[1].confidence, 0.60);
  assert.equal(out.parlay.combined_confidence, 0.39);
});

test('a non-numeric confidence falls to the floor rather than poisoning the product', () => {
  const out = normalizeNflParlay({ parlay: { legs: [leg('n/a'), leg(0.70)] } });
  assert.equal(out.parlay.legs[0].confidence, NFL_LEG_CONFIDENCE_MIN);
  assert.equal(out.parlay.combined_confidence, 0.35);
});

test('risk level tracks the combined probability and is never LOW', () => {
  const two = normalizeNflParlay({ parlay: { legs: [leg(0.70), leg(0.70)] } });
  assert.equal(two.parlay.risk_level, 'MODERATE');

  const three = normalizeNflParlay({ parlay: { legs: [leg(0.70), leg(0.70), leg(0.60)] } });
  assert.equal(three.parlay.risk_level, 'HIGH');

  const six = normalizeNflParlay({ parlay: { legs: Array.from({ length: 6 }, () => leg(0.62)) } });
  assert.equal(six.parlay.risk_level, 'VERY HIGH');
});

test('a model-reported LOW risk is overwritten', () => {
  const out = normalizeNflParlay({
    parlay: { legs: [leg(0.62), leg(0.62), leg(0.62), leg(0.62)], risk_level: 'LOW' },
  });
  assert.equal(out.parlay.risk_level, 'VERY HIGH');
});

test('leg text fields survive normalization untouched', () => {
  const out = normalizeNflParlay({
    parlay: { legs: [leg(0.62, 'NYJ @ NE')], strategy_note: 'note' },
  });
  assert.equal(out.parlay.legs[0].game, 'NYJ @ NE');
  assert.equal(out.parlay.legs[0].pick, 'KC -3.5');
  assert.equal(out.parlay.strategy_note, 'note');
});

test('a payload with no usable parlay returns null', () => {
  assert.equal(normalizeNflParlay(null), null);
  assert.equal(normalizeNflParlay({}), null);
  assert.equal(normalizeNflParlay({ parlay: {} }), null);
  assert.equal(normalizeNflParlay({ parlay: { legs: [] } }), null);
});
