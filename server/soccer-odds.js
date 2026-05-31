/**
 * soccer-odds.js — soccer market odds via The Odds API, league-aware.
 *
 * Isolated from the frozen MLB odds-api.js (and NBA/NFL/NHL modules). Mirrors the
 * dual-key handling of nhl-odds.js, but with the soccer market shape:
 *
 *   - 1X2 (h2h THREE-way): Home / Draw / Away — the Draw is a real outcome with
 *     ~25-30% probability, never a push. We carry all three prices.
 *   - Totals: over/under goals (most common line 2.5). Taken by MODE so we keep
 *     the real book line rather than averaging 2.5 and 3.0 into 2.75.
 *   - BTTS (both teams to score): popular binary market, key `btts`.
 *
 * `leagueSlug` selects the Odds API sport key via soccer-league-map. One module
 * covers all six leagues.
 *
 * Public API:
 *   getSoccerGameOdds({ leagueSlug, date })  → cached array of normalized events
 *   matchSoccerOddsToGame(events, homeTeamName, awayTeamName)
 *   buildMarketOddsForGame(event)  → { threeWay, total, btts }
 *   getSoccerOddsStatus()
 */

import { getSoccerLeague } from './soccer-league-map.js';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const CACHE_TTL_MS  = 5 * 60 * 1000; // 5 min

const _cache = new Map();
let _lastFetchMeta = {
  keyConfigured: Boolean(process.env.ODDS_API_KEY),
  backupKeyConfigured: Boolean(process.env.ODDS_API_BACKUP_KEY),
  cacheKey: null,
  keySlot: null,
  league: null,
  requestedDate: null,
  events: 0,
  status: null,
  ok: null,
  error: null,
  fetchedAt: null,
  quota: null,
};

function resolveSportKey(leagueSlug) {
  const meta = getSoccerLeague(leagueSlug);
  return meta?.oddsApiSlug ?? null;
}

function getDateWindow(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) return null;
  const start = new Date(`${date}T00:00:00.000Z`);
  // Soccer leagues span weekends with timezone slop; a 2-day window is enough.
  const end = new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000);
  const iso = v => v.toISOString().replace('.000Z', 'Z');
  return { from: iso(start), to: iso(end) };
}

function getCacheKey(leagueSlug, date) {
  return `${leagueSlug}:${date ? `date:${date}` : 'upcoming'}`;
}

function setLastFetchMeta(patch) {
  _lastFetchMeta = {
    ..._lastFetchMeta,
    keyConfigured: Boolean(process.env.ODDS_API_KEY),
    backupKeyConfigured: Boolean(process.env.ODDS_API_BACKUP_KEY),
    fetchedAt: new Date().toISOString(),
    ...patch,
  };
}

export function getSoccerOddsStatus() {
  return {
    ..._lastFetchMeta,
    keyConfigured: Boolean(process.env.ODDS_API_KEY),
    backupKeyConfigured: Boolean(process.env.ODDS_API_BACKUP_KEY),
    cachedEvents: [..._cache.values()].reduce((n, e) => n + (e.data?.length ?? 0), 0),
  };
}

async function fetchOdds(apiKey, sportKey, requestedDate) {
  const params = new URLSearchParams({
    apiKey,
    regions: 'us,uk,eu',
    markets: 'h2h,totals,btts',
    oddsFormat: 'american',
    dateFormat: 'iso',
  });
  const window = getDateWindow(requestedDate);
  if (window) {
    params.set('commenceTimeFrom', window.from);
    params.set('commenceTimeTo',   window.to);
  }
  const url = `${ODDS_API_BASE}/sports/${sportKey}/odds/?${params.toString()}`;
  const res = await fetch(url);
  const quota = {
    remaining: res.headers.get('x-requests-remaining'),
    used:      res.headers.get('x-requests-used'),
    last:      res.headers.get('x-requests-last'),
  };
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, status: res.status, body, quota };
  }
  const raw = await res.json();
  return { ok: true, status: res.status, raw: Array.isArray(raw) ? raw : [], quota };
}

/**
 * Public: cached soccer market odds for a league + calendar date. Never throws —
 * on failure returns `[]` and exposes the error via getSoccerOddsStatus().
 */
