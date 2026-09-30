import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveNflQuoteOutcomes } from '../nflQuoteOutcomeResolver.js';

test('grades rejected and watched quotes independently of actual tickets', async () => {
  const inserts = [];
  const database = {
    query: async () => ({ rows: [
      { id: 1, game_pk: 10, market: 'spread', side: 'away', line: 3,
        decision: 'NO_BET' },
      { id: 2, game_pk: 10, market: 'total', side: 'over', line: 44.5,
        decision: 'WATCH' },
    ] }),
    connect: async () => ({
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO nfl_quote_outcomes')) {
          inserts.push(params);
          return { rows: [{ id: inserts.length }] };
        }
        return { rows: [] };
      },
      release: () => {},
    }),
  };
  let lookups = 0;
  const lookup = async () => {
    lookups += 1;
    return { game_id: 10, game_status_id: 3, home_score: 24, away_score: 21 };
  };
  const result = await resolveNflQuoteOutcomes({ database, lookup });
  assert.deepEqual({ pending: result.pending, graded: result.graded, skipped: result.skipped },
    { pending: 2, graded: 2, skipped: 0 });
  assert.equal(lookups, 1);
  assert.deepEqual(inserts.map(row => row[1]), ['push', 'win']);
});
