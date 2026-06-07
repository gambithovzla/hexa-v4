/**
 * nfl-player-fetcher.js — NFL player-level prop averages from the Python ML
 * sidecar's nflverse endpoint (GET /nfl/player-stats?season=).
 *
 * The player analog of nfl-advanced-fetcher.js (team EPA). It surfaces each
 * player's season-to-date and recent (last-4) per-game averages for the prop
 * stats we model (pass_yds, rush_yds, receptions, anytime_td, …) so NFL prop
 * pick_features carry real player form, not just market signal.
 *
 * Resilient like nfl-advanced-fetcher.js: 6h cache, serves stale on failure,
 * never throws, and is a silent no-op when the sidecar is disabled.
 */

const ML_SIDECAR_ENABLED = process.env.ML_SIDECAR_ENABLED === 'true' || process.env.ML_SIDECAR_ENABLED === '1';
const ML_API_URL = (process.env.HEXA_ML_API_URL ?? '').replace(/\/$/, '');
const ML_TOKEN = process.env.HEXA_ML_INTERNAL_TOKEN ?? '';

const TTL_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 15000; // first call cold-fetches the weekly parquet in the sidecar

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

function normName(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * getNflPlayerStats(season) → { season, fetchedAt, players } or null.
 * `players` is keyed by normalized player name; each value has season_avg /
 * recent_avg dicts (by prop kind) + games.
 */
export async function getNflPlayerStats(season) {
  if (!ML_SIDECAR_ENABLED || !ML_API_URL || season == null) return null;

  const cacheKey = `nfl_players:${season}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = `${ML_API_URL}/nfl/player-stats?season=${encodeURIComponent(season)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { ...(ML_TOKEN ? { Authorization: `Bearer ${ML_TOKEN}` } : {}) },
      signal: controller.signal,
    });
    if (!res.ok) {
      const stale = cacheGetStale(cacheKey);
      if (stale) return stale;
      console.warn(`[nfl-player] player-stats ${season} → HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const result = {
      season: json.season ?? season,
      fetchedAt: json.fetched_at ?? new Date().toISOString(),
      players: json.players ?? {},
    };
    cacheSet(cacheKey, result);
    console.log(`[nfl-player] player-stats ${season}: ${Object.keys(result.players).length} players`);
    return result;
  } catch (err) {
    const stale = cacheGetStale(cacheKey);
    if (stale) {
      console.warn(`[nfl-player] player-stats ${season} failed (${err.message}) — serving stale`);
      return stale;
    }
    const msg = err.name === 'AbortError' ? `timeout after ${Math.round(TIMEOUT_MS / 1000)}s` : err.message;
    console.warn(`[nfl-player] player-stats ${season} failed (${msg})`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function findPlayer(players, playerName) {
  const query = normName(playerName);
  if (!query || !players) return null;
  if (players[query]) return players[query];
  for (const [key, p] of Object.entries(players)) {
    if (key.includes(query) || query.includes(key)) return p;
    const queryLast = query.split(' ').pop();
    const keyLast = key.split(' ').pop();
    if (queryLast === keyLast && queryLast.length > 2) return p;
  }
  return null;
}

/**
 * Lookup one player's season + recent average for a prop kind.
 * @returns {{ seasonAvg, recentAvg, games }|null}
 */
export function findNflPlayerPropStat(payload, playerName, propKind) {
  if (!payload?.players || !playerName || !propKind) return null;
  const p = findPlayer(payload.players, playerName);
  if (!p) return null;
  const seasonAvg = p.season_avg?.[propKind] ?? null;
  const recentAvg = p.recent_avg?.[propKind] ?? null;
  if (seasonAvg == null && recentAvg == null) return null;
  return { seasonAvg, recentAvg, games: p.games ?? null };
}
