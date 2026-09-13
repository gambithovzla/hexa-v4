import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { toEtDateString, shiftDateString } from '../utils/etDate.js';

const { getNflGamesForDate, _resetNflApiCache } = await import('../nfl-api.js');

let originalFetch;
beforeEach(() => { originalFetch = global.fetch; _resetNflApiCache(); });
afterEach(() => { global.fetch = originalFetch; _resetNflApiCache(); });

test('a night kickoff belongs to the ET day, not the UTC one', () => {
  // Sunday Night Football, 8:20pm ET on the 13th → 00:20Z on the 14th.
  assert.equal(toEtDateString('2026-09-14T00:20Z'), '2026-09-13');
  // Monday Night Football, same shape a day later.
  assert.equal(toEtDateString('2026-09-15T00:15Z'), '2026-09-14');
});

test('daytime kickoffs are unchanged', () => {
  assert.equal(toEtDateString('2026-09-13T17:00Z'), '2026-09-13');
  assert.equal(toEtDateString('2026-09-13T20:25Z'), '2026-09-13');
});

test('toEtDateString passes through a bare date and rejects junk', () => {
  assert.equal(toEtDateString('2026-09-13'), '2026-09-13');
  assert.equal(toEtDateString('not a date'), null);
  assert.equal(toEtDateString(null), null);
});

test('shiftDateString walks days without tripping over month ends', () => {
  assert.equal(shiftDateString('2026-09-14', -1), '2026-09-13');
  assert.equal(shiftDateString('2026-10-01', -1), '2026-09-30');
  assert.equal(shiftDateString('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDateString('garbage', -1), null);
});

test('a Sunday-night game normalizes to the Sunday, matching ESPN slate', async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      season: { year: 2026, type: 2 },
      week: { number: 1 },
      events: [{
        id: '401872999',
        date: '2026-09-14T00:20Z',
        season: { year: 2026, type: 2 },
        week: { number: 1 },
        status: { type: { state: 'post', completed: true, shortDetail: 'Final' } },
        competitions: [{
          id: '401872999',
          competitors: [
            { homeAway: 'home', score: '24', team: { id: '12', abbreviation: 'KC', displayName: 'Kansas City Chiefs' } },
            { homeAway: 'away', score: '20', team: { id: '2', abbreviation: 'BUF', displayName: 'Buffalo Bills' } },
          ],
        }],
      }],
    }),
  });

  const games = await getNflGamesForDate('2026-09-13');
  assert.equal(games[0].game_date, '2026-09-13', 'stored under the ET Sunday');
  assert.equal(games[0].game_datetime, '2026-09-14T00:20Z', 'the exact kickoff is untouched');
});
