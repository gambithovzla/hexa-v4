/**
 * soccer-squad-strength.js — player-level squad quality for national teams.
 *
 * Why this exists: the FIFA ranking (soccer-national-strength.js) is a team-level
 * Elo that LAGS. It cannot see that a once-great nation is fielding a thin current
 * squad — the exact "Brazil isn't the Brazil of old" problem. The market-divergence
 * guard catches the symptom indirectly; THIS module measures the cause directly by
 * looking at how the individual players are performing right now and rolling that
 * up into a squad-quality read.
 *
 * Source: API-Football (api-sports.io) /players — the same provider and auth
 * plumbing as soccer-lineups-api.js (reuses buildApiFootballRequest). Each player
 * row carries a per-competition `statistics[].games.rating` plus goals/assists/
 * minutes; we aggregate the most-used players into an average rating, a count of
 * in-form "star" performers, and the top contributors.
 *
 * Fully optional and null-safe (mirrors every other soccer fetcher): a no-op when
 * API_FOOTBALL_KEY is unset, and any failure (no team match, sparse season,
 * network error) returns null so the FIFA prior + market still carry the analysis.
 *
 * Pure helpers exported for tests: aggregateSquadStrength, squadQualityTier.
 */

import { buildApiFootballRequest, isSoccerLineupsEnabled } from './soccer-lineups-api.js';
import { findSoccerTeam } from './soccer-team-map.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — squad form moves slowly
const _cache = new Map();

export function isSquadStrengthEnabled() {
  return isSoccerLineupsEnabled();
}

/**
 * National-team API-Football season. Unlike domestic European clubs (Aug→May,
 * keyed by start year), national teams play on the calendar year — so the World
 * Cup 2026 fixtures live under season 2026.
 */
export function nationalTeamSeason(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().getUTCFullYear() : d.getUTCFullYear();
}

function _num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Qualitative squad-quality tier from an average player rating (API-Football
 * ratings run ~6.0–8.0). The bands are deliberately coarse — the point is to
 * separate a top current squad from a thin one, not to over-fit a 0.1 delta.
 */
export function squadQualityTier(avgRating) {
  if (avgRating == null) return null;
  if (avgRating >= 7.2) return 'elite squad';
  if (avgRating >= 7.0) return 'strong squad';
  if (avgRating >= 6.8) return 'solid squad';
  if (avgRating >= 6.5) return 'average squad';
  return 'thin squad';
}

/**
 * Aggregate API-Football /players rows into a squad-quality summary. Pure.
 *
 * Picks each player's best (most-minutes) statistics block, keeps the players
 * with real minutes, and averages the rating of the top contributors. Also
 * surfaces star count (rating ≥ 7.2) and the top scorers/creators by goal
 * involvement.
 *
 * @param {object[]} rows  API-Football /players `response` array
 * @returns {{ avgRating, starCount, sampleSize, tier, topPlayers } | null}
 */
export function aggregateSquadStrength(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;

  const players = [];
  for (const row of rows) {
    const name = row?.player?.name ?? null;
    const stats = Array.isArray(row?.statistics) ? row.statistics : [];
    if (!name || !stats.length) continue;
    // Use the competition block with the most minutes (a player's primary comp).
    let best = null;
    for (const s of stats) {
      const mins = _num(s?.games?.minutes) ?? 0;
      if (!best || mins > best.minutes) {
        best = {
          minutes: mins,
          rating: _num(s?.games?.rating),
          goals: _num(s?.goals?.total) ?? 0,
          assists: _num(s?.goals?.assists) ?? 0,
          position: s?.games?.position ?? row?.player?.position ?? null,
        };
      }
    }
    if (!best) continue;
    players.push({ name, ...best, involvement: best.goals + best.assists });
  }

  // Keep players with a rating and meaningful minutes; fall back to any rated.
  const rated = players.filter(p => p.rating != null && p.minutes >= 90);
  const pool = rated.length >= 5 ? rated : players.filter(p => p.rating != null);
  if (!pool.length) return null;

  // Average the top-16 by minutes (the core that actually plays).
  const core = [...pool].sort((a, b) => b.minutes - a.minutes).slice(0, 16);
  const avgRating = Math.round((core.reduce((s, p) => s + p.rating, 0) / core.length) * 100) / 100;
  const starCount = pool.filter(p => p.rating >= 7.2).length;

  const topPlayers = [...pool]
    .sort((a, b) => (b.involvement - a.involvement) || (b.rating - a.rating))
    .slice(0, 3)
    .map(p => ({
      name: p.name,
      rating: p.rating,
      goals: p.goals,
      assists: p.assists,
      position: p.position,
    }));

  return {
    avgRating,
    starCount,
    sampleSize: pool.length,
    tier: squadQualityTier(avgRating),
    topPlayers,
  };
}

async function _fetchJson(path, query, cacheKey) {
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;
  const { url, headers } = buildApiFootballRequest(path, query);
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`API-Football HTTP ${res.status}`);
    const json = await res.json();
    _cache.set(cacheKey, { at: Date.now(), data: json });
    return json;
  } catch (err) {
    console.warn(`[squad-strength] ${path} failed: ${err.message}`);
    if (cached) return cached.data;
    return null;
  }
}

/**
 * Resolve a national team's API-Football team id by name. National teams are
 * `national=true` in API-Football. Cached. Returns null when unresolved.
 */
async function resolveNationalTeamId(teamName) {
  const seeded = findSoccerTeam(teamName, 'fifa.world');
  const canonical = seeded?.name ?? teamName;
  const cacheKey = `af:natid:${canonical}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const resp = await _fetchJson('/teams', { name: canonical }, `af:teamsearch:${canonical}`);
  const arr = resp?.response ?? [];
  // Prefer the national-team entry when several clubs share the name.
  const national = arr.find(t => t?.team?.national === true) ?? arr[0] ?? null;
  const id = national?.team?.id ?? null;
  _cache.set(cacheKey, { at: Date.now(), data: id });
  return id;
}

/**
 * Player-level squad strength for one national team. Best-effort: resolves the
 * team id, pulls two pages of /players for the season, and aggregates. Returns
 * null when disabled / unresolved / no data — never throws.
 *
 * @returns {{ avgRating, starCount, sampleSize, tier, topPlayers } | null}
 */
export async function getNationalSquadStrength({ teamName, season, dateStr } = {}) {
  if (!isSquadStrengthEnabled() || !teamName) return null;
  const yr = season ?? nationalTeamSeason(dateStr);
  const teamId = await resolveNationalTeamId(teamName);
  if (!teamId) return null;

  const cacheKey = `af:squad:${teamId}:${yr}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  // Pull the first two pages (≈40 players covers any national squad).
  const pages = await Promise.all([
    _fetchJson('/players', { team: teamId, season: yr, page: 1 }, `af:players:${teamId}:${yr}:1`),
    _fetchJson('/players', { team: teamId, season: yr, page: 2 }, `af:players:${teamId}:${yr}:2`),
  ]);
  const rows = pages.flatMap(p => p?.response ?? []);
  const agg = aggregateSquadStrength(rows);
  _cache.set(cacheKey, { at: Date.now(), data: agg });
  return agg;
}

export default {
  isSquadStrengthEnabled,
  nationalTeamSeason,
  squadQualityTier,
  aggregateSquadStrength,
  getNationalSquadStrength,
};
