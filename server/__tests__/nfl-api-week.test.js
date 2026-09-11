import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { getCurrentNflWeek, getNflGamesForWeek, getNflWeekSchedule, _resetNflApiCache } = await import('../nfl-api.js');

let originalFetch;
beforeEach(() => { originalFetch = global.fetch; _resetNflApiCache(); });
afterEach(() => { global.fetch = originalFetch; _resetNflApiCache(); });

function event({ id, seasonType, week, season = 2026 }) {
  return {
    id: String(id),
    date: '2026-08-14T22:00:00Z',
    season: { year: season, type: seasonType },
    week: { number: week },
    status: { type: { state: 'pre', shortDetail: 'Fri 6:00 PM' } },
    competitions: [{
      id: String(id),
      competitors: [
        { homeAway: 'home', score: null, team: { id: '7', abbreviation: 'DEN', displayName: 'Denver Broncos' } },
        { homeAway: 'away', score: null, team: { id: '1', abbreviation: 'ATL', displayName: 'Atlanta Falcons' } },
      ],
    }],
  };
}

test('preseason slate wins over an offseason seasontype on the scoreboard root', async () => {
  // ESPN keeps reporting type 4 (offseason) on the root during preseason week 2.
  // Feeding that 4 back into ?seasontype= matches nothing, which is how a day
  // with three preseason games rendered an empty board.
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      season: { year: 2026, type: 4 },
      week: { number: 1 },
      events: [event({ id: 1, seasonType: 1, week: 2 })],
    }),
  });

  const cur = await getCurrentNflWeek();
  assert.equal(cur.seasonType, 1);
  assert.equal(cur.week, 2);
  assert.equal(cur.season, 2026);
});

test('root seasontype is kept when it is a valid 1-3 and no events are present', async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ season: { year: 2026, type: 2 }, week: { number: 5 }, events: [] }),
  });

  const cur = await getCurrentNflWeek();
  assert.equal(cur.seasonType, 2);
  assert.equal(cur.week, 5);
});

test('an invalid root seasontype with no events degrades to regular season', async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ season: { year: 2026, type: 4 }, week: { number: 3 }, events: [] }),
  });

  const cur = await getCurrentNflWeek();
  assert.equal(cur.seasonType, 2);
});

test('current-week lookup falls back to the live slate when the week query is empty', async () => {
  const slate = [event({ id: 1, seasonType: 1, week: 2 }), event({ id: 2, seasonType: 1, week: 2 })];
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url);
    // No-param scoreboard: the real slate. Explicit week query: empty.
    const isExplicit = String(url).includes('seasontype=');
    return {
      ok: true,
      json: async () => ({
        season: { year: 2026, type: 4 },
        week: { number: 1 },
        events: isExplicit ? [] : slate,
      }),
    };
  };

  const games = await getNflGamesForWeek();
  assert.equal(games.length, 2, 'the slate should be served rather than an empty board');
  assert.equal(games[0].home_team_abbr, 'DEN');
  assert.ok(urls.some(u => String(u).includes('seasontype=1&week=2')));
});

test('an explicit week request stays empty instead of borrowing the live slate', async () => {
  // A user asking for week 9 must not be handed today's preseason games.
  global.fetch = async (url) => ({
    ok: true,
    json: async () => ({
      season: { year: 2026, type: 4 },
      week: { number: 1 },
      events: String(url).includes('seasontype=') ? [] : [event({ id: 1, seasonType: 1, week: 2 })],
    }),
  });

  const games = await getNflGamesForWeek({ season: 2026, seasonType: 2, week: 9 });
  assert.equal(games.length, 0);
});

test('a populated week query is returned as-is', async () => {
  global.fetch = async (url) => ({
    ok: true,
    json: async () => ({
      season: { year: 2026, type: 1 },
      week: { number: 2 },
      events: String(url).includes('seasontype=') ? [event({ id: 9, seasonType: 1, week: 2 })] : [],
    }),
  });

  const games = await getNflGamesForWeek();
  assert.equal(games.length, 1);
  assert.equal(games[0].game_id, '9');
});

