/**
 * odds-api.js — The Odds API integration for H.E.X.A. V4
 *
 * Exports:
 *   getGameOdds()                               — fetch + cache MLB odds (5 min TTL)
 *   matchOddsToGame(oddsData, home, away)        — fuzzy-match a game
 *   convertOdds(americanOdds)                   — American → decimal
 *   calculatePayout(stake, americanOdds)         — compute potential payout
 */

import { loadCachedOdds, saveCachedOdds } from './odds-cache.js';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const CACHE_TTL_MS  = 60 * 60 * 1000; // 60 minutes
// Optional: filter to a specific bookmaker (e.g. 'bet365') instead of taking
// consensus across a US region. When set, ALL fetchers (main, alts, props)
// pass `bookmakers=<value>` to The Odds API and skip the `regions` param —
// you read the exact prices that book shows on its site. Common values:
//   bet365 / pinnacle / williamhill / unibet / betfair
// Leave empty for the default (regions=us + consensus across top books).
const ODDS_API_BOOKMAKER = (process.env.ODDS_API_BOOKMAKER ?? '').trim().toLowerCase();
// When using a non-US book (Bet365 lives in uk/eu), the Odds API still
// accepts the bookmakers param without regions — but we may need to set
// regions to widen the search if a bookmaker isn't found. Configurable.
const ODDS_API_REGIONS = (process.env.ODDS_API_REGIONS ?? '').trim().toLowerCase() ||
  (ODDS_API_BOOKMAKER ? 'us,uk,eu,au' : 'us');
const PROP_MARKETS  = [
  'batter_hits',
  'pitcher_strikeouts',
  'batter_total_bases',
  'batter_home_runs',
  'batter_rbis',
];

// Extended menus fetched on-demand (per-event) for Imperdible / Safe /
// Parlay / Oracle. Quota cost is real — these are only fetched when a
// consumer explicitly asks, and the result is shared via Postgres cache.
const ALT_GAME_MARKETS = [
  'alternate_spreads',
  'alternate_totals',
  'team_totals',
  'alternate_team_totals',
];

const EXTENDED_PROP_MARKETS = [
  'batter_hits',
  'batter_hits_alternate',
  'batter_total_bases',
  'batter_total_bases_alternate',
  'batter_home_runs',
  'batter_home_runs_alternate',
  'batter_rbis',
  'batter_rbis_alternate',
  'batter_runs_scored',
  'batter_runs_scored_alternate',
  'batter_strikeouts',
  'batter_strikeouts_alternate',
  'pitcher_strikeouts',
  'pitcher_strikeouts_alternate',
  'pitcher_record_a_win',
  'pitcher_hits_allowed',
  'pitcher_outs',
  'pitcher_earned_runs',
  'pitcher_walks',
];

const _cache = new Map();
const _propCache = new Map();
let _lastFetchMeta = {
  keyConfigured: Boolean(process.env.ODDS_API_KEY),
  backupKeyConfigured: Boolean(process.env.ODDS_API_BACKUP_KEY),
  keySlot: null,
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
    backupKeyConfigured: Boolean(process.env.ODDS_API_BACKUP_KEY),
    fetchedAt: new Date().toISOString(),
    ...patch,
  };
}

/**
 * Append the bookmaker / regions params to a URLSearchParams instance.
 * If ODDS_API_BOOKMAKER is set, both `regions` and `bookmakers` are sent —
 * regions widens the search across markets the book serves, bookmakers
 * filters to only that book. If not set, defaults to regions=us only.
 */
function applyBookmakerParams(params) {
  params.set('regions', ODDS_API_REGIONS);
  if (ODDS_API_BOOKMAKER) {
    params.set('bookmakers', ODDS_API_BOOKMAKER);
  }
  return params;
}

