/**
 * soccer-props-odds.js — Soccer player prop odds via The Odds API event endpoint.
 *
 * Soccer player props are NOT available on the bulk /odds endpoint (used by
 * soccer-odds.js for 1X2/totals/BTTS). They live on the per-event endpoint:
 *   GET /v4/sports/{sportKey}/events/{eventId}/odds?markets=player_goal_scorer_anytime,...
 *
 * The sport key is league-dependent (soccer_epl, soccer_spain_la_liga, etc.),
 * so both leagueSlug and eventId are required. Mirrors dual-key fallback + cache +
 * never-throws contract of nfl-props-odds.js; isolated from soccer-odds.js.
 *
 * Public API:
 *   SOCCER_PROP_MARKETS                              — Odds API market keys
 *   getSoccerPlayerPropOdds({ leagueSlug, eventId }) — cached array of offers
 *   normalizeSoccerPropEvent(rawEvent)               — pure normalizer (unit-testable)
 *   getSoccerPropOddsStatus()
 */

import { getSoccerLeague } from './soccer-league-map.js';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const CACHE_TTL_MS  = 5 * 60 * 1000; // 5 min

// Odds API soccer prop market key → canonical prop kind (soccer-props-resolver.js).
const MARKET_KIND_MAP = {
  player_goal_scorer_anytime: 'anytime_goal',
  player_shots_on_target:     'shots_on_target',
  player_shots:               'shots',
  player_to_receive_a_card:   'card',
};

export const SOCCER_PROP_MARKETS = Object.keys(MARKET_KIND_MAP);

// Yes-markets: single-line props where the "outcome" is the player (no over/under).
const YES_MARKETS = new Set(['player_goal_scorer_anytime', 'player_to_receive_a_card']);

const _cache = new Map();
let _lastFetchMeta = {
  keyConfigured: Boolean(process.env.ODDS_API_KEY),
  backupKeyConfigured: Boolean(process.env.ODDS_API_BACKUP_KEY),
  leagueSlug: null,
  eventId: null,
  offers: 0,
  status: null,
  ok: null,
  error: null,
  fetchedAt: null,
  quota: null,
};

function setLastFetchMeta(patch) {
  _lastFetchMeta = {
    ..._lastFetchMeta,
    keyConfigured: Boolean(process.env.ODDS_API_KEY),
    backupKeyConfigured: Boolean(process.env.ODDS_API_BACKUP_KEY),
    fetchedAt: new Date().toISOString(),
    ...patch,
  };
}

