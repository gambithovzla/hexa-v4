import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { espnRequest, mirrorUrl, ESPN_PRIMARY_HOST, ESPN_MIRROR_HOST } = await import('../espn-http.js');

const PRIMARY = `${ESPN_PRIMARY_HOST}/apis/site/v2/sports/football/nfl/scoreboard?week=2`;

let originalFetch;
let originalWarn;
beforeEach(() => {
  originalFetch = global.fetch;
  originalWarn = console.warn;
  console.warn = () => {};
});
afterEach(() => {
  global.fetch = originalFetch;
  console.warn = originalWarn;
});

test('mirrorUrl swaps only the host of a primary URL', () => {
  assert.equal(mirrorUrl(PRIMARY), `${ESPN_MIRROR_HOST}/apis/site/v2/sports/football/nfl/scoreboard?week=2`);
  assert.equal(mirrorUrl('https://cdn.espn.com/core/nfl/scoreboard'), null);
});

test('a 403 from the Akamai edge fails over to the mirror', async () => {
  // The production symptom: Railway egress gets "Access Denied" from
  // site.api.espn.com while the same path succeeds elsewhere.
  const seen = [];
  global.fetch = async (url) => {
    seen.push(String(url));
    if (String(url).startsWith(ESPN_PRIMARY_HOST)) return { ok: false, status: 403, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ events: [{ id: '1' }] }) };
  };

  const data = await espnRequest(PRIMARY, { label: 'scoreboard', prefix: 'nfl-api' });
  assert.equal(data.events.length, 1);
  assert.equal(seen.length, 2);
  assert.ok(seen[1].startsWith(ESPN_MIRROR_HOST));
});

test('the mirror is not attempted when the primary answers', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return { ok: true, status: 200, json: async () => ({ events: [] }) };
  };

  await espnRequest(PRIMARY, { label: 'scoreboard' });
  assert.equal(calls, 1);
});

test('requests carry browser-shaped headers', async () => {
  let headers = null;
  global.fetch = async (_url, opts) => {
    headers = opts.headers;
    return { ok: true, status: 200, json: async () => ({}) };
  };

  await espnRequest(PRIMARY, { label: 'scoreboard' });
  assert.match(headers['User-Agent'], /Mozilla\/5\.0/);
  assert.equal(headers.Referer, 'https://www.espn.com/');
});

test('both hosts failing throws with the prefix and the last reason', async () => {
  global.fetch = async () => { throw new Error('fetch failed'); };

  await assert.rejects(
    () => espnRequest(PRIMARY, { label: 'scoreboard 2026 st1 wk2', prefix: 'nfl-api' }),
    /\[nfl-api\] scoreboard 2026 st1 wk2 → fetch failed/,
  );
});

test('a timeout is reported in seconds rather than as an abort', async () => {
  global.fetch = async (_url, opts) => new Promise((_resolve, reject) => {
    opts.signal.addEventListener('abort', () => {
      const err = new Error('This operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });

  await assert.rejects(
    () => espnRequest(PRIMARY, { timeoutMs: 20, label: 'scoreboard', prefix: 'nfl-api' }),
    /timeout after 0s/,
  );
});
