/**
 * server/soccer-api.js — soccer data wrapper over ESPN's hidden API.
 *
 * League-aware by design: every function takes a `leagueSlug` (e.g. 'eng.1')
 * and hits the same ESPN endpoint shape. One wrapper covers all six supported
 * leagues — no per-league duplication. Mirrors the NBA/NFL/NHL pattern: no API
 * key, Railway-friendly, cache + stale fallback on every fetch.
 *
 * ESPN endpoints (soccer/{leagueSlug}):
 *   scoreboard:  site.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard?dates=YYYYMMDD
 *   standings:   site.api.espn.com/apis/v2/sports/soccer/{slug}/standings
 *   summary:     site.api.espn.com/apis/site/v2/sports/soccer/{slug}/summary?event=ID
 *   teams:       site.api.espn.com/apis/site/v2/sports/soccer/{slug}/teams
 */

import { getSoccerLeague, isSupportedLeague } from './soccer-league-map.js';
import { findSoccerTeam } from './soccer-team-map.js';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function cacheSet(key, data) {
  cache.set(key, { at: Date.now(), data });
}

async function fetchEspn(url, cacheKey) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (hexa-soccer)' } });
    if (!res.ok) throw new Error(`ESPN ${res.status}`);
    const json = await res.json();
    cacheSet(cacheKey, json);
    return json;
  } catch (err) {
    const cached = cache.get(cacheKey);
    if (cached) {
      console.warn(`[soccer-api] fetch failed, serving stale: ${err.message}`);
      return cached.data;
    }
    throw err;
  }
}

function assertLeague(leagueSlug) {
  if (!isSupportedLeague(leagueSlug)) {
    throw new Error(`unsupported soccer league: ${leagueSlug}`);
  }
}

function toEspnDate(dateStr) {
  return String(dateStr).replace(/-/g, '');
}

function normalizeStatus(state) {
  if (state === 'pre') return 'scheduled';
  if (state === 'in') return 'live';
  if (state === 'post') return 'final';
  return 'scheduled';
}

function mapCompetitor(c, leagueSlug) {
  const espnName = c?.team?.displayName ?? c?.team?.name ?? null;
  const seeded = findSoccerTeam(c?.team?.abbreviation, leagueSlug)
    ?? findSoccerTeam(espnName, leagueSlug);
  return {
    abbreviation: seeded?.short ?? c?.team?.abbreviation ?? null,
    name: seeded?.name ?? espnName,
    id: c?.team?.id ?? null,
    logo: c?.team?.logo ?? c?.team?.logos?.[0]?.href ?? null,
    score: c?.score != null ? Number(c.score) : null,
    record: c?.records?.[0]?.summary ?? null,
    winner: c?.winner ?? null,
  };
}

/**
 * Games for a league on a date. `dateStr` is YYYY-MM-DD.
 * Returns a normalized, MLB-compatible-ish shape with `league` attached.
 */
export async function getSoccerGamesForDate(leagueSlug, dateStr) {
  assertLeague(leagueSlug);
  const url = `${ESPN_BASE}/${leagueSlug}/scoreboard?dates=${toEspnDate(dateStr)}`;
  const json = await fetchEspn(url, `soccer:games:${leagueSlug}:${dateStr}`);
  const events = json?.events ?? [];
  return events.map((ev) => {
    const comp = ev?.competitions?.[0] ?? {};
    const competitors = comp?.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === 'home') ?? {};
    const away = competitors.find((c) => c.homeAway === 'away') ?? {};
    return {
      gamePk: ev?.id ? Number(ev.id) : null,
      gameId: ev?.id ?? null,
      gameDate: ev?.date ?? null,
      league: leagueSlug,
      status: normalizeStatus(comp?.status?.type?.state),
      statusDetail: comp?.status?.type?.detail ?? null,
      teams: {
        home: mapCompetitor(home, leagueSlug),
        away: mapCompetitor(away, leagueSlug),
      },
      venue: comp?.venue?.fullName ?? null,
      neutralSite: comp?.neutralSite ?? false,
    };
  });
}

export async function getSoccerStandings(leagueSlug) {
  assertLeague(leagueSlug);
  const url = `${ESPN_BASE.replace('/site/v2', '/v2')}/${leagueSlug}/standings`;
  try {
    return await fetchEspn(url, `soccer:standings:${leagueSlug}`);
  } catch (err) {
    console.warn(`[soccer-api] standings failed for ${leagueSlug}: ${err.message}`);
    return null;
  }
}

export async function getSoccerGameSummary(leagueSlug, eventId) {
  assertLeague(leagueSlug);
  const url = `${ESPN_BASE}/${leagueSlug}/summary?event=${eventId}`;
  return fetchEspn(url, `soccer:summary:${leagueSlug}:${eventId}`);
}

export async function getSoccerTeams(leagueSlug) {
  assertLeague(leagueSlug);
  const url = `${ESPN_BASE}/${leagueSlug}/teams`;
  const json = await fetchEspn(url, `soccer:teams:${leagueSlug}`);
  const groups = json?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  return groups.map((g) => {
    const t = g?.team ?? {};
    const seeded = findSoccerTeam(t.abbreviation, leagueSlug) ?? findSoccerTeam(t.displayName, leagueSlug);
    return {
      id: t.id ?? null,
      abbreviation: seeded?.short ?? t.abbreviation ?? null,
      name: seeded?.name ?? t.displayName ?? null,
      league: leagueSlug,
    };
  });
}

export function getSoccerLeagueMeta(leagueSlug) {
  return getSoccerLeague(leagueSlug);
}

export default {
  getSoccerGamesForDate,
  getSoccerStandings,
  getSoccerGameSummary,
  getSoccerTeams,
  getSoccerLeagueMeta,
};
