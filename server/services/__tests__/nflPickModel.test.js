import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignNflModelToPick } from '../nflPickModel.js';

function align(pick, type, probability = 0.7) {
  return alignNflModelToPick({
    analysisData: { master_prediction: { pick }, best_pick: { type } },
    gameMeta: { homeAbbr: 'KC', awayAbbr: 'BUF' },
    marketOdds: { spread: { home: -3.5, away: 3.5 }, total: { line: 47.5 } },
    probability,
  });
}

test('moneyline probability follows the selected team', () => {
  assert.equal(align('KC ML', 'Moneyline').probability, 0.7);
  assert.ok(Math.abs(align('BUF ML', 'Moneyline').probability - 0.3) < 1e-9);
});

test('spread probability follows the selected team and exact signed line', () => {
  assert.equal(align('KC -3.5', 'Spread').probability, 0.7);
  assert.ok(Math.abs(align('BUF +3.5', 'Spread').probability - 0.3) < 1e-9);
  assert.equal(align('BUF -3.5', 'Spread'), null);
  assert.equal(align('KC -7', 'Spread'), null);
});

test('total uses over probability or its under complement at the quoted line', () => {
  assert.equal(align('Over 47.5', 'Total').market, 'nfl_total');
  assert.ok(Math.abs(align('Under 47.5', 'Total').probability - 0.3) < 1e-9);
  assert.equal(align('Under 44.5', 'Total'), null);
});

test('ambiguous picks and invalid model probabilities remain unavailable', () => {
  for (const pick of ['KC vs BUF ML', 'ML', 'SEA ML']) assert.equal(align(pick, 'Moneyline'), null);
  for (const probability of [NaN, Infinity, -0.2, 1.1, null]) assert.equal(align('KC ML', 'Moneyline', probability), null);
});
