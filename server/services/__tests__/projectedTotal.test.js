import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateProjectedTotal } from '../projectedTotal.js';

test('returns null when there is no usable offense/pitching signal', () => {
  assert.equal(estimateProjectedTotal({}), null);
  assert.equal(estimateProjectedTotal({ parkFactorData: { park_factor_overall: 102 } }), null);
});

test('produces a number within the sane MLB range from pitcher signal', () => {
  const v = estimateProjectedTotal({
    homePitcherSavant: { xwOBA_against: 0.34 },
    awayPitcherSavant: { xwOBA_against: 0.33 },
  });
  assert.equal(typeof v, 'number');
  assert.ok(v >= 5 && v <= 15, `expected 5..15, got ${v}`);
});

test('higher offense / weaker pitching yields a higher projected total', () => {
  const lo = estimateProjectedTotal({
    homePitcherSavant: { xwOBA_against: 0.28 },
    awayPitcherSavant: { xwOBA_against: 0.28 },
  });
  const hi = estimateProjectedTotal({
    homePitcherSavant: { xwOBA_against: 0.36 },
    awayPitcherSavant: { xwOBA_against: 0.36 },
  });
  assert.ok(hi > lo, `expected hi(${hi}) > lo(${lo})`);
});

test('clamps extreme inputs into range', () => {
  const v = estimateProjectedTotal({
    homePitcherSavant: { xwOBA_against: 0.9 },
    awayPitcherSavant: { xwOBA_against: 0.9 },
    savantBatters: { home: [{ savant: { xwOBA: 0.9 } }], away: [{ savant: { xwOBA: 0.9 } }] },
  });
  assert.ok(v <= 15, `expected <=15, got ${v}`);
});
