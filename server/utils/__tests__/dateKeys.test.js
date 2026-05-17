import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLimaDateString, resolveGameCalendarDate } from '../dateKeys.js';

test('getLimaDateString maps late ET Saturday start to Lima Saturday', () => {
  const lima = getLimaDateString('2026-05-17T02:30:00.000Z');
  assert.equal(lima, '2026-05-16');
});

test('resolveGameCalendarDate prefers officialDate over UTC slice', () => {
  const date = resolveGameCalendarDate({
    officialDate: '2026-05-16',
    gameDate: '2026-05-17T02:30:00.000Z',
  });
  assert.equal(date, '2026-05-16');
});

test('resolveGameCalendarDate uses Lima when only ISO gameDate is present', () => {
  const date = resolveGameCalendarDate({
    gameDate: '2026-05-17T02:30:00.000Z',
  });
  assert.equal(date, '2026-05-16');
});
