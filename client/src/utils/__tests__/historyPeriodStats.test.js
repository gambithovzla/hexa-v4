import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePickStats,
  groupHistoryByPeriod,
  periodBucketKey,
} from '../historyPeriodStats.js';

test('computePickStats excludes pushes from win rate', () => {
  const stats = computePickStats([
    { result: 'win' },
    { result: 'loss' },
    { result: 'push' },
    { result: 'pending' },
  ]);
  assert.equal(stats.wins, 1);
  assert.equal(stats.losses, 1);
  assert.equal(stats.pushes, 1);
  assert.equal(stats.pending, 1);
  assert.equal(stats.winRate, 50);
});

test('groupHistoryByPeriod buckets by Lima week', () => {
  const entries = [
    { date: '2026-05-17', result: 'win' },
    { date: '2026-05-01', result: 'loss' },
  ];
  const weeks = groupHistoryByPeriod(entries, 'week', 'en');
  assert.equal(weeks.length, 2);
  const keys = weeks.map((w) => w.key).sort();
  assert.ok(keys.every((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)));
});

test('periodBucketKey uses month slice', () => {
  assert.equal(periodBucketKey({ date: '2026-05-17' }, 'month'), '2026-05');
});
