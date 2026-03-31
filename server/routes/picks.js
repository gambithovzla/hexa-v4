/**
 * server/routes/picks.js — Public picks stats router
 *
 * Routes:
 *   GET /api/picks/public-stats — ROI dashboard (no JWT required)
 *
 * Query params:
 *   period: 7 | 30 | 'season' (default 30)
 */

import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Detect pick type from the pick string.
 * Priority: over → under → runline → prop → moneyline
 */
function detectPickType(pick) {
  if (!pick) return 'moneyline';
  if (/Over/i.test(pick)) return 'over';
  if (/Under/i.test(pick)) return 'under';
  if (/Run Line|\+1\.5|-1\.5/i.test(pick)) return 'runline';
  // Player prop heuristic: "F. Lastname" pattern or common prop keywords
  if (/\b[A-Z]\.\s+[A-Z][a-z]+|Total Bases|Strikeouts?|Home Runs?|Hits?\b|RBIs?|\bWalks?\b|ERA\b|WHIP\b/i.test(pick)) return 'prop';
  return 'moneyline';
}

/**
 * Calculate units profit for a single pick using flat 1-unit stake.
 * American odds: +150 → profit 1.5u ; -110 → profit 0.909u ; loss → -1u ; push → 0u
 * Returns null only if odds === 0 (degenerate case — caller skips from ROI math).
 * Callers should pass -110 as the default when odds_at_pick is missing.
 */
function calcUnits(result, odds) {
  const isWon = result === 'won' || result === 'win';
  const isLost = result === 'lost' || result === 'loss';
  if (isWon) {
    if (odds == null || odds === 0) return null;
    return odds >= 0 ? odds / 100 : 100 / Math.abs(odds);
  }
  if (isLost) return -1;
  return 0; // push
}

/**
 * Build a summary object from a {wins, losses, pushes, units} accumulator.
 */
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

// ── GET /api/picks/public-stats ────────────────────────────────────────────────

router.get('/public-stats', async (req, res) => {
  try {
    const period = req.query.period ?? '30';

    // Build date filter (no user-supplied values interpolated into SQL)
    let dateFilter;
    if (period === 'season') {
      dateFilter = `created_at >= '2026-03-01'`;
    } else {
      const days = parseInt(period, 10);
      if (![7, 30].includes(days)) {
        return res.status(400).json({
          success: false,
          error: "period must be 7, 30, or 'season'",
        });
      }
      // days is validated to be exactly 7 or 30 — safe to interpolate
      dateFilter = `created_at >= NOW() - INTERVAL '${days} days'`;
    }

    // Fetch all resolved picks in the window, ordered for roiCurve
    const { rows } = await pool.query(`
      SELECT id, pick, model, result, odds_at_pick, created_at
      FROM   picks
      WHERE  result IN ('won', 'lost', 'push', 'win', 'loss')
        AND  ${dateFilter}
      ORDER  BY created_at ASC
    `);

    // ── Aggregate ──────────────────────────────────────────────────────────────
    let wins = 0, losses = 0, pushes = 0;
    let roiUnits = 0, totalPicksForROI = 0;  // only picks with usable odds
    const modelStats = {};
    const typeStats  = {};
    const roiCurve   = [];
    let runningUnits = 0;
    let roiPickNumber = 0;  // cursor for picks that contribute to ROI curve

    for (const row of rows) {
      const result = row.result;
      const isWon  = result === 'won'  || result === 'win';
      const isLost = result === 'lost' || result === 'loss';
      const isPush = result === 'push';

      const odds  = row.odds_at_pick != null ? parseInt(row.odds_at_pick, 10) : -110; // default to standard juice when missing
      const units = calcUnits(result, odds); // null only if odds === 0 (shouldn't happen with -110 default)

      // W-L-P record uses ALL resolved picks regardless of odds
      if (isWon)       wins++;
      else if (isLost) losses++;
      else if (isPush) pushes++;

      // ROI math only counts picks where calcUnits returned a number
      if (units !== null) {
        roiUnits += units;
        totalPicksForROI++;

        // ── Model breakdown ────────────────────────────────────────────────────
        const model = row.model || 'unknown';
        if (!modelStats[model]) modelStats[model] = { wins: 0, losses: 0, pushes: 0, units: 0 };
        if (isWon)       modelStats[model].wins++;
        else if (isLost) modelStats[model].losses++;
        else if (isPush) modelStats[model].pushes++;
        modelStats[model].units += units;

        // ── Type breakdown ─────────────────────────────────────────────────────
        const type = detectPickType(row.pick);
        if (!typeStats[type]) typeStats[type] = { wins: 0, losses: 0, pushes: 0, units: 0 };
        if (isWon)       typeStats[type].wins++;
        else if (isLost) typeStats[type].losses++;
        else if (isPush) typeStats[type].pushes++;
        typeStats[type].units += units;

        // ── ROI curve entry (only picks with usable odds) ──────────────────────
        runningUnits += units;
        roiPickNumber++;
        const cumulativeRoi = Math.round((runningUnits / roiPickNumber) * 10000) / 100;
        roiCurve.push({
          pickNumber:   roiPickNumber,
          cumulativeRoi,
          date:         row.created_at,
          result:       isWon ? 'won' : isLost ? 'lost' : 'push',
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

    return res.json({
      success: true,
      data: {
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
      },
    });
  } catch (err) {
    const msg = process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message;
    return res.status(500).json({ success: false, error: msg });
  }
});

export default router;