test('recovers the current slate when both weekly ESPN hosts fail', async () => {
  global.fetch = async url => {
    if (String(url).includes('seasontype=')) throw new Error('provider offline');
    return { ok: true, json: async () => ({ events: [event({ id: 1, seasonType: 2, week: 1 })] }) };
  };
  const result = await getNflWeekSchedule();
  assert.equal(result.games.length, 1);
  assert.equal(result.meta.status, 'degraded');
  assert.equal(result.meta.source, 'espn-scoreboard');
  assert.equal(result.meta.partial, true);
  assert.equal(result.games[0].home_score, null);
});

test('unavailable schedule rejects instead of claiming an empty week', async () => {
  global.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(getNflWeekSchedule(), /offline/);
  assert.deepEqual(await getNflGamesForWeek(), []); // compatibility for background consumers
});

test('malformed weekly payload is not cached as a successful empty response', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ error: 'upstream' }) });
  const options = { season: 2026, seasonType: 2, week: 5 };
  await assert.rejects(getNflWeekSchedule(options), /Invalid NFL/);
  global.fetch = async () => ({ ok: true, json: async () => ({ events: [event({ id: 5, seasonType: 2, week: 5 })] }) });
  assert.equal((await getNflWeekSchedule(options)).games.length, 1);
});

test('parallel callers share discovery and weekly requests', async () => {
  let count = 0;
  global.fetch = async () => {
    count++;
    return { ok: true, json: async () => ({ events: [event({ id: 1, seasonType: 2, week: 1 })] }) };
  };
  const results = await Promise.all(Array.from({ length: 12 }, () => getNflWeekSchedule()));
  assert.equal(count, 2);
  assert.ok(results.every(r => r.games[0].game_id === '1'));
});

test('fallback slate does not poison a subsequent explicit week cache', async () => {
  global.fetch = async url => ({ ok: true, json: async () => ({
    events: String(url).includes('seasontype=') ? [] : [event({ id: 1, seasonType: 2, week: 1 })],
  }) });
  assert.equal((await getNflWeekSchedule()).games.length, 1);
  assert.equal((await getNflWeekSchedule({ season: 2026, seasonType: 2, week: 1 })).games.length, 0);
});

test('expired live cache recovers briefly but is rejected after the age limit', async t => {
  const options = { season: 2026, seasonType: 2, week: 1 };
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const live = event({ id: 1, seasonType: 2, week: 1 });
  live.status.type.state = 'in';
  global.fetch = async () => ({ ok: true, json: async () => ({ events: [live] }) });
  const initial = await getNflWeekSchedule(options);
  now += 31_000;
  global.fetch = async () => { throw new Error('offline'); };
  const stale = await getNflWeekSchedule(options);
  assert.equal(stale.meta.stale, true);
  assert.equal(stale.meta.fetchedAt, initial.meta.fetchedAt);
  now += 15 * 60_000;
  await assert.rejects(getNflWeekSchedule(options), /offline/);
});

test('changing season phase cannot borrow the previous slate', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  global.fetch = async () => ({ ok: true, json: async () => ({ events: [event({ id: 1, seasonType: 1, week: 4 })] }) });
  await getNflWeekSchedule();
  now += 11 * 60_000;
  global.fetch = async () => ({ ok: true, json: async () => ({ season: { year: 2026, type: 2 }, week: { number: 1 }, events: [] }) });
  const next = await getNflWeekSchedule();
  assert.equal(next.seasonType, 2);
  assert.equal(next.week, 1);
  assert.equal(next.games.length, 0);
});

test('a cached empty explicit week cannot hide a populated current slate', async () => {
  global.fetch = async url => ({ ok: true, json: async () => ({
    events: String(url).includes('seasontype=') ? [] : [event({ id: 1, seasonType: 2, week: 1 })],
  }) });
  assert.equal((await getNflWeekSchedule({ season: 2026, seasonType: 2, week: 1 })).games.length, 0);
  assert.equal((await getNflWeekSchedule()).games.length, 1);
});
