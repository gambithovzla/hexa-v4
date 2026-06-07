/**
 * nfl-advanced-fetcher.js — NFL advanced stats (EPA / success rate / PROE) from
 * the Python ML sidecar's nflverse endpoint.
 *
 * This is the NFL analog of savant-fetcher.js: it surfaces the advanced metrics
 * the Oracle prompt already references by name (EPA/play, success rate, PROE)
 * but which ESPN standings cannot provide. The heavy lifting (downloading
 * nflverse play-by-play and computing team EPA) lives in the sidecar; here we
 * just fetch, normalise team keys to canonical ESPN abbreviations, and cache.
 *
 * Resilient like nfl-api.js: serves stale cache on failure, never throws, and
 * is a silent no-op when the sidecar is disabled — the context builder simply
 * falls back to the point-differential proxy it already had.
 */

import { getNflTeam } from './nfl-team-map.js';

const ML_SIDECAR_ENABLED = process.env.ML_SIDECAR_ENABLED === 'true' || process.env.ML_SIDECAR_ENABLED === '1';
const ML_API_URL = (process.env.HEXA_ML_API_URL ?? '').replace(/\/$/, '');
const ML_TOKEN = process.env.HEXA_ML_INTERNAL_TOKEN ?? '';

const TTL_MS = 6 * 60 * 60 * 1000; // 6h — nflverse season aggregates move slowly
const TIMEOUT_MS = 12000;          // first call cold-fetches pbp in the sidecar

const _cache = new Map();

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.data;
}
function cacheGetStale(key) {
  return _cache.get(key)?.data ?? null;
}
function cacheSet(key, data) {
  _cache.set(key, { data, expiresAt: Date.now() + TTL_MS });
}

/** Re-key the sidecar's nflverse-abbr map to canonical ESPN abbreviations. */
function normaliseTeamMap(teams) {
  const byAbbr = {};
  for (const [rawAbbr, stats] of Object.entries(teams ?? {})) {
    const team = getNflTeam({ teamAbbr: rawAbbr });
    const canon = team?.abbr ?? String(rawAbbr).toUpperCase();
    byAbbr[canon] = stats;
  }
  return byAbbr;
}

/** Fetch a single season's stats from the sidecar. Null on any failure/empty. */
async function _fetchSeasonStats(season) {
  const cacheKey = `nfl_adv:${season}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = `${ML_API_URL}/nfl/team-stats?season=${encodeURIComponent(season)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { ...(ML_TOKEN ? { Authorization: `Bearer ${ML_TOKEN}` } : {}) },
      signal: controller.signal,
    });
    if (!res.ok) {
      // 503 = nflverse not reachable from the sidecar; degrade quietly.
      const stale = cacheGetStale(cacheKey);
      if (stale) return stale;
      console.warn(`[nfl-advanced] team-stats ${season} → HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const result = {
      season: json.season ?? season,
      fetchedAt: json.fetched_at ?? new Date().toISOString(),
      byAbbr: normaliseTeamMap(json.teams),
    };
    cacheSet(cacheKey, result);
    console.log(`[nfl-advanced] team-stats ${season}: ${Object.keys(result.byAbbr).length} teams`);
    return result;
  } catch (err) {
    const stale = cacheGetStale(cacheKey);
    if (stale) {
      console.warn(`[nfl-advanced] team-stats ${season} failed (${err.message}) — serving stale`);
      return stale;
    }
    const msg = err.name === 'AbortError' ? `timeout after ${Math.round(TIMEOUT_MS / 1000)}s` : err.message;
    console.warn(`[nfl-advanced] team-stats ${season} failed (${msg})`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * getNflAdvancedTeamStats(season, { maxLookback }) → { season, requestedSeason,
 * isFallback, fetchedAt, byAbbr } or null.
 *
 * byAbbr is keyed by canonical ESPN abbr; each value is
 * { epa_off, epa_def, success_rate_off, success_rate_def, proe, plays_per_game, games_played }.
 *
 * Off-season / early-season fallback: nflverse has no play-by-play for the
 * requested season until ~Week 2, so a request for an empty season walks back
 * one year (default) to the last completed season's aggregates — a defensible
 * prior that keeps the Oracle context rich instead of dropping EPA to null. The
 * result is tagged `isFallback: true` and carries the original `requestedSeason`
 * so context_meta can surface that the numbers are last-season's.
 */
export async function getNflAdvancedTeamStats(season, { maxLookback = 1 } = {}) {
  if (!ML_SIDECAR_ENABLED || !ML_API_URL || season == null) return null;

  const requested = Number(season);
  for (let back = 0; back <= maxLookback; back++) {
    const trySeason = requested - back;
    const result = await _fetchSeasonStats(trySeason);
    if (result && Object.keys(result.byAbbr ?? {}).length > 0) {
      if (back > 0) {
        console.log(`[nfl-advanced] season ${requested} empty → fell back to ${trySeason}`);
        return { ...result, requestedSeason: requested, isFallback: true };
      }
      return { ...result, requestedSeason: requested, isFallback: false };
    }
  }
  return null;
}

/** Lookup one team's advanced stats by canonical abbr. Null if absent. */
export function findAdvancedStats(payload, teamAbbr) {
  if (!payload?.byAbbr || !teamAbbr) return null;
  const team = getNflTeam({ teamAbbr });
  const canon = team?.abbr ?? String(teamAbbr).toUpperCase();
  return payload.byAbbr[canon] ?? null;
}
