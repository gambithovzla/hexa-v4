import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveNflPendingBets } from '../nflBetResolver.js';

test('settles one final ticket and skips a game without a final score', async () => {
  const writes = [];
  const bets = [
    { id: 1, game_pk: 101, market: 'spread', side: 'home', line: -3,
      accepted_decimal: 1.91, stake: 10 },
    { id: 2, game_pk: 102, market: 'total', side: 'under', line: 40.5,
      accepted_decimal: 1.91, stake: 10 },
  ];
  const database = {
    query: async () => ({ rows: bets }),
    connect: async () => ({
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO nfl_bet_settlements')) {
          writes.push(params);
          return { rows: [{ id: 9 }] };
        }
        return { rows: [] };
      },
      release: () => {},
    }),
  };
  const lookup = async ({ gameId }) => gameId === 101
    ? { game_id: 101, game_status_id: 3, home_score: 24, away_score: 21 }
    : { game_id: 102, game_status_id: 2, home_score: 10, away_score: 7 };
  const result = await resolveNflPendingBets({ database, lookup });
  assert.deepEqual({ pending: result.pending, settled: result.settled, skipped: result.skipped },
    { pending: 2, settled: 1, skipped: 1 });
  assert.equal(writes[0][0], 1);
  assert.equal(writes[0][1], 'push');
  assert.equal(writes[0][2], 0);
});
