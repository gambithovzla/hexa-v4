/**
 * odds-api.js — The Odds API integration for H.E.X.A. V4
 *
 * Exports:
 *   getGameOdds()                               — fetch + cache MLB odds (5 min TTL)
 *   matchOddsToGame(oddsData, home, away)        — fuzzy-match a game
 *   convertOdds(americanOdds)                   — American → decimal
 *   calculatePayout(stake, americanOdds)         — compute potential payout
 */

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const CACHE_TTL_MS  = 60 * 60 * 1000; // 60 minutes
const PROP_MARKETS  = ['batter_hits', 'pitcher_strikeouts'];

const _cache = new Map();
const _propCache = new Map();
let _lastFetchMeta = {
  keyConfigured: Boolean(process.env.ODDS_API_KEY),
  cacheKey: null,
  requestedDate: null,
  events: 0,
  status: null,
  ok: null,
  error: null,
  fetchedAt: null,
  quota: null,
  rawEvents: null,
  normalizedEvents: null,
  firstEventBookmakers: null,
};

// ---------------------------------------------------------------------------
// Spring Training detection + mock odds
// ---------------------------------------------------------------------------

function isSpringTraining(date = new Date()) {
  const m = date.getMonth() + 1; // 1-indexed
  const d = date.getDate();
  const y = date.getFullYear();
  // Spring Training: March 1 – March 26 any year
  return (m === 3 && d >= 1 && d <= 26);
}

function getMockOddsForGame(homeTeam, awayTeam) {
  return {
    homeTeam,
    awayTeam,
    odds: {
      moneyline: { home: -110, away: -110 },
      runLine: {
        home: { spread: -1.5, price: 120 },
        away: { spread:  1.5, price: -140 },
      },
      overUnder: {
        total:      8.5,
        overPrice:  -110,
        underPrice: -110,
      },
    },
    source: 'estimated_spring_training',
  };
}

function normalizeDateArg(input) {
  if (!input) return null;
  if (typeof input === 'string') return input;
  return input.date ?? null;
}

function getDateWindow(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) return null;
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 36 * 60 * 60 * 1000);
  const apiIso = (value) => value.toISOString().replace('.000Z', 'Z');
  return {
    from: apiIso(start),
    to: apiIso(end),
  };
}

function getCacheKey(date) {
  return date ? `date:${date}` : 'upcoming';
}

function setLastFetchMeta(patch) {
  _lastFetchMeta = {
    ..._lastFetchMeta,
    keyConfigured: Boolean(process.env.ODDS_API_KEY),
    fetchedAt: new Date().toISOString(),
    ...patch,
  };
}

export function getOddsApiStatus() {
  return {
    ..._lastFetchMeta,
    keyConfigured: Boolean(process.env.ODDS_API_KEY),
    cachedEvents: [..._cache.values()].reduce((sum, entry) => sum + (entry.data?.length ?? 0), 0),
  };
}

// ---------------------------------------------------------------------------
// getGameOdds
// ---------------------------------------------------------------------------

/**
 * Fetches MLB moneyline / run-line / totals odds from The Odds API.
 * Results are cached for 5 minutes to conserve API quota.
 *
 * @returns {Promise<Array>} Array of normalized game odds objects
 */
