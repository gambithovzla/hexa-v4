import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { getNflGameOdds, NFL_SPORT_KEYS } = await import('../nfl-odds.js');

let originalFetch;
let originalKey;
let originalBackup;

beforeEach(() => {
  originalFetch = global.fetch;
  originalKey = process.env.ODDS_API_KEY;
  originalBackup = process.env.ODDS_API_BACKUP_KEY;
  process.env.ODDS_API_KEY = 'test-key';
  delete process.env.ODDS_API_BACKUP_KEY;
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.ODDS_API_KEY;
  else process.env.ODDS_API_KEY = originalKey;
  if (originalBackup === undefined) delete process.env.ODDS_API_BACKUP_KEY;
  else process.env.ODDS_API_BACKUP_KEY = originalBackup;
});

function eventPayload({ home = 'Atlanta Falcons', away = 'Miami Dolphins', spread = -1.5 } = {}) {
  return [{
    id: 'evt-1',
    commence_time: '2026-08-14T23:00:00Z',
    home_team: home,
    away_team: away,
    bookmakers: [{
      key: 'draftkings',
      markets: [
        { key: 'h2h', outcomes: [{ name: home, price: -120 }, { name: away, price: 100 }] },
        {
          key: 'spreads',
          outcomes: [
            { name: home, point: spread, price: -110 },
            { name: away, point: -spread, price: -110 },
          ],
        },
      ],
    }],
  }];
}

/** Records every sport key requested and answers per-key from `bySportKey`. */
function mockOddsApi(bySportKey) {
  const requested = [];
  global.fetch = async (url) => {
    const key = String(url).match(/\/sports\/([^/]+)\//)?.[1] ?? null;
    requested.push(key);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => bySportKey[key] ?? [],
      text: async () => '',
    };
  };
  return requested;
}

test('a preseason slate queries the preseason sport key first and finds the game', async () => {
  const requested = mockOddsApi({ [NFL_SPORT_KEYS.PRESEASON]: eventPayload() });

  const events = await getNflGameOdds({ date: '2026-08-14', seasonType: 1 });

  assert.equal(requested[0], NFL_SPORT_KEYS.PRESEASON);
  assert.equal(events.length, 1);
  assert.equal(events[0].spread.home, -1.5);
  assert.equal(events[0].sportKey, NFL_SPORT_KEYS.PRESEASON);
});

test('an empty regular-season answer falls through to the preseason key', async () => {
  const requested = mockOddsApi({
    [NFL_SPORT_KEYS.REGULAR]: [],
    [NFL_SPORT_KEYS.PRESEASON]: eventPayload(),
  });

  // seasonType unknown — exactly the case that used to return "no odds".
  const events = await getNflGameOdds({ date: '2026-08-15', seasonType: null });

  assert.deepEqual(requested, [NFL_SPORT_KEYS.REGULAR, NFL_SPORT_KEYS.PRESEASON]);
  assert.equal(events.length, 1);
  assert.equal(events[0].sportKey, NFL_SPORT_KEYS.PRESEASON);
});

test('a regular-season slate costs exactly one request', async () => {
  const requested = mockOddsApi({ [NFL_SPORT_KEYS.REGULAR]: eventPayload({ spread: -3 }) });

  const events = await getNflGameOdds({ date: '2026-09-13', seasonType: 2 });

  assert.deepEqual(requested, [NFL_SPORT_KEYS.REGULAR]);
  assert.equal(events[0].spread.home, -3);
});

test('a hard failure does not spend a request on the other sport key', async () => {
  const requested = [];
  global.fetch = async (url) => {
    requested.push(String(url).match(/\/sports\/([^/]+)\//)?.[1] ?? null);
    return {
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => 'unauthorized',
    };
  };

  const events = await getNflGameOdds({ date: '2026-09-20', seasonType: 2 });

  assert.deepEqual(requested, [NFL_SPORT_KEYS.REGULAR]);
  assert.deepEqual(events, []);
});