export async function getSoccerGameOdds({ leagueSlug, date } = {}) {
  const sportKey = resolveSportKey(leagueSlug);
  if (!sportKey) {
    setLastFetchMeta({ cacheKey: null, league: leagueSlug, requestedDate: date, events: 0, status: 'unsupported_league', ok: false, error: `unsupported league: ${leagueSlug}`, quota: null });
    return [];
  }

  const primary = process.env.ODDS_API_KEY;
  const backup  = process.env.ODDS_API_BACKUP_KEY;
  const cacheKey = getCacheKey(leagueSlug, date);

  if (!primary && !backup) {
    setLastFetchMeta({ cacheKey, league: leagueSlug, keySlot: null, requestedDate: date, events: 0, status: 'missing_key', ok: false, error: 'ODDS_API_KEY not set', quota: null });
    return [];
  }

  const cached = _cache.get(cacheKey);
  if (cached?.data && Date.now() - cached.ts < CACHE_TTL_MS) {
    setLastFetchMeta({ cacheKey, league: leagueSlug, keySlot: cached.keySlot, requestedDate: date, events: cached.data.length, status: 'cache_hit', ok: true, error: null, quota: cached.quota });
    return cached.data;
  }

  const tryKey = async (apiKey, slot) => {
    try {
      const result = await fetchOdds(apiKey, sportKey, date);
      if (!result.ok) return { slot, result };
      const data = result.raw.map(normalizeEvent).filter(Boolean);
      _cache.set(cacheKey, { data, ts: Date.now(), quota: result.quota, keySlot: slot });
      setLastFetchMeta({ cacheKey, league: leagueSlug, keySlot: slot, requestedDate: date, events: data.length, status: result.status, ok: true, error: null, quota: result.quota });
      console.log(`[soccer-odds] ${sportKey} ${date ?? 'upcoming'}: ${data.length} events (key=${slot})`);
      return { slot, data };
    } catch (err) {
      return { slot, error: err };
    }
  };

  if (primary) {
    const r = await tryKey(primary, 'primary');
    if (r.data) return r.data;
    if (backup && backup !== primary) {
      const body = r.result?.body ?? '';
      const isOutOfCredits = typeof body === 'string' && body.includes('OUT_OF_USAGE_CREDITS');
      if (isOutOfCredits || r.error) {
        console.warn(`[soccer-odds] primary key failed (${isOutOfCredits ? 'OUT_OF_USAGE_CREDITS' : r.error?.message ?? r.result?.status}) — trying backup`);
        const rb = await tryKey(backup, 'backup');
        if (rb.data) return rb.data;
      }
    }
    setLastFetchMeta({
      cacheKey, league: leagueSlug, keySlot: 'primary', requestedDate: date,
      events: cached?.data?.length ?? 0,
      status: r.result?.status ?? 'fetch_error', ok: false,
      error: r.error?.message ?? (typeof r.result?.body === 'string' ? r.result.body.substring(0, 200) : null),
      quota: r.result?.quota ?? null,
    });
    return cached?.data ?? [];
  }

  const rb = await tryKey(backup, 'backup');
  if (rb.data) return rb.data;
  setLastFetchMeta({
    cacheKey, league: leagueSlug, keySlot: 'backup', requestedDate: date,
    events: cached?.data?.length ?? 0,
    status: rb.result?.status ?? 'fetch_error', ok: false,
    error: rb.error?.message ?? (typeof rb.result?.body === 'string' ? rb.result.body.substring(0, 200) : null),
    quota: rb.result?.quota ?? null,
  });
  return cached?.data ?? [];
}

// ── Normalisation ─────────────────────────────────────────────────────────────

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/** Most common value (preserves the real book total line); first on a tie. */
function mode(arr) {
  if (!arr.length) return null;
  const counts = new Map();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = arr[0], bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) { bestN = n; best = v; }
  }
  return best;
}

