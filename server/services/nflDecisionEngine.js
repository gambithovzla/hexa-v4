/** A quoted bet365 selection is the unit of an NFL decision. All odds are decimal. */
const MARKET_SIDES = {
  moneyline: new Set(['home', 'away']),
  spread: new Set(['home', 'away']),
  total: new Set(['over', 'under']),
};

const round = (n, places = 4) => Math.round(n * 10 ** places) / 10 ** places;

export function evaluateNflDecision({
  quote, model, kickoffAt, now = new Date().toISOString(), qbConfirmed = false,
  dataQuality = 0, bankroll = null, gameExposure = 0, slateExposure = 0,
  minEv = 0.03, isPreseason = false,
} = {}) {
  const reasons = [];
  const market = String(quote?.market ?? '').toLowerCase();
  const side = String(quote?.side ?? '').toLowerCase();
  const line = quote?.line == null ? null : Number(quote.line);
  const price = Number(quote?.decimalOdds);
  const observedAt = Date.parse(quote?.observedAt ?? '');
  const kickoff = Date.parse(kickoffAt ?? '');
  const current = Date.parse(now);

  if (String(quote?.bookmaker ?? '').toLowerCase() !== 'bet365') reasons.push('bookmaker_unverified');
  if (!MARKET_SIDES[market]?.has(side)) reasons.push('selection_invalid');
  if (market !== 'moneyline' && !Number.isFinite(line)) reasons.push('line_missing');
  if (!Number.isFinite(price) || price <= 1 || price > 1000) reasons.push('price_invalid');
  if (!Number.isFinite(observedAt) || !Number.isFinite(kickoff) || !Number.isFinite(current)
      || observedAt > current || current >= kickoff || observedAt >= kickoff) reasons.push('quote_time_invalid');
  else if (current - observedAt > 5 * 60_000) reasons.push('quote_stale');

  const homeProbability = model?.probability == null ? NaN : Number(model.probability);
  const modelLine = model?.line == null ? null : Number(model.line);
  if (!Number.isFinite(homeProbability) || homeProbability < 0 || homeProbability > 1) reasons.push('model_unavailable');
  if (market !== 'moneyline' && Number.isFinite(line) && modelLine !== line) reasons.push('model_line_mismatch');
  if (model?.certified !== true || !model?.version) reasons.push('model_not_certified');
  if (isPreseason) reasons.push('preseason_out_of_distribution');
  if (!qbConfirmed) reasons.push('qb_unverified');
  if (!Number.isFinite(Number(dataQuality)) || Number(dataQuality) < 0.8) reasons.push('data_quality_low');

  const pushProbability = quote?.pushProbability == null
    ? (line != null && Number.isInteger(line) ? null : 0)
    : Number(quote.pushProbability);
  if (pushProbability == null && market !== 'moneyline') reasons.push('push_probability_missing');
  if (pushProbability != null && (!Number.isFinite(pushProbability) || pushProbability < 0 || pushProbability >= 1)) reasons.push('push_probability_invalid');

  const sideProbability = side === 'away' || side === 'under' ? 1 - homeProbability : homeProbability;
  const validProbability = Number.isFinite(sideProbability) && sideProbability >= 0 && sideProbability <= 1;
  const pWin = validProbability && Number.isFinite(pushProbability) ? sideProbability * (1 - pushProbability) : null;
  const pLoss = validProbability && Number.isFinite(pushProbability) ? (1 - sideProbability) * (1 - pushProbability) : null;
  const ev = pWin != null && Number.isFinite(price) && price > 1 ? pWin * (price - 1) - pLoss : null;
  const minDecimalOdds = validProbability && sideProbability > 0 ? round(1 / sideProbability, 3) : null;
  if (ev != null && ev < minEv) reasons.push('edge_below_minimum');

  const funds = Number(bankroll);
  const usedGame = Number(gameExposure);
  const usedSlate = Number(slateExposure);
  if (!Number.isFinite(funds) || funds <= 0) reasons.push('bankroll_missing');
  if (!Number.isFinite(usedGame) || usedGame < 0 || !Number.isFinite(usedSlate) || usedSlate < 0) reasons.push('exposure_invalid');

  const hardBlock = reasons.some(r => [
    'bookmaker_unverified', 'selection_invalid', 'line_missing', 'price_invalid',
    'quote_time_invalid', 'push_probability_invalid', 'edge_below_minimum',
    'preseason_out_of_distribution',
  ].includes(r));
  const decision = hardBlock ? 'NO_BET' : reasons.length ? 'WATCH' : 'BET';
  const maxStake = decision === 'BET' ? Math.max(0, Math.min(
    funds * 0.0025,
    funds * 0.005 - usedGame,
    funds * 0.02 - usedSlate,
  )) : 0;
  const roundedStake = round(maxStake, 2);
  if (decision === 'BET' && roundedStake <= 0) reasons.push('exposure_limit');

  return {
    decision: roundedStake <= 0 && decision === 'BET' ? 'NO_BET' : decision,
    reasons,
    quote: quote ? { bookmaker: quote.bookmaker, market, side, line, decimalOdds: price, observedAt: quote.observedAt } : null,
    model: { probability: validProbability ? round(sideProbability) : null, version: model?.version ?? null, certified: model?.certified === true },
    probability: {
      win: pWin == null ? null : round(pWin),
      push: Number.isFinite(pushProbability) ? round(pushProbability) : null,
      loss: pLoss == null ? null : round(pLoss),
    },
    expectedValue: ev == null ? null : round(ev),
    minimumDecimalOdds: minDecimalOdds,
    stake: roundedStake > 0 ? roundedStake : 0,
  };
}
