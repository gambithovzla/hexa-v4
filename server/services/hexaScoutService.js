/**
 * hexaScoutService.js — Hexa Scout: futures + prospect call-up tracker (B9).
 *
 * Futures: Fetches MLB futures odds (WS winner, division winners, pennant)
 *          from The Odds API `baseball_mlb_world_series_winner` market.
 *
 * Prospect alerts: Monitors MLB Stats API transactions feed for call-ups
 *                  and optionals — provides roster context for analysis.
 *
 * Endpoints:
 *   GET /api/mlb/futures          — futures market prices
 *   GET /api/mlb/transactions     — recent roster moves (call-ups, DFA, etc.)
 *
 * Feature flag: SCOUT_ENABLED=1 (default on — read-only, low cost)
 */

const ODDS_API_BASE  = 'https://api.the-odds-api.com/v4';
const MLB_API_BASE   = 'https://statsapi.mlb.com/api/v1';

// Futures market keys supported by The Odds API for MLB
const FUTURES_MARKETS = [
  { key: 'baseball_mlb_world_series_winner',    label: 'World Series Winner' },
  { key: 'baseball_mlb_american_league_winner', label: 'AL Pennant' },
  { key: 'baseball_mlb_national_league_winner', label: 'NL Pennant' },
];

const _cache = new Map();
const FUTURES_TTL = 4 * 60 * 60 * 1000; // 4h

function apiKey() {
  return process.env.ODDS_API_KEY ?? '';
}

/**
 * Fetch futures odds for MLB from The Odds API.
 * Returns a flat array of { sport, market, team, odds (American), implied_prob, book }.
 */
export async function getMlbFutures() {
  const cacheKey = 'mlb_futures';
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < FUTURES_TTL) return cached.data;

  const key = apiKey();
  if (!key) return [];

  const results = [];

  for (const market of FUTURES_MARKETS) {
    try {
      const url = `${ODDS_API_BASE}/sports/${market.key}/odds?apiKey=${key}&regions=us&markets=outrights&oddsFormat=american`;
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[hexa-scout] Odds API ${res.status} for ${market.key}`);
        continue;
      }
      const events = await res.json();
      if (!Array.isArray(events)) continue;

      for (const event of events) {
        for (const book of (event.bookmakers ?? [])) {
          for (const m of (book.markets ?? [])) {
            for (const outcome of (m.outcomes ?? [])) {
              const americanOdds = outcome.price;
              const impliedProb = americanOdds > 0
                ? 100 / (americanOdds + 100)
                : Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
              results.push({
                market_key: market.key,
                market_label: market.label,
                team: outcome.name,
                odds: americanOdds,
                implied_prob: Math.round(impliedProb * 1000) / 10,
                book: book.key,
                updated_at: book.last_update ?? null,
              });
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[hexa-scout] Failed to fetch ${market.key}: ${err.message}`);
    }
  }

  // Deduplicate: keep best odds per team per market (highest American odds = most value)
  const byTeam = new Map();
  for (const r of results) {
    const k = `${r.market_key}:${r.team}`;
    const prev = byTeam.get(k);
    if (!prev || r.odds > prev.odds) byTeam.set(k, r);
  }

  const data = Array.from(byTeam.values()).sort((a, b) => a.implied_prob - b.implied_prob);
  _cache.set(cacheKey, { ts: Date.now(), data });
  return data;
}

/**
 * Fetch recent MLB roster transactions (call-ups, optionals, DFAs, activations).
 * Uses the MLB Stats API transactions endpoint.
 *
 * @param {number} dayBack — how many days back to fetch (default 3)
 */
export async function getMlbTransactions(daysBack = 3) {
  const cacheKey = `mlb_transactions_${daysBack}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 15 * 60 * 1000) return cached.data; // 15m TTL

  const endDate = new Date();
  const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const url = `${MLB_API_BASE}/transactions?startDate=${fmt(startDate)}&endDate=${fmt(endDate)}&sportId=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB transactions API ${res.status}`);
  const json = await res.json();

  const RELEVANT_TYPES = new Set([
    'CALLUP', 'OPTIONAL', 'RECALL', 'ACTIVATED', 'PLACED_ON_IL',
    'DFA', 'RELEASED', 'OUTRIGHTED',
  ]);

  const transactions = (json.transactions ?? [])
    .filter(t => RELEVANT_TYPES.has(t.typeCode))
    .map(t => ({
      type: t.typeCode,
      type_label: t.typeDesc,
      player: t.person?.fullName ?? 'Unknown',
      player_id: t.person?.id ?? null,
      team: t.team?.abbreviation ?? null,
      team_name: t.team?.name ?? null,
      date: t.date,
      description: t.description ?? null,
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  _cache.set(cacheKey, { ts: Date.now(), data: transactions });
  return transactions;
}
