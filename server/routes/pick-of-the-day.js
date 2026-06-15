/**
 * server/routes/pick-of-the-day.js — "Pick del Día para Ganar" (admin-only, MLB).
 *
 *   GET  /api/pick-of-the-day/games    — today's games + lineup-confirmation status
 *   POST /api/pick-of-the-day/analyze  — the single best pick to WIN, or PASS
 *
 * Reuses the Imperdible candidate generation (buildScoredSlate) and applies the
 * Pick-of-the-Day selector: a payout window (default -150..+120) plus an anti-vig
 * gate (model prob must beat the odds' break-even by a margin) so the daily pick
 * is profitable, not just a pretty favourite. Read-only this phase (no persistence).
 *
 * Feature-flagged by PICK_OF_THE_DAY_ENABLED. Never touches frozen files.
 */

import { Router } from 'express';
import { verifyToken, requireAdmin } from '../middleware/auth-middleware.js';
import { getTodayGames } from '../mlb-api.js';
import { buildScoredSlate } from '../services/imperdibleEngine.js';
import { selectPickOfTheDay, DEFAULT_POTD_CONFIG } from '../services/pickOfTheDay.js';

const router = Router();

function potdEnabled(req, res, next) {
  if (process.env.PICK_OF_THE_DAY_ENABLED !== 'true') {
    return res.status(503).json({ success: false, error: 'Pick del Día is not enabled on this instance.' });
  }
  return next();
}

function safeErr(err) {
  return process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Pull only the recognised config knobs from the body, clamped to sane ranges so
// a caller can't, say, set the payout floor to +5000.
function configFromBody(body = {}) {
  const cfg = { ...DEFAULT_POTD_CONFIG };
  if (body.oddsFloorAmerican != null) cfg.oddsFloorAmerican = num(body.oddsFloorAmerican, cfg.oddsFloorAmerican);
  if (body.oddsCeilingAmerican != null) cfg.oddsCeilingAmerican = num(body.oddsCeilingAmerican, cfg.oddsCeilingAmerican);
  if (body.antiVigMarginPts != null) cfg.antiVigMarginPts = Math.max(0, Math.min(15, num(body.antiVigMarginPts, cfg.antiVigMarginPts)));
  if (body.minModelProb != null) cfg.minModelProb = Math.max(50, Math.min(80, num(body.minModelProb, cfg.minModelProb)));
  if (body.requireLineupConfirmed === false) cfg.requireLineupConfirmed = false;
  return cfg;
}

router.use(verifyToken, requireAdmin, potdEnabled);

// GET /api/pick-of-the-day/games — games for the date with lineup-confirmation flags.
router.get('/games', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  try {
    const games = await getTodayGames(date);
    const payload = games.map((g) => ({
      gamePk: g.gamePk,
      gameDate: g.gameDate ?? null,
      matchup: `${g.teams?.away?.abbreviation ?? '?'} @ ${g.teams?.home?.abbreviation ?? '?'}`,
      lineupStatus: g.lineupStatus ?? 'unavailable',
      selectable: g.lineupStatus === 'confirmed',
    }));
    res.json({ success: true, date, games: payload });
  } catch (err) {
    console.error(`[pick-of-the-day] /games failed: ${err.message}`);
    res.status(500).json({ success: false, error: safeErr(err) });
  }
});

// POST /api/pick-of-the-day/analyze
// body: { gameIds?: [], date?, lang?, oddsFloorAmerican?, oddsCeilingAmerican?,
//         antiVigMarginPts?, minModelProb?, requireLineupConfirmed? }
// gameIds omitted → consider every confirmed-lineup game of the day.
router.post('/analyze', async (req, res) => {
  const { gameIds = null, date, lang = 'en' } = req.body ?? {};
  const config = configFromBody(req.body ?? {});

  try {
    const { date: resolvedDate, slate, confirmedGames, totalGames, excluded } = await buildScoredSlate({
      gameIds, date, lang, sport: 'mlb', requireMarketPrice: true,
    });

    const selection = selectPickOfTheDay(slate, config);

    res.json({
      success: true,
      date: resolvedDate,
      sport: 'mlb',
      config,
      status: selection.status,           // 'PICK' | 'PASS'
      pick: selection.pick,               // the single best pick to win, or null
      reason: selection.reason,
      considered: selection.considered,
      eligibleCount: selection.eligibleCount,
      rejected: selection.rejected,
      confirmedGames,
      totalGames,
      excluded,
    });
  } catch (err) {
    console.error(`[pick-of-the-day] /analyze failed: ${err.message}`);
    res.status(500).json({ success: false, error: safeErr(err) });
  }
});

export default router;
