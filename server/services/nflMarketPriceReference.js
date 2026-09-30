const implied = price => {
  const n = Number(price);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : -n / (-n + 100);
};

/** Fair probability from independent, same-line, contemporaneous two-sided books. */
export function nflMarketPriceReference(quotes, selection, observedAt, maxAgeMs = 5 * 60_000) {
  if (!Array.isArray(quotes)) return null;
  const now = Date.parse(observedAt);
  if (!Number.isFinite(now)) return null;
  const { market, side } = selection ?? {};
  const opposite = market === 'total'
    ? { over: 'under', under: 'over' }[side]
    : { home: 'away', away: 'home' }[side];
  if (!opposite || !['moneyline', 'spread', 'total'].includes(market)) return null;
  const targetLine = market === 'moneyline' ? null : Number(selection.line);
  if (market !== 'moneyline' && (selection.line == null || !Number.isFinite(targetLine))) return null;
  const byBook = new Map();
  for (const quote of quotes) {
    if (!quote?.bookmaker || String(quote.bookmaker).toLowerCase().includes('bet365')) continue;
    if (quote.market !== market || ![side, opposite].includes(quote.side)) continue;
    const expectedLine = market === 'spread' && quote.side === opposite ? -targetLine : targetLine;
    if (market !== 'moneyline' && Number(quote.line) !== expectedLine) continue;
    const at = Date.parse(quote.lastUpdate ?? '');
    if (!Number.isFinite(at) || at > now || now - at > maxAgeMs) continue;
    const probability = implied(quote.price);
    if (probability == null) continue;
    const book = byBook.get(quote.bookmaker) ?? {};
    book[quote.side] = { probability, at };
    byBook.set(quote.bookmaker, book);
  }
  const fair = [];
  for (const [bookmaker, sides] of byBook) {
    if (!sides[side] || !sides[opposite]) continue;
    const a = sides[side].probability, b = sides[opposite].probability;
    if (a + b <= 0 || a + b > 1.5) continue;
    fair.push({ bookmaker, probability: a / (a + b),
      observedAt: new Date(Math.min(sides[side].at, sides[opposite].at)).toISOString() });
  }
  if (fair.length < 2) return null;
  fair.sort((a, b) => a.probability - b.probability);
  const median = fair.length % 2
    ? fair[(fair.length - 1) / 2].probability
    : (fair[fair.length / 2 - 1].probability + fair[fair.length / 2].probability) / 2;
  const decimal = Number(selection.decimalOdds);
  return { probability: Math.round(median * 1e5) / 1e5,
    fairDecimal: Math.round(1 / median * 1000) / 1000,
    quotedDecimal: Number.isFinite(decimal) ? decimal : null,
    impliedEdgeAtQuotedPrice: Number.isFinite(decimal)
      ? Math.round((median * decimal - 1) * 1e4) / 1e4 : null,
    bookmakerCount: fair.length, bookmakers: fair.map(item => item.bookmaker),
    latestSourceAt: fair.map(item => item.observedAt).sort().at(-1),
    source: 'oddsapi_independent_same_line_two_sided',
    diagnosticOnly: true };
}
