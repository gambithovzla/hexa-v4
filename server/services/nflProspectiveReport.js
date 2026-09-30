const validProbability = value => value != null && Number.isFinite(Number(value))
  && Number(value) >= 0 && Number(value) <= 1;

/** One pregame quote per game/market is the independent calibration unit. */
export function summarizeNflQuoteDecisions(rows = []) {
  const decisions = { BET: 0, WATCH: 0, NO_BET: 0 };
  const reasons = {};
  const firstByGameMarket = new Map();
  let gradedQuotes = 0;
  let ticketed = 0;
  for (const row of rows) {
    if (decisions[row.decision] != null) decisions[row.decision] += 1;
    if (row.result != null) gradedQuotes += 1;
    if (row.bet_id != null) ticketed += 1;
    const list = Array.isArray(row.reasons) ? row.reasons : [];
    for (const reason of list) reasons[reason] = (reasons[reason] ?? 0) + 1;
    const key = `${row.game_pk}:${row.market}`;
    const prior = firstByGameMarket.get(key);
    if (!prior || Date.parse(row.observed_at) < Date.parse(prior.observed_at)) {
      firstByGameMarket.set(key, row);
    }
  }
  const byMarket = {};
  for (const row of firstByGameMarket.values()) {
    if (row.result !== 'win' && row.result !== 'loss') continue;
    if (!validProbability(row.model_probability)) continue;
    const market = row.market;
    const entry = byMarket[market] ?? { n: 0, brierSum: 0, certifiedN: 0 };
    const probability = Number(row.model_probability);
    const actual = row.result === 'win' ? 1 : 0;
    entry.n += 1;
    entry.brierSum += (probability - actual) ** 2;
    if (row.snapshot?.decision?.model?.certified === true) entry.certifiedN += 1;
    byMarket[market] = entry;
  }
  for (const entry of Object.values(byMarket)) {
    entry.brier = Math.round(entry.brierSum / entry.n * 10_000) / 10_000;
    delete entry.brierSum;
  }
  return {
    evaluatedQuotes: rows.length,
    gradedQuotes,
    ticketedQuotes: ticketed,
    decisionCounts: decisions,
    rejectionReasons: reasons,
    calibrationByMarket: byMarket,
    calibrationUnit: 'first_quote_per_game_and_market_excluding_pushes',
    roi: null,
    note: 'Quote outcomes and Brier are diagnostics; realized ROI belongs to placed tickets only.',
  };
}
