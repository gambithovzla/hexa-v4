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
 *
 * ESPN tennis scoreboard has two observed shapes:
 *   A) event IS the match: ev.competitors=[playerA, playerB] (no competitions[])
 *   B) event IS a tournament: ev.competitions=[{competitors:[...]}]
 * We detect by ev.competitors.length === 2 and handle both. No secondary date
 * filter — ESPN already filters by ?dates=YYYYMMDD; over-filtering caused 0 results.
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

  // Helper: extract a single match from a competitors array + context objects.
  // comp = the nested competition (null when event IS the match).
  // parentEv = the top-level event (used for name/id/surface/round fallbacks).
  const extractMatch = (competitors, comp, parentEv) => {
    if (competitors.length !== 2) return; // skip doubles/malformed

    // Tour filter when bare /scoreboard returns ATP+WTA together.
    if (!usedTourPath) {
      const nameUpper = String(parentEv?.name ?? '').toUpperCase();
      const wantAtp = tour === 'atp';
      const hasWta = nameUpper.includes('WTA') || nameUpper.includes('WOMEN');
      const hasAtp = nameUpper.includes('ATP') || nameUpper.includes('MEN');
      if (wantAtp && hasWta && !hasAtp) return;
      if (!wantAtp && hasAtp && !hasWta) return;
    }

    const ordered = [...competitors].sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));
    const playerA = mapCompetitor(ordered[0]);
    const playerB = mapCompetitor(ordered[1]);
    const sr = extractSurfaceRound(comp ?? parentEv, parentEv);
    const ref = comp ?? parentEv; // prefer comp-level fields, fall back to event
    const statusName = ref?.status?.type?.name ?? null;

    matches.push({
      matchId:        ref?.id ?? null,
      tour,
      tournamentId:   parentEv?.id ?? null,
      tournamentName: parentEv?.name ?? parentEv?.shortName ?? null,
      matchDate:      ref?.date ?? parentEv?.date ?? null,
      surface:        sr.surface,
      round:          sr.round,
      roundDepth:     sr.roundDepth,
      status:         normalizeStatus(ref?.status?.type?.state),
      statusName,
      statusDetail:   ref?.status?.type?.detail ?? null,
      isVoidStatus:   isVoidStatusName(statusName),
      players:        { a: playerA, b: playerB },
      winner:         playerA.winner ? 'a' : playerB.winner ? 'b' : null,
    });
  };

  for (const ev of events) {
    // ESPN tennis scoreboard has three observed shapes:
    //   A) event IS the match → ev.competitors = [playerA, playerB]  (no competitions[])
    //   B) event IS a tournament → ev.competitions = [{competitors:[...]}]
    //   C) Grand Slam / big tournament → ev.groupings = [{competitions:[{competitors:[...]}]}]
    //      or ev.groupings = [{grouping:{competitions:[...]}}]
    //      (confirmed for Roland Garros: topLevelKeys includes 'groupings', no competitions/competitors)
    const eventLevelCompetitors = ev?.competitors ?? [];
    if (eventLevelCompetitors.length === 2) {
      // Shape A: the event itself is the match.
      extractMatch(eventLevelCompetitors, null, ev);
    } else if ((ev?.competitions ?? []).length > 0) {
      // Shape B: tournament with top-level competitions.
      for (const comp of ev.competitions) {
        extractMatch(comp?.competitors ?? [], comp, ev);
      }
    } else {
      // Shape C: tournament with groupings (Roland Garros / Grand Slams).
      // Matches live inside groupings[N].competitions or groupings[N].grouping.competitions.
      for (const g of ev?.groupings ?? []) {
        const subComps =
          Array.isArray(g?.competitions)         ? g.competitions :
          Array.isArray(g?.grouping?.competitions) ? g.grouping.competitions :
          Array.isArray(g?.events)               ? g.events :
          Array.isArray(g?.grouping?.events)     ? g.grouping.events :
          [];
        for (const comp of subComps) {
          extractMatch(comp?.competitors ?? [], comp, ev);
        }
      }
    }
  }

  console.log(`[tennis-api] ${tour} ${dateStr}: ${matches.length} singles matches from ${events.length} events`);

  // Diagnostic: when 0 matches extracted, log groupings structure to aid debugging.
  if (matches.length === 0 && events.length > 0) {
    const ev0 = events[0];
    const g0 = (ev0?.groupings ?? [])[0];
    console.warn(`[tennis-api] 0 matches extracted — event diagnostic:`, JSON.stringify({
      id:               ev0?.id,
      name:             ev0?.name,
      statusState:      ev0?.status?.type?.state,
      competitorsLen:   (ev0?.competitors ?? []).length,
      competitionsLen:  (ev0?.competitions ?? []).length,
      groupingsLen:     (ev0?.groupings ?? []).length,
      g0keys:           g0 ? Object.keys(g0) : null,
      g0compsLen:       (g0?.competitions ?? []).length,
      g0groupingComps:  (g0?.grouping?.competitions ?? []).length,
      g0eventsLen:      (g0?.events ?? []).length,
    }));
  }

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
