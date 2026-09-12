import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { getNflGameById, _resetNflApiCache } = await import('../nfl-api.js');

let originalFetch;
beforeEach(() => { originalFetch = global.fetch; _resetNflApiCache(); });
afterEach(() => { global.fetch = originalFetch; _resetNflApiCache(); });

function summaryPayload({ id = '401872925', seasonType = 2, week = 2 } = {}) {
  return {
    header: {
      id,
      season: { year: 2026, type: seasonType },
      week,
      competitions: [{
        id,
        date: '2026-09-13T17:00:00Z',
        status: { type: { state: 'pre', shortDetail: 'Sun 12:00 PM' }, period: 0, displayClock: '0:00' },
        venue: { fullName: 'Paycor Stadium' },
        competitors: [
          { homeAway: 'home', score: null, team: { id: '4', abbreviation: 'CIN', displayName: 'Cincinnati Bengals' } },
          { homeAway: 'away', score: null, team: { id: '27', abbreviation: 'TB', displayName: 'Tampa Bay Buccaneers' } },
        ],
      }],
    },
  };
}

test('getNflGameById resolves a game from the per-event summary', async () => {
  global.fetch = async () => ({ ok: true, json: async () => summaryPayload() });

  const game = await getNflGameById('401872925');
  assert.equal(game.game_id, '401872925');
  assert.equal(game.home_team_abbr, 'CIN');
  assert.equal(game.away_team_abbr, 'TB');
  assert.equal(game.game_date, '2026-09-13');
  assert.equal(game.season, 2026);
  assert.equal(game.season_type, 2);
  assert.equal(game.week, 2);
});

test('getNflGameById returns null for an id ESPN does not know', async () => {
  global.fetch = async () => ({ ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) });
  assert.equal(await getNflGameById('999999'), null);
});

test('getNflGameById never throws on a malformed summary', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ header: {} }) });
  assert.equal(await getNflGameById('401872925'), null);
});

test('getNflGameById ignores an empty id without calling ESPN', async () => {
  let called = false;
  global.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  assert.equal(await getNflGameById(''), null);
  assert.equal(called, false);
});

// ── findNflGame / resolveNflSlate (over the real nfl-api, ESPN mocked) ─────────

const { findNflGame, resolveNflSlate } = await import('../services/nflGameLookup.js');

function scoreboardEvent({ id, seasonType = 2, week = 2, date = '2026-09-13T17:00:00Z' }) {
  return {
    id: String(id),
    date,
    season: { year: 2026, type: seasonType },
    week: { number: week },
    status: { type: { state: 'pre', shortDetail: 'Sun 12:00 PM' } },
    competitions: [{
      id: String(id),
      competitors: [
        { homeAway: 'home', score: null, team: { id: '4', abbreviation: 'CIN', displayName: 'Cincinnati Bengals' } },
        { homeAway: 'away', score: null, team: { id: '27', abbreviation: 'TB', displayName: 'Tampa Bay Buccaneers' } },
      ],
    }],
  };
}

/** Routes ESPN calls by URL so a test can decide what each locator answers. */
function mockEspn({ onWeek = () => ({ events: [] }), onDate = () => ({ events: [] }), onSummary = null }) {
  const calls = [];
  global.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    let body;
    if (u.includes('/summary?event=')) {
      if (!onSummary) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
      body = onSummary();
    } else if (/[?&]seasontype=/.test(u)) {
      body = onWeek(u);
    } else {
      body = onDate(u);
    }
    return { ok: true, json: async () => body };
  };
  return calls;
}

test('a Saturday date does not sink a Sunday game — the week locator answers first', async () => {
  // The reported bug: the date picker sends the day the user is on, and the NFL
  // scoreboard for that day holds no games.
  mockEspn({
    onWeek: () => ({ season: { year: 2026, type: 2 }, week: { number: 2 }, events: [scoreboardEvent({ id: 401872925 })] }),
    onDate: () => ({ events: [] }),
  });

  const game = await findNflGame({ gameId: '401872925', season: 2026, seasonType: 2, week: 2, date: '2026-09-12' });
  assert.equal(game?.game_id, '401872925');
  assert.equal(game.home_team_abbr, 'CIN');
});

test('with no week locator, an empty date lookup falls through to the current week', async () => {
  mockEspn({
    onWeek: () => ({ season: { year: 2026, type: 2 }, week: { number: 2 }, events: [scoreboardEvent({ id: 401872925 })] }),
    onDate: (u) => (u.includes('dates=20260912')
      ? { events: [] }
      : { season: { year: 2026, type: 2 }, week: { number: 2 }, events: [scoreboardEvent({ id: 401872925 })] }),
  });

  const game = await findNflGame({ gameId: '401872925', date: '2026-09-12' });
  assert.equal(game?.game_id, '401872925');
});

test('a game missing from every slate still resolves through the per-event summary', async () => {
  mockEspn({
    onWeek: () => ({ season: { year: 2026, type: 2 }, week: { number: 3 }, events: [] }),
    onDate: () => ({ events: [] }),
    onSummary: () => summaryPayload(),
  });

  const game = await findNflGame({ gameId: '401872925', season: 2026, seasonType: 2, week: 3, date: '2026-09-12' });
  assert.equal(game?.game_id, '401872925');
  assert.equal(game.week, 2, 'the summary carries the game\'s real week, not the one asked for');
});

test('findNflGame returns null when ESPN knows nothing about the id', async () => {
  mockEspn({ onWeek: () => ({ events: [] }), onDate: () => ({ events: [] }) });
  assert.equal(await findNflGame({ gameId: '123', date: '2026-09-12' }), null);
});

test('resolveNflSlate falls back to the current week on a day with no games', async () => {
  mockEspn({
    onWeek: () => ({ season: { year: 2026, type: 2 }, week: { number: 2 }, events: [scoreboardEvent({ id: 401872925 })] }),
    onDate: (u) => (u.includes('dates=20260912')
      ? { events: [] }
      : { season: { year: 2026, type: 2 }, week: { number: 2 }, events: [scoreboardEvent({ id: 401872925 })] }),
  });

  const slate = await resolveNflSlate({ date: '2026-09-12' });
  assert.equal(slate.length, 1);
  assert.equal(slate[0].game_id, '401872925');
});
