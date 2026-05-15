#!/usr/bin/env node

/**
 * Parlay Architect smoke — read-only history + optional auto-resolve probe.
 *
 * Env:
 *   SMOKE_BASE_URL
 *   SMOKE_ADMIN_TOKEN or any user JWT with parlay history
 *   SMOKE_PARLAY_RUN_ID   optional db id (numeric, without db_ prefix)
 */

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3001';
const TOKEN = process.env.SMOKE_ADMIN_TOKEN || process.env.SMOKE_USER_TOKEN || '';
const RUN_ID = process.env.SMOKE_PARLAY_RUN_ID || '';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...options.headers,
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  return { ok: res.ok, status: res.status, data, raw: text };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  console.log(`[parlay-smoke] base_url=${BASE_URL}`);

  if (!TOKEN) {
    console.log('[parlay-smoke] skip — no SMOKE_ADMIN_TOKEN / SMOKE_USER_TOKEN');
    return;
  }

  const hist = await fetchJson(`${BASE_URL}/api/parlay-architect/history`);
  assert(hist.ok, `history expected 2xx, got ${hist.status}`);
  assert(hist.data?.success === true, 'history success=false');
  assert(Array.isArray(hist.data?.data), 'history data[] missing');
  console.log(`[parlay-smoke] PASS history (${hist.data.data.length} rows)`);

  const dbRun = hist.data.data.find((r) => String(r.id).startsWith('db_'));
  const runId = RUN_ID || (dbRun ? String(dbRun.id).replace(/^db_/, '') : null);

  if (!runId) {
    console.log('[parlay-smoke] skip auto-resolve — no db_* run in history');
    return;
  }

  const resolve = await fetchJson(`${BASE_URL}/api/parlay-architect/${runId}/auto-resolve`, {
    method: 'POST',
  });
  assert(resolve.ok, `auto-resolve expected 2xx, got ${resolve.status}: ${resolve.raw?.slice(0, 200)}`);
  assert(resolve.data?.success === true, 'auto-resolve success=false');
  assert(resolve.data?.data?.status, 'auto-resolve status missing');
  console.log(`[parlay-smoke] PASS auto-resolve run=${runId} status=${resolve.data.data.status}`);
}

run().catch((err) => {
  console.error(`[parlay-smoke] FAIL ${err.message}`);
  process.exitCode = 1;
});
