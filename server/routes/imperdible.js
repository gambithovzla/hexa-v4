/**
 * server/routes/imperdible.js — Pick Imperdible endpoints (admin-only, MLB).
 *
 *   POST /api/imperdible/analyze   — analyze a slate, return the single lock or PASS
 *   GET  /api/imperdible/games     — today's games with lineup-confirmation status
 *   GET  /api/imperdible/history   — past runs + outcomes + equity summary
 *
 * Feature-flagged by IMPERDIBLE_ENABLED. Never touches frozen files.
 */

import { Router } from 'express';
import pool from '../db.js';
import { verifyToken, requireAdmin } from '../middleware/auth-middleware.js';
import { getTodayGames } from '../mlb-api.js';
import { analyzeImperdible, persistImperdible, getImperdibleHistory } from '../services/imperdibleEngine.js';
import { computeAdminEquityFromRows } from '../services/admin-equity.js';

const router = Router();

function imperdibleEnabled(req, res, next) {
  if (process.env.IMPERDIBLE_ENABLED !== 'true') {
    return res.status(503).json({ success: false, error: 'Pick Imperdible is not enabled on this instance.' });
  }
  return next();
}

function safeErr(err) {
  return process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
}

router.use(verifyToken, requireAdmin, imperdibleEnabled);

// GET /api/imperdible/games — games for the date with lineup-confirmation flags.
router.get('/games', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  try {
    const games = await getTodayGames(date);
    const payload = games.map((g) => ({
      gamePk: g.gamePk,
      gameDate: g.gameDate ?? null,
      home: g.teams?.home?.abbreviation ?? g.teams?.home?.name ?? '?',
      away: g.teams?.away?.abbreviation ?? g.teams?.away?.name ?? '?',
      matchup: `${g.teams?.away?.abbreviation ?? '?'} @ ${g.teams?.home?.abbreviation ?? '?'}`,
      lineupStatus: g.lineupStatus ?? 'unavailable',
      selectable: g.lineupStatus === 'confirmed',
    }));
    res.json({ success: true, date, games: payload });
  } catch (err) {
    console.error(`[imperdible] /games failed: ${err.message}`);
    res.status(500).json({ success: false, error: safeErr(err) });
  }
});

// POST /api/imperdible/analyze — body: { gameIds: [], date?, lang?, dryRun? }
router.post('/analyze', async (req, res) => {
  const { gameIds, date, lang = 'en', dryRun = false } = req.body ?? {};
  if (!Array.isArray(gameIds) || gameIds.length === 0) {
    return res.status(400).json({ success: false, error: 'gameIds (non-empty array) is required' });
  }

  try {
    const result = await analyzeImperdible({ gameIds, date, lang });

    let savedPick = null;
    if (!dryRun) {
      const persisted = await persistImperdible({
        result,
        userId: req.user.id,
        userEmail: req.user.email ?? null,
        lang,
      });
      savedPick = persisted.savedPick;
    }

    res.json({
      success: true,
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
    console.error(`[imperdible] /analyze failed: ${err.message}`);
    res.status(500).json({ success: false, error: safeErr(err) });
  }
});

// GET /api/imperdible/history — past runs + equity over resolved locks.
router.get('/history', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  try {
    const runs = await getImperdibleHistory({ limit });

    const { rows: resolvedRows } = await pool.query(
      `SELECT id, pick, matchup, result, odds_at_pick, created_at, game_date,
              COALESCE(sport,'mlb') AS sport, type, oracle_confidence
       FROM   picks
       WHERE  type = 'imperdible'
         AND  deleted_at IS NULL
         AND  LOWER(result) IN ('win','won','loss','lost','push')
       ORDER  BY created_at ASC`,
    );
    const equity = computeAdminEquityFromRows(resolvedRows);

    res.json({ success: true, runs, equity });
  } catch (err) {
    console.error(`[imperdible] /history failed: ${err.message}`);
    res.status(500).json({ success: false, error: safeErr(err) });
  }
});

export default router;
