/**
 * soccer-lineups-api.js — confirmed lineups, injuries & suspensions from
 * API-Football (api-sports.io). The "lineup-confirmed" availability signal that
 * Sprint 11.3 adds on top of the ESPN-only soccer context.
 *
 * Provider-agnostic auth: works with both the direct api-sports.io key and a
 * RapidAPI subscription, selected by API_FOOTBALL_PROVIDER:
 *   - 'apisports' (default): header  x-apisports-key   host v3.football.api-sports.io
 *   - 'rapidapi':            headers x-rapidapi-key + x-rapidapi-host (api-football-v1)
 *
 * Suspensions (yellow-card accumulation / red cards) are unique to soccer and
 * invisible to ESPN — they surface here through the /injuries endpoint's reason.
 *
 * Every network call degrades to null and never throws (mirrors soccer-xg-fetcher
 * and the other soccer fetchers). The whole feature is a no-op when
 * API_FOOTBALL_KEY is unset, so the context builder keeps working ESPN-only.
 *
 * Pure helpers (exported for tests): apiFootballLeagueId, apiFootballSeason,
 * buildApiFootballRequest, matchFixtureByTeams, normalizeLineups,
 * normalizeAvailability.
 */

// Internal soccer-league slug → API-Football numeric league id.
const API_FOOTBALL_LEAGUE_ID = {
  'eng.1': 39,   // Premier League
  'esp.1': 140,  // La Liga
  'ita.1': 135,  // Serie A
  'ger.1': 78,   // Bundesliga
  'fra.1': 61,   // Ligue 1
  'usa.1': 253,  // MLS
};

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min — lineups change near kickoff
const _cache = new Map();

export function isSoccerLineupsEnabled() {
  return !!process.env.API_FOOTBALL_KEY;
}

export function apiFootballLeagueId(leagueSlug) {
  return API_FOOTBALL_LEAGUE_ID[leagueSlug] ?? null;
}

/**
 * API-Football season year. European leagues run Aug→May and are keyed by their
 * start year (2024 = the 2024-25 campaign); MLS is a calendar-year season.
 */
export function apiFootballSeason(leagueSlug, dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 1-12
  if (leagueSlug === 'usa.1') return year;        // MLS: calendar year
  return month >= 7 ? year : year - 1;            // Europe: Jul+ → this year's season
}

/**
 * Build the {url, headers} for an API-Football request — provider-aware. Reads
 * API_FOOTBALL_KEY + API_FOOTBALL_PROVIDER from env. Pure given the env.
 */
export function buildApiFootballRequest(path, query = {}) {
  const key = process.env.API_FOOTBALL_KEY ?? '';
  const provider = (process.env.API_FOOTBALL_PROVIDER ?? 'apisports').toLowerCase();
  const qs = Object.entries(query)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  if (provider === 'rapidapi') {
    const host = process.env.API_FOOTBALL_HOST ?? 'api-football-v1.p.rapidapi.com';
    return {
      url: `https://${host}/v3${path}${qs ? `?${qs}` : ''}`,
      headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': host },
    };
  }
  const host = process.env.API_FOOTBALL_HOST ?? 'v3.football.api-sports.io';
  return {
    url: `https://${host}${path}${qs ? `?${qs}` : ''}`,
    headers: { 'x-apisports-key': key },
  };
}

