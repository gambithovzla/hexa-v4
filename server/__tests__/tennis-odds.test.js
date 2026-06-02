import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchTennisOddsToMatch,
  buildMarketOddsForMatch,
} from '../tennis-odds.js';
import { isVoidStatusName } from '../tennis-api.js';

const SAMPLE = [
  {
    eventId: 'evt1',
    playerA: 'Novak Djokovic',
    playerB: 'Carlos Alcaraz',
    moneyline: { a: -150, b: +130 },
    setHandicap: { line: -1.5, aPrice: +120, bPrice: -140 },
    totalGames: { line: 22.5, overPrice: -110, underPrice: -110 },
  },
];

test('matchTennisOddsToMatch matches by full names (straight orientation)', () => {
  const m = matchTennisOddsToMatch(SAMPLE, 'Novak Djokovic', 'Carlos Alcaraz');
  assert.equal(m?.eventId, 'evt1');
  assert.equal(m._flipped, false);
});

test('matchTennisOddsToMatch matches by surname only', () => {
  const m = matchTennisOddsToMatch(SAMPLE, 'Djokovic', 'Alcaraz');
  assert.equal(m?.eventId, 'evt1');
});

test('matchTennisOddsToMatch detects flipped A/B orientation', () => {
  // Our player A is the book's player B and vice versa.
  const m = matchTennisOddsToMatch(SAMPLE, 'Carlos Alcaraz', 'Novak Djokovic');
  assert.equal(m?.eventId, 'evt1');
  assert.equal(m._flipped, true);
});

test('matchTennisOddsToMatch handles "Last, First" ordering', () => {
  const m = matchTennisOddsToMatch(SAMPLE, 'Djokovic, Novak', 'Alcaraz, Carlos');
  assert.equal(m?.eventId, 'evt1');
});

test('matchTennisOddsToMatch returns null on no overlap', () => {
  assert.equal(matchTennisOddsToMatch(SAMPLE, 'Roger Federer', 'Rafael Nadal'), null);
});

test('matchTennisOddsToMatch handles empty input', () => {
  assert.equal(matchTennisOddsToMatch([], 'A', 'B'), null);
  assert.equal(matchTennisOddsToMatch(SAMPLE, null, null), null);
});

test('buildMarketOddsForMatch produces moneyline-first shape with implied prob', () => {
  const m = matchTennisOddsToMatch(SAMPLE, 'Novak Djokovic', 'Carlos Alcaraz');
  const odds = buildMarketOddsForMatch(m);
  assert.equal(odds.moneyline.a, -150);
  assert.equal(odds.moneyline.b, +130);
  assert.equal(odds.setHandicap.line, -1.5);
  assert.equal(odds.totalGames.line, 22.5);
  assert.equal(odds.source, 'oddsapi');
  // -150 implies 60%
  assert.ok(Math.abs(odds.moneyline.aImplied - 60) < 0.5);
});

test('buildMarketOddsForMatch swaps A/B prices when flipped', () => {
  const m = matchTennisOddsToMatch(SAMPLE, 'Carlos Alcaraz', 'Novak Djokovic');
  const odds = buildMarketOddsForMatch(m);
  // Our player A is Alcaraz → should carry Alcaraz's price (+130).
  assert.equal(odds.moneyline.a, +130);
  assert.equal(odds.moneyline.b, -150);
  assert.equal(odds.setHandicap.aPrice, -140);
  assert.equal(odds.setHandicap.bPrice, +120);
});

test('buildMarketOddsForMatch returns null for missing event', () => {
  assert.equal(buildMarketOddsForMatch(null), null);
});

test('isVoidStatusName flags retirement / walkover / abandoned', () => {
  assert.equal(isVoidStatusName('STATUS_RETIRED'), true);
  assert.equal(isVoidStatusName('STATUS_WALKOVER'), true);
  assert.equal(isVoidStatusName('STATUS_ABANDONED'), true);
  assert.equal(isVoidStatusName('STATUS_CANCELED'), true);
  assert.equal(isVoidStatusName('status_retired'), true); // case-insensitive
  assert.equal(isVoidStatusName('STATUS_FINAL'), false);
  assert.equal(isVoidStatusName('STATUS_IN_PROGRESS'), false);
  assert.equal(isVoidStatusName(null), false);
});
