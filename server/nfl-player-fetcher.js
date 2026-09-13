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
 *
 * Prior-season fallback (Sprint 9.8.1): in Week 1 nobody has current-season
 * games, and through the early weeks a one- or two-game average is noise. With
 * `includePriorSeason` the payload carries last season's averages alongside, and
 * findNflPlayerPropStat falls back to them per player until the current season
 * has enough games to stand on its own. Without it the prop engine simply has
 * nothing to project from until roughly Week 4.
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

async function _fetchPlayerSeason(season) {
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

/**
 * getNflPlayerStats(season, { includePriorSeason }) →
 *   { season, fetchedAt, players, priorSeason: { season, players }|null } or null.
 *
 * `players` is keyed by normalized player name; each value has season_avg /
 * recent_avg / season_std dicts (by prop kind) + games + team.
 */
export async function getNflPlayerStats(season, { includePriorSeason = false } = {}) {
  const current = await _fetchPlayerSeason(season);
  if (!includePriorSeason) return current;

  const prior = await _fetchPlayerSeason(Number(season) - 1);
  if (!current && !prior) return null;
  if (!current) {
    // The season has not started (or nflverse has not published it yet): serve
    // last season's numbers as the whole payload, flagged as prior-season.
    return {
      season,
      fetchedAt: prior.fetchedAt,
      players: {},
      priorSeason: { season: prior.season, players: prior.players },
    };
  }
  return {
    ...current,
    priorSeason: prior ? { season: prior.season, players: prior.players } : null,
  };
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

/** Below this many current-season games, last season is the better estimate. */
const MIN_CURRENT_SEASON_GAMES = 3;

function statFor(entry, propKind) {
  if (!entry) return null;
  const seasonAvg = entry.season_avg?.[propKind] ?? null;
  const recentAvg = entry.recent_avg?.[propKind] ?? null;
  if (seasonAvg == null && recentAvg == null) return null;
  return {
    seasonAvg,
    recentAvg,
    games: entry.games ?? null,
    // Sprint 9.8: dispersion and team ride along for the projection engine.
    // Older sidecar builds omit them; callers must treat both as optional.
    playerStd: entry.season_std?.[propKind] ?? null,
    team: entry.team ?? null,
    position: entry.position ?? null,
  };
}

/**
 * Lookup one player's season + recent average for a prop kind.
 *
 * Prefers the current season once the player has enough games for the average to
 * mean anything; before that (Week 1-3, or a player just back from injury) it
 * falls back to last season when the payload carries it. The result says which,
 * because a prior-season average deserves less weight than a current one — the
 * projection engine deflates its effective sample accordingly.
 *
 * @returns {{ seasonAvg, recentAvg, games, playerStd, team, position,
 *             fromPriorSeason, priorSeasonYear }|null}
 */
export function findNflPlayerPropStat(payload, playerName, propKind, { minCurrentGames = MIN_CURRENT_SEASON_GAMES } = {}) {
  if (!payload || !playerName || !propKind) return null;

  const current = statFor(findPlayer(payload.players, playerName), propKind);
  if (current && (current.games ?? 0) >= minCurrentGames) {
    return { ...current, fromPriorSeason: false, priorSeasonYear: null };
  }

  const prior = statFor(findPlayer(payload.priorSeason?.players, playerName), propKind);
  if (prior) {
    return {
      ...prior,
      // A prior-season row cannot tell us this year's roster. The caller only
      // trusts `team` when it matches one of the two teams actually playing,
      // so a stale team degrades to a neutral game script rather than a wrong one.
      fromPriorSeason: true,
      priorSeasonYear: payload.priorSeason?.season ?? null,
    };
  }

  return current ? { ...current, fromPriorSeason: false, priorSeasonYear: null } : null;
}
