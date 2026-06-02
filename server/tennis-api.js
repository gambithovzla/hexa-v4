/**
 * server/tennis-api.js — tennis data wrapper over ESPN's hidden API.
 *
 * Tour-aware by design: every function takes a `tour` ('atp' | 'wta') and hits
 * the same ESPN endpoint shape. One wrapper covers both tours — no per-tour
 * duplication. Mirrors the Soccer/NHL/NFL pattern: no API key, Railway-friendly,
 * cache + stale fallback on every fetch.
 *
 * The structural quirk vs the team sports: the ESPN tennis scoreboard groups
 * matches **by tournament**. An `event` is a tournament; the individual matches
 * live in `event.competitions[]`. `getTennisMatchesForDate` flattens that nested
 * shape into a flat list of matches, inheriting surface/round from the parent.
 *
 * ESPN endpoints (tennis/{tour}):
 *   scoreboard:  site.api.espn.com/apis/site/v2/sports/tennis/{tour}/scoreboard?dates=YYYYMMDD
 *   tournament:  site.api.espn.com/apis/site/v2/sports/tennis/{tour}/tournaments/{id}
 *   summary:     site.api.espn.com/apis/site/v2/sports/tennis/{tour}/summary?event=ID
 *   rankings:    site.api.espn.com/apis/site/v2/sports/tennis/{tour}/rankings
 *
 * No team map: players are keyed by normalized displayName + ESPN athlete.id.
 */

import { isSupportedTour, normalizeSurface, roundDepth } from './tennis-tour-map.js';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/tennis';

const CACHE_TTL_MS = 5 * 60 * 1000;       // 5 min for scoreboard/draw
const CACHE_TTL_LIVE_MS = 30 * 1000;      // 30s when a match is in-progress
const cache = new Map();

function cacheSet(key, data) {
  cache.set(key, { at: Date.now(), data });
}

async function fetchEspn(url, cacheKey) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (hexa-tennis)' } });
    if (!res.ok) throw new Error(`ESPN ${res.status}`);
    const json = await res.json();
    cacheSet(cacheKey, json);
    return json;
  } catch (err) {
    const cached = cache.get(cacheKey);
    if (cached) {
      console.warn(`[tennis-api] fetch failed, serving stale: ${err.message}`);
      return cached.data;
    }
    throw err;
  }
}

