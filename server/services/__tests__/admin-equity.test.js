import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRollingSharpe30d, computeAdminEquityFromRows } from '../admin-equity.js';

test('computeAdminEquityFromRows returns summary and drawdown metrics', () => {
  const rows = [
    { result: 'win', odds_at_pick: 100, created_at: '2026-05-01T10:00:00Z', sport: 'mlb', pick: 'A', matchup: 'A @ B' },
    { result: 'loss', odds_at_pick: -110, created_at: '2026-05-02T10:00:00Z', sport: 'mlb', pick: 'C', matchup: 'C @ D' },
    { result: 'win', odds_at_pick: -110, created_at: '2026-05-03T10:00:00Z', sport: 'mlb', pick: 'E', matchup: 'E @ F' },
  ];

  const out = computeAdminEquityFromRows(rows);
  assert.equal(out.summary.totalPicks, 3);
  assert.equal(out.summary.wins, 2);
  assert.equal(out.summary.losses, 1);
  assert.equal(out.summary.maxDrawdown, -1);
  assert.equal(out.summary.unitProfit, 0.91);
  assert.equal(out.series.length, 3);
  assert.ok(Array.isArray(out.rollingSharpe30d));
});

test('buildRollingSharpe30d applies a 30-day calendar window', () => {
  const series = [
    { date: '2026-01-01T10:00:00Z', units: 1 },
    { date: '2026-01-02T10:00:00Z', units: -1 },
    { date: '2026-02-05T10:00:00Z', units: 1 },
  ];

  const rolling = buildRollingSharpe30d(series);
  const jan02 = rolling.find((p) => p.day === '2026-01-02');
  const feb05 = rolling.find((p) => p.day === '2026-02-05');

  assert.equal(jan02.sampleSize, 2);
  assert.equal(feb05.sampleSize, 1);
  assert.equal(feb05.sharpe, 0);
});