function normName(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(fc|cf|sc|afc|ac|club|cd|ud|rc)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function nameMatches(a, b) {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Pick the fixture whose home/away teams match the ESPN names (either orientation
 * tolerated, but home/away preserved). Returns the fixture object or null.
 */
export function matchFixtureByTeams(fixtures, homeName, awayName) {
  if (!Array.isArray(fixtures)) return null;
  for (const f of fixtures) {
    const h = f?.teams?.home?.name;
    const a = f?.teams?.away?.name;
    if (nameMatches(h, homeName) && nameMatches(a, awayName)) return f;
  }
  // Fallback: any fixture where both clubs appear (orientation flipped).
  for (const f of fixtures) {
    const h = f?.teams?.home?.name;
    const a = f?.teams?.away?.name;
    if ((nameMatches(h, homeName) || nameMatches(a, homeName)) &&
        (nameMatches(h, awayName) || nameMatches(a, awayName))) return f;
  }
  return null;
}

/**
 * Normalize a /fixtures/lineups response into per-side confirmation. A lineup is
 * "confirmed" once API-Football publishes a startXI (≈1h pre-kick).
 */
export function normalizeLineups(lineupResp, homeName, awayName) {
  const arr = lineupResp?.response ?? lineupResp ?? [];
  const out = { home: { confirmed: false, formation: null, startXICount: 0 },
                away: { confirmed: false, formation: null, startXICount: 0 } };
  if (!Array.isArray(arr)) return out;
  for (const entry of arr) {
    const teamName = entry?.team?.name;
    const startXI = Array.isArray(entry?.startXI) ? entry.startXI : [];
    const block = { confirmed: startXI.length >= 11, formation: entry?.formation ?? null, startXICount: startXI.length };
    if (nameMatches(teamName, homeName)) out.home = block;
    else if (nameMatches(teamName, awayName)) out.away = block;
  }
  return out;
}

/**
 * Normalize an /injuries response into per-side injuries + suspensions. Soccer's
 * unique suspension signal (yellow accumulation / red card) lives in `reason`.
 */
export function normalizeAvailability(injuriesResp, homeName, awayName) {
  const arr = injuriesResp?.response ?? injuriesResp ?? [];
  const out = { home: { injuries: [], suspensions: [] }, away: { injuries: [], suspensions: [] } };
  if (!Array.isArray(arr)) return out;
  for (const row of arr) {
    const teamName = row?.team?.name;
    const player = row?.player?.name ?? null;
    const reason = String(row?.player?.reason ?? row?.reason ?? '').trim();
    const isSuspension = /suspend|red card|tarjeta roja|sanci/i.test(reason);
    const item = { player, reason: reason || null };
    let side = null;
    if (nameMatches(teamName, homeName)) side = 'home';
    else if (nameMatches(teamName, awayName)) side = 'away';
    if (!side || !player) continue;
    (isSuspension ? out[side].suspensions : out[side].injuries).push(item);
  }
  return out;
}

async function _fetchJson(path, query, cacheKey) {
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;
  const { url, headers } = buildApiFootballRequest(path, query);
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`API-Football HTTP ${res.status}`);
    const json = await res.json();
    _cache.set(cacheKey, { data: json, expiresAt: Date.now() + CACHE_TTL_MS });
    return json;
  } catch (err) {
    console.warn(`[soccer-lineups] ${path} failed: ${err.message}`);
    if (cached) return cached.data; // stale fallback
    return null;
  }
}

/**
 * Confirmed-lineup + injury + suspension picture for one match. Resolves the
 * API-Football fixture by league + date + team names, then fetches lineups and
 * injuries. Returns a per-side availability block, or null when disabled / no
 * fixture / total failure (caller treats null as "unknown", ESPN-only).
 *
 * @returns {{ fixtureId, lineupsConfirmed, home, away } | null}
 *   home/away: { lineupStatus:'confirmed'|'unknown', formation, injuries[], suspensions[] }
 */
export async function getSoccerMatchAvailability({ leagueSlug, date, homeName, awayName }) {
  if (!isSoccerLineupsEnabled()) return null;
  const leagueId = apiFootballLeagueId(leagueSlug);
  if (!leagueId || !date || !homeName || !awayName) return null;
  const season = apiFootballSeason(leagueSlug, date);

  const fixturesResp = await _fetchJson(
    '/fixtures', { league: leagueId, season, date },
    `af:fixtures:${leagueId}:${season}:${date}`,
  );
  const fixture = matchFixtureByTeams(fixturesResp?.response ?? [], homeName, awayName);
  if (!fixture?.fixture?.id) return null;
  const fixtureId = fixture.fixture.id;

  const [lineupResp, injuriesResp] = await Promise.all([
    _fetchJson('/fixtures/lineups', { fixture: fixtureId }, `af:lineups:${fixtureId}`),
    _fetchJson('/injuries', { fixture: fixtureId }, `af:injuries:${fixtureId}`),
  ]);

  const lineups = normalizeLineups(lineupResp ?? {}, homeName, awayName);
  const avail = normalizeAvailability(injuriesResp ?? {}, homeName, awayName);

  const side = (s) => ({
    lineupStatus: lineups[s].confirmed ? 'confirmed' : 'unknown',
    formation: lineups[s].formation,
    injuries: avail[s].injuries,
    suspensions: avail[s].suspensions,
  });

  return {
    fixtureId,
    lineupsConfirmed: lineups.home.confirmed && lineups.away.confirmed,
    home: side('home'),
    away: side('away'),
  };
}