export async function getGameOdds(options = {}) {
  const apiKey = process.env.ODDS_API_KEY;
  const requestedDate = normalizeDateArg(options);
  const cacheKey = getCacheKey(requestedDate);

  console.log('[odds-api] API key present:', apiKey ? `${apiKey.substring(0, 8)}...` : 'MISSING');
  console.log('[odds-api] Spring Training:', isSpringTraining());

  if (!apiKey) {
    console.warn('[odds-api] ODDS_API_KEY not set — skipping fetch');
    setLastFetchMeta({
      cacheKey,
      requestedDate,
      events: 0,
      rawEvents: null,
      normalizedEvents: null,
      firstEventBookmakers: null,
      status: 'missing_key',
      ok: false,
      error: 'ODDS_API_KEY is not configured',
      quota: null,
    });
    return [];
  }

  const cached = _cache.get(cacheKey);
  if (cached?.data && Date.now() - cached.ts < CACHE_TTL_MS) {
    console.log('[odds-api] Returning cached data:', cached.data.length, 'events', cacheKey);
    setLastFetchMeta({
      cacheKey,
      requestedDate,
      events: cached.data.length,
      rawEvents: cached.rawEvents ?? null,
      normalizedEvents: cached.normalizedEvents ?? cached.data.length,
      firstEventBookmakers: cached.firstEventBookmakers ?? null,
      status: 'cache_hit',
      ok: true,
      error: null,
      quota: cached.quota ?? null,
    });
    return cached.data;
  }

  try {
    const params = new URLSearchParams({
      apiKey,
      regions: 'us',
      markets: 'h2h,spreads,totals',
      oddsFormat: 'american',
      dateFormat: 'iso',
    });
    const window = getDateWindow(requestedDate);
    if (window) {
      params.set('commenceTimeFrom', window.from);
      params.set('commenceTimeTo', window.to);
    }
    const url = `${ODDS_API_BASE}/sports/baseball_mlb/odds/?${params.toString()}`;

    console.log('[odds-api] Fetching URL:', url.replace(apiKey, `${apiKey.substring(0, 8)}...`));

    const res = await fetch(url);
    console.log('[odds-api] Response status:', res.status, res.statusText);
    const quota = {
      remaining: res.headers.get('x-requests-remaining'),
      used: res.headers.get('x-requests-used'),
      last: res.headers.get('x-requests-last'),
    };

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[odds-api] API error ${res.status} — body: ${body.substring(0, 200)}`);
      console.warn('[odds-api] Note: The Odds API does not list Spring Training games. Returning cached data.');
      setLastFetchMeta({
        cacheKey,
        requestedDate,
        events: cached?.data?.length ?? 0,
        rawEvents: cached?.rawEvents ?? null,
        normalizedEvents: cached?.normalizedEvents ?? cached?.data?.length ?? 0,
        firstEventBookmakers: cached?.firstEventBookmakers ?? null,
        status: res.status,
        ok: false,
        error: body.substring(0, 200) || res.statusText,
        quota,
      });
      return cached?.data ?? [];
    }

    const raw  = await res.json();
    console.log('[odds-api] Raw events returned:', Array.isArray(raw) ? raw.length : 'not an array', typeof raw === 'string' ? raw.substring(0, 200) : '');

    const rawEvents = Array.isArray(raw) ? raw.length : null;
    const firstEventBookmakers = Array.isArray(raw) && raw[0]?.bookmakers
      ? raw[0].bookmakers.length
      : null;
    const data = (Array.isArray(raw) ? raw : []).map(normalizeEvent).filter(Boolean);
    console.log('[odds-api] Normalized events:', data.length);

    if (data.length === 0 && cached?.data?.length > 0) {
      // Odds API returned 0 events — all games likely started and were removed from the endpoint.
      // Keep the existing pre-game odds so picks still show real odds instead of '—'.
      // Extend the TTL so we don't hit the API again for another 60 minutes.
      console.warn(`[odds-api] 0 events returned but cache has ${cached.data.length} — preserving pre-game odds cache`);
      _cache.set(cacheKey, { ...cached, ts: Date.now() });
      setLastFetchMeta({
        cacheKey,
        requestedDate,
        events: cached.data.length,
        rawEvents,
        normalizedEvents: cached.data.length,
        firstEventBookmakers,
        status: 'empty_preserved_cache',
        ok: true,
        error: null,
        quota,
      });
      return cached.data;
    }

    if (data.length === 0) {
      console.warn('[odds-api] 0 events returned — likely all games started or Spring Training');
    }

    _cache.set(cacheKey, { data, ts: Date.now(), quota, rawEvents, normalizedEvents: data.length, firstEventBookmakers });
    setLastFetchMeta({
      cacheKey,
      requestedDate,
      events: data.length,
      rawEvents,
      normalizedEvents: data.length,
      firstEventBookmakers,
      status: res.status,
      ok: true,
      error: null,
      quota,
    });
    return data;
  } catch (err) {
    console.error('[odds-api] fetch error:', err.message);
    setLastFetchMeta({
      cacheKey,
      requestedDate,
      events: cached?.data?.length ?? 0,
      rawEvents: cached?.rawEvents ?? null,
      normalizedEvents: cached?.normalizedEvents ?? cached?.data?.length ?? 0,
      firstEventBookmakers: cached?.firstEventBookmakers ?? null,
      status: 'fetch_error',
      ok: false,
      error: err.message,
      quota: cached?.quota ?? null,
    });
    return cached?.data ?? [];
  }
}

export async function hydrateOddsForGame(oddsData) {
  const apiKey = process.env.ODDS_API_KEY;
  if (!oddsData || oddsData.source === 'estimated_spring_training') return oddsData;
  if (oddsData.playerProps) return oddsData;
  if (!oddsData.eventId || !apiKey) return oddsData;

  const cached = _propCache.get(oddsData.eventId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { ...oddsData, playerProps: cached.data };
  }

  try {
    const url =
      `${ODDS_API_BASE}/sports/baseball_mlb/events/${encodeURIComponent(oddsData.eventId)}/odds?` +
      `apiKey=${apiKey}&regions=us&markets=${PROP_MARKETS.join(',')}&oddsFormat=american&dateFormat=iso`;

    console.log('[odds-api] Fetching event props:', url.replace(apiKey, `${apiKey.substring(0, 8)}...`));
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[odds-api] props error ${res.status} for ${oddsData.awayTeam} @ ${oddsData.homeTeam}: ${body.substring(0, 160)}`);
      return oddsData;
    }

    const event = await res.json();
    const playerProps = normalizePlayerProps(event);
    _propCache.set(oddsData.eventId, { ts: Date.now(), data: playerProps });
    return { ...oddsData, playerProps };
  } catch (err) {
    console.error('[odds-api] props fetch error:', err.message);
    return oddsData;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function americanToImplied(americanOdds) {
  const n = Number(americanOdds);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0
    ? 100 / (n + 100)
    : Math.abs(n) / (Math.abs(n) + 100);
}

function impliedToAmerican(probability) {
  const p = Number(probability);
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null;
  if (p >= 0.5) return -Math.round((p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

function consensusAmerican(prices) {
  const implied = prices
    .map(americanToImplied)
    .filter(p => p != null);
  if (!implied.length) return null;
  return impliedToAmerican(avg(implied));
}

function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePropDirection(value) {
  const name = normalizeName(value);
  if (name === 'over' || name === 'o') return 'over';
  if (name === 'under' || name === 'u') return 'under';
  return null;
}

function normalizePlayerProps(event) {
  const grouped = new Map();
  const books = event?.bookmakers ?? [];

  for (const book of books) {
    for (const market of book.markets ?? []) {
      if (!PROP_MARKETS.includes(market.key)) continue;
      for (const outcome of market.outcomes ?? []) {
        const direction = normalizePropDirection(outcome.name);
        const point = Number(outcome.point);
        const price = Number(outcome.price);
        const playerName = String(
          outcome.description ??
          outcome.participant ??
          outcome.player ??
          '',
        ).trim();

        if (!direction || !playerName || !Number.isFinite(point) || !Number.isFinite(price)) continue;

        const key = `${market.key}::${normalizeName(playerName)}::${direction}::${point}`;
        const existing = grouped.get(key) ?? {
          marketKey: market.key,
          playerName,
          normalizedPlayerName: normalizeName(playerName),
          direction,
          line: point,
          prices: [],
          books: [],
        };
        existing.prices.push(price);
        existing.books.push(book.key ?? book.title ?? 'book');
        grouped.set(key, existing);
      }
    }
  }

  const playerProps = {};
  for (const entry of grouped.values()) {
    const offer = {
      playerName: entry.playerName,
      normalizedPlayerName: entry.normalizedPlayerName,
      direction: entry.direction,
      line: entry.line,
      price: Math.round(avg(entry.prices)),
      books: entry.books,
    };
    if (!playerProps[entry.marketKey]) playerProps[entry.marketKey] = [];
    playerProps[entry.marketKey].push(offer);
  }

  for (const marketKey of Object.keys(playerProps)) {
    playerProps[marketKey].sort((a, b) =>
      a.normalizedPlayerName.localeCompare(b.normalizedPlayerName) ||
      a.line - b.line ||
      a.direction.localeCompare(b.direction)
    );
  }

  return playerProps;
}

/**
 * Normalizes a raw Odds API event into H.E.X.A.'s internal format.
 * Averages the top-3 bookmakers to smooth line discrepancies.
 */
function normalizeEvent(event) {
  if (!event?.bookmakers?.length) return null;

  const books = event.bookmakers.slice(0, 3);

  const mlHome = [], mlAway = [];
  const rlHomeSpread = [], rlHomePrice = [], rlAwaySpread = [], rlAwayPrice = [];
  const ouTotal = [], ouOver = [], ouUnder = [];

  for (const book of books) {
    for (const market of book.markets ?? []) {
      switch (market.key) {
        case 'h2h':
          for (const o of market.outcomes ?? []) {
            if (o.name === event.home_team) mlHome.push(o.price);
            else mlAway.push(o.price);
          }
          break;
        case 'spreads':
          for (const o of market.outcomes ?? []) {
            if (o.name === event.home_team) {
              rlHomeSpread.push(o.point);
              rlHomePrice.push(o.price);
            } else {
              rlAwaySpread.push(o.point);
              rlAwayPrice.push(o.price);
            }
          }
          break;
        case 'totals':
          for (const o of market.outcomes ?? []) {
            ouTotal.push(o.point);
            if (o.name === 'Over') ouOver.push(o.price);
            else ouUnder.push(o.price);
          }
          break;
      }
    }
  }

  const mlHomeConsensus = consensusAmerican(mlHome);
  const mlAwayConsensus = consensusAmerican(mlAway);
  if (mlHomeConsensus == null && mlAwayConsensus == null) return null;

  return {
    eventId: event.id ?? null,
    commenceTime: event.commence_time ?? null,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    odds: {
      moneyline: {
        home: mlHomeConsensus,
        away: mlAwayConsensus,
      },
      runLine: {
        home: {
          spread: rlHomeSpread.length ? +(avg(rlHomeSpread).toFixed(1)) : null,
          price:  consensusAmerican(rlHomePrice),
        },
        away: {
          spread: rlAwaySpread.length ? +(avg(rlAwaySpread).toFixed(1)) : null,
          price:  consensusAmerican(rlAwayPrice),
        },
      },
      overUnder: {
        total:      ouTotal.length  ? +(avg(ouTotal).toFixed(1))  : null,
        overPrice:  consensusAmerican(ouOver),
        underPrice: consensusAmerican(ouUnder),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Exported utilities
// ---------------------------------------------------------------------------

/**
 * Fuzzy-matches an odds data array to a specific game by team names.
 * Handles variations between MLB Stats API and The Odds API team naming.
 *
 * @param {Array}  oddsData      — result from getGameOdds()
 * @param {string} homeTeamName  — home team full name from MLB Stats API
 * @param {string} awayTeamName  — away team full name from MLB Stats API
 * @returns {object|null}
 */
export function matchOddsToGame(oddsData, homeTeamName, awayTeamName) {
  if (!homeTeamName || !awayTeamName) return null;

  if (oddsData?.length) {
    const words = (s) =>
      String(s).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).filter(w => w.length > 2);

    const overlap = (a, b) => {
      const wb = new Set(words(b));
      return words(a).filter(w => wb.has(w)).length;
    };

    let best = null, bestScore = -1;
    for (const event of oddsData) {
      const score = overlap(homeTeamName, event.homeTeam) + overlap(awayTeamName, event.awayTeam);
      if (score > bestScore) { bestScore = score; best = event; }
    }

    if (bestScore > 0) return best;
  }

  // Fallback: return estimated mock odds during Spring Training
  if (isSpringTraining()) {
    console.log(`[odds-api] No real odds found for ${awayTeamName} @ ${homeTeamName} — using Spring Training estimated lines`);
    return getMockOddsForGame(homeTeamName, awayTeamName);
  }

  return null;
}

/**
 * Converts American odds to implied probability (as a percentage).
 *   Positive: implied% = 100 / (n + 100)
 *   Negative: implied% = |n| / (|n| + 100)
 *
 * @param {number} americanOdds
 * @returns {number|null}  e.g. 56.5 for -130
 */
export function calculateImpliedProbability(americanOdds) {
  const n = Number(americanOdds);
  if (!isFinite(n) || n === 0) return null;
  const prob = n > 0
    ? 100 / (n + 100)
    : Math.abs(n) / (Math.abs(n) + 100);
  return Math.round(prob * 1000) / 10; // one decimal place
}

/**
 * Converts American odds to decimal format.
 *   Positive: decimal = (american / 100) + 1
 *   Negative: decimal = (100 / |american|) + 1
 *
 * @param {number} americanOdds
 * @returns {number|null}
 */
export function convertOdds(americanOdds) {
  const n = Number(americanOdds);
  if (!isFinite(n) || n === 0) return null;
  return n > 0 ? (n / 100) + 1 : (100 / Math.abs(n)) + 1;
}

/**
 * Calculates potential payout for a given stake and American odds.
 *   Positive: profit = stake × (american / 100)
 *   Negative: profit = stake × (100 / |american|)
 *
 * @param {number} stake
 * @param {number} americanOdds
 * @returns {{ stake: number, profit: number, totalPayout: number }|null}
 */
export function calculatePayout(stake, americanOdds) {
  const s = Number(stake);
  const n = Number(americanOdds);
  if (!isFinite(s) || !isFinite(n) || s <= 0 || n === 0) return null;

  const profit = n > 0 ? s * (n / 100) : s * (100 / Math.abs(n));
  return {
    stake,
    profit:      Math.round(profit * 100) / 100,
    totalPayout: Math.round((s + profit) * 100) / 100,
  };
}
