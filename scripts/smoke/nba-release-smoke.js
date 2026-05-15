#!/usr/bin/env node

/**
 * NBA release smoke test.
 *
 * Read-only check that the NBA scaffolding + Sprint 7.0 plumbing
 * (injuries + odds + context_meta) stays wired. Targets the same public
 * endpoints the client uses; the admin analyze endpoint is exercised only
 * when SMOKE_ADMIN_TOKEN and SMOKE_NBA_GAME_ID are provided.
 *
 * Env:
 *   SMOKE_BASE_URL          (default http://127.0.0.1:3001)
 *   SMOKE_ADMIN_TOKEN       admin JWT; enables /api/nba/analyze/game probe
 *   SMOKE_NBA_GAME_ID       required when ADMIN_TOKEN is set
 *   SMOKE_NBA_DATE          YYYY-MM-DD, default today
 *   SMOKE_TIMEOUT_MS        default 30000 (LLM call can be slow)
 *   SMOKE_RETRIES           default 3
 *   SMOKE_WAIT_FOR_SERVER   set to 0 to skip the boot wait
 *   NBA_ANALYSIS_ENABLED    only the server cares — smoke just probes
 */

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3001';
const WAIT_FOR_SERVER = process.env.SMOKE_WAIT_FOR_SERVER !== '0';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 30000);
const RETRIES = Number(process.env.SMOKE_RETRIES || 3);
const RETRY_DELAY_MS = Number(process.env.SMOKE_RETRY_DELAY_MS || 1000);
const ADMIN_TOKEN = process.env.SMOKE_ADMIN_TOKEN || '';
const NBA_GAME_ID = process.env.SMOKE_NBA_GAME_ID || '';
const NBA_DATE    = process.env.SMOKE_NBA_DATE || new Date().toISOString().slice(0, 10);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, { method = 'GET', body = null, headers = {}, timeoutMs = TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
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
        console.warn(`[nba-smoke] ${name} failed (attempt ${attempt}/${RETRIES}): ${err.message}`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  throw lastError;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function waitForServer() {
  const start = Date.now();
  const maxWaitMs = 30000;
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetchJson(`${BASE_URL}/api/nba/games?date=${NBA_DATE}`, { timeoutMs: 3000 });
      if (res.status < 500) return;
    } catch {
      // ignore
    }
    await sleep(1000);
  }
  throw new Error(`Server did not become reachable within ${maxWaitMs}ms`);
}

async function run() {
  console.log(`[nba-smoke] base_url=${BASE_URL} date=${NBA_DATE}`);
  if (WAIT_FOR_SERVER) {
    await waitForServer();
  }

  const checks = [
    {
      name: 'nba-games',
      run: async () => {
        const res = await fetchJson(`${BASE_URL}/api/nba/games?date=${NBA_DATE}`);
        assert(res.ok, `expected 2xx, got ${res.status}`);
        assert(res.data?.success === true, 'expected success=true');
        assert(Array.isArray(res.data.data), 'expected data[] array');
      },
    },
    {
      name: 'nba-teams',
      run: async () => {
        const res = await fetchJson(`${BASE_URL}/api/nba/teams`);
        assert(res.ok, `expected 2xx, got ${res.status}`);
        assert(res.data?.success === true, 'expected success=true');
        assert(Array.isArray(res.data.data), 'expected data[] array');
      },
    },
  ];

  if (ADMIN_TOKEN && NBA_GAME_ID) {
    checks.push({
      name: 'nba-analyze-game',
      run: async () => {
        const res = await fetchJson(`${BASE_URL}/api/nba/analyze/game`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
          body: { gameId: NBA_GAME_ID, date: NBA_DATE, lang: 'en', engine: 'haiku', riskProfile: 'balanced' },
          timeoutMs: 60000,
        });
        if (res.status === 503) {
          console.warn('[nba-smoke] analyze gated by NBA_ANALYSIS_ENABLED=true — skipping');
          return;
        }
        assert(res.ok, `expected 2xx, got ${res.status}: ${res.raw?.slice(0, 200)}`);
        assert(res.data?.success === true, 'expected success=true');
        const meta = res.data.meta ?? {};
        assert(meta.context_meta && typeof meta.context_meta === 'object', 'meta.context_meta missing');
        assert(meta.context_meta.sources, 'context_meta.sources missing');
        assert(typeof meta.context_meta.overallCompleteness === 'number', 'overallCompleteness missing');
        assert(Array.isArray(meta.context_meta.staleFlags), 'staleFlags missing');
        assert(['client', 'server', null, undefined].includes(meta.oddsSource ?? null), `unexpected oddsSource=${meta.oddsSource}`);
      },
    });
  } else {
    console.log('[nba-smoke] skipping nba-analyze-game (SMOKE_ADMIN_TOKEN and/or SMOKE_NBA_GAME_ID not set)');
  }

  for (const check of checks) {
    await withRetries(check.name, async () => {
      await check.run();
      console.log(`[nba-smoke] PASS ${check.name}`);
    });
  }

  console.log('[nba-smoke] ALL CHECKS PASSED');
}

run().catch((err) => {
  console.error(`[nba-smoke] FAIL ${err.message}`);
  process.exitCode = 1;
});
