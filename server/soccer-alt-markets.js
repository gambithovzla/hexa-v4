/**
 * soccer-alt-markets.js — alternate goal totals + alternate handicaps for one
 * soccer match, via The Odds API event-specific endpoint.
 *
 * The bulk /odds feed (soccer-odds.js) only carries the MAIN total and the MAIN
 * handicap line. The full alternate ladders (Over/Under 1.5, 3.5, 4.5; handicap
 * -2.5, +2.5, …) live on the per-event endpoint under the `alternate_totals`
 * and `alternate_spreads` markets — the same pattern as the MLB getEventAlternates
 * and the NFL/F5 event-odds fetchers.
 *
 * Lets the Oracle pick a non-2.5 goal line or a non-main handicap with a REAL
 * price instead of guessing. Dual-key fallback, 5-min cache, never throws —
 * returns null/empty when unavailable so the analysis still runs on the main lines.
 *
 * Public API:
 *   getSoccerAltMarkets({ leagueSlug, eventId })  → { altTotals, altSpreads } | null
 * Pure (exported for tests):
 *   normalizeSoccerAlternates(event, homeTeam, awayTeam)
 */

import { getSoccerLeague } from './soccer-league-map.js';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const CACHE_TTL_MS = 5 * 60 * 1000;
const _cache = new Map();

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
function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
}
function consensus(prices) {
  const implied = prices.map(americanToImplied).filter(v => v != null);
  if (!implied.length) return null;
  return impliedToAmerican(avg(implied));
}

/**
 * Normalize an event-odds payload into alternate-total and alternate-handicap
 * ladders, consensus-priced per line. Pure.
 *
 * @returns {{ altTotals: {line,over,under}[], altSpreads: {homePoint,homePrice,awayPrice}[] }}
 */
export function normalizeSoccerAlternates(event, homeTeam, awayTeam) {
  const out = { altTotals: [], altSpreads: [] };
  if (!event?.bookmakers?.length) return out;

  const totByLine = new Map();    // line → { over:[], under:[] }
  const spByHomePt = new Map();   // homePoint → { home:[], away:[] }

  for (const book of event.bookmakers) {
    for (const market of book.markets ?? []) {
      if (market.key === 'alternate_totals') {
        for (const o of market.outcomes ?? []) {
          if (o.point == null) continue;
          const slot = totByLine.get(o.point) ?? { over: [], under: [] };
          if (String(o.name).toLowerCase() === 'over') slot.over.push(o.price);
          else slot.under.push(o.price);
          totByLine.set(o.point, slot);
        }
      } else if (market.key === 'alternate_spreads') {
        for (const o of market.outcomes ?? []) {
          if (o.point == null) continue;
          // Key every ladder rung by the HOME point so both sides line up.
          const homePt = o.name === homeTeam ? o.point
            : o.name === awayTeam ? -o.point : null;
          if (homePt == null) continue;
          const slot = spByHomePt.get(homePt) ?? { home: [], away: [] };
          if (o.name === homeTeam) slot.home.push(o.price);
          else slot.away.push(o.price);
          spByHomePt.set(homePt, slot);
        }
      }
    }
  }

  out.altTotals = [...totByLine.entries()]
    .map(([line, p]) => ({ line, over: consensus(p.over), under: consensus(p.under) }))
    .filter(t => t.over != null || t.under != null)
    .sort((a, b) => a.line - b.line);

  out.altSpreads = [...spByHomePt.entries()]
    .map(([homePoint, p]) => ({ homePoint, homePrice: consensus(p.home), awayPrice: consensus(p.away) }))
    .filter(s => s.homePrice != null || s.awayPrice != null)
    .sort((a, b) => a.homePoint - b.homePoint);

  return out;
}

async function fetchEventOdds(apiKey, sportKey, eventId) {
  const params = new URLSearchParams({
    apiKey,
    regions: 'us,uk,eu',
    markets: 'alternate_totals,alternate_spreads',
    oddsFormat: 'american',
    dateFormat: 'iso',
  });
  const url = `${ODDS_API_BASE}/sports/${sportKey}/events/${encodeURIComponent(eventId)}/odds?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, status: res.status, body };
  }
  return { ok: true, raw: await res.json() };
}

/**
 * Alternate goal-total + handicap ladders for one event. Dual-key, cached,
 * never throws. Returns null when no key / event id / both keys fail.
 */
export async function getSoccerAltMarkets({ leagueSlug, eventId } = {}) {
  if (!eventId) return null;
  const sportKey = getSoccerLeague(leagueSlug)?.oddsApiSlug ?? null;
  if (!sportKey) return null;

  const cacheKey = `${sportKey}:${eventId}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const keys = [process.env.ODDS_API_KEY, process.env.ODDS_API_BACKUP_KEY].filter(Boolean);
  for (const [i, key] of keys.entries()) {
    try {
      const result = await fetchEventOdds(key, sportKey, eventId);
      if (!result.ok) {
        const outOfCredits = typeof result.body === 'string' && result.body.includes('OUT_OF_USAGE_CREDITS');
        if (outOfCredits && i < keys.length - 1) {
          console.warn('[soccer-alt-markets] key exhausted, trying backup');
          continue;
        }
        console.warn(`[soccer-alt-markets] event odds fetch failed (${result.status})`);
        break;
      }
      const data = normalizeSoccerAlternates(result.raw, result.raw?.home_team, result.raw?.away_team);
      _cache.set(cacheKey, { data, ts: Date.now() });
      return data;
    } catch (err) {
      console.warn(`[soccer-alt-markets] fetch error: ${err.message}`);
    }
  }
  _cache.set(cacheKey, { data: null, ts: Date.now() });
  return null;
}

export default { getSoccerAltMarkets, normalizeSoccerAlternates };
