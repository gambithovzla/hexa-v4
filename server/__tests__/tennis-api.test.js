import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchOnRequestedDate, isVoidStatusName } from '../tennis-api.js';

test('matchOnRequestedDate keeps a match on its UTC date', () => {
  assert.equal(matchOnRequestedDate('2026-06-03T13:00Z', '2026-06-03'), true);
});

test('matchOnRequestedDate tolerates UTC rollover via ET/Lima zones', () => {
  // 01:00Z on June 4 is still the evening of June 3 in America/New_York & Lima.
  assert.equal(matchOnRequestedDate('2026-06-04T01:00Z', '2026-06-03'), true);
});

test('matchOnRequestedDate rejects a match days off (the stale-leak bug)', () => {
  // The April match that previously leaked into a June slate.
  assert.equal(matchOnRequestedDate('2026-04-28T18:00Z', '2026-06-03'), false);
  // A finished final from earlier in the same tournament fortnight.
  assert.equal(matchOnRequestedDate('2026-05-31T15:00Z', '2026-06-03'), false);
});

test('matchOnRequestedDate passes through null / unparseable dates', () => {
  assert.equal(matchOnRequestedDate(null, '2026-06-03'), true);
  assert.equal(matchOnRequestedDate('not-a-date', '2026-06-03'), true);
  assert.equal(matchOnRequestedDate('2026-06-03T13:00Z', null), true);
});

test('isVoidStatusName flags retirements / walkovers, not normal finals', () => {
  assert.equal(isVoidStatusName('STATUS_RETIRED'), true);
  assert.equal(isVoidStatusName('STATUS_WALKOVER'), true);
  assert.equal(isVoidStatusName('STATUS_FINAL'), false);
  assert.equal(isVoidStatusName(null), false);
});
