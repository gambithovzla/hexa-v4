#!/usr/bin/env node

/**
 * Parlay Architect smoke — history shape + optional auto-resolve probe.
 *
 * Env:
 *   SMOKE_BASE_URL
 *   SMOKE_ADMIN_TOKEN or SMOKE_USER_TOKEN
 *   SMOKE_PARLAY_RUN_ID   optional numeric id (without db_ prefix)
 *   SMOKE_PARLAY_SKIP_RESOLVE=1   only validate history (no POST auto-resolve)
 */

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3001';
const TOKEN = process.env.SMOKE_ADMIN_TOKEN || process.env.SMOKE_USER_TOKEN || '';
const RUN_ID = process.env.SMOKE_PARLAY_RUN_ID || '';
const SKIP_RESOLVE = process.env.SMOKE_PARLAY_SKIP_RESOLVE === '1';

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

function assertHistoryRow(row) {
  assert(row && typeof row === 'object', 'history row must be object');
  assert(row.id != null, 'history row missing id');
  assert(Array.isArray(row.legs) || row.legs == null, 'legs must be array or null');
  if (row.leg_results != null) {
    assert(Array.isArray(row.leg_results), 'leg_results must be array when present');
    for (const leg of row.leg_results) {
      assert(leg && typeof leg === 'object', 'leg_results entry must be object');
      assert(
        ['win', 'loss', 'push', null, undefined].includes(leg.result),
        `unexpected leg result: ${leg.result}`,
      );
    }
  }
}

function findRun(rows, runId) {
  if (runId) {
    const id = `db_${runId}`;
    return rows.find(r => String(r.id) === id || String(r.id) === String(runId));
  }
  return rows.find(r => String(r.id).startsWith('db_'));
}

async function run() {
  console.log(`[parlay-smoke] base_url=${BASE_URL}`);

  if (!TOKEN) {
    console.log('[parlay-smoke] skip — set SMOKE_ADMIN_TOKEN or SMOKE_USER_TOKEN');
    return;
  }

  const hist = await fetchJson(`${BASE_URL}/api/parlay-architect/history`);
  assert(hist.ok, `history expected 2xx, got ${hist.status}`);
  assert(hist.data?.success === true, 'history success=false');
  assert(Array.isArray(hist.data?.data), 'history data[] missing');

  const rows = hist.data.data;
  for (const row of rows.slice(0, 5)) {
    assertHistoryRow(row);
  }
  console.log(`[parlay-smoke] PASS history (${rows.length} rows, shape ok)`);

  const learnings = await fetchJson(`${BASE_URL}/api/parlay-architect/learnings`);
  assert(learnings.ok, `learnings expected 2xx, got ${learnings.status}`);
  assert(learnings.data?.success === true, 'learnings success=false');
  console.log('[parlay-smoke] PASS learnings');

  if (SKIP_RESOLVE) {
    console.log('[parlay-smoke] skip auto-resolve (SMOKE_PARLAY_SKIP_RESOLVE=1)');
    return;
  }

  const dbRun = findRun(rows, RUN_ID);
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
  const out = resolve.data?.data ?? {};
  assert(out.status, 'auto-resolve status missing');
  assert(Array.isArray(out.legResults), 'auto-resolve legResults[] missing');
  for (const leg of out.legResults) {
    assert(leg?.pick != null || leg?.candidateId != null, 'leg missing pick/candidateId');
    assert(
      ['win', 'loss', 'push', null, undefined].includes(leg.result),
      `unexpected legResults result: ${leg.result}`,
    );
  }
  console.log(
    `[parlay-smoke] PASS auto-resolve run=${runId} status=${out.status} legs=${out.legResults.length}`,
  );

  const hist2 = await fetchJson(`${BASE_URL}/api/parlay-architect/history`);
  assert(hist2.ok, 'history refetch failed');
  const updated = findRun(hist2.data?.data ?? [], runId);
  assert(updated, 'resolved run missing from history refetch');
  if (out.status !== 'pending') {
    assert(updated.leg_results?.length > 0, 'leg_results not persisted after finalize');
    assert(updated.resolved === true, 'resolved flag not set after finalize');
  } else {
    assert(
      updated.leg_results == null || Array.isArray(updated.leg_results),
      'leg_results must be array when partial persist',
    );
  }
  console.log('[parlay-smoke] PASS leg_results persisted in history');
}

run().catch((err) => {
  console.error(`[parlay-smoke] FAIL ${err.message}`);
  process.exitCode = 1;
});
