import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeNflQuoteDecisions } from '../nflProspectiveReport.js';

test('reports rejected quotes and deduplicates calibration by game/market', () => {
  const rows = [
    { game_pk: 10, market: 'spread', decision: 'NO_BET', result: 'win',
      model_probability: 0.6, observed_at: '2026-09-01T12:00:00Z',
      reasons: ['model_not_certified'], bet_id: null },
    { game_pk: 10, market: 'spread', decision: 'WATCH', result: 'loss',
      model_probability: 0.9, observed_at: '2026-09-01T13:00:00Z',
      reasons: ['qb_unverified'], bet_id: null },
    { game_pk: 11, market: 'total', decision: 'BET', result: 'push',
      model_probability: 0.55, observed_at: '2026-09-01T14:00:00Z',
      reasons: [], bet_id: 4 },
    { game_pk: 11, market: 'total', decision: 'WATCH', result: 'win',
      model_probability: 0.9, observed_at: '2026-09-01T15:00:00Z',
      reasons: [], bet_id: null },
  ];
  const report = summarizeNflQuoteDecisions(rows);
  assert.equal(report.evaluatedQuotes, 4);
  assert.equal(report.gradedQuotes, 4);
  assert.equal(report.ticketedQuotes, 1);
  assert.equal(report.decisionCounts.NO_BET, 1);
  assert.equal(report.rejectionReasons.model_not_certified, 1);
  assert.deepEqual(report.calibrationByMarket.spread,
    { n: 1, certifiedN: 0, brier: 0.16 });
  assert.equal(report.calibrationByMarket.total, undefined);
  assert.equal(report.roi, null);
});
