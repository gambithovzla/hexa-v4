import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { getCurrentNflWeek, getNflGamesForWeek, _resetNflApiCache } = await import('../nfl-api.js');

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
