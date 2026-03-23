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
const CACHE_TTL_MS  = 5 * 60 * 1000; // 5 minutes

let _cache = { data: null, ts: 0 };

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

// ---------------------------------------------------------------------------
// getGameOdds
// ---------------------------------------------------------------------------

/**
 * Fetches MLB moneyline / run-line / totals odds from The Odds API.
 * Results are cached for 5 minutes to conserve API quota.
 *
 * @returns {Promise<Array>} Array of normalized game odds objects
 */
export async function getGameOdds() {
  const apiKey = process.env.ODDS_API_KEY;

  console.log('[odds-api] API key present:', apiKey ? `${apiKey.substring(0, 8)}...` : 'MISSING');
  console.log('[odds-api] Spring Training:', isSpringTraining());

  if (!apiKey) {
    console.warn('[odds-api] ODDS_API_KEY not set — skipping fetch');
    return [];
  }

  if (_cache.data && Date.now() - _cache.ts < CACHE_TTL_MS) {
    console.log('[odds-api] Returning cached data:', _cache.data.length, 'events');
    return _cache.data;
  }

  try {
    const url =
      `${ODDS_API_BASE}/sports/baseball_mlb/odds/?` +
      `apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american&dateFormat=iso`;

    console.log('[odds-api] Fetching URL:', url.replace(apiKey, `${apiKey.substring(0, 8)}...`));

    const res = await fetch(url);
    console.log('[odds-api] Response status:', res.status, res.statusText);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[odds-api] API error ${res.status} — body: ${body.substring(0, 200)}`);
      console.warn('[odds-api] Note: The Odds API does not list Spring Training games. Returning cached data.');
      return _cache.data ?? [];
    }

    const raw  = await res.json();
    console.log('[odds-api] Raw events returned:', Array.isArray(raw) ? raw.length : 'not an array', typeof raw === 'string' ? raw.substring(0, 200) : '');

    if (Array.isArray(raw) && raw.length === 0) {
      console.warn('[odds-api] 0 events returned — likely Spring Training (no MLB regular season games listed)');
    }

    const data = (Array.isArray(raw) ? raw : []).map(normalizeEvent).filter(Boolean);
    console.log('[odds-api] Normalized events:', data.length);
    _cache = { data, ts: Date.now() };
    return data;
  } catch (err) {
    console.error('[odds-api] fetch error:', err.message);
    return _cache.data ?? [];
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
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

  const mlHomeAvg = avg(mlHome);
  const mlAwayAvg = avg(mlAway);
  if (mlHomeAvg == null && mlAwayAvg == null) return null;

  return {
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    odds: {
      moneyline: {
        home: mlHomeAvg != null ? Math.round(mlHomeAvg) : null,
        away: mlAwayAvg != null ? Math.round(mlAwayAvg) : null,
      },
      runLine: {
        home: {
          spread: rlHomeSpread.length ? +(avg(rlHomeSpread).toFixed(1)) : null,
          price:  rlHomePrice.length  ? Math.round(avg(rlHomePrice))    : null,
        },
        away: {
          spread: rlAwaySpread.length ? +(avg(rlAwaySpread).toFixed(1)) : null,
          price:  rlAwayPrice.length  ? Math.round(avg(rlAwayPrice))    : null,
        },
      },
      overUnder: {
        total:      ouTotal.length  ? +(avg(ouTotal).toFixed(1))  : null,
        overPrice:  ouOver.length   ? Math.round(avg(ouOver))     : null,
        underPrice: ouUnder.length  ? Math.round(avg(ouUnder))    : null,
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
