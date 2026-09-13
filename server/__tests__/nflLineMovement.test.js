/**
 * nflLineMovement.test.js — NFL odds snapshots and the movement read (Sprint 9.10).
 *
 * Covers the pure half: what counts as a key-number crossing, when movement is
 * money rather than noise, and the snapshot key that has to survive both a
 * Monday-night UTC date and two feeds naming teams differently.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeNflLineMovement,
  crossedKeyNumbers,
  nflSnapshotGameId,
  NFL_KEY_NUMBERS,
} from '../nfl-line-movement.js';

const snap = (over = {}) => ({
  moneyline_home: -150, moneyline_away: 130,
  spread_home: -3, total: 45.5, bookmaker_count: 8,
  captured_at: '2026-09-10T12:00:00Z', ...over,
});

// ── Key numbers ───────────────────────────────────────────────────────────────

test('key numbers are the margins NFL games land on', () => {
  assert.deepEqual(NFL_KEY_NUMBERS, [3, 7, 10, 14]);
});

test('a spread crossing 3 is detected regardless of which side is favoured', () => {
  assert.deepEqual(crossedKeyNumbers(-2.5, -3.5), [3]);
  // Same event from the bettor's view: the number 3 is off the board either way.
  assert.deepEqual(crossedKeyNumbers(2.5, 3.5), [3]);
  assert.deepEqual(crossedKeyNumbers(-3.5, -2.5), [3], 'crossing back counts too');
});

test('a move that never reaches a key number crosses nothing', () => {
  assert.deepEqual(crossedKeyNumbers(-4.5, -5.5), []);
  assert.deepEqual(crossedKeyNumbers(-3, -3), [], 'sitting still on 3 is not a crossing');
  assert.deepEqual(crossedKeyNumbers(-2.5, -3), [3], 'landing on 3 from below is');
});

test('a big move can cross several key numbers', () => {
  assert.deepEqual(crossedKeyNumbers(-2.5, -7.5), [3, 7]);
});

test('crossing needs two real numbers', () => {
  assert.deepEqual(crossedKeyNumbers(null, -3.5), []);
  assert.deepEqual(crossedKeyNumbers(-2.5, undefined), []);
});

// ── Movement read ─────────────────────────────────────────────────────────────

test('one snapshot is not movement', () => {
  assert.equal(analyzeNflLineMovement([snap()]), null);
  assert.equal(analyzeNflLineMovement([]), null);
  assert.equal(analyzeNflLineMovement(null), null);
});

test('movement is measured from the first snapshot to the last', () => {
  const res = analyzeNflLineMovement([
    snap({ spread_home: -2.5, total: 47.5, moneyline_home: -145 }),
    snap({ spread_home: -3, total: 47, moneyline_home: -135 }),
    snap({ spread_home: -3.5, total: 46.5, moneyline_home: -125, captured_at: '2026-09-11T12:00:00Z' }),
  ]);
  assert.equal(res.movement_spread_home, -1);
  assert.equal(res.movement_total, -1);
  assert.equal(res.movement_ml_home, 20);
  assert.deepEqual(res.key_numbers_crossed, [3]);
  assert.equal(res.snapshots_count, 3);
  assert.equal(res.hours_tracked, 24);
});

test('steps all pointing one way read as a sustained move', () => {
  const res = analyzeNflLineMovement([
    snap({ moneyline_home: -160 }),
    snap({ moneyline_home: -150 }),
    snap({ moneyline_home: -140 }),
    snap({ moneyline_home: -130 }),
  ]);
  assert.equal(res.sustained_move_pct, 100);
});

test('a jump that drifts back is not a sustained move', () => {
  const res = analyzeNflLineMovement([
    snap({ moneyline_home: -160 }),
    snap({ moneyline_home: -130 }),
    snap({ moneyline_home: -145 }),
    snap({ moneyline_home: -150 }),
  ]);
  assert.ok(res.sustained_move_pct < 70, `expected choppy, got ${res.sustained_move_pct}%`);
});

test('moves below the step threshold are ignored as book-to-book noise', () => {
  const res = analyzeNflLineMovement([
    snap({ moneyline_home: -150 }),
    snap({ moneyline_home: -148 }),
    snap({ moneyline_home: -151 }),
  ]);
  assert.equal(res.sustained_move_pct, null, 'no move was large enough to count as a step');
});

test('a favourite drifting longer is flagged as reverse line movement', () => {
  // Public money shortens favourites; a favourite getting cheaper to back means
  // the books are moving against the popular side.
  const res = analyzeNflLineMovement([
    snap({ moneyline_home: -180, moneyline_away: 155 }),
    snap({ moneyline_home: -155, moneyline_away: 135 }),
  ]);
  assert.equal(res.reverse_line_movement, 'against_home_favorite');
});

test('a favourite getting shorter is ordinary public money, not RLM', () => {
  const res = analyzeNflLineMovement([
    snap({ moneyline_home: -150, moneyline_away: 130 }),
    snap({ moneyline_home: -185, moneyline_away: 160 }),
  ]);
  assert.equal(res.reverse_line_movement, null);
});

test('a near-pick-em game is not treated as having a public favourite', () => {
  const res = analyzeNflLineMovement([
    snap({ moneyline_home: -110, moneyline_away: -110 }),
    snap({ moneyline_home: -105, moneyline_away: -115 }),
  ]);
  assert.equal(res.reverse_line_movement, null);
});

test('missing prices do not crash the read', () => {
  const res = analyzeNflLineMovement([
    snap({ moneyline_home: null, spread_home: null, total: null }),
    snap({ moneyline_home: null, spread_home: null, total: null }),
  ]);
  assert.equal(res.movement_ml_home, null);
  assert.equal(res.movement_spread_home, null);
  assert.deepEqual(res.key_numbers_crossed, []);
});

// ── Snapshot key ──────────────────────────────────────────────────────────────

test('the snapshot key prefers the odds provider event id', () => {
  const key = nflSnapshotGameId({
    eventId: 'abc123', gameDate: '2026-09-14', homeTeam: 'Kansas City Chiefs', awayTeam: 'Los Angeles Chargers',
  });
  assert.equal(key, 'evt:abc123');
});

test('the event id makes the key survive a Monday-night UTC date shift', () => {
  // Same game, read back the next calendar day in UTC: still one key.
  const atCapture = nflSnapshotGameId({ eventId: 'abc123', gameDate: '2026-09-15' });
  const atRead = nflSnapshotGameId({ eventId: 'abc123', gameDate: '2026-09-16' });
  assert.equal(atCapture, atRead);
});

test('the event id also bridges feeds that name teams differently', () => {
  const oddsFeed = nflSnapshotGameId({ eventId: 'abc123', homeTeam: 'Kansas City Chiefs' });
  const espn = nflSnapshotGameId({ eventId: 'abc123', homeTeam: 'KC Chiefs' });
  assert.equal(oddsFeed, espn);
});

test('without an event id the key falls back to date and teams', () => {
  assert.equal(
    nflSnapshotGameId({ gameDate: '2026-09-14', awayTeam: 'Los Angeles Chargers', homeTeam: 'Kansas City Chiefs' }),
    '2026-09-14_los_angeles_chargers_at_kansas_city_chiefs'
  );
  assert.equal(nflSnapshotGameId({ gameDate: '2026-09-14' }), null, 'an unkeyable snapshot is skipped');
  assert.equal(nflSnapshotGameId({}), null);
});
