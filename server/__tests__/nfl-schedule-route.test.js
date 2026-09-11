import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleNflGames } from '../routes/nfl-schedule.js';
import { _resetNflApiCache } from '../nfl-api.js';

afterEach(_resetNflApiCache);

function response() {
  return {
    statusCode: 200, headers: {},
    set(key, value) { this.headers[key] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('endpoint returns 503 and retry metadata for a provider outage', async t => {
  t.mock.method(global, 'fetch', async () => { throw new Error('offline'); });
  const res = response();
  await handleNflGames({ query: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'NFL_SCHEDULE_UNAVAILABLE');
  assert.equal(res.headers['Retry-After'], '30');
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('a confirmed empty week remains a successful empty response', async t => {
  t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ events: [] }) }));
  const res = response();
  await handleNflGames({ query: { season: '2026', seasonType: '2', week: '4' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.count, 0);
  assert.equal(res.body.week, 4);
  assert.equal(res.body.meta.status, 'fresh');
});

test('invalid weeks never reach the provider', async t => {
  const fetchMock = t.mock.method(global, 'fetch', async () => { throw new Error('must not fetch'); });
  for (const week of ['0', '-1', '19', '1.5', 'NaN', '']) {
    const res = response();
    await handleNflGames({ query: { week } }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});
