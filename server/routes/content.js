/**
 * content.js — Read-only Content API (/api/content/v1/*).
 *
 * Consumer: external content-generation system (social media / marketing).
 * Auth: X-API-Key header via CONTENT_API_KEYS env var.
 * All endpoints do SELECTs only — no mutations, no Claude API calls.
 *
 * Mount in index.js:
 *   import contentRouter from './routes/content.js';
 *   app.use('/api/content/v1', contentLimiter, contentRouter);
 */

import { Router } from 'express';
import pool from '../db.js';
import { verifyContentApiKey } from '../middleware/content-api-key.js';
import { toPickDTO, toInsightDTO, toPostmortemDTO, toPerformanceDTO } from './content-dto.js';
import { computePublicStats } from '../services/public-stats.js';

const router = Router();

// Columns selected for picks queries — whitelist matches toPickDTO exactly.
// Sensitive columns (user_id, user_email, probability_model, value_breakdown,
// kelly_recommendation, clv, etc.) are intentionally not selected.
const PICK_COLUMNS = `
  id, type, matchup, pick, oracle_confidence, bet_value, model_risk,
  oracle_report, hexa_hunch, alert_flags, best_pick, model, language,
  result, odds_at_pick, game_pk, game_date, created_at,
  postmortem, postmortem_summary, postmortem_generated_at
`;

function logRequest(req, status) {
  const label = req.contentConsumer?.label ?? 'unknown';
  console.log(`[content-api] ${label} ${req.method} ${req.path} ${status}`);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Apply API-key auth to every route in this router.
router.use(verifyContentApiKey);

// ── GET /api/content/v1/picks/today ──────────────────────────────────────────
// Returns all picks for the current Eastern-time date, ordered by confidence.
// Optional query params: ?lang=en|es  ?model=deep|fast|haiku
router.get('/picks/today', async (req, res) => {
  try {
    const params = [];
    const filters = [
      `deleted_at IS NULL`,
      `game_date = ((NOW() AT TIME ZONE 'America/New_York')::date)`,
    ];

    if (req.query.lang === 'en' || req.query.lang === 'es') {
      params.push(req.query.lang);
      filters.push(`language = $${params.length}`);
    }
    const allowedModels = ['deep', 'fast', 'haiku'];
    if (allowedModels.includes(req.query.model)) {
      params.push(req.query.model);
      filters.push(`model = $${params.length}`);
    }

    const { rows } = await pool.query(
      `SELECT ${PICK_COLUMNS}
       FROM picks
       WHERE ${filters.join(' AND ')}
       ORDER BY oracle_confidence DESC NULLS LAST, created_at DESC`,
      params
    );
    logRequest(req, 200);
    return res.json({ success: true, count: rows.length, data: rows.map(toPickDTO) });
  } catch {
    logRequest(req, 500);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /api/content/v1/picks?from=YYYY-MM-DD&to=YYYY-MM-DD ──────────────────
// Date-range pick list. Max 30-day window; paginated via ?limit=&offset=.
router.get('/picks', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return res.status(400).json({
      success: false,
      error: 'from and to query params are required (YYYY-MM-DD)',
    });
  }
  const daysApart = (new Date(to) - new Date(from)) / 86_400_000;
  if (daysApart < 0 || daysApart > 30) {
    return res.status(400).json({ success: false, error: 'Date range must be 0–30 days' });
  }
  const limit  = Math.min(Math.max(parseInt(req.query.limit,  10) || 50, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  try {
    const { rows } = await pool.query(
      `SELECT ${PICK_COLUMNS}
       FROM picks
       WHERE deleted_at IS NULL
         AND game_date BETWEEN $1 AND $2
       ORDER BY game_date DESC, oracle_confidence DESC NULLS LAST, created_at DESC
       LIMIT $3 OFFSET $4`,
      [from, to, limit, offset]
    );
    logRequest(req, 200);
    return res.json({ success: true, count: rows.length, limit, offset, data: rows.map(toPickDTO) });
  } catch {
    logRequest(req, 500);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /api/content/v1/picks/:id ────────────────────────────────────────────
// Single pick by numeric id. Includes postmortem_available flag.
router.get('/picks/:id(\\d+)', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${PICK_COLUMNS}
       FROM picks
       WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows.length) {
      logRequest(req, 404);
      return res.status(404).json({ success: false, error: 'Pick not found' });
    }
    logRequest(req, 200);
    return res.json({ success: true, data: toPickDTO(rows[0]) });
  } catch {
    logRequest(req, 500);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /api/content/v1/postmortems/:pickId ───────────────────────────────────
// Narrative postmortem for a resolved pick (summary + key factors).
// Returns 404 if the pick has no postmortem yet.
router.get('/postmortems/:pickId(\\d+)', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, matchup, pick, result, game_date,
              postmortem, postmortem_summary, postmortem_generated_at
       FROM picks
       WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.pickId]
    );
    if (!rows.length) {
      logRequest(req, 404);
      return res.status(404).json({ success: false, error: 'Pick not found' });
    }
    const row = rows[0];
    if (!row.postmortem && !row.postmortem_summary) {
      logRequest(req, 404);
      return res.status(404).json({ success: false, error: 'Postmortem not yet available' });
    }
    logRequest(req, 200);
    return res.json({ success: true, data: toPostmortemDTO(row) });
  } catch {
    logRequest(req, 500);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /api/content/v1/insights?week=YYYY-MM-DD ─────────────────────────────
// Weekly editorial insights (aciertos/fallos). No week param = latest 100.
router.get('/insights', async (req, res) => {
  try {
    const { week } = req.query;
    const { rows } = (week && DATE_RE.test(week))
      ? await pool.query(
          `SELECT id, type, title, explanation, pick_id, week_start, created_at
           FROM hexa_insights
           WHERE deleted_at IS NULL AND week_start = $1
           ORDER BY created_at DESC`,
          [week]
        )
      : await pool.query(
          `SELECT id, type, title, explanation, pick_id, week_start, created_at
           FROM hexa_insights
           WHERE deleted_at IS NULL
           ORDER BY week_start DESC, created_at DESC
           LIMIT 100`
        );
    logRequest(req, 200);
    return res.json({ success: true, count: rows.length, data: rows.map(toInsightDTO) });
  } catch {
    logRequest(req, 500);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /api/content/v1/performance/summary?period=7|30|season ───────────────
// Public ROI / win-rate summary. Always available (no performance_public flag
// needed — this route is protected by API key instead).
router.get('/performance/summary', async (req, res) => {
  try {
    const stats = await computePublicStats(req.query.period ?? '30');
    logRequest(req, 200);
    return res.json({ success: true, data: toPerformanceDTO(stats) });
  } catch (err) {
    if (err.code === 'INVALID_PERIOD') {
      return res.status(400).json({ success: false, error: err.message });
    }
    logRequest(req, 500);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
