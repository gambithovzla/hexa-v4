/**
 * nfl-odds.js — NFL market odds via The Odds API (americanfootball_nfl).
 *
 * Isolated from the frozen MLB odds-api.js (and the NBA nba-odds.js) so we
 * never regress other sports. Mirrors the dual-key handling and normalisation
 * of nba-odds.js, with ONE deliberate NFL difference: spread and total POINTS
 * are taken by MODE (most common across books), not averaged. Averaging would
 * manufacture fake half-points off the key numbers (-3 and -2.5 → -2.75), and
 * NFL spreads live or die on 3 and 7. Prices still use consensus.
 *
 * Public API:
 *   getNflGameOdds({ date })  → cached array of normalized NFL events
 *   matchNflOddsToGame(events, homeTeamName, awayTeamName)
 *   buildMarketOddsForGame(event)  → { spread, total, moneyline } the Oracle expects
 *   getNflOddsStatus()
 */

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const SPORT_KEY     = 'americanfootball_nfl';
const CACHE_TTL_MS  = 5 * 60 * 1000; // 5 min

const _cache = new Map();
let _lastFetchMeta = {
  keyConfigured: Boolean(process.env.ODDS_API_KEY),
  backupKeyConfigured: Boolean(process.env.ODDS_API_BACKUP_KEY),
  cacheKey: null,
  keySlot: null,
  requestedDate: null,
  events: 0,
  status: null,
  ok: null,
  error: null,
  fetchedAt: null,
  quota: null,
};

function getDateWindow(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) return null;
  const start = new Date(`${date}T00:00:00.000Z`);
  // NFL games span Thu→Mon; a 4-day window from the requested date catches the slate.
  const end = new Date(start.getTime() + 4 * 24 * 60 * 60 * 1000);
  const iso = v => v.toISOString().replace('.000Z', 'Z');
  return { from: iso(start), to: iso(end) };
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

export function getNflOddsStatus() {
  return {
    ..._lastFetchMeta,
    keyConfigured: Boolean(process.env.ODDS_API_KEY),
    backupKeyConfigured: Boolean(process.env.ODDS_API_BACKUP_KEY),
    cachedEvents: [..._cache.values()].reduce((n, e) => n + (e.data?.length ?? 0), 0),
  };
}

async function fetchOdds(apiKey, requestedDate) {
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
    params.set('commenceTimeTo',   window.to);
  }
  const url = `${ODDS_API_BASE}/sports/${SPORT_KEY}/odds/?${params.toString()}`;
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
 * Public: cached NFL market odds for a calendar date. Never throws — on failure
 * returns `[]` and exposes the error via getNflOddsStatus().
 */
export async function getNflGameOdds({ date } = {}) {
  const primary = process.env.ODDS_API_KEY;
  const backup  = process.env.ODDS_API_BACKUP_KEY;
  const cacheKey = getCacheKey(date);

  if (!primary && !backup) {
    setLastFetchMeta({ cacheKey, keySlot: null, requestedDate: date, events: 0, status: 'missing_key', ok: false, error: 'ODDS_API_KEY not set', quota: null });
    return [];
  }

  const cached = _cache.get(cacheKey);
  if (cached?.data && Date.now() - cached.ts < CACHE_TTL_MS) {
    setLastFetchMeta({ cacheKey, keySlot: cached.keySlot, requestedDate: date, events: cached.data.length, status: 'cache_hit', ok: true, error: null, quota: cached.quota });
    return cached.data;
  }

  const tryKey = async (apiKey, slot) => {
    try {
      const result = await fetchOdds(apiKey, date);
      if (!result.ok) return { slot, result };
      const data = result.raw.map(normalizeEvent).filter(Boolean);
      _cache.set(cacheKey, { data, ts: Date.now(), quota: result.quota, keySlot: slot });
      setLastFetchMeta({ cacheKey, keySlot: slot, requestedDate: date, events: data.length, status: result.status, ok: true, error: null, quota: result.quota });
      console.log(`[nfl-odds] ${SPORT_KEY} ${date ?? 'upcoming'}: ${data.length} events (key=${slot})`);
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
        console.warn(`[nfl-odds] primary key failed (${isOutOfCredits ? 'OUT_OF_USAGE_CREDITS' : r.error?.message ?? r.result?.status}) — trying backup`);
        const rb = await tryKey(backup, 'backup');
        if (rb.data) return rb.data;
      }
    }
    setLastFetchMeta({
      cacheKey, keySlot: 'primary', requestedDate: date,
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
    cacheKey, keySlot: 'backup', requestedDate: date,
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

/** Most common value (preserves real NFL lines / key numbers); first on a tie. */
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
  const books = event.bookmakers.slice(0, 3);

  const mlHome = [], mlAway = [];
  const spHome = [], spHomePrice = [], spAway = [], spAwayPrice = [];
  const totals = [], overs = [], unders = [];

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
            if (o.name === event.home_team) { spHome.push(o.point); spHomePrice.push(o.price); }
            else { spAway.push(o.point); spAwayPrice.push(o.price); }
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

  const mlH = consensusAmerican(mlHome);
  const mlA = consensusAmerican(mlAway);
  const spH = spHome.length ? mode(spHome) : null;
  const spA = spAway.length ? mode(spAway) : null;
  const totLine = totals.length ? mode(totals) : null;
  if (mlH == null && mlA == null && spH == null && totLine == null) return null;

  return {
    eventId:      event.id ?? null,
    commenceTime: event.commence_time ?? null,
    homeTeam:     event.home_team,
    awayTeam:     event.away_team,
    moneyline: { home: mlH, away: mlA },
    spread: {
      home: spH,
      homePrice: consensusAmerican(spHomePrice),
      away: spA,
      awayPrice: consensusAmerican(spAwayPrice),
    },
    total: {
      line:       totLine,
      overPrice:  consensusAmerican(overs),
      underPrice: consensusAmerican(unders),
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
 * Fuzzy match an NFL event by team names. Accepts full names ("Kansas City
 * Chiefs") or short names ("Chiefs") — word-overlap copes with both.
 */
export function matchNflOddsToGame(events, homeTeamName, awayTeamName) {
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
 * Convert a matched NFL event into the `marketOdds` shape the Oracle prompt
 * expects: `{ spread, total, moneyline }` (spread first — NFL primary market).
 * Returns null if the event has no usable price.
 */
export function buildMarketOddsForGame(event) {
  if (!event) return null;
  const homeImplied = event.moneyline.home != null ? americanToImplied(event.moneyline.home) * 100 : null;
  const awayImplied = event.moneyline.away != null ? americanToImplied(event.moneyline.away) * 100 : null;

  return {
    spread: {
      home:      event.spread.home,
      homePrice: event.spread.homePrice,
      away:      event.spread.away,
      awayPrice: event.spread.awayPrice,
    },
    total: {
      line:       event.total.line,
      overPrice:  event.total.overPrice,
      underPrice: event.total.underPrice,
    },
    moneyline: {
      home:        event.moneyline.home,
      away:        event.moneyline.away,
      homeImplied: homeImplied != null ? Math.round(homeImplied * 10) / 10 : null,
      awayImplied: awayImplied != null ? Math.round(awayImplied * 10) / 10 : null,
    },
    source: 'oddsapi',
    eventId: event.eventId,
  };
}
