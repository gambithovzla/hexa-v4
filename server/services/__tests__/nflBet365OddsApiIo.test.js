import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getOddsApiIoNflBoard, matchOddsApiIoNflEvent, normalizeOddsApiIoBet365Board,
} from '../nflBet365OddsApiIo.js';

const game = {
  home_team_name: 'Kansas City Chiefs', away_team_name: 'Buffalo Bills',
  game_datetime: '2026-10-01T20:00:00Z',
};

test('matches both NFL teams and kickoff before accepting a provider event', () => {
  const events = [
    { id: 1, home: 'Kansas City Chiefs', away: 'New York Jets', date: game.game_datetime },
    { id: 2, home: 'Kansas City Chiefs', away: 'Buffalo Bills', date: '2026-10-03T20:00:00Z' },
    { id: 3, home: 'Kansas City Chiefs', away: 'Buffalo Bills', date: game.game_datetime },
  ];
  assert.equal(matchOddsApiIoNflEvent(events, game).id, 3);
});

test('normalizes actual Bet365 moneyline, spread and total prices without making lines up', () => {
  const board = { id: 42, bookmakers: { Bet365: [
    { name: 'ML', updatedAt: '2026-10-01T19:50:00Z', odds: [{ home: '2.100', away: '1.850' }] },
    { name: 'Spread', odds: [{ hdp: -3.5, home: '1.900', away: '1.900' }] },
    { name: 'Totals', odds: [{ hdp: 45.5, over: '1.910', under: '1.910' }] },
    { name: 'Spread', odds: [{ home: '1.900', away: '1.900' }] },
  ] } };
  const quotes = normalizeOddsApiIoBet365Board(board, '2026-10-01T19:55:00Z');
  assert.equal(quotes.length, 6);
  assert.deepEqual(quotes.find(q => q.market === 'spread' && q.side === 'away').line, 3.5);
  assert.deepEqual(quotes.find(q => q.market === 'total' && q.side === 'under').line, 45.5);
  assert.equal(quotes.find(q => q.market === 'moneyline' && q.side === 'home').decimalOdds, 2.1);
  assert.ok(quotes.every(q => q.provider === 'odds_api_io' && q.bookmaker === 'bet365'));
});

test('fetches provider events then its Bet365 board with an injected API client', async () => {
  const requests = [];
  const fetcher = async url => {
    requests.push(new URL(url));
    return { ok: true, json: async () => requests.length === 1
      ? [{ id: 42, home: game.home_team_name, away: game.away_team_name, date: game.game_datetime }]
      : { id: 42, bookmakers: { Bet365: [
        { name: 'ML', odds: [{ home: '2.100', away: '1.850' }] },
      ] } } };
  };
  const result = await getOddsApiIoNflBoard(game, { apiKey: 'test', fetcher });
  assert.equal(result.status, 'ok');
  assert.equal(result.quotes.length, 2);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].searchParams.get('sport'), 'american-football');
  assert.equal(requests[1].searchParams.get('bookmakers'), 'Bet365,DraftKings');
});

test('reports missing credentials without a network call', async () => {
  const result = await getOddsApiIoNflBoard(game, { apiKey: '',
    fetcher: () => { throw new Error('should not fetch'); } });
  assert.deepEqual(result, { status: 'missing_key', quotes: [] });
});
