/**
 * featureFlagsService.js — Lightweight DB-backed feature flags (B5).
 *
 * A simple GrowthBook-style flags system using Postgres instead of a separate
 * service. Flags can be toggled from /admin/feature-flags without a redeploy.
 * In-memory cache with 60s TTL to avoid per-request DB hits.
 *
 * Flag evaluation:
 *   - enabled=false  → off for everyone
 *   - enabled=true, rollout_pct=100 → on for everyone
 *   - enabled=true, rollout_pct=N → on for N% of users (hash-stable per userId)
 *
 * Env var flags (existing system) take priority over DB flags when explicitly set.
 * DB flags are a superset — they can override defaults without a server restart.
 */

import pool from '../db.js';

const CACHE_TTL_MS = 60_000;
let _cache = new Map();
let _cacheTs = 0;

async function loadAll() {
  if (Date.now() - _cacheTs < CACHE_TTL_MS) return _cache;
  try {
    const { rows } = await pool.query(
      `SELECT key, enabled, rollout_pct, metadata FROM feature_flags`,
    );
    _cache = new Map(rows.map((r) => [r.key, r]));
    _cacheTs = Date.now();
  } catch {
    // Table may not exist yet — return empty map, not an error
  }
  return _cache;
}

function stableHashUserId(userId, key) {
  // Deterministic hash: same user always gets the same side for a given flag
  let h = 0;
  const s = `${userId}:${key}`;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100;
}

/**
 * Check whether a feature flag is enabled.
 * @param {string} key - flag key
 * @param {{ userId?: string|number }} [ctx]
 * @returns {Promise<boolean>}
 */
export async function isFeatureEnabled(key, ctx = {}) {
  const flags = await loadAll();
  const flag = flags.get(key);
  if (!flag) return false;
  if (!flag.enabled) return false;
  const pct = Number(flag.rollout_pct ?? 100);
  if (pct >= 100) return true;
  if (pct <= 0) return false;
  if (!ctx.userId) return false;
  return stableHashUserId(ctx.userId, key) < pct;
}

export async function getAllFlags() {
  const flags = await loadAll();
  return Array.from(flags.values());
}

export async function upsertFlag({ key, enabled, rollout_pct = 100, metadata = {} }) {
  await pool.query(
    `INSERT INTO feature_flags (key, enabled, rollout_pct, metadata, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (key) DO UPDATE
       SET enabled = $2, rollout_pct = $3, metadata = $4, updated_at = NOW()`,
    [key, Boolean(enabled), rollout_pct, JSON.stringify(metadata)],
  );
  _cacheTs = 0; // invalidate cache
}

export async function deleteFlag(key) {
  await pool.query(`DELETE FROM feature_flags WHERE key = $1`, [key]);
  _cacheTs = 0;
}

export function invalidateFlagsCache() {
  _cacheTs = 0;
}