export function getOddsApiStatus() {
  return {
    ..._lastFetchMeta,
    keyConfigured: Boolean(process.env.ODDS_API_KEY),
    backupKeyConfigured: Boolean(process.env.ODDS_API_BACKUP_KEY),
    bookmaker: ODDS_API_BOOKMAKER || null,
    regions: ODDS_API_REGIONS,
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
  const primaryApiKey = process.env.ODDS_API_KEY;
  const backupApiKey = process.env.ODDS_API_BACKUP_KEY;
  let apiKey = primaryApiKey || backupApiKey;
  let keySlot = primaryApiKey ? 'primary' : 'backup';
  const requestedDate = normalizeDateArg(options);
  const cacheKey = getCacheKey(requestedDate);

  console.log('[odds-api] API key present:', apiKey ? `${keySlot}:${apiKey.substring(0, 8)}...` : 'MISSING');
  console.log('[odds-api] Spring Training:', isSpringTraining());

  if (!apiKey) {
    console.warn('[odds-api] ODDS_API_KEY not set — skipping fetch');
    setLastFetchMeta({
      cacheKey,
      keySlot: null,
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
      keySlot: cached.keySlot ?? null,
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
    const params = applyBookmakerParams(new URLSearchParams({
      apiKey,
      markets: 'h2h,spreads,totals',
      oddsFormat: 'american',
      dateFormat: 'iso',
    }));
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
      const retryBackupFullMarkets = async () => {
        if (!backupApiKey || backupApiKey === apiKey || !body.includes('OUT_OF_USAGE_CREDITS')) return null;
        console.warn('[odds-api] Primary key is out of usage credits; retrying full markets with backup key');
        const backupParams = applyBookmakerParams(new URLSearchParams({
          apiKey: backupApiKey,
          markets: 'h2h,spreads,totals',
          oddsFormat: 'american',
          dateFormat: 'iso',
        }));
        const window = getDateWindow(requestedDate);
        if (window) {
          backupParams.set('commenceTimeFrom', window.from);
          backupParams.set('commenceTimeTo', window.to);
        }
        const backupUrl = `${ODDS_API_BASE}/sports/baseball_mlb/odds/?${backupParams.toString()}`;
        const backupRes = await fetch(backupUrl);
        const backupQuota = {
          remaining: backupRes.headers.get('x-requests-remaining'),
          used: backupRes.headers.get('x-requests-used'),
          last: backupRes.headers.get('x-requests-last'),
        };
        if (!backupRes.ok) return null;

        const backupRaw = await backupRes.json();
        const backupRawEvents = Array.isArray(backupRaw) ? backupRaw.length : null;
        const backupFirstEventBookmakers = Array.isArray(backupRaw) && backupRaw[0]?.bookmakers
          ? backupRaw[0].bookmakers.length
          : null;
        const backupData = (Array.isArray(backupRaw) ? backupRaw : []).map(normalizeEvent).filter(Boolean);
        _cache.set(cacheKey, {
          data: backupData,
          ts: Date.now(),
          quota: backupQuota,
          rawEvents: backupRawEvents,
          normalizedEvents: backupData.length,
          firstEventBookmakers: backupFirstEventBookmakers,
          markets: 'h2h,spreads,totals',
          keySlot: 'backup',
        });
        setLastFetchMeta({
          cacheKey,
          keySlot: 'backup',
          requestedDate,
          events: backupData.length,
          rawEvents: backupRawEvents,
          normalizedEvents: backupData.length,
          firstEventBookmakers: backupFirstEventBookmakers,
          status: backupRes.status,
          ok: true,
          error: null,
          quota: backupQuota,
          markets: 'h2h,spreads,totals',
          fallbackReason: 'primary_out_of_usage_credits',
        });
        return backupData;
      };
      const backupFullMarketData = await retryBackupFullMarkets();
      if (backupFullMarketData) return backupFullMarketData;
      const retryMoneylineOnly = async () => {
        if (!body.includes('OUT_OF_USAGE_CREDITS') || Number(quota.remaining) < 1) return null;
        console.warn('[odds-api] Remaining quota cannot cover h2h+spreads+totals; retrying with h2h moneyline only');
        const fallbackParams = applyBookmakerParams(new URLSearchParams({
          apiKey,
          markets: 'h2h',
          oddsFormat: 'american',
          dateFormat: 'iso',
        }));
        const window = getDateWindow(requestedDate);
        if (window) {
          fallbackParams.set('commenceTimeFrom', window.from);
          fallbackParams.set('commenceTimeTo', window.to);
        }
        const fallbackUrl = `${ODDS_API_BASE}/sports/baseball_mlb/odds/?${fallbackParams.toString()}`;
        const fallbackRes = await fetch(fallbackUrl);
        const fallbackQuota = {
          remaining: fallbackRes.headers.get('x-requests-remaining'),
          used: fallbackRes.headers.get('x-requests-used'),
          last: fallbackRes.headers.get('x-requests-last'),
        };
        if (!fallbackRes.ok) return null;

        const fallbackRaw = await fallbackRes.json();
        const fallbackRawEvents = Array.isArray(fallbackRaw) ? fallbackRaw.length : null;
        const fallbackFirstEventBookmakers = Array.isArray(fallbackRaw) && fallbackRaw[0]?.bookmakers
          ? fallbackRaw[0].bookmakers.length
          : null;
        const fallbackData = (Array.isArray(fallbackRaw) ? fallbackRaw : []).map(normalizeEvent).filter(Boolean);
        _cache.set(cacheKey, {
          data: fallbackData,
          ts: Date.now(),
          quota: fallbackQuota,
          rawEvents: fallbackRawEvents,
          normalizedEvents: fallbackData.length,
          firstEventBookmakers: fallbackFirstEventBookmakers,
          markets: 'h2h',
          keySlot,
        });
        setLastFetchMeta({
          cacheKey,
          keySlot,
          requestedDate,
          events: fallbackData.length,
          rawEvents: fallbackRawEvents,
          normalizedEvents: fallbackData.length,
          firstEventBookmakers: fallbackFirstEventBookmakers,
          status: fallbackRes.status,
          ok: true,
          error: null,
          quota: fallbackQuota,
          markets: 'h2h',
          partialMarkets: true,
        });
        return fallbackData;
      };
      const moneylineOnlyData = await retryMoneylineOnly();
      if (moneylineOnlyData) return moneylineOnlyData;
      console.warn(`[odds-api] API error ${res.status} — body: ${body.substring(0, 200)}`);
      console.warn('[odds-api] Note: The Odds API does not list Spring Training games. Returning cached data.');
      setLastFetchMeta({
        cacheKey,
        keySlot,
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
        keySlot: cached.keySlot ?? keySlot,
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

    _cache.set(cacheKey, { data, ts: Date.now(), quota, rawEvents, normalizedEvents: data.length, firstEventBookmakers, keySlot });
    setLastFetchMeta({
      cacheKey,
      keySlot,
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
      keySlot: cached?.keySlot ?? keySlot,
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
    const params = applyBookmakerParams(new URLSearchParams({
      apiKey,
      markets: PROP_MARKETS.join(','),
      oddsFormat: 'american',
      dateFormat: 'iso',
    }));
    const url = `${ODDS_API_BASE}/sports/baseball_mlb/events/${encodeURIComponent(oddsData.eventId)}/odds?${params.toString()}`;

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
    perBook: {
      bookCount: books.length,
      mlHome,
      mlAway,
      totals: ouTotal,
    },
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

// ---------------------------------------------------------------------------
// Extended market fetchers (alt lines + team totals + full props menu)
// ---------------------------------------------------------------------------

function pickApiKey() {
  const primary = process.env.ODDS_API_KEY;
  const backup = process.env.ODDS_API_BACKUP_KEY;
  if (primary) return { key: primary, slot: 'primary', backup };
  if (backup) return { key: backup, slot: 'backup', backup: null };
  return null;
}

async function fetchEventMarketsRaw({ eventId, marketsList, apiKey }) {
  const params = applyBookmakerParams(new URLSearchParams({
    apiKey,
    markets: marketsList.join(','),
    oddsFormat: 'american',
    dateFormat: 'iso',
  }));
  const url = `${ODDS_API_BASE}/sports/baseball_mlb/events/${encodeURIComponent(eventId)}/odds?${params.toString()}`;
  const res = await fetch(url);
  const quota = {
    remaining: res.headers.get('x-requests-remaining'),
    used: res.headers.get('x-requests-used'),
    last: res.headers.get('x-requests-last'),
  };
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, status: res.status, body, quota };
  }
  const event = await res.json();
  return { ok: true, status: res.status, event, quota };
}

function normalizeAlternateGameLines(event) {
  const homeTeam = event?.home_team;
  const awayTeam = event?.away_team;
  if (!homeTeam || !awayTeam) return null;

  // Aggregate consensus by (market, side, line). Up to 3 books per offer.
  const altSpreads = new Map();  // key: side|line  → { prices: [] }
  const altTotals = new Map();   // key: direction|line
  const teamTotals = new Map();  // key: teamSide|direction|line  (incl. alt_team_totals)

  for (const book of (event.bookmakers ?? []).slice(0, 6)) {
    for (const market of book.markets ?? []) {
      const key = market.key;
      if (key === 'alternate_spreads') {
        for (const o of market.outcomes ?? []) {
          const point = Number(o.point);
          const price = Number(o.price);
          if (!Number.isFinite(point) || !Number.isFinite(price)) continue;
          const side = o.name === homeTeam ? 'home' : (o.name === awayTeam ? 'away' : null);
          if (!side) continue;
          const k = `${side}|${point}`;
          const entry = altSpreads.get(k) ?? { side, line: point, prices: [] };
          entry.prices.push(price);
          altSpreads.set(k, entry);
        }
      } else if (key === 'alternate_totals') {
        for (const o of market.outcomes ?? []) {
          const point = Number(o.point);
          const price = Number(o.price);
          if (!Number.isFinite(point) || !Number.isFinite(price)) continue;
          const dir = normalizePropDirection(o.name);
          if (!dir) continue;
          const k = `${dir}|${point}`;
          const entry = altTotals.get(k) ?? { direction: dir, line: point, prices: [] };
          entry.prices.push(price);
          altTotals.set(k, entry);
        }
      } else if (key === 'team_totals' || key === 'alternate_team_totals') {
        for (const o of market.outcomes ?? []) {
          const point = Number(o.point);
          const price = Number(o.price);
          if (!Number.isFinite(point) || !Number.isFinite(price)) continue;
          const dir = normalizePropDirection(o.name);
          if (!dir) continue;
          // The team is in 'description' for team_totals markets
          const teamName = String(o.description ?? '').trim();
          if (!teamName) continue;
          const teamSide = teamName === homeTeam ? 'home' : (teamName === awayTeam ? 'away' : null);
          if (!teamSide) continue;
          const k = `${teamSide}|${dir}|${point}`;
          const entry = teamTotals.get(k) ?? { teamSide, direction: dir, line: point, prices: [] };
          entry.prices.push(price);
          teamTotals.set(k, entry);
        }
      }
    }
  }

  const finalize = (map, fields) => [...map.values()].map((e) => {
    const out = { ...e, price: consensusAmerican(e.prices) };
    delete out.prices;
    return fields ? Object.fromEntries(Object.entries(out).filter(([k]) => fields.includes(k))) : out;
  });

  return {
    eventId: event.id,
    homeTeam,
    awayTeam,
    altRunLines: finalize(altSpreads),
    altTotals: finalize(altTotals),
    teamTotals: finalize(teamTotals),
  };
}

function normalizeExtendedProps(event) {
  const grouped = new Map();
  for (const book of (event.bookmakers ?? []).slice(0, 6)) {
    for (const market of book.markets ?? []) {
      if (!EXTENDED_PROP_MARKETS.includes(market.key)) continue;
      for (const outcome of market.outcomes ?? []) {
        const direction = normalizePropDirection(outcome.name);
        const point = outcome.point != null ? Number(outcome.point) : null;
        const price = Number(outcome.price);
        const playerName = String(
          outcome.description ?? outcome.participant ?? outcome.player ?? '',
        ).trim();
        if (!direction || !playerName || !Number.isFinite(price)) continue;
        // Some markets (e.g. pitcher_record_a_win) have no point — encode as 0.
        const linePoint = Number.isFinite(point) ? point : 0;
        const key = `${market.key}::${normalizeName(playerName)}::${direction}::${linePoint}`;
        const existing = grouped.get(key) ?? {
          marketKey: market.key,
          playerName,
          normalizedPlayerName: normalizeName(playerName),
          direction,
          line: linePoint,
          prices: [],
        };
        existing.prices.push(price);
        grouped.set(key, existing);
      }
    }
  }
  const out = {};
  for (const entry of grouped.values()) {
    const offer = {
      playerName: entry.playerName,
      normalizedPlayerName: entry.normalizedPlayerName,
      direction: entry.direction,
      line: entry.line,
      price: Math.round(avg(entry.prices)),
    };
    if (!out[entry.marketKey]) out[entry.marketKey] = [];
    out[entry.marketKey].push(offer);
  }
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) =>
      a.normalizedPlayerName.localeCompare(b.normalizedPlayerName) ||
      a.line - b.line ||
      a.direction.localeCompare(b.direction)
    );
  }
  return out;
}

/**
 * Fetch alt-line + team-totals menu for one event. Postgres-cached (6h TTL
 * by default). Returns null when no API key is configured or upstream fails.
 *
 * @param {string} eventId  — Odds API event id
 * @param {{ forceRefresh?: boolean, ttlMs?: number }} [opts]
 * @returns {Promise<object|null>}
 */
export async function getEventAlternates(eventId, opts = {}) {
  if (!eventId) return null;
  if (!opts.forceRefresh) {
    const cached = await loadCachedOdds({ scope: 'alts', subject: eventId });
    if (cached?.payload) return cached.payload;
  }
  const apiKey = pickApiKey();
  if (!apiKey) {
    console.warn('[odds-api] getEventAlternates: no API key configured');
    return null;
  }
  let attempt = await fetchEventMarketsRaw({ eventId, marketsList: ALT_GAME_MARKETS, apiKey: apiKey.key });
  if (!attempt.ok && apiKey.backup && attempt.body?.includes('OUT_OF_USAGE_CREDITS')) {
    console.warn(`[odds-api] alts: primary out of credits for event ${eventId}; falling back to backup`);
    attempt = await fetchEventMarketsRaw({ eventId, marketsList: ALT_GAME_MARKETS, apiKey: apiKey.backup });
  }
  if (!attempt.ok) {
    console.warn(`[odds-api] alts fetch failed for event ${eventId}: status=${attempt.status} body=${(attempt.body ?? '').slice(0, 160)}`);
    return null;
  }
  const normalized = normalizeAlternateGameLines(attempt.event);
  if (!normalized) return null;
  await saveCachedOdds({
    scope: 'alts',
    subject: eventId,
    payload: normalized,
    markets: ALT_GAME_MARKETS.join(','),
    quota: attempt.quota,
    keySlot: apiKey.slot,
    ttlMs: opts.ttlMs,
  });
  return normalized;
}

/**
 * Fetch extended player props menu for one event. Postgres-cached (3h TTL by
 * default). Returns null on any failure path.
 *
 * @param {string} eventId
 * @param {{ forceRefresh?: boolean, ttlMs?: number, markets?: string[] }} [opts]
 * @returns {Promise<object|null>}
 */
export async function getEventPropsExtended(eventId, opts = {}) {
  if (!eventId) return null;
  if (!opts.forceRefresh) {
    const cached = await loadCachedOdds({ scope: 'props_full', subject: eventId });
    if (cached?.payload) return cached.payload;
  }
  const apiKey = pickApiKey();
  if (!apiKey) return null;
  const marketsList = Array.isArray(opts.markets) && opts.markets.length > 0
    ? opts.markets
    : EXTENDED_PROP_MARKETS;
  let attempt = await fetchEventMarketsRaw({ eventId, marketsList, apiKey: apiKey.key });
  if (!attempt.ok && apiKey.backup && attempt.body?.includes('OUT_OF_USAGE_CREDITS')) {
    console.warn(`[odds-api] props_full: primary out of credits for event ${eventId}; falling back to backup`);
    attempt = await fetchEventMarketsRaw({ eventId, marketsList, apiKey: apiKey.backup });
  }
  if (!attempt.ok) {
    console.warn(`[odds-api] props_full fetch failed for event ${eventId}: status=${attempt.status} body=${(attempt.body ?? '').slice(0, 160)}`);
    return null;
  }
  const playerProps = normalizeExtendedProps(attempt.event);
  const payload = { eventId, playerProps };
  await saveCachedOdds({
    scope: 'props_full',
    subject: eventId,
    payload,
    markets: marketsList.join(','),
    quota: attempt.quota,
    keySlot: apiKey.slot,
    ttlMs: opts.ttlMs,
  });
  return payload;
}

export const __MARKET_LISTS__ = {
  PROP_MARKETS,
  ALT_GAME_MARKETS,
  EXTENDED_PROP_MARKETS,
};
