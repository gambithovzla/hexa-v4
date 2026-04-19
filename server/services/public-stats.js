/**
 * public-stats.js — pure computation for the public ROI / performance summary.
 *
 * Extracted from routes/picks.js so both the original /api/picks/public-stats
 * route and the Content API (/api/content/v1/performance/summary) can reuse
 * the same aggregation without duplicating logic.
 *
 * Behavior is identical to the previous inline implementation.
 */

import pool from '../db.js';

function parseJsonMaybe(value) {
  if (!value || typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

/**
 * Detect pick type from the saved payload first, then fall back to the pick text.
 * This avoids misclassifying player props like "Under 0.5 Hits" as plain "under".
 */
function detectPickType(pick, bestPickRaw) {
  const bestPick = parseJsonMaybe(bestPickRaw);
  const bestType = String(bestPick?.type ?? '').toLowerCase().replace(/[\s_-]/g, '');

  if (bestType.includes('playerprop')) return 'prop';
  if (bestType.includes('runline'))    return 'runline';
  if (bestType.includes('moneyline'))  return 'moneyline';
  if (bestType.includes('overunder')) {
    if (/Under/i.test(pick)) return 'under';
    if (/Over/i.test(pick))  return 'over';
  }

  if (!pick) return 'moneyline';

  const propLike =
    /\b[A-Z]\.\s+[A-Z][a-z]+|Total Bases|Strikeouts?|Home Runs?|Hits?\b|RBIs?|\bWalks?\b|Pitching Outs?|Earned Runs?|Stolen Bases?\b/i.test(pick);
  if (propLike) return 'prop';
  if (/Run Line|\+1\.5|-1\.5/i.test(pick)) return 'runline';
  if (/Over/i.test(pick))  return 'over';
  if (/Under/i.test(pick)) return 'under';
  return 'moneyline';
}

function calcUnits(result, odds) {
  const isWon  = result === 'won'  || result === 'win';
  const isLost = result === 'lost' || result === 'loss';
  if (isWon) {
    if (odds == null || odds === 0) return null;
    return odds >= 0 ? odds / 100 : 100 / Math.abs(odds);
  }
  if (isLost) return -1;
  return 0; // push
}

function buildSummary(statsMap) {
  const out = {};
  for (const [key, s] of Object.entries(statsMap)) {
    const tot = s.wins + s.losses + s.pushes;
    out[key] = {
      totalPicks: tot,
      wins:       s.wins,
      losses:     s.losses,
      pushes:     s.pushes,
      winRate:    (s.wins + s.losses) > 0
        ? Math.round((s.wins / (s.wins + s.losses)) * 1000) / 10
        : 0,
      roi:        tot > 0 ? Math.round((s.units / tot) * 10000) / 100 : 0,
      unitProfit: Math.round(s.units * 100) / 100,
    };
  }
  return out;
}

/**
 * computePublicStats(period)
 *   period: '7' | '30' | 'season' (numbers also accepted)
 * Throws { code: 'INVALID_PERIOD' } on bad input so the caller can map to 400.
 * Returns the same `data` object shape the /public-stats route has always returned.
 */
export async function computePublicStats(period) {
  const p = String(period ?? '30');

  let dateFilter;
  if (p === 'season') {
    dateFilter = `created_at >= '2026-03-01'`;
  } else {
    const days = parseInt(p, 10);
    if (![7, 30].includes(days)) {
      const err = new Error("period must be 7, 30, or 'season'");
      err.code = 'INVALID_PERIOD';
      throw err;
    }
    // days is validated to be exactly 7 or 30 — safe to interpolate
    dateFilter = `created_at >= NOW() - INTERVAL '${days} days'`;
  }

  const { rows } = await pool.query(`
    SELECT id, pick, best_pick, model, result, odds_at_pick, created_at
    FROM   picks
    WHERE  LOWER(result) IN ('won', 'lost', 'push', 'win', 'loss')
      AND  deleted_at IS NULL
      AND  ${dateFilter}
    ORDER  BY created_at ASC
  `);

  let wins = 0, losses = 0, pushes = 0;
  let roiUnits = 0, totalPicksForROI = 0;
  const modelStats = {};
  const typeStats  = {};
  const roiCurve   = [];
  let runningUnits = 0;
  let roiPickNumber = 0;

  for (const row of rows) {
    const result = String(row.result ?? '').toLowerCase();
    const isWon  = result === 'won'  || result === 'win';
    const isLost = result === 'lost' || result === 'loss';
    const isPush = result === 'push';

    const odds  = row.odds_at_pick != null ? parseInt(row.odds_at_pick, 10) : -110;
    const units = calcUnits(result, odds);

    if (isWon)       wins++;
    else if (isLost) losses++;
    else if (isPush) pushes++;

    if (units !== null) {
      roiUnits += units;
      totalPicksForROI++;

      const model = row.model || 'unknown';
      if (!modelStats[model]) modelStats[model] = { wins: 0, losses: 0, pushes: 0, units: 0 };
      if (isWon)       modelStats[model].wins++;
      else if (isLost) modelStats[model].losses++;
      else if (isPush) modelStats[model].pushes++;
      modelStats[model].units += units;

      const type = detectPickType(row.pick, row.best_pick);
      if (!typeStats[type]) typeStats[type] = { wins: 0, losses: 0, pushes: 0, units: 0 };
      if (isWon)       typeStats[type].wins++;
      else if (isLost) typeStats[type].losses++;
      else if (isPush) typeStats[type].pushes++;
      typeStats[type].units += units;

      runningUnits += units;
      roiPickNumber++;
      const cumulativeRoi = Math.round((runningUnits / roiPickNumber) * 10000) / 100;
      roiCurve.push({
        pickNumber:    roiPickNumber,
        cumulativeRoi,
        date:          row.created_at,
        result:        isWon ? 'won' : isLost ? 'lost' : 'push',
      });
    }
  }

  const totalPicks = rows.length;
  const winRate    = (wins + losses) > 0
    ? Math.round((wins / (wins + losses)) * 1000) / 10
    : 0;
  const unitProfit = Math.round(roiUnits * 100) / 100;
  const roi        = totalPicksForROI > 0
    ? Math.round((roiUnits / totalPicksForROI) * 10000) / 100
    : 0;

  return {
    totalPicks,
    wins,
    losses,
    pushes,
    winRate,
    roi,
    unitProfit,
    roiSampleSize: totalPicksForROI,
    breakdown: {
      byModel: buildSummary(modelStats),
      byType:  buildSummary(typeStats),
    },
    roiCurve,
  };
}
