/**
 * admin-equity.js — Equity curve, drawdown, Sharpe and monthly breakdown
 * for the admin performance dashboard.
 *
 * Extends public-stats logic with:
 *   - sport filter (mlb | nba | all)
 *   - month-by-month breakdown
 *   - rolling 30-day Sharpe series
 *   - date range filter (startDate / endDate)
 *   - flat-bet units (win = +1, loss = -1, push = 0) when no odds available
 */

import pool from '../db.js';

function calcUnits(result, odds) {
  const r = String(result ?? '').toLowerCase();
  if (r === 'win' || r === 'won') {
    if (odds != null && odds !== 0) {
      return odds >= 0 ? odds / 100 : 100 / Math.abs(odds);
    }
    return 1; // flat bet fallback
  }
  if (r === 'loss' || r === 'lost') return -1;
  if (r === 'push') return 0;
  return null;
}

function monthKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function calcSharpe(values) {
  if (!Array.isArray(values) || values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  const std = Math.sqrt(variance);
  return std > 0 ? Math.round((mean / std) * 100) / 100 : 0;
}

function dayOffset(dayString, deltaDays) {
  const d = new Date(`${dayString}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export function buildRollingSharpe30d(series) {
  const unitsByDay = new Map();
  for (const point of series) {
    const key = dayKey(point.date);
    const prev = unitsByDay.get(key) ?? [];
    prev.push(Number(point.units));
    unitsByDay.set(key, prev);
  }

  const days = Array.from(unitsByDay.keys()).sort((a, b) => a.localeCompare(b));
  return days.map((day) => {
    const from = dayOffset(day, -29);
    const returns = [];
    for (const candidateDay of days) {
      if (candidateDay < from || candidateDay > day) continue;
      returns.push(...(unitsByDay.get(candidateDay) ?? []));
    }
    return {
      day,
      sharpe: calcSharpe(returns),
      sampleSize: returns.length,
    };
  });
}

export function computeAdminEquityFromRows(rows = []) {
  let runningUnits = 0;
  let peakUnits = 0;
  let maxDrawdown = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  const perPickReturns = [];
  const series = [];
  const byMonth = {};
  const bySport = {};
  let n = 0;

  for (const row of rows) {
    const units = calcUnits(row.result, row.odds_at_pick);
    if (units === null) continue;

    const r = String(row.result).toLowerCase();
    const isWin = r === 'win' || r === 'won';
    const isLoss = r === 'loss' || r === 'lost';
    const isPush = r === 'push';

    if (isWin) wins++;
    else if (isLoss) losses++;
    else if (isPush) pushes++;

    runningUnits += units;
    n++;

    if (runningUnits > peakUnits) peakUnits = runningUnits;
    const dd = runningUnits - peakUnits;
    if (dd < maxDrawdown) maxDrawdown = dd;

    perPickReturns.push(units);

    series.push({
      date: row.created_at,
      pick: row.pick ?? '',
      matchup: row.matchup ?? '',
      result: isWin ? 'win' : isLoss ? 'loss' : 'push',
      units: Math.round(units * 100) / 100,
      cumUnits: Math.round(runningUnits * 100) / 100,
      drawdown: Math.round(dd * 100) / 100,
      sport: row.sport,
    });

    const mk = monthKey(row.created_at);
    if (!byMonth[mk]) byMonth[mk] = { wins: 0, losses: 0, pushes: 0, units: 0, picks: 0 };
    if (isWin) byMonth[mk].wins++;
    else if (isLoss) byMonth[mk].losses++;
    else if (isPush) byMonth[mk].pushes++;
    byMonth[mk].units += units;
    byMonth[mk].picks++;

    const sp = row.sport ?? 'mlb';
    if (!bySport[sp]) bySport[sp] = { wins: 0, losses: 0, pushes: 0, units: 0, picks: 0 };
    if (isWin) bySport[sp].wins++;
    else if (isLoss) bySport[sp].losses++;
    else if (isPush) bySport[sp].pushes++;
    bySport[sp].units += units;
    bySport[sp].picks++;
  }

  const total = wins + losses + pushes;
  const winRate = (wins + losses) > 0
    ? Math.round((wins / (wins + losses)) * 1000) / 10
    : 0;
  const roi = n > 0 ? Math.round((runningUnits / n) * 10000) / 100 : 0;
  const sharpe = calcSharpe(perPickReturns);

  const monthly = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, s]) => ({
      month,
      picks: s.picks,
      wins: s.wins,
      losses: s.losses,
      pushes: s.pushes,
      units: Math.round(s.units * 100) / 100,
      roi: s.picks > 0 ? Math.round((s.units / s.picks) * 10000) / 100 : 0,
      winRate: (s.wins + s.losses) > 0
        ? Math.round((s.wins / (s.wins + s.losses)) * 1000) / 10
        : 0,
    }));

  const sportBreakdown = Object.fromEntries(
    Object.entries(bySport).map(([sp, s]) => [sp, {
      picks: s.picks,
      wins: s.wins,
      losses: s.losses,
      pushes: s.pushes,
      units: Math.round(s.units * 100) / 100,
      roi: s.picks > 0 ? Math.round((s.units / s.picks) * 10000) / 100 : 0,
      winRate: (s.wins + s.losses) > 0
        ? Math.round((s.wins / (s.wins + s.losses)) * 1000) / 10
        : 0,
    }]),
  );

  return {
    summary: {
      totalPicks: total,
      wins,
      losses,
      pushes,
      winRate,
      roi,
      unitProfit: Math.round(runningUnits * 100) / 100,
      peakUnits: Math.round(peakUnits * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      sharpe,
    },
    series,
    monthly,
    bySport: sportBreakdown,
    rollingSharpe30d: buildRollingSharpe30d(series),
  };
}

/**
 * computeAdminEquity({ sport, startDate, endDate })
 *
 * sport     — 'mlb' | 'nba' | 'all' (default 'all')
 * startDate — 'YYYY-MM-DD' (optional, inclusive)
 * endDate   — 'YYYY-MM-DD' (optional, inclusive)
 *
 * Returns full equity stats for admin dashboard.
 */
export async function computeAdminEquity({ sport = 'all', startDate, endDate } = {}) {
  const conditions = [`LOWER(result) IN ('win','won','loss','lost','push')`, `deleted_at IS NULL`];
  const params = [];

  if (sport && sport !== 'all') {
    params.push(sport);
    conditions.push(`sport = $${params.length}`);
  }
  if (startDate) {
    params.push(startDate);
    conditions.push(`created_at >= $${params.length}::date`);
  }
  if (endDate) {
    params.push(endDate);
    conditions.push(`created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  const where = conditions.join(' AND ');

  const { rows } = await pool.query(
    `SELECT id, pick, matchup, result, odds_at_pick, created_at,
            COALESCE(sport, 'mlb') AS sport, type, oracle_confidence
     FROM   picks
     WHERE  ${where}
     ORDER  BY created_at ASC`,
    params
  );

  return computeAdminEquityFromRows(rows);
}
