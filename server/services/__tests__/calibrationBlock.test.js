import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCalibrationBlock } from '../calibrationBlockService.js';

const overconfidentRow = { market: 'moneyline', bucket: '60-64', n: 48, statedAvg: 61.5, winRate: 52.1 };
const calibratedRow = { market: 'moneyline', bucket: '55-59', n: 33, statedAvg: 57.0, winRate: 58.5 };
const underconfidentRow = { market: 'overunder', bucket: '55-59', n: 20, statedAvg: 56.0, winRate: 65.0 };

test('returns empty string with no rows', () => {
  assert.equal(renderCalibrationBlock([]), '');
  assert.equal(renderCalibrationBlock(null), '');
});

test('filters out buckets below the minimum sample', () => {
  const thin = { ...overconfidentRow, n: 14 };
  assert.equal(renderCalibrationBlock([thin]), '');
  const mixed = renderCalibrationBlock([thin, calibratedRow]);
  assert.ok(mixed.includes('55-59'));
  assert.ok(!mixed.includes('60-64'));
});

test('flags overconfident buckets with the delta', () => {
  const block = renderCalibrationBlock([overconfidentRow], { sport: 'mlb' });
  assert.ok(block.includes('⚠ OVERCONFIDENT (-9.4)'));
  assert.ok(block.includes('ORACLE CALIBRATION RECORD (MLB)'));
  assert.ok(block.includes('actual win rate 52.1% over 48 picks'));
});

test('marks small drifts as calibrated and large positive drifts as underconfident', () => {
  const block = renderCalibrationBlock([calibratedRow, underconfidentRow]);
  assert.ok(block.includes('✓ calibrated'));
  assert.ok(block.includes('↑ underconfident (+9.0)'));
});

test('always carries the anchoring instruction', () => {
  const block = renderCalibrationBlock([calibratedRow], { sport: 'soccer' });
  assert.ok(block.includes('ORACLE INSTRUCTION'));
  assert.ok(block.includes('at or below the ACTUAL win rate'));
  assert.ok(block.includes('(SOCCER)'));
});
