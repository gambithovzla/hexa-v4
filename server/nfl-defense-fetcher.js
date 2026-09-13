/**
 * nfl-defense-fetcher.js — opponent defense-allowed rates for NFL player props.
 *
 * The defensive counterpart of nfl-player-fetcher.js. A receiver's 62.5-yard line
 * means something different against the defense surrendering the most passing
 * yards in the league than against the one surrendering the fewest; this module
 * supplies the per-game allowed rate and the league mean so the projection engine
 * can price that matchup (nflPropProjection.defenseFactor).
 *
 * Same resilience contract as the other nflverse fetchers: 6h cache, serves stale
 * on failure, walks back one season when the requested one has no play-by-play
 * yet (off-season / Week 1), never throws, and is a silent no-op when the sidecar
 * is disabled — the projection engine then simply applies a neutral 1.0 factor.
 */

import { getNflTeam } from './nfl-team-map.js';

const ML_SIDECAR_ENABLED = process.env.ML_SIDECAR_ENABLED === 'true' || process.env.ML_SIDECAR_ENABLED === '1';
const ML_API_URL = (process.env.HEXA_ML_API_URL ?? '').replace(/\/$/, '');
const ML_TOKEN = process.env.HEXA_ML_INTERNAL_TOKEN ?? '';

const TTL_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 15000; // the first call cold-loads the season's parquet

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

/**
 * Which defensive rate governs each prop kind. Receiving props ride on passing
 * yards allowed (they are the same yards from the other side of the ball), and
 * scoring props ride on total touchdowns allowed.
 */
export const PROP_DEFENSE_STAT = {
  pass_yds: 'pass_yds',
  longest_completion: 'pass_yds',
  reception_yds: 'pass_yds',
  longest_reception: 'pass_yds',
  pass_completions: 'completions',
  receptions: 'completions',
  pass_attempts: 'pass_attempts',
  pass_tds: 'pass_tds',
  pass_interceptions: 'interceptions',
  rush_yds: 'rush_yds',
  longest_rush: 'rush_yds',
  rush_attempts: 'rush_attempts',
  rush_rec_yds: 'scrimmage_yds',
  pass_rush_rec_yds: 'scrimmage_yds',
  anytime_td: 'total_tds',
  first_td: 'total_tds',
  last_td: 'total_tds',
  pass_rush_rec_tds: 'total_tds',
  sacks: 'sacks',
};

/** Re-key the sidecar's nflverse abbreviations to canonical ESPN ones. */
function normaliseTeamMap(teams) {
  const byAbbr = {};
  for (const [rawAbbr, stats] of Object.entries(teams ?? {})) {
    const team = getNflTeam({ teamAbbr: rawAbbr });
    const canon = team?.abbr ?? String(rawAbbr).toUpperCase();
    byAbbr[canon] = stats;
  }
  return byAbbr;
}

async function _fetchSeason(season) {
  const cacheKey = `nfl_def:${season}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = `${ML_API_URL}/nfl/defense-allowed?season=${encodeURIComponent(season)}`;
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
      // 503 is the expected answer for a season nflverse has no plays for yet —
      // the caller walks back a season rather than treating it as an outage.
      if (res.status !== 503) console.warn(`[nfl-defense] defense-allowed ${season} → HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const teams = normaliseTeamMap(json.teams);
    if (!Object.keys(teams).length) return null;
    const result = {
      season: json.season ?? season,
      fetchedAt: json.fetched_at ?? new Date().toISOString(),
      league: json.league ?? {},
      byAbbr: teams,
    };
    cacheSet(cacheKey, result);
    console.log(`[nfl-defense] defense-allowed ${season}: ${Object.keys(teams).length} teams`);
    return result;
  } catch (err) {
    const stale = cacheGetStale(cacheKey);
    if (stale) {
      console.warn(`[nfl-defense] defense-allowed ${season} failed (${err.message}) — serving stale`);
      return stale;
    }
    const msg = err.name === 'AbortError' ? `timeout after ${Math.round(TIMEOUT_MS / 1000)}s` : err.message;
    console.warn(`[nfl-defense] defense-allowed ${season} failed (${msg})`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Defense-allowed rates for a season, walking back up to `maxLookback` seasons
 * when the requested one has no play-by-play yet. A prior-season prior beats no
 * matchup signal at all, and is labelled so callers can flag it.
 *
 * @returns {{season, requestedSeason, isFallback, league, byAbbr, fetchedAt}|null}
 */
export async function getNflDefenseAllowed(season, { maxLookback = 1 } = {}) {
  if (!ML_SIDECAR_ENABLED || !ML_API_URL || season == null) return null;
  const requested = Number(season);
  if (!Number.isFinite(requested)) return null;

  for (let back = 0; back <= maxLookback; back++) {
    const target = requested - back;
    const data = await _fetchSeason(target);
    if (data) {
      return { ...data, requestedSeason: requested, isFallback: back > 0 };
    }
  }
  return null;
}

/**
 * One team's allowed rate for a prop kind, alongside the league mean.
 * Returns null when the stat has no defensive analogue (tackles, kicking) or the
 * team is absent — the projection engine then applies a neutral matchup factor.
 *
 * @param payload  result of getNflDefenseAllowed()
 * @param teamAbbr the DEFENDING team (the player's opponent)
 */
export function findNflDefenseAllowed(payload, teamAbbr, propKind) {
  if (!payload?.byAbbr || !teamAbbr || !propKind) return null;
  const stat = PROP_DEFENSE_STAT[propKind];
  if (!stat) return null;

  const team = getNflTeam({ teamAbbr });
  const canon = team?.abbr ?? String(teamAbbr).toUpperCase();
  const entry = payload.byAbbr[canon];
  if (!entry) return null;

  const allowedPerGame = entry[stat];
  const leagueAvgAllowed = payload.league?.[stat];
  if (!Number.isFinite(allowedPerGame) || !Number.isFinite(leagueAvgAllowed)) return null;

  return {
    stat,
    allowedPerGame,
    leagueAvgAllowed,
    games: entry.games ?? null,
    isFallback: payload.isFallback === true,
    season: payload.season ?? null,
  };
}
