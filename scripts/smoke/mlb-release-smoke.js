#!/usr/bin/env node

/**
 * MLB release smoke test.
 *
 * Runs a minimal set of read-only endpoint checks to catch obvious regressions
 * before production release. Designed for both CI and manual terminal runs.
 */

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3001';
const WAIT_FOR_SERVER = process.env.SMOKE_WAIT_FOR_SERVER !== '0';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20000);
const RETRIES = Number(process.env.SMOKE_RETRIES || 3);
const RETRY_DELAY_MS = Number(process.env.SMOKE_RETRY_DELAY_MS || 1000);

const today = new Date().toISOString().slice(0, 10);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data, raw: text };
  } finally {
    clearTimeout(timer);
  }
}

async function withRetries(name, fn) {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < RETRIES) {
        console.warn(`[mlb-smoke] ${name} failed (attempt ${attempt}/${RETRIES}): ${err.message}`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  throw lastError;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForServer() {
  const healthUrl = `${BASE_URL}/api/games?date=${today}`;
  const start = Date.now();
  const maxWaitMs = 30000;
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetchJsonWithTimeout(healthUrl, 3000);
      if (res.status < 500) return;
    } catch {
      // ignore until timeout
    }
    await sleep(1000);
  }
  throw new Error(`Server did not become reachable within ${maxWaitMs}ms`);
}

async function run() {
  console.log(`[mlb-smoke] base_url=${BASE_URL}`);
  if (WAIT_FOR_SERVER) {
    await waitForServer();
  }

  const checks = [
    {
      name: 'mlb-games',
      url: `${BASE_URL}/api/games?date=${today}`,
      validate: (res) => {
        assert(res.ok, `expected 2xx, got ${res.status}`);
        assert(res.data && typeof res.data === 'object', 'expected JSON object body');
        assert(res.data.success === true, 'expected success=true');
        assert(Array.isArray(res.data.data), 'expected data[] array');
      },
    },
    {
      name: 'mlb-teams',
      url: `${BASE_URL}/api/teams`,
      validate: (res) => {
        assert(res.ok, `expected 2xx, got ${res.status}`);
        assert(res.data && typeof res.data === 'object', 'expected JSON object body');
        assert(res.data.success === true, 'expected success=true');
        assert(Array.isArray(res.data.data), 'expected data[] array');
      },
    },
    {
      name: 'mlb-board',
      url: `${BASE_URL}/api/hexa/board?date=${today}`,
      validate: (res) => {
        assert(res.ok, `expected 2xx, got ${res.status}`);
        assert(res.data && typeof res.data === 'object', 'expected JSON object body');
        assert(res.data.success === true, 'expected success=true');
        assert(res.data.data && typeof res.data.data === 'object', 'expected data object');
        assert(Array.isArray(res.data.data.insights), 'expected data.insights[] array');
      },
    },
  ];

  for (const check of checks) {
    await withRetries(check.name, async () => {
      const res = await fetchJsonWithTimeout(check.url, TIMEOUT_MS);
      check.validate(res);
      console.log(`[mlb-smoke] PASS ${check.name} status=${res.status}`);
    });
  }

  console.log('[mlb-smoke] ALL CHECKS PASSED');
}

run().catch((err) => {
  console.error(`[mlb-smoke] FAIL ${err.message}`);
  process.exitCode = 1;
});

