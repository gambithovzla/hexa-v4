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
 * Beyond availability, the same matched fixture also yields two extra signals at
 * little/no quota cost: the assigned REFEREE (free — already in the fixture
 * object) and recent HEAD-TO-HEAD history (+1 call to /fixtures/headtohead).
 *
 * Every network call degrades to null and never throws (mirrors soccer-xg-fetcher
 * and the other soccer fetchers). The whole feature is a no-op when
 * API_FOOTBALL_KEY is unset, so the context builder keeps working ESPN-only.
 *
 * Pure helpers (exported for tests): apiFootballLeagueId, apiFootballSeason,
 * buildApiFootballRequest, matchFixtureByTeams, normalizeLineups,
 * normalizeAvailability, normalizeH2H.
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

/**
 * Normalize a /fixtures/headtohead response into recent-meeting aggregates, from
 * the perspective of the UPCOMING match's home/away teams (by name, since a club
 * is home in some past meetings and away in others). Only finished meetings with
 * a final score are counted.
 *
 * @returns {{ meetings, homeWins, awayWins, draws, avgTotalGoals, bttsPct, last }}
 *   homeWins/awayWins are wins for the upcoming home/away club respectively.
 *   last: up to 5 recent meetings { date, home, away, score } for display.
 */
export function normalizeH2H(h2hResp, homeName, awayName) {
  const arr = h2hResp?.response ?? h2hResp ?? [];
  const empty = { meetings: 0, homeWins: 0, awayWins: 0, draws: 0, avgTotalGoals: null, bttsPct: null, last: [] };
  if (!Array.isArray(arr) || !arr.length) return empty;

  let homeWins = 0, awayWins = 0, draws = 0, totalGoals = 0, bttsCount = 0, counted = 0;
  const last = [];

  for (const m of arr) {
    const hg = m?.goals?.home;
    const ag = m?.goals?.away;
    if (hg == null || ag == null) continue; // not finished
    const pastHome = m?.teams?.home?.name;
    const pastAway = m?.teams?.away?.name;

    // Goals for the upcoming home/away club, regardless of which side they were on.
    let upHomeGoals = null, upAwayGoals = null;
    if (nameMatches(pastHome, homeName) && nameMatches(pastAway, awayName)) {
      upHomeGoals = hg; upAwayGoals = ag;
    } else if (nameMatches(pastHome, awayName) && nameMatches(pastAway, homeName)) {
      upHomeGoals = ag; upAwayGoals = hg;
    } else {
      continue; // unrelated fixture
    }

    counted += 1;
    totalGoals += hg + ag;
    if (hg > 0 && ag > 0) bttsCount += 1;
    if (upHomeGoals > upAwayGoals) homeWins += 1;
    else if (upHomeGoals < upAwayGoals) awayWins += 1;
    else draws += 1;

    if (last.length < 5) {
      last.push({
        date: (m?.fixture?.date ?? '').slice(0, 10) || null,
        home: pastHome ?? null,
        away: pastAway ?? null,
        score: `${hg}-${ag}`,
      });
    }
  }

  if (!counted) return empty;
  return {
    meetings: counted,
    homeWins, awayWins, draws,
    avgTotalGoals: Math.round((totalGoals / counted) * 100) / 100,
    bttsPct: Math.round((bttsCount / counted) * 100),
    last,
  };
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
 * @returns {{ fixtureId, lineupsConfirmed, referee, h2h, home, away } | null}
 *   home/away: { lineupStatus:'confirmed'|'unknown', formation, injuries[], suspensions[] }
 *   referee: string | null (free from the fixture object)
 *   h2h: aggregate from normalizeH2H | null
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

  // Referee is already on the matched fixture — zero extra cost.
  const referee = fixture.fixture?.referee ?? null;

  // API-Football team ids drive the head-to-head lookup (names aren't accepted).
  const apHomeId = fixture.teams?.home?.id ?? null;
  const apAwayId = fixture.teams?.away?.id ?? null;
  const h2hKey = apHomeId && apAwayId ? `${apHomeId}-${apAwayId}` : null;

  const [lineupResp, injuriesResp, h2hResp] = await Promise.all([
    _fetchJson('/fixtures/lineups', { fixture: fixtureId }, `af:lineups:${fixtureId}`),
    _fetchJson('/injuries', { fixture: fixtureId }, `af:injuries:${fixtureId}`),
    h2hKey
      ? _fetchJson('/fixtures/headtohead', { h2h: h2hKey, last: 10 }, `af:h2h:${h2hKey}`)
      : Promise.resolve(null),
  ]);

  const lineups = normalizeLineups(lineupResp ?? {}, homeName, awayName);
  const avail = normalizeAvailability(injuriesResp ?? {}, homeName, awayName);
  const h2hAgg = h2hResp ? normalizeH2H(h2hResp, homeName, awayName) : null;
  const h2h = h2hAgg && h2hAgg.meetings > 0 ? h2hAgg : null;

  const side = (s) => ({
    lineupStatus: lineups[s].confirmed ? 'confirmed' : 'unknown',
    formation: lineups[s].formation,
    injuries: avail[s].injuries,
    suspensions: avail[s].suspensions,
  });

  return {
    fixtureId,
    lineupsConfirmed: lineups.home.confirmed && lineups.away.confirmed,
    referee,
    h2h,
    home: side('home'),
    away: side('away'),
  };
}
