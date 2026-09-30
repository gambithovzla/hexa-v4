import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleNflBetFromGame, gradeNflSelectionFromGame } from '../nflBetSettlement.js';

const game = { game_id: '123', game_status_id: 3, home_score: 24, away_score: 21 };
const ticket = { market: 'spread', side: 'home', line: -3, stake: 10, accepted_decimal: 1.91 };

test('accepted spread line produces a refund at exactly three points', () => {
  assert.deepEqual(settleNflBetFromGame(ticket, game).result, 'push');
  assert.equal(settleNflBetFromGame(ticket, game).pnl, 0);
  assert.equal(settleNflBetFromGame({ ...ticket, line: -2.5 }, game).pnl, 9.1);
  assert.equal(settleNflBetFromGame({ ...ticket, line: -3.5 }, game).pnl, -10);
});

test('total and moneyline settle from final score and quoted side', () => {
  assert.equal(settleNflBetFromGame({ ...ticket, market: 'total', side: 'over', line: 45 }, game).result, 'push');
  assert.equal(settleNflBetFromGame({ ...ticket, market: 'moneyline', side: 'away', line: null }, game).result, 'loss');
});

test('a live score and a tied moneyline remain unsettled', () => {
  assert.equal(settleNflBetFromGame(ticket, { ...game, game_status_id: 2 }).result, null);
  assert.equal(settleNflBetFromGame({ ...ticket, market: 'moneyline', side: 'home' }, { ...game, away_score: 24 }).result, null);
});

test('a rejected quote can be graded without a ticket or stake', () => {
  const quote = { market: 'spread', side: 'home', line: -3 };
  assert.equal(gradeNflSelectionFromGame(quote, game).result, 'push');
  assert.equal(gradeNflSelectionFromGame(quote, { ...game, home_score: null }).result, null);
});
