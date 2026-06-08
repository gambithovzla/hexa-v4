/**
 * server/routes/soccer-imperdible.js — Soccer Pick Imperdible endpoints (admin-only).
 *
 *   GET  /api/soccer/imperdible/games    — matches for a league + date (selectable)
 *   POST /api/soccer/imperdible/analyze  — analyze a slate, return the single lock or PASS
 *   GET  /api/soccer/imperdible/history  — past soccer runs + outcomes + equity summary
 *
 * Feature-flagged by IMPERDIBLE_SOCCER_ENABLED. Never touches frozen files.
 *
 * Like NFL, soccer has no cheap pre-confirmation signal (lineups confirm ~1h
 * pre-kick, wired in Sprint 11.3), so /games lists everything as selectable and
 * the model-certified gate runs at analyze time.
 */

import { Router } from 'express';
import pool from '../db.js';
import { verifyToken, requireAdmin } from '../middleware/auth-middleware.js';
import { isSupportedLeague } from '../soccer-league-map.js';
import { getSoccerGamesForDate } from '../soccer-api.js';
import {
  analyzeSoccerImperdible,
  persistSoccerImperdible,
  getSoccerImperdibleHistory,
} from '../services/soccerImperdibleEngine.js';
import { computeAdminEquityFromRows } from '../services/admin-equity.js';

const router = Router();

function imperdibleSoccerEnabled(req, res, next) {
  if (process.env.IMPERDIBLE_SOCCER_ENABLED !== 'true') {
    return res.status(503).json({ success: false, error: 'Soccer Pick Imperdible is not enabled on this instance.' });
  }
  return next();
}

function safeErr(err) {
  return process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
}

function validateLeague(req, res) {
  const leagueSlug = req.body?.leagueSlug ?? req.query?.league ?? null;
  if (!leagueSlug || !isSupportedLeague(leagueSlug)) {
    res.status(400).json({ success: false, error: 'leagueSlug is required and must be a supported soccer league (eng.1, esp.1, ita.1, ger.1, fra.1, usa.1)' });
    return null;
  }
  return leagueSlug;
}

router.use(verifyToken, requireAdmin, imperdibleSoccerEnabled);

// GET /api/soccer/imperdible/games?league=eng.1&date=YYYY-MM-DD
router.get('/games', async (req, res) => {
  const leagueSlug = validateLeague(req, res);
  if (!leagueSlug) return;
  const date = req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date))
    ? String(req.query.date)
    : new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  try {
    const games = await getSoccerGamesForDate(leagueSlug, date);
    const payload = (games ?? []).map((g) => ({
      gamePk: String(g.gameId ?? g.gamePk),
      gameDate: g.gameDate ?? null,
      home: g.teams?.home?.abbreviation ?? g.teams?.home?.name ?? '?',
      away: g.teams?.away?.abbreviation ?? g.teams?.away?.name ?? '?',
      matchup: `${g.teams?.away?.abbreviation ?? '?'} @ ${g.teams?.home?.abbreviation ?? '?'}`,
      status: g.status ?? null,
      selectable: g.status !== 'final', // model-certified gate runs during analyze
    }));
    res.json({ success: true, league: leagueSlug, date, games: payload });
  } catch (err) {
    console.error(`[soccer-imperdible] /games failed: ${err.message}`);
    res.status(500).json({ success: false, error: safeErr(err) });
  }
});

// POST /api/soccer/imperdible/analyze — body: { leagueSlug, date?, gameIds:[], lang?, dryRun? }
router.post('/analyze', async (req, res) => {
  const leagueSlug = validateLeague(req, res);
  if (!leagueSlug) return;
  const { gameIds, date = null, lang = 'en', dryRun = false } = req.body ?? {};
  if (!Array.isArray(gameIds) || gameIds.length === 0) {
    return res.status(400).json({ success: false, error: 'gameIds (non-empty array) is required' });
  }

  try {
    const result = await analyzeSoccerImperdible({ leagueSlug, date, gameIds, lang });

    let savedPick = null;
    if (!dryRun) {
      const persisted = await persistSoccerImperdible({
        result,
        userId: req.user.id,
        userEmail: req.user.email ?? null,
        lang,
      });
      savedPick = persisted.savedPick;
    }

    res.json({
      success: true,
      sport: 'soccer',
      league: leagueSlug,
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
    console.error(`[soccer-imperdible] /analyze failed: ${err.message}`);
    res.status(500).json({ success: false, error: safeErr(err) });
  }
});

// GET /api/soccer/imperdible/history — past soccer runs + equity over resolved locks.
router.get('/history', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  try {
    const runs = await getSoccerImperdibleHistory({ limit });

    const { rows: resolvedRows } = await pool.query(
      `SELECT id, pick, matchup, result, odds_at_pick, created_at, game_date,
              COALESCE(sport,'mlb') AS sport, type, oracle_confidence
       FROM   picks
       WHERE  type = 'imperdible'
         AND  COALESCE(sport,'mlb') = 'soccer'
         AND  deleted_at IS NULL
         AND  LOWER(result) IN ('win','won','loss','lost','push')
       ORDER  BY created_at ASC`,
    );
    const equity = computeAdminEquityFromRows(resolvedRows);

    res.json({ success: true, runs, equity });
  } catch (err) {
    console.error(`[soccer-imperdible] /history failed: ${err.message}`);
    res.status(500).json({ success: false, error: safeErr(err) });
  }
});

export default router;
