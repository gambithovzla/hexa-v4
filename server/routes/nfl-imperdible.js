/**
 * server/routes/nfl-imperdible.js — NFL Pick Imperdible endpoints (admin-only).
 *
 *   GET  /api/nfl/imperdible/games    — games for a week/date (selectable for a lock)
 *   POST /api/nfl/imperdible/analyze  — analyze a slate, return the single lock or PASS
 *   GET  /api/nfl/imperdible/history  — past NFL runs + outcomes + equity summary
 *
 * Feature-flagged by IMPERDIBLE_NFL_ENABLED. Never touches frozen files.
 *
 * Unlike MLB, NFL has no cheap pre-confirmation signal equivalent to a confirmed
 * lineup — the starting-QB gate is assessed inside analyze (from ESPN injuries),
 * so /games lists everything as selectable and the gate runs at analyze time.
 */

import { Router } from 'express';
import pool from '../db.js';
import { verifyToken, requireAdmin } from '../middleware/auth-middleware.js';
import { getNflGamesForWeek, getNflGamesForDate } from '../nfl-api.js';
import {
  analyzeNflImperdible,
  persistNflImperdible,
  getNflImperdibleHistory,
} from '../services/nflImperdibleEngine.js';
import { computeAdminEquityFromRows } from '../services/admin-equity.js';

const router = Router();

function imperdibleNflEnabled(req, res, next) {
  if (process.env.IMPERDIBLE_NFL_ENABLED !== 'true') {
    return res.status(503).json({ success: false, error: 'NFL Pick Imperdible is not enabled on this instance.' });
  }
  return next();
}

function safeErr(err) {
  return process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
}

router.use(verifyToken, requireAdmin, imperdibleNflEnabled);

// GET /api/nfl/imperdible/games — games for the week (or an explicit date).
router.get('/games', async (req, res) => {
  const { season = null, seasonType = null, week = null, date = null } = req.query ?? {};
  try {
    let games;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      games = await getNflGamesForDate(String(date));
    } else {
      games = await getNflGamesForWeek({
        season: season != null ? Number(season) : null,
        seasonType: seasonType != null ? Number(seasonType) : null,
        week: week != null ? Number(week) : null,
      });
    }
    const payload = (games ?? []).map((g) => ({
      gamePk: String(g.game_id),
      gameDate: g.game_date ?? null,
      home: g.home_team_abbr ?? g.home_team_name ?? '?',
      away: g.away_team_abbr ?? g.away_team_name ?? '?',
      matchup: `${g.away_team_abbr ?? '?'} @ ${g.home_team_abbr ?? '?'}`,
      selectable: true, // QB-confirmation gate is applied during analyze
    }));
    res.json({ success: true, games: payload });
  } catch (err) {
    console.error(`[nfl-imperdible] /games failed: ${err.message}`);
    res.status(500).json({ success: false, error: safeErr(err) });
  }
});

// POST /api/nfl/imperdible/analyze — body: { gameIds:[], season?, seasonType?, week?, date?, lang?, dryRun? }
router.post('/analyze', async (req, res) => {
  const { gameIds, season, seasonType, week, date, lang = 'en', dryRun = false } = req.body ?? {};
  if (!Array.isArray(gameIds) || gameIds.length === 0) {
    return res.status(400).json({ success: false, error: 'gameIds (non-empty array) is required' });
  }

  try {
    const result = await analyzeNflImperdible({ gameIds, season, seasonType, week, date, lang });

    let savedPick = null;
    if (!dryRun) {
      const persisted = await persistNflImperdible({
        result,
        userId: req.user.id,
        userEmail: req.user.email ?? null,
        lang,
      });
      savedPick = persisted.savedPick;
    }

    res.json({
      success: true,
      sport: 'nfl',
      verdict: result.verdict,
      reason: result.reason,
      imperdible: result.imperdible,
      arbiter: result.arbiter ?? null,
      slate: result.slate,
      excluded: result.excluded,
      slateSize: result.slateSize,
      bestRejected: result.bestRejected ?? null,
      savedPickId: savedPick?.id ?? null,
    });
  } catch (err) {
    console.error(`[nfl-imperdible] /analyze failed: ${err.message}`);
    res.status(500).json({ success: false, error: safeErr(err) });
  }
});

// GET /api/nfl/imperdible/history — past NFL runs + equity over resolved locks.
router.get('/history', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  try {
    const runs = await getNflImperdibleHistory({ limit });

    const { rows: resolvedRows } = await pool.query(
      `SELECT id, pick, matchup, result, odds_at_pick, created_at, game_date,
              COALESCE(sport,'mlb') AS sport, type, oracle_confidence
       FROM   picks
       WHERE  type = 'imperdible'
         AND  COALESCE(sport,'mlb') = 'nfl'
         AND  deleted_at IS NULL
         AND  LOWER(result) IN ('win','won','loss','lost','push')
       ORDER  BY created_at ASC`,
    );
    const equity = computeAdminEquityFromRows(resolvedRows);

    res.json({ success: true, runs, equity });
  } catch (err) {
    console.error(`[nfl-imperdible] /history failed: ${err.message}`);
    res.status(500).json({ success: false, error: safeErr(err) });
  }
});

export default router;
