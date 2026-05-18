import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getLimaDateString,
  getLimaWeekStart,
  resolveGameCalendarDate,
  formatGameTimeLima,
} from '../dateKeys.js';

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

test('formatGameTimeLima converts UTC ISO to Peru wall clock', () => {
  assert.equal(formatGameTimeLima('2026-05-17T00:05:00.000Z'), '07:05 PM LIM');
});

test('getLimaWeekStart keeps Sunday evening Lima in the current Mon-Sun week', () => {
  assert.equal(getLimaWeekStart('2026-05-18T00:04:00.000Z'), '2026-05-11');
});

test('getLimaWeekStart rolls to next week after Lima midnight Sunday', () => {
  assert.equal(getLimaWeekStart('2026-05-18T05:00:00.000Z'), '2026-05-18');
});
