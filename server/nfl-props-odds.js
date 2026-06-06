/**
 * nfl-props-odds.js — NFL player prop odds via The Odds API event endpoint.
 *
 * Player props are NOT available on the bulk /odds endpoint (used by nfl-odds.js
 * for spread/total/moneyline). They live on the per-event endpoint:
 *   GET /v4/sports/americanfootball_nfl/events/{eventId}/odds?markets=player_pass_yds,...
 *
 * Isolated from nfl-odds.js so the frozen-ish game-odds path never regresses.
 * Mirrors its dual-key fallback + cache + never-throws contract.
 *
 * Public API:
 *   NFL_PROP_MARKETS                        — Odds API market keys requested
 *   getNflPlayerPropOdds({ eventId })       — cached array of normalized prop offers
 *   normalizeNflPropEvent(rawEvent)         — pure normalizer (unit-testable)
 *   getNflPropOddsStatus()
 */

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const SPORT_KEY = 'americanfootball_nfl';
const CACHE_TTL_MS = 5 * 60 * 1000;

// Odds API market key → our canonical prop kind (see nfl-props-resolver.js).
const MARKET_KIND_MAP = {
  player_pass_yds: 'pass_yds',
  player_pass_tds: 'pass_tds',
  player_pass_completions: 'pass_completions',
  player_pass_attempts: 'pass_attempts',
  player_pass_interceptions: 'pass_interceptions',
  player_rush_yds: 'rush_yds',
  player_rush_attempts: 'rush_attempts',
  player_reception_yds: 'reception_yds',
  player_receptions: 'receptions',
  player_anytime_td: 'anytime_td',
};

export const NFL_PROP_MARKETS = Object.keys(MARKET_KIND_MAP);

const _cache = new Map();
let _lastFetchMeta = {
  keyConfigured: Boolean(process.env.ODDS_API_KEY),
  eventId: null, offers: 0, status: null, ok: null, error: null, fetchedAt: null, quota: null,
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

export function getNflPropOddsStatus() {
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
  for (const [v, n] of counts) {
    if (n > bestN) { bestN = n; best = v; }
  }
  return best;
}

function consensusAmerican(prices) {
  const implied = prices.map(americanToImplied).filter(v => v != null);
  if (!implied.length) return null;
  return impliedToAmerican(avg(implied));
}

/**
 * Normalizes an event-odds payload into a flat array of prop offers, one per
 * (player, propKind, side). Consolidates across books: line by MODE (preserves
 * real book lines), price by implied-prob consensus.
 *
 * anytime_td is a yes-market: emitted as side='over', line=0.5.
 */
export function normalizeNflPropEvent(event) {
  if (!event?.bookmakers?.length) return [];
  const books = event.bookmakers.slice(0, 6);

  // group[key] = { propKind, playerName, side, points[], prices[] }
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
      for (const o of market.outcomes ?? []) {
        // For O/U markets: outcome.description = player, outcome.name = 'Over'/'Under'.
        // For anytime_td: outcome.name = player, no point.
        if (propKind === 'anytime_td') {
          add('anytime_td', o.name ?? o.description, 'over', 0.5, o.price);
        } else {
          const side = /under/i.test(o.name ?? '') ? 'under' : 'over';
          add(propKind, o.description ?? o.name, side, Number(o.point), o.price);
        }
      }
    }
  }

  const offers = [];
  for (const g of group.values()) {
    const line = g.points.length ? mode(g.points) : (g.propKind === 'anytime_td' ? 0.5 : null);
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

function normKey(name) {
  return String(name ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

function round4(v) {
  return v == null ? null : Math.round(v * 1e4) / 1e4;
}

async function fetchEventOdds(apiKey, eventId) {
  const params = new URLSearchParams({
    apiKey,
    regions: 'us',
    markets: NFL_PROP_MARKETS.join(','),
    oddsFormat: 'american',
    dateFormat: 'iso',
  });
  const url = `${ODDS_API_BASE}/sports/${SPORT_KEY}/events/${eventId}/odds/?${params.toString()}`;
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
 * Cached NFL player prop offers for a single Odds API event. Never throws — on
 * failure returns [] and exposes the error via getNflPropOddsStatus().
 */
export async function getNflPlayerPropOdds({ eventId } = {}) {
  if (!eventId) {
    setLastFetchMeta({ eventId: null, offers: 0, status: 'missing_event', ok: false, error: 'eventId required' });
    return [];
  }
  const primary = process.env.ODDS_API_KEY;
  const backup = process.env.ODDS_API_BACKUP_KEY;
  if (!primary && !backup) {
    setLastFetchMeta({ eventId, offers: 0, status: 'missing_key', ok: false, error: 'ODDS_API_KEY not set' });
    return [];
  }

  const cached = _cache.get(eventId);
  if (cached?.data && Date.now() - cached.ts < CACHE_TTL_MS) {
    setLastFetchMeta({ eventId, offers: cached.data.length, status: 'cache_hit', ok: true, error: null, quota: cached.quota });
    return cached.data;
  }

  const tryKey = async (apiKey, slot) => {
    try {
      const result = await fetchEventOdds(apiKey, eventId);
      if (!result.ok) return { slot, result };
      const data = normalizeNflPropEvent(result.raw);
      _cache.set(eventId, { data, ts: Date.now(), quota: result.quota, keySlot: slot });
      setLastFetchMeta({ eventId, offers: data.length, status: result.status, ok: true, error: null, quota: result.quota });
      console.log(`[nfl-props-odds] event ${eventId}: ${data.length} prop offers (key=${slot})`);
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
        console.warn(`[nfl-props-odds] primary key failed — trying backup`);
        const rb = await tryKey(backup, 'backup');
        if (rb.data) return rb.data;
      }
    }
    setLastFetchMeta({
      eventId, offers: cached?.data?.length ?? 0,
      status: r.result?.status ?? 'fetch_error', ok: false,
      error: r.error?.message ?? (typeof r.result?.body === 'string' ? r.result.body.substring(0, 200) : null),
      quota: r.result?.quota ?? null,
    });
    return cached?.data ?? [];
  }

  const rb = await tryKey(backup, 'backup');
  if (rb.data) return rb.data;
  setLastFetchMeta({
    eventId, offers: cached?.data?.length ?? 0,
    status: rb.result?.status ?? 'fetch_error', ok: false,
    error: rb.error?.message ?? null, quota: rb.result?.quota ?? null,
  });
  return cached?.data ?? [];
}
