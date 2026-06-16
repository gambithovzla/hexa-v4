/**
 * server/routes/line-shop.js — best available price per game across books.
 *
 *   GET /api/line-shop?date=YYYY-MM-DD — per-game best ML/total/runline prices
 *   with book attribution + EV-vs-consensus. Sorted by the biggest edge.
 *
 * Auth-only (any verified user) — line shopping is core bettor value and is
 * read-only over odds we already fetch. Never touches frozen files.
 */

import { Router } from 'express';
import { verifyToken } from '../middleware/auth-middleware.js';
import { buildLineShopBoard } from '../services/lineShopService.js';

const router = Router();

function safeErr(err) {
  return process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
}

router.get('/', verifyToken, async (req, res) => {
  try {
    const board = await buildLineShopBoard({ date: req.query.date || undefined });
    res.json({ success: true, ...board });
  } catch (err) {
    console.error(`[line-shop] build failed: ${err.message}`);
    res.status(500).json({ success: false, error: safeErr(err) });
  }
});

export default router;
