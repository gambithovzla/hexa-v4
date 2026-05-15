#!/usr/bin/env node

/**
 * Post-deploy check for Hexa ML sidecar artifact persistence (Sprint 6b).
 *
 * Usage:
 *   HEXA_ML_API_URL=https://hexa-ml-production.up.railway.app node scripts/ops/verify-ml-persistence.js
 */

const API_URL = (process.env.HEXA_ML_API_URL ?? '').replace(/\/$/, '');
const TOKEN = process.env.HEXA_ML_INTERNAL_TOKEN ?? '';
const REQUIRE_PERSISTENT = process.env.ML_VERIFY_REQUIRE_PERSISTENT !== '0';
const REQUIRE_MODELS = process.env.ML_VERIFY_REQUIRE_MODELS !== '0';

function fail(message) {
  console.error(`[ml-verify] FAIL ${message}`);
  process.exitCode = 1;
}

function warn(message) {
  console.warn(`[ml-verify] WARN ${message}`);
}

async function run() {
  if (!API_URL) {
    fail('HEXA_ML_API_URL is required');
    return;
  }

  const headers = { Accept: 'application/json' };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  let res;
  try {
    res = await fetch(`${API_URL}/health`, { headers });
  } catch (err) {
    fail(`could not reach ${API_URL}/health — ${err.message}`);
    return;
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    fail(`/health returned ${res.status}`);
    return;
  }

  console.log(`[ml-verify] status=${body.status} artifacts_dir=${body.artifacts_dir}`);
  console.log(`[ml-verify] models_loaded=${JSON.stringify(body.models_loaded ?? [])}`);
  console.log(`[ml-verify] models_available=${JSON.stringify(body.models_available ?? [])}`);
  console.log(`[ml-verify] artifacts_persistent=${body.artifacts_persistent}`);

  if (REQUIRE_PERSISTENT && !body.artifacts_persistent) {
    fail(
      'artifacts_persistent=false — set Railway Volume at /data and HEXA_ML_ARTIFACTS_DIR=/data/artifacts on hexa-ml',
    );
    return;
  }

  if (REQUIRE_MODELS) {
    const loaded = body.models_loaded ?? [];
    const available = body.models_available ?? [];
    if (loaded.length === 0 && available.length === 0) {
      warn('no models loaded or on disk — run RETRAIN ALL from /admin/ml-control');
    } else if (loaded.length === 0 && available.length > 0) {
      warn('artifacts exist but none loaded in memory — restart sidecar or check logs');
    }
  }

  if (!process.exitCode) {
    console.log('[ml-verify] OK');
  }
}

run();
