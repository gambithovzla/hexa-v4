/**
 * tennis-odds.js — tennis match odds via The Odds API, tour-aware.
 *
 * Isolated from the frozen MLB odds-api.js (and the NBA/NFL/NHL/Soccer modules).
 * Mirrors the dual-key handling of soccer-odds.js, but with the tennis market
 * shape:
 *
 *   - Match winner (h2h, TWO-way): player A / player B — no draw (like NHL ML).
 *   - Set handicap (spreads): ±1.5 sets. Coverage is irregular for tennis on
 *     The Odds API — exposed when present, degraded to moneyline-only otherwise.
 *   - Total games (totals): over/under total games. Same irregular coverage.
 *
 * `tour` selects the Odds API sport key via tennis-tour-map. Matching to a
 * specific match is by **player name** (no team id), normalizing "Last, First"
 * ↔ "First Last" before comparing.
 *
 * Public API:
 *   getTennisMatchOdds({ tour, date })  → cached array of normalized events
 *   matchTennisOddsToMatch(events, playerAName, playerBName)
 *   buildMarketOddsForMatch(event)  → { moneyline, setHandicap, totalGames }
 *   getTennisOddsStatus()
 */

import { getTennisTour } from './tennis-tour-map.js';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const CACHE_TTL_MS  = 5 * 60 * 1000; // 5 min

const _cache = new Map();
let _lastFetchMeta = {
  keyConfigured: Boolean(process.env.ODDS_API_KEY),
  backupKeyConfigured: Boolean(process.env.ODDS_API_BACKUP_KEY),
  cacheKey: null,
  keySlot: null,
  tour: null,
  requestedDate: null,
  events: 0,
  status: null,
  ok: null,
  error: null,
  fetchedAt: null,
  quota: null,
};

function resolveSportKey(tour) {
  const meta = getTennisTour(tour);
  return meta?.oddsApiSlug ?? null;
}

function getDateWindow(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) return null;
  const start = new Date(`${date}T00:00:00.000Z`);
  // A single tennis day plus timezone slop.
  const end = new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000);
  const iso = v => v.toISOString().replace('.000Z', 'Z');
  return { from: iso(start), to: iso(end) };
}

