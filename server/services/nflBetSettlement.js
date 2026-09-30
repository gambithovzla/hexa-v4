/** Grade any quoted NFL selection from a final score, without assuming a bet. */
export function gradeNflSelectionFromGame(bet, game) {
  if (game?.game_status_id !== 3) return { result: null, reason: 'game_not_final' };
  if (game.home_score == null || game.away_score == null) return { result: null, reason: 'invalid_score' };
  const home = Number(game.home_score), away = Number(game.away_score);
  if (![home, away].every(Number.isFinite)) return { result: null, reason: 'invalid_score' };
  const market = bet.market, side = bet.side;
  let margin;
  if (market === 'moneyline' && ['home', 'away'].includes(side)) {
    if (home === away) return { result: null, reason: 'tie_rule_unverified' };
    margin = side === 'home' ? home - away : away - home;
  } else if (market === 'spread' && ['home', 'away'].includes(side)) {
    const line = Number(bet.line);
    if (bet.line == null || !Number.isFinite(line)) return { result: null, reason: 'line_missing' };
    margin = (side === 'home' ? home - away : away - home) + line;
  } else if (market === 'total' && ['over', 'under'].includes(side)) {
    const line = Number(bet.line);
    if (bet.line == null || !Number.isFinite(line)) return { result: null, reason: 'line_missing' };
    margin = side === 'over' ? home + away - line : line - home - away;
  } else return { result: null, reason: 'market_unsupported' };
  const result = margin > 0 ? 'win' : margin < 0 ? 'loss' : 'push';
  return {
    result,
    evidence: { gameId: String(game.game_id), homeScore: home, awayScore: away, market, side, line: bet.line ?? null },
  };
}

/** Settle a placed ticket at the price and stake the user actually accepted. */
export function settleNflBetFromGame(bet, game) {
  const graded = gradeNflSelectionFromGame(bet, game);
  if (!graded.result) return graded;
  const stake = Number(bet?.stake), decimal = Number(bet?.accepted_decimal);
  if (![stake, decimal].every(Number.isFinite) || stake <= 0 || decimal <= 1) {
    return { result: null, reason: 'invalid_ticket' };
  }
  const pnl = graded.result === 'win' ? stake * (decimal - 1) : graded.result === 'loss' ? -stake : 0;
  return { ...graded, pnl: Math.round(pnl * 100) / 100 };
}
