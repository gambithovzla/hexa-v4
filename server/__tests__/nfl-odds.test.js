import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchNflOddsToGame, buildMarketOddsForGame } from '../nfl-odds.js';

const events = [
  {
    eventId: 'a', homeTeam: 'Kansas City Chiefs', awayTeam: 'Buffalo Bills',
    moneyline: { home: -135, away: 115 },
    spread: { home: -2.5, homePrice: -110, away: 2.5, awayPrice: -110 },
    total: { line: 47.5, overPrice: -110, underPrice: -110 },
  },
  {
    eventId: 'b', homeTeam: 'Philadelphia Eagles', awayTeam: 'Dallas Cowboys',
    moneyline: { home: -200, away: 170 },
    spread: { home: -4.5, homePrice: -110, away: 4.5, awayPrice: -110 },
    total: { line: 44, overPrice: -110, underPrice: -110 },
  },
];

test('matchNflOddsToGame matches by full team names', () => {
  const m = matchNflOddsToGame(events, 'Kansas City Chiefs', 'Buffalo Bills');
  assert.equal(m?.eventId, 'a');
});

test('matchNflOddsToGame matches by short names (word overlap)', () => {
  const m = matchNflOddsToGame(events, 'Eagles', 'Cowboys');
  assert.equal(m?.eventId, 'b');
});

test('matchNflOddsToGame returns null on no overlap', () => {
  const m = matchNflOddsToGame(events, 'Seattle Seahawks', 'San Francisco 49ers');
  assert.equal(m, null);
});

test('matchNflOddsToGame handles empty input', () => {
  assert.equal(matchNflOddsToGame([], 'KC', 'BUF'), null);
  assert.equal(matchNflOddsToGame(events, null, null), null);
});

test('buildMarketOddsForGame returns spread-first shape with implied prob', () => {
  const odds = buildMarketOddsForGame(events[0]);
  assert.deepEqual(Object.keys(odds), ['spread', 'total', 'moneyline', 'source', 'eventId']);
  assert.equal(odds.spread.home, -2.5);
  assert.equal(odds.total.line, 47.5);
  assert.equal(odds.source, 'oddsapi');
  // -135 → implied ~57.4%
  assert.ok(odds.moneyline.homeImplied > 56 && odds.moneyline.homeImplied < 59);
});

test('buildMarketOddsForGame returns null for missing event', () => {
  assert.equal(buildMarketOddsForGame(null), null);
});

test('buildMarketOddsForGame tolerates null moneyline prices', () => {
  const odds = buildMarketOddsForGame({
    eventId: 'c', homeTeam: 'X', awayTeam: 'Y',
    moneyline: { home: null, away: null },
    spread: { home: -3, homePrice: -110, away: 3, awayPrice: -110 },
    total: { line: 41, overPrice: -110, underPrice: -110 },
  });
  assert.equal(odds.moneyline.homeImplied, null);
  assert.equal(odds.spread.home, -3);
});