function assertTour(tour) {
  if (!isSupportedTour(tour)) {
    throw new Error(`unsupported tennis tour: ${tour}`);
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

/**
 * A terminal status name from ESPN that means the match did NOT complete
 * normally. The resolver voids picks on these (retirement/walkover/abandoned).
 */
const VOID_STATUS_NAMES = new Set([
  'STATUS_RETIRED',
  'STATUS_WALKOVER',
  'STATUS_ABANDONED',
  'STATUS_CANCELED',
  'STATUS_CANCELLED',
]);

export function isVoidStatusName(name) {
  return VOID_STATUS_NAMES.has(String(name ?? '').toUpperCase());
}

/**
 * Map an ESPN competitor (one side of a match) to our player shape.
 * Tennis has no homeAway; the caller assigns slot A/B by array order.
 */
function mapCompetitor(c) {
  const athlete = c?.athletes?.[0] ?? c?.athlete ?? {};
  const name = athlete?.displayName ?? athlete?.fullName ?? c?.team?.displayName ?? null;
  // Per-set games (linescores) + sets won (score)
  const linescores = Array.isArray(c?.linescores)
    ? c.linescores.map((l) => (l?.value != null ? Number(l.value) : null))
    : [];
  return {
    id: athlete?.id ?? c?.id ?? null,
    name,
    country: athlete?.flag?.alt ?? athlete?.citizenship ?? null,
    flag: athlete?.flag?.href ?? null,
    setsWon: c?.score != null ? Number(c.score) : null,
    gamesPerSet: linescores,
    winner: c?.winner ?? false,
    seed: c?.curatedRank?.current ?? c?.seed ?? null,
  };
}

/**
 * Extract surface + round for a competition, checking the competition itself
 * then falling back to the parent tournament event.
 */
function extractSurfaceRound(competition, parentEvent) {
  const surfaceRaw =
    competition?.surface?.name ??
    competition?.notes?.find?.((n) => /clay|grass|hard|carpet/i.test(n?.headline ?? ''))?.headline ??
    parentEvent?.groupings?.[0]?.grouping?.surface ??
    parentEvent?.surface?.name ??
    null;

  const roundRaw =
    competition?.notes?.[0]?.headline ??
    competition?.round?.displayName ??
    competition?.type?.text ??
    parentEvent?.groupings?.[0]?.grouping?.displayName ??
    null;

  return {
    surface: normalizeSurface(surfaceRaw),
    round: roundRaw ?? null,
    roundDepth: roundDepth(roundRaw),
  };
}

/**
 * Matches for a tour on a date. `dateStr` is YYYY-MM-DD.
 * Flattens the nested tournament→competition shape into a flat match list.
 *
 * ESPN tennis scoreboard returns *tournaments* as top-level events; individual
 * matches live in event.competitions[]. The `dates` param returns whatever
 * active tournaments ESPN considers "for" that date — some days ESPN ignores
 * the filter and returns all active tournament competitions regardless of match
 * date. We therefore filter by comp.date as a secondary pass and also try a
 * bare call without dates when the first returns 0 events.
 */
export async function getTennisMatchesForDate(tour, dateStr) {
  assertTour(tour);
  const datePart = toEspnDate(dateStr);
  const cacheKey = `tennis:matches:${tour}:${dateStr}`;

  // ESPN tennis may or may not use /atp/ or /wta/ as a sub-path. Try all known
  // patterns in order of specificity; stop on the first one that returns events.
  const candidates = [
    `${ESPN_BASE}/${tour}/scoreboard?dates=${datePart}`,
    `${ESPN_BASE}/${tour}/scoreboard`,
    `${ESPN_BASE}/scoreboard?dates=${datePart}`,
    `${ESPN_BASE}/scoreboard`,
  ];

  let json = null;
  let usedTourPath = false;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (hexa-tennis)' } });
      if (!res.ok) {
        console.warn(`[tennis-api] ${url} → HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const evCount = (data?.events ?? []).length;
      console.log(`[tennis-api] ${url} → events=${evCount}`);
      if (evCount > 0) {
        json = data;
        usedTourPath = url.includes(`/${tour}/`);
        cacheSet(cacheKey, json);
        break;
      }
    } catch (err) {
      console.warn(`[tennis-api] fetch failed (${url}): ${err.message}`);
    }
  }

  // Fall back to stale cache if all attempts returned nothing.
  if (!json || (json?.events ?? []).length === 0) {
    const cached = cache.get(cacheKey);
    if (cached) {
      console.warn(`[tennis-api] serving stale cache for ${tour}:${dateStr}`);
      json = cached.data;
      usedTourPath = true; // cached data was already tour-filtered when stored
    }
  }

  const events = json?.events ?? [];
  const matches = [];
  for (const ev of events) {
    const tournamentName = ev?.name ?? ev?.shortName ?? null;
    const tournamentId = ev?.id ?? null;
    const competitions = ev?.competitions ?? [];
    for (const comp of competitions) {
      const competitors = comp?.competitors ?? [];
      // Tennis singles = 2 competitors. Skip doubles (4) and malformed rows.
      if (competitors.length !== 2) continue;

      // Secondary date filter: ESPN may return all rounds of an active tournament;
      // keep only matches whose date matches the requested day.
      // comp.date is ISO 8601, e.g. "2026-06-02T13:00Z" — compare prefix only.
      const compDate = comp?.date ?? null;
      if (compDate && !String(compDate).startsWith(dateStr)) continue;

      // Tour filter when the bare /scoreboard URL was used (returns ATP+WTA together).
      // Match tournament name keywords ("ATP"/"WTA"/gender). When unrecognizable,
      // include — better to show an extra match than to miss one.
      if (!usedTourPath) {
        const nameUpper = String(tournamentName ?? '').toUpperCase();
        const wantAtp = tour === 'atp';
        const hasWta = nameUpper.includes('WTA') || nameUpper.includes('WOMEN');
        const hasAtp = nameUpper.includes('ATP') || nameUpper.includes('MEN');
        if (wantAtp && hasWta && !hasAtp) continue;
        if (!wantAtp && hasAtp && !hasWta) continue;
      }

      const ordered = [...competitors].sort(
        (a, b) => (a?.order ?? 0) - (b?.order ?? 0),
      );
      const playerA = mapCompetitor(ordered[0]);
      const playerB = mapCompetitor(ordered[1]);
      const sr = extractSurfaceRound(comp, ev);
      const statusName = comp?.status?.type?.name ?? null;

      matches.push({
        matchId: comp?.id ?? null,
        tour,
        tournamentId,
        tournamentName,
        matchDate: compDate ?? ev?.date ?? null,
        surface: sr.surface,
        round: sr.round,
        roundDepth: sr.roundDepth,
        status: normalizeStatus(comp?.status?.type?.state),
        statusName,
        statusDetail: comp?.status?.type?.detail ?? null,
        isVoidStatus: isVoidStatusName(statusName),
        players: { a: playerA, b: playerB },
        winner: playerA.winner ? 'a' : playerB.winner ? 'b' : null,
      });
    }
  }
  console.log(`[tennis-api] ${tour} ${dateStr}: ${matches.length} singles matches from ${events.length} tournaments`);
  return matches;
}

export async function getTennisTournamentDraw(tour, tournamentId) {
  assertTour(tour);
  const url = `${ESPN_BASE}/${tour}/tournaments/${tournamentId}`;
  return fetchEspn(url, `tennis:draw:${tour}:${tournamentId}`);
}

/**
 * Single-match summary (live + final). The resolver reads this for the per-set
 * score and the terminal status (retired/walkover/final).
 */
export async function getTennisMatchSummary(tour, eventId) {
  assertTour(tour);
  const url = `${ESPN_BASE}/${tour}/summary?event=${eventId}`;
  // Use a short TTL so live polling sees fresh scores.
  const cacheKey = `tennis:summary:${tour}:${eventId}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_LIVE_MS) {
    return cached.data;
  }
  return fetchEspn(url, cacheKey);
}

export async function getTennisRankings(tour) {
  assertTour(tour);
  const url = `${ESPN_BASE}/${tour}/rankings`;
  try {
    return await fetchEspn(url, `tennis:rankings:${tour}`);
  } catch (err) {
    console.warn(`[tennis-api] rankings failed for ${tour}: ${err.message}`);
    return null;
  }
}

export default {
  getTennisMatchesForDate,
  getTennisTournamentDraw,
  getTennisMatchSummary,
  getTennisRankings,
  isVoidStatusName,
};
