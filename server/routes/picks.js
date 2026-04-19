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
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { computePublicStats } from '../services/public-stats.js';

const router = Router();

// ── Performance-public gate ────────────────────────────────────────────────────
// The performance dashboard is admin-only by default. Admin can flip the
// `performance_public` flag in app_settings to expose it to everyone. A valid
// admin bearer token always bypasses the gate so the admin can preview even
// when the flag is off.

async function isPerformancePublicEnabled() {
  try {
    const { rows } = await pool.query(
      "SELECT value FROM app_settings WHERE key = 'performance_public'"
    );
    if (rows.length === 0) return false;
    const v = rows[0].value;
    return v === true || v === 'true';
  } catch {
    return false;
  }
}

function requestIsAdmin(req) {
  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded?.is_admin === true;
  } catch {
    return false;
  }
}

async function gatePublicStats(req, res, next) {
  if (await isPerformancePublicEnabled()) return next();
  if (requestIsAdmin(req)) return next();
  return res.status(403).json({ success: false, error: 'Performance dashboard is not public' });
}

// ── GET /api/picks/public-stats ────────────────────────────────────────────────

router.get('/public-stats', gatePublicStats, async (req, res) => {
  try {
    const data = await computePublicStats(req.query.period ?? '30');
    return res.json({ success: true, data });
  } catch (err) {
    if (err.code === 'INVALID_PERIOD') {
      return res.status(400).json({ success: false, error: err.message });
    }
    const msg = process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message;
    return res.status(500).json({ success: false, error: msg });
  }
});

export default router;
