/**
 * server/routes/sharp-money.js — where the sharp money is today.
 *
 *   GET /api/sharp-money?date=YYYY-MM-DD — games with a sharp-money signal
 *   (reverse line movement / steam / large ML move), sorted by strength.
 *
 * Auth-only, read-only over odds snapshots we already capture. Sharp line
 * movement is one of the few public signals that anticipates the close.
 * Never touches frozen files.
 */

import { Router } from 'express';
import { verifyToken } from '../middleware/auth-middleware.js';
import { buildSharpMoneyBoard } from '../services/sharpMoneyService.js';

const router = Router();

function safeErr(err) {
  return process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
}

router.get('/', verifyToken, async (req, res) => {
  try {
    const board = await buildSharpMoneyBoard({ date: req.query.date || undefined });
    res.json({ success: true, ...board });
  } catch (err) {
    console.error(`[sharp-money] build failed: ${err.message}`);
    res.status(500).json({ success: false, error: safeErr(err) });
  }
});

export default router;