function getCacheKey(tour, date) {
  return `${tour}:${date ? `date:${date}` : 'upcoming'}`;
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

export function getTennisOddsStatus() {
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
    markets: 'h2h,spreads,totals',
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
 * Public: cached tennis match odds for a tour + calendar date. Never throws —
 * on failure returns `[]` and exposes the error via getTennisOddsStatus().
 */
export async function getTennisMatchOdds({ tour, date } = {}) {
  const sportKey = resolveSportKey(tour);
  if (!sportKey) {
    setLastFetchMeta({ cacheKey: null, tour, requestedDate: date, events: 0, status: 'unsupported_tour', ok: false, error: `unsupported tour: ${tour}`, quota: null });
    return [];
  }

  const primary = process.env.ODDS_API_KEY;
  const backup  = process.env.ODDS_API_BACKUP_KEY;
  const cacheKey = getCacheKey(tour, date);

  if (!primary && !backup) {
    setLastFetchMeta({ cacheKey, tour, keySlot: null, requestedDate: date, events: 0, status: 'missing_key', ok: false, error: 'ODDS_API_KEY not set', quota: null });
    return [];
  }

  const cached = _cache.get(cacheKey);
  if (cached?.data && Date.now() - cached.ts < CACHE_TTL_MS) {
    setLastFetchMeta({ cacheKey, tour, keySlot: cached.keySlot, requestedDate: date, events: cached.data.length, status: 'cache_hit', ok: true, error: null, quota: cached.quota });
    return cached.data;
  }

  const tryKey = async (apiKey, slot) => {
    try {
      const result = await fetchOdds(apiKey, sportKey, date);
      if (!result.ok) return { slot, result };
      const data = result.raw.map(normalizeEvent).filter(Boolean);
      _cache.set(cacheKey, { data, ts: Date.now(), quota: result.quota, keySlot: slot });
      setLastFetchMeta({ cacheKey, tour, keySlot: slot, requestedDate: date, events: data.length, status: result.status, ok: true, error: null, quota: result.quota });
      console.log(`[tennis-odds] ${sportKey} ${date ?? 'upcoming'}: ${data.length} events (key=${slot})`);
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
        console.warn(`[tennis-odds] primary key failed (${isOutOfCredits ? 'OUT_OF_USAGE_CREDITS' : r.error?.message ?? r.result?.status}) — trying backup`);
        const rb = await tryKey(backup, 'backup');
        if (rb.data) return rb.data;
      }
    }
    setLastFetchMeta({
      cacheKey, tour, keySlot: 'primary', requestedDate: date,
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
    cacheKey, tour, keySlot: 'backup', requestedDate: date,
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

/** Most common value (preserves the real book line); first on a tie. */
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

  // h2h: home_team/away_team are the two players (The Odds API reuses those keys)
  const h2hA = [], h2hB = [];
  const spreadLines = [], spreadAPrices = [], spreadBPrices = [];
  const totals = [], overs = [], unders = [];

  for (const book of books) {
    for (const market of book.markets ?? []) {
      switch (market.key) {
        case 'h2h':
          for (const o of market.outcomes ?? []) {
            if (o.name === event.home_team) h2hA.push(o.price);
            else if (o.name === event.away_team) h2hB.push(o.price);
          }
          break;
        case 'spreads':
          for (const o of market.outcomes ?? []) {
            if (o.name === event.home_team) { spreadAPrices.push(o.price); if (o.point != null) spreadLines.push(o.point); }
            else if (o.name === event.away_team) { spreadBPrices.push(o.price); }
          }
          break;
        case 'totals':
          for (const o of market.outcomes ?? []) {
            totals.push(o.point);
            if (o.name === 'Over') overs.push(o.price);
            else                   unders.push(o.price);
          }
          break;
      }
    }
  }

  const mlA = consensusAmerican(h2hA);
  const mlB = consensusAmerican(h2hB);
  const setLine = spreadLines.length ? mode(spreadLines) : null;
  const totLine = totals.length ? mode(totals) : null;
  if (mlA == null && mlB == null && setLine == null && totLine == null) return null;

  return {
    eventId:      event.id ?? null,
    commenceTime: event.commence_time ?? null,
    playerA:      event.home_team,
    playerB:      event.away_team,
    moneyline: { a: mlA, b: mlB },
    setHandicap: {
      line:    setLine,
      aPrice:  consensusAmerican(spreadAPrices),
      bPrice:  consensusAmerican(spreadBPrices),
    },
    totalGames: {
      line:       totLine,
      overPrice:  consensusAmerican(overs),
      underPrice: consensusAmerican(unders),
    },
  };
}

// ── Matching to a specific match ──────────────────────────────────────────────

/** Normalize "Djokovic, Novak" / "Novak Djokovic" to a word set. */
function words(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/,/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 1);
}

function overlap(a, b) {
  const wb = new Set(words(b));
  return words(a).filter(w => wb.has(w)).length;
}

/**
 * Fuzzy match a tennis event by player names. Surnames carry the signal;
 * word-overlap copes with "Last, First" vs "First Last" ordering.
 */
export function matchTennisOddsToMatch(events, playerAName, playerBName) {
  if (!Array.isArray(events) || !events.length) return null;
  if (!playerAName && !playerBName) return null;

  let best = null;
  let bestScore = -1;
  for (const ev of events) {
    // Try both orientations: our A/B may be flipped vs the book's home/away.
    const straight =
      (playerAName ? overlap(playerAName, ev.playerA) : 0) +
      (playerBName ? overlap(playerBName, ev.playerB) : 0);
    const flipped =
      (playerAName ? overlap(playerAName, ev.playerB) : 0) +
      (playerBName ? overlap(playerBName, ev.playerA) : 0);
    const score = Math.max(straight, flipped);
    if (score > bestScore) {
      bestScore = score;
      best = { ...ev, _flipped: flipped > straight };
    }
  }
  return bestScore > 0 ? best : null;
}

/**
 * Convert a matched tennis event into the `marketOdds` shape the Oracle prompt
 * expects: `{ moneyline, setHandicap, totalGames }` (match winner first).
 * Honors `_flipped` from the matcher so A/B always map to our player A/B.
 * Returns null if the event has no usable price.
 */
export function buildMarketOddsForMatch(event) {
  if (!event) return null;
  const flipped = event._flipped === true;

  const mlA = flipped ? event.moneyline.b : event.moneyline.a;
  const mlB = flipped ? event.moneyline.a : event.moneyline.b;
  const aImplied = mlA != null ? americanToImplied(mlA) * 100 : null;
  const bImplied = mlB != null ? americanToImplied(mlB) * 100 : null;
  const round1 = v => (v != null ? Math.round(v * 10) / 10 : null);

  return {
    moneyline: {
      a:        mlA,
      b:        mlB,
      aImplied: round1(aImplied),
      bImplied: round1(bImplied),
    },
    setHandicap: {
      line:   event.setHandicap.line,
      aPrice: flipped ? event.setHandicap.bPrice : event.setHandicap.aPrice,
      bPrice: flipped ? event.setHandicap.aPrice : event.setHandicap.bPrice,
    },
    totalGames: {
      line:       event.totalGames.line,
      overPrice:  event.totalGames.overPrice,
      underPrice: event.totalGames.underPrice,
    },
    source: 'oddsapi',
    eventId: event.eventId,
  };
}

export default {
  getTennisMatchOdds,
  matchTennisOddsToMatch,
  buildMarketOddsForMatch,
  getTennisOddsStatus,
};
