function impliedUnitResult(result, odds) {
  const r = String(result ?? '').toLowerCase();
  const o = Number(odds);
  if (r === 'won' || r === 'win') {
    if (!Number.isFinite(o) || o === 0) return 1;
    return o > 0 ? o / 100 : 100 / Math.abs(o);
  }
  if (r === 'lost' || r === 'loss') return -1;
  if (r === 'push') return 0;
  return null;
}

function moneyResult(result, stake, odds) {
  const r = String(result ?? '').toLowerCase();
  const s = Number(stake);
  const o = Number(odds);
  if (!Number.isFinite(s) || s <= 0) return 0;
  if (r === 'won' || r === 'win') {
    if (!Number.isFinite(o) || o === 0) return s;
    return o > 0 ? s * (o / 100) : s * (100 / Math.abs(o));
  }
  if (r === 'lost' || r === 'loss') return -s;
  return 0;
}

export function buildEquitySummary(rows = []) {
  const settled = rows
    .filter(r => ['won', 'win', 'lost', 'loss', 'push'].includes(String(r?.result ?? '').toLowerCase()))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let unitProfit = 0;
  let moneyProfit = 0;
  const equityCurve = [];

  for (const row of settled) {
    const result = String(row.result ?? '').toLowerCase();
    const unit = impliedUnitResult(result, row.odds);
    const pnl = moneyResult(result, row.stake, row.odds);
    if (unit == null) continue;

    if (result === 'won' || result === 'win') wins++;
    else if (result === 'lost' || result === 'loss') losses++;
    else if (result === 'push') pushes++;

    unitProfit += unit;
    moneyProfit += pnl;
    equityCurve.push({
      at: row.created_at,
      units: Math.round(unitProfit * 100) / 100,
      bankroll_delta: Math.round(moneyProfit * 100) / 100,
      source: row.source ?? 'manual',
      result: result === 'won' ? 'win' : result === 'lost' ? 'loss' : result,
    });
  }

  const decided = wins + losses;
  const sample = settled.length;
  return {
    sample_size: sample,
    wins,
    losses,
    pushes,
    win_rate: decided > 0 ? Math.round((wins / decided) * 1000) / 10 : 0,
    unit_profit: Math.round(unitProfit * 100) / 100,
    roi_units: sample > 0 ? Math.round((unitProfit / sample) * 10000) / 100 : 0,
    bankroll_delta: Math.round(moneyProfit * 100) / 100,
    equity_curve: equityCurve,
  };
}

export function buildUserVsHexaComparison(rows = []) {
  const all = buildEquitySummary(rows);
  const hexaOnly = buildEquitySummary(rows.filter(r => String(r.source ?? '').toLowerCase() === 'hexa'));

  return {
    your_strategy: all,
    hexa_baseline: hexaOnly,
    delta: {
      roi_units: Math.round((all.roi_units - hexaOnly.roi_units) * 100) / 100,
      win_rate: Math.round((all.win_rate - hexaOnly.win_rate) * 10) / 10,
      unit_profit: Math.round((all.unit_profit - hexaOnly.unit_profit) * 100) / 100,
      bankroll_delta: Math.round((all.bankroll_delta - hexaOnly.bankroll_delta) * 100) / 100,
    },
  };
}