function americanToImplied(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

function impliedToAmerican(p) {
  const x = Number(p);
  if (!Number.isFinite(x) || x <= 0 || x >= 1) return null;
  return x >= 0.5 ? -Math.round((x / (1 - x)) * 100) : Math.round(((1 - x) / x) * 100);
}

function consensusAmerican(prices) {
  const implied = prices.map(americanToImplied).filter(v => v != null);
  if (!implied.length) return null;
  return impliedToAmerican(avg(implied));
}

function normalizeEvent(event) {
  if (!event?.bookmakers?.length) return null;
  const books = event.bookmakers.slice(0, 4);

  const h2hHome = [], h2hAway = [], h2hDraw = [];
  const totals = [], overs = [], unders = [];
  const bttsYes = [], bttsNo = [];

  for (const book of books) {
    for (const market of book.markets ?? []) {
      switch (market.key) {
        case 'h2h':
          for (const o of market.outcomes ?? []) {
            const name = String(o.name ?? '').toLowerCase();
            if (o.name === event.home_team) h2hHome.push(o.price);
            else if (o.name === event.away_team) h2hAway.push(o.price);
            else if (name === 'draw') h2hDraw.push(o.price);
          }
          break;
        case 'totals':
          for (const o of market.outcomes ?? []) {
            totals.push(o.point);
            if (o.name === 'Over') overs.push(o.price);
            else                   unders.push(o.price);
          }
          break;
        case 'btts':
          for (const o of market.outcomes ?? []) {
            const name = String(o.name ?? '').toLowerCase();
            if (name === 'yes') bttsYes.push(o.price);
            else if (name === 'no') bttsNo.push(o.price);
          }
          break;
      }
    }
  }

  const h2hH = consensusAmerican(h2hHome);
  const h2hA = consensusAmerican(h2hAway);
  const h2hD = consensusAmerican(h2hDraw);
  const totLine = totals.length ? mode(totals) : null;
  if (h2hH == null && h2hA == null && h2hD == null && totLine == null) return null;

  return {
    eventId:      event.id ?? null,
    commenceTime: event.commence_time ?? null,
    homeTeam:     event.home_team,
    awayTeam:     event.away_team,
    threeWay: { home: h2hH, draw: h2hD, away: h2hA },
    total: {
      line:       totLine,
      overPrice:  consensusAmerican(overs),
      underPrice: consensusAmerican(unders),
    },
    btts: {
      yes: consensusAmerican(bttsYes),
      no:  consensusAmerican(bttsNo),
    },
  };
}

// ── Matching to a specific game ───────────────────────────────────────────────

function words(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function overlap(a, b) {
  const wb = new Set(words(b));
  return words(a).filter(w => wb.has(w)).length;
}

/**
 * Fuzzy match a soccer event by team names. Accepts canonical names
 * ("Manchester United") or short names ("Man United") — word-overlap copes with
 * both. Caller should pass canonical names from soccer-team-map when possible.
 */
export function matchSoccerOddsToGame(events, homeTeamName, awayTeamName) {
  if (!Array.isArray(events) || !events.length) return null;
  if (!homeTeamName && !awayTeamName) return null;

  let best = null;
  let bestScore = -1;
  for (const ev of events) {
    const score =
      (homeTeamName ? overlap(homeTeamName, ev.homeTeam) : 0) +
      (awayTeamName ? overlap(awayTeamName, ev.awayTeam) : 0);
    if (score > bestScore) { bestScore = score; best = ev; }
  }
  return bestScore > 0 ? best : null;
}

/**
 * Convert a matched soccer event into the `marketOdds` shape the Oracle prompt
 * expects: `{ threeWay, total, btts }` (1X2 first — soccer primary market).
 * Returns null if the event has no usable price.
 */
export function buildMarketOddsForGame(event) {
  if (!event) return null;
  const homeImplied = event.threeWay.home != null ? americanToImplied(event.threeWay.home) * 100 : null;
  const drawImplied = event.threeWay.draw != null ? americanToImplied(event.threeWay.draw) * 100 : null;
  const awayImplied = event.threeWay.away != null ? americanToImplied(event.threeWay.away) * 100 : null;

  const round1 = v => (v != null ? Math.round(v * 10) / 10 : null);

  return {
    threeWay: {
      home:        event.threeWay.home,
      draw:        event.threeWay.draw,
      away:        event.threeWay.away,
      homeImplied: round1(homeImplied),
      drawImplied: round1(drawImplied),
      awayImplied: round1(awayImplied),
    },
    total: {
      line:       event.total.line,
      overPrice:  event.total.overPrice,
      underPrice: event.total.underPrice,
    },
    btts: {
      yes: event.btts.yes,
      no:  event.btts.no,
    },
    source: 'oddsapi',
    eventId: event.eventId,
  };
}
