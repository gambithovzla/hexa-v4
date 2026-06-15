import { test } from 'node:test';
import assert from 'node:assert/strict';

import { statcastRegressionSignal, strikeoutRateSignal } from '../services/statcastRegression.js';

test('batter overperforming wOBA flags downside regression risk', () => {
  const s = statcastRegressionSignal(0.380, 0.320, 'batter');
  assert.ok(s);
  assert.equal(s.overperforming, true);
  assert.equal(s.magnitude, 'significant');
  assert.match(s.text, /OVERPERFORMING/);
  assert.match(s.text, /downside regression risk/);
});

test('batter underperforming wOBA flags positive regression candidate', () => {
  const s = statcastRegressionSignal(0.290, 0.335, 'batter');
  assert.ok(s);
  assert.equal(s.overperforming, false);
  assert.match(s.text, /positive regression candidate/);
});

test('pitcher allowing less than expected is overperforming (regress up)', () => {
  // wOBA against well below xwOBA against = lucky pitcher
  const s = statcastRegressionSignal(0.270, 0.330, 'pitcher');
  assert.ok(s);
  assert.equal(s.overperforming, true);
  assert.match(s.text, /OVERPERFORMING/);
  assert.match(s.text, /regress UP/);
});

test('pitcher allowing more than expected is unlucky (pitching better than results)', () => {
  const s = statcastRegressionSignal(0.360, 0.310, 'pitcher');
  assert.ok(s);
  assert.equal(s.overperforming, false);
  assert.match(s.text, /UNDERPERFORMING/);
});

test('gap below the notable threshold returns null', () => {
  assert.equal(statcastRegressionSignal(0.325, 0.320, 'batter'), null);
});

test('missing inputs return null', () => {
  assert.equal(statcastRegressionSignal(null, 0.320, 'batter'), null);
  assert.equal(statcastRegressionSignal(0.320, undefined, 'pitcher'), null);
});

test('notable vs significant magnitude boundary', () => {
  assert.equal(statcastRegressionSignal(0.350, 0.318, 'batter').magnitude, 'notable'); // .032
  assert.equal(statcastRegressionSignal(0.380, 0.328, 'batter').magnitude, 'significant'); // .052
});

test('strikeout signal: whiff exceeds K → K-prop upside', () => {
  const s = strikeoutRateSignal(32, 22);
  assert.ok(s);
  assert.equal(s.direction, 'k-upside');
  assert.match(s.text, /OVER upside/);
});

test('strikeout signal: K exceeds whiff → downside risk', () => {
  const s = strikeoutRateSignal(20, 28);
  assert.ok(s);
  assert.equal(s.direction, 'k-downside');
});

test('strikeout signal normalizes decimal rates', () => {
  const s = strikeoutRateSignal(0.32, 0.22);
  assert.ok(s);
  assert.equal(s.direction, 'k-upside');
});

test('strikeout signal below divergence threshold returns null', () => {
  assert.equal(strikeoutRateSignal(28, 25), null);
});
