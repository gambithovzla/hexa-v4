/**
 * server/routes/bet-card.js — Daily Bet Card endpoint (admin-only).
 *
 *   GET /api/bet-card?date=YYYY-MM-DD&sport=mlb — pending picks of the day
 *   evaluated against the hard gates (model prob, edge, conviction, market
 *   CLV health, calibration). Returns bets + rejected with per-gate detail.
 *
 * Feature-flagged by BET_CARD_ENABLED. Read-only; never touches frozen files.
 */

import { Router } from 'express';
import { verifyToken, requireAdmin } from '../middleware/auth-middleware.js';
import { buildBetCard, DEFAULT_THRESHOLDS } from '../services/betCardService.js';

const router = Router();

function betCardEnabled(req, res, next) {
  if (process.env.BET_CARD_ENABLED !== 'true') {
    return res.status(503).json({ success: false, error: 'Bet Card is not enabled on this instance.' });
  }
  return next();
}

function safeErr(err) {
  return process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
}

router.use(verifyToken, requireAdmin, betCardEnabled);

router.get('/', async (req, res) => {
  const { date, sport } = req.query;
  try {
    const card = await buildBetCard({
      date: date || undefined,
      sport: sport || null,
      thresholds: DEFAULT_THRESHOLDS,
    });
    res.json({ success: true, ...card });
  } catch (err) {
    console.error(`[bet-card] build failed: ${err.message}`);
    res.status(500).json({ success: false, error: safeErr(err) });
  }
});

export default router;
