const BASE = 'https://api.odds-api.io/v3';

const normalize = value => String(value ?? '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const decimal = value => {
  const number = Number(value);
  return Number.isFinite(number) && number > 1 && number <= 1000 ? number : null;
};

const eventList = payload => Array.isArray(payload) ? payload
  : Array.isArray(payload?.data) ? payload.data
    : Array.isArray(payload?.events) ? payload.events : [];

export function matchOddsApiIoNflEvent(events, game) {
  const home = normalize(game?.home_team_name);
  const away = normalize(game?.away_team_name);
  const kickoff = Date.parse(game?.game_datetime ?? '');
  if (!home || !away || !Number.isFinite(kickoff)) return null;
  return events.find(event => {
    const eventHome = normalize(event.home), eventAway = normalize(event.away);
    const eventTime = Date.parse(event.date ?? '');
    const nickname = value => value.split(' ').at(-1);
    const teamsMatch = (home === eventHome && away === eventAway)
      || (home.endsWith(` ${eventHome}`) && away.endsWith(` ${eventAway}`))
      || (eventHome.endsWith(` ${home}`) && eventAway.endsWith(` ${away}`))
      || (nickname(home) === nickname(eventHome) && nickname(away) === nickname(eventAway)
        && nickname(home).length >= 4 && nickname(away).length >= 4);
    return teamsMatch && Number.isFinite(eventTime) && Math.abs(eventTime - kickoff) <= 12 * 60 * 60_000;
  }) ?? null;
}

export function normalizeOddsApiIoBet365Board(payload, fetchedAt) {
  const markets = payload?.bookmakers?.Bet365;
  if (!Array.isArray(markets)) return [];
  const quotes = [];
  const add = (market, side, line, price, updatedAt) => {
    const decimalOdds = decimal(price);
    if (decimalOdds == null || (market !== 'moneyline' && !Number.isFinite(line))) return;
    quotes.push({ market, side, line, decimalOdds, bookmaker: 'bet365',
      provider: 'odds_api_io', providerEventId: String(payload.id),
      providerMarketUpdatedAt: updatedAt ?? null, fetchedAt });
  };
  for (const entry of markets) {
    const name = String(entry?.name ?? '').toLowerCase();
    for (const odd of entry?.odds ?? []) {
      if (name === 'ml') {
        add('moneyline', 'home', null, odd.home, entry.updatedAt);
        add('moneyline', 'away', null, odd.away, entry.updatedAt);
      } else if (name === 'spread') {
        const homeLine = odd.hdp == null ? NaN : Number(odd.hdp);
        add('spread', 'home', homeLine, odd.home, entry.updatedAt);
        add('spread', 'away', -homeLine, odd.away, entry.updatedAt);
      } else if (name === 'totals') {
        const line = odd.hdp == null ? NaN : Number(odd.hdp);
        add('total', 'over', line, odd.over, entry.updatedAt);
        add('total', 'under', line, odd.under, entry.updatedAt);
      }
    }
  }
  return quotes;
}

async function getJson(path, params, apiKey, fetcher) {
  const url = new URL(`${BASE}/${path}`);
  for (const [key, value] of Object.entries({ ...params, apiKey })) url.searchParams.set(key, value);
  const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Odds-API.io HTTP ${response.status}`);
  return response.json();
}

/** Fetches indicative Bet365 NFL quotes. Account-specific execution is verified separately. */
export async function getOddsApiIoNflBoard(game, {
  apiKey = process.env.ODDS_API_IO_KEY, fetcher = fetch,
} = {}) {
  if (!apiKey) return { status: 'missing_key', quotes: [] };
  const searches = [{ sport: 'american-football', league: 'usa-nfl' },
    { sport: 'american-football' }];
  let event = null;
  for (const search of searches) {
    const payload = await getJson('events', {
      ...search, status: 'pending', limit: '100', bookmaker: 'Bet365',
    }, apiKey, fetcher);
    event = matchOddsApiIoNflEvent(eventList(payload), game);
    if (event) break;
  }
  if (!event) return { status: 'event_unmatched', quotes: [] };
  const board = await getJson('odds', {
    eventId: String(event.id), bookmakers: 'Bet365,DraftKings',
    markets: 'ML,Spread,Totals',
  }, apiKey, fetcher);
  const fetchedAt = new Date().toISOString();
  const quotes = normalizeOddsApiIoBet365Board(board, fetchedAt);
  return { status: quotes.length ? 'ok' : 'bet365_market_unavailable',
    eventId: String(event.id), fetchedAt, quotes };
}