export function getSoccerPropOddsStatus() {
  return { ..._lastFetchMeta };
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

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function mode(arr) {
  if (!arr.length) return null;
  const counts = new Map();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = arr[0], bestN = 0;
  for (const [v, n] of counts) if (n > bestN) { bestN = n; best = v; }
  return best;
}

function consensusAmerican(prices) {
  const impl = prices.map(americanToImplied).filter(v => v != null);
  if (!impl.length) return null;
  return impliedToAmerican(avg(impl));
}

function normKey(name) {
  return String(name ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

function round4(v) {
  return v == null ? null : Math.round(v * 1e4) / 1e4;
}

/**
 * Normalizes an event-odds payload into a flat array of prop offers, one per
 * (player, propKind, side). Consolidates across books: line by MODE, price by
 * implied-prob consensus.
 *
 * Yes-markets (anytime_goal, card) are emitted as side='over', line=0.5.
 */
export function normalizeSoccerPropEvent(event) {
  if (!event?.bookmakers?.length) return [];
  const books = event.bookmakers.slice(0, 6);

  const group = new Map();
  const add = (propKind, playerName, side, point, price) => {
    if (!playerName) return;
    const k = `${propKind}|${normKey(playerName)}|${side}`;
    const g = group.get(k) ?? { propKind, playerName, side, points: [], prices: [] };
    if (Number.isFinite(point)) g.points.push(point);
    if (Number.isFinite(Number(price))) g.prices.push(Number(price));
    group.set(k, g);
  };

  for (const book of books) {
    for (const market of book.markets ?? []) {
      const propKind = MARKET_KIND_MAP[market.key];
      if (!propKind) continue;
      const isYes = YES_MARKETS.has(market.key);
      for (const o of market.outcomes ?? []) {
        if (isYes) {
          // outcome.name = player name for yes-markets
          add(propKind, o.name ?? o.description, 'over', 0.5, o.price);
        } else {
          const side = /under/i.test(o.name ?? '') ? 'under' : 'over';
          add(propKind, o.description ?? o.name, side, Number(o.point), o.price);
        }
      }
    }
  }

  const offers = [];
  for (const g of group.values()) {
    const line = g.points.length ? mode(g.points) : 0.5;
    const oddsAmerican = consensusAmerican(g.prices);
    if (oddsAmerican == null && line == null) continue;
    offers.push({
      propKind: g.propKind,
      playerName: g.playerName,
      side: g.side,
      line,
      oddsAmerican,
      impliedProb: oddsAmerican != null ? round4(americanToImplied(oddsAmerican)) : null,
    });
  }
  return offers;
}

async function fetchEventOdds(apiKey, sportKey, eventId) {
  const params = new URLSearchParams({
    apiKey,
    regions: 'us,uk,eu',
    markets: SOCCER_PROP_MARKETS.join(','),
    oddsFormat: 'american',
    dateFormat: 'iso',
  });
  const url = `${ODDS_API_BASE}/sports/${sportKey}/events/${eventId}/odds/?${params}`;
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
  const raw = await res.json();
  return { ok: true, status: res.status, raw, quota };
}

/**
 * Cached soccer player prop offers for a single Odds API event. Never throws —
 * on failure returns [] and exposes the error via getSoccerPropOddsStatus().
 */
export async function getSoccerPlayerPropOdds({ leagueSlug, eventId } = {}) {
  const leagueMeta = getSoccerLeague(leagueSlug);
  const sportKey = leagueMeta?.oddsApiSlug ?? null;

  if (!sportKey || !eventId) {
    setLastFetchMeta({ leagueSlug, eventId, offers: 0, status: 'missing_params', ok: false,
      error: !sportKey ? `unknown leagueSlug: ${leagueSlug}` : 'eventId required' });
    return [];
  }

  const primary = process.env.ODDS_API_KEY;
  const backup  = process.env.ODDS_API_BACKUP_KEY;
  if (!primary && !backup) {
    setLastFetchMeta({ leagueSlug, eventId, offers: 0, status: 'missing_key', ok: false, error: 'ODDS_API_KEY not set' });
    return [];
  }

  const cacheKey = `${sportKey}:${eventId}`;
  const cached = _cache.get(cacheKey);
  if (cached?.data && Date.now() - cached.ts < CACHE_TTL_MS) {
    setLastFetchMeta({ leagueSlug, eventId, offers: cached.data.length, status: 'cache_hit', ok: true, error: null, quota: cached.quota });
    return cached.data;
  }

  const tryKey = async (apiKey, slot) => {
    try {
      const result = await fetchEventOdds(apiKey, sportKey, eventId);
      if (!result.ok) return { slot, result };
      const data = normalizeSoccerPropEvent(result.raw);
      _cache.set(cacheKey, { data, ts: Date.now(), quota: result.quota, keySlot: slot });
      setLastFetchMeta({ leagueSlug, eventId, offers: data.length, status: result.status, ok: true, error: null, quota: result.quota });
      console.log(`[soccer-props-odds] ${leagueSlug} event ${eventId}: ${data.length} offers (key=${slot})`);
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
      const isOut = typeof body === 'string' && body.includes('OUT_OF_USAGE_CREDITS');
      if (isOut || r.error) {
        console.warn(`[soccer-props-odds] primary key failed — trying backup`);
        const rb = await tryKey(backup, 'backup');
        if (rb.data) return rb.data;
      }
    }
    setLastFetchMeta({
      leagueSlug, eventId, offers: cached?.data?.length ?? 0,
      status: r.result?.status ?? 'fetch_error', ok: false,
      error: r.error?.message ?? (typeof r.result?.body === 'string' ? r.result.body.substring(0, 200) : null),
      quota: r.result?.quota ?? null,
    });
    return cached?.data ?? [];
  }

  const rb = await tryKey(backup, 'backup');
  if (rb.data) return rb.data;
  setLastFetchMeta({
    leagueSlug, eventId, offers: cached?.data?.length ?? 0,
    status: rb.result?.status ?? 'fetch_error', ok: false,
    error: rb.error?.message ?? null, quota: rb.result?.quota ?? null,
  });
  return cached?.data ?? [];
}
