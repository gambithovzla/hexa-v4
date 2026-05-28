/**
 * server/odds-cache.js — Postgres-backed odds cache (L2) with in-memory L1.
 *
 * Used to share alt-line and extended-prop menus across all consumers
 * (Imperdible, Safe Pick, Parlay Architect, Oracle Chat) without re-pinging
 * The Odds API. Survives redeploys, has TTL per scope.
 *
 * Scopes (cache_key conventions):
 *   - mlb:date:YYYY-MM-DD:main         — main markets (h2h/spreads/totals)
 *   - mlb:event:EVENT_ID:alts          — alt_spreads + alt_totals + team_totals
 *   - mlb:event:EVENT_ID:props_full    — extended player props menu
 *
 * The existing in-memory cache in odds-api.js stays as the primary path for
 * main markets (60-min TTL). This module adds durable persistence for the
 * alt/props menus that have larger TTL and benefit from cross-consumer reuse.
 */

import pool from './db.js';

const _l1 = new Map();
const _stats = { hits_l1: 0, hits_l2: 0, misses: 0, writes: 0, errors: 0 };

const DEFAULT_TTL_MS = {
  main:        60 * 60 * 1000,         // 60 min
  alts:        6 * 60 * 60 * 1000,     // 6 hours — alt menu doesn't move
  props_full:  3 * 60 * 60 * 1000,     // 3 hours — depends on lineup confirmation
};

export function buildCacheKey(sport, scope, subject) {
  return `${sport}:${subject ? `${scope === 'main' ? 'date' : 'event'}:${subject}:${scope}` : scope}`;
}

export function getOddsCacheStats() {
  return {
    ..._stats,
    l1_entries: _l1.size,
  };
}

/**
 * Look up cached payload. Returns null on miss. L1 first, then L2.
 */
export async function loadCachedOdds({ sport = 'mlb', scope, subject }) {
  const key = buildCacheKey(sport, scope, subject);
  const now = Date.now();

  const l1 = _l1.get(key);
  if (l1 && l1.expiresAt > now) {
    _stats.hits_l1++;
    return { ...l1, source: 'l1' };
  }

  try {
    const { rows } = await pool.query(
      `SELECT payload, markets, quota, key_slot, fetched_at, expires_at
       FROM   odds_cache
       WHERE  cache_key = $1
         AND  expires_at > NOW()
       LIMIT  1`,
      [key],
    );
    if (rows.length) {
      const row = rows[0];
      const entry = {
        payload: row.payload,
        markets: row.markets,
        quota: row.quota,
        keySlot: row.key_slot,
        fetchedAt: row.fetched_at instanceof Date ? row.fetched_at.getTime() : Date.parse(row.fetched_at),
        expiresAt: row.expires_at instanceof Date ? row.expires_at.getTime() : Date.parse(row.expires_at),
      };
      _l1.set(key, entry);
      _stats.hits_l2++;
      return { ...entry, source: 'l2' };
    }
  } catch (err) {
    _stats.errors++;
    console.warn(`[odds-cache] L2 read failed for ${key}: ${err.message}`);
  }

  _stats.misses++;
  return null;
}

/**
 * Persist payload at both L1 and L2.
 */
export async function saveCachedOdds({
  sport = 'mlb',
  scope,
  subject,
  payload,
  markets = null,
  quota = null,
  keySlot = null,
  ttlMs = null,
}) {
  const key = buildCacheKey(sport, scope, subject);
  const effectiveTtl = Number.isFinite(ttlMs) && ttlMs > 0
    ? ttlMs
    : (DEFAULT_TTL_MS[scope] ?? 60 * 60 * 1000);
  const expiresAt = Date.now() + effectiveTtl;

  _l1.set(key, { payload, markets, quota, keySlot, fetchedAt: Date.now(), expiresAt });

  try {
    await pool.query(
      `INSERT INTO odds_cache (cache_key, sport, scope, subject, payload, markets, quota, key_slot, fetched_at, expires_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, NOW(), to_timestamp($9))
       ON CONFLICT (cache_key)
       DO UPDATE SET
         payload    = EXCLUDED.payload,
         markets    = EXCLUDED.markets,
         quota      = EXCLUDED.quota,
         key_slot   = EXCLUDED.key_slot,
         fetched_at = NOW(),
         expires_at = EXCLUDED.expires_at`,
      [
        key,
        sport,
        scope,
        subject != null ? String(subject) : null,
        JSON.stringify(payload ?? null),
        markets,
        quota ? JSON.stringify(quota) : null,
        keySlot,
        Math.round(expiresAt / 1000),
      ],
    );
    _stats.writes++;
  } catch (err) {
    _stats.errors++;
    console.warn(`[odds-cache] L2 write failed for ${key}: ${err.message}`);
  }
}

/**
 * Drop a cached entry. Used when a game flips to live and pregame menus
 * should not be served to new picks.
 */
export async function invalidateCachedOdds({ sport = 'mlb', scope, subject }) {
  const key = buildCacheKey(sport, scope, subject);
  _l1.delete(key);
  try {
    await pool.query(`DELETE FROM odds_cache WHERE cache_key = $1`, [key]);
  } catch (err) {
    console.warn(`[odds-cache] invalidate failed for ${key}: ${err.message}`);
  }
}

/**
 * Periodically called by the warm-up job: prunes expired rows from Postgres
 * so the table stays bounded. Cheap operation.
 */
export async function pruneExpiredOddsCache() {
  try {
    const { rowCount } = await pool.query(`DELETE FROM odds_cache WHERE expires_at <= NOW()`);
    if (rowCount > 0) console.log(`[odds-cache] pruned ${rowCount} expired row(s)`);
    // Also evict expired L1 entries.
    const now = Date.now();
    for (const [key, entry] of _l1.entries()) {
      if (entry.expiresAt <= now) _l1.delete(key);
    }
    return { pruned: rowCount };
  } catch (err) {
    console.warn(`[odds-cache] prune failed: ${err.message}`);
    return { pruned: 0, error: err.message };
  }
}
