import express from 'express';
import pool from '../db.js';
import { verifyToken, requireAdmin } from '../middleware/auth-middleware.js';

const router = express.Router();

function getWeekStart(isoDate) {
  const d = new Date(isoDate + 'T12:00:00Z');
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // back to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function buildExplanation(pick, type) {
  const pickStr = pick.pick || pick.matchup || 'N/A';
  const conf = pick.oracle_confidence ? `${pick.oracle_confidence}%` : '—';
  const matchup = pick.matchup || '—';

  if (type === 'acierto') {
    return `${pickStr} confirmó en ${matchup}. Confianza Oracle: ${conf}. Los factores estadísticos clave convergieron correctamente — el modelo identificó el edge con precisión.`;
  }
  return `${pickStr} no confirmó en ${matchup} (Oracle: ${conf}). El pick estaba respaldado por datos sólidos. La varianza natural del béisbol — pitching imprevisible, contacto de baja frecuencia — determinó el resultado. Explicable, no un error de modelo.`;
}

// GET /api/insights — non-deleted insights, optional ?week=YYYY-MM-DD filter
router.get('/', async (req, res) => {
  const { week, type } = req.query;
  try {
    const filters = ['deleted_at IS NULL'];
    const params = [];

    if (week) {
      params.push(week);
      filters.push(`week_start = $${params.length}`);
    }

    if (type === 'acierto' || type === 'fallo') {
      params.push(type);
      filters.push(`type = $${params.length}`);
    }

    const limitClause = week ? '' : 'LIMIT 100';
    const { rows } = await pool.query(
      `SELECT id, type, title, explanation, pick_id, pick_data, week_start, created_at
       FROM hexa_insights
       WHERE ${filters.join(' AND ')}
       ORDER BY week_start DESC, created_at DESC
       ${limitClause}`,
      params
    );
    res.json({ success: true, insights: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/insights/admin/picks-recent — resolved picks from last 7 days (admin only)
router.get('/admin/picks-recent', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, matchup, pick, oracle_confidence, type, result, created_at, game_date
       FROM picks
       WHERE result IN ('win', 'loss', 'push')
         AND deleted_at IS NULL
         AND game_date >= CURRENT_DATE - INTERVAL '7 days'
       ORDER BY game_date DESC, created_at DESC
       LIMIT 60`
    );
    res.json({ success: true, picks: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/insights/generate-explanation — template explanation from pick (admin only)
router.post('/generate-explanation', verifyToken, requireAdmin, async (req, res) => {
  const { pick_id, type } = req.body;
  if (!pick_id || !type) {
    return res.status(400).json({ success: false, error: 'pick_id and type required' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, matchup, pick, oracle_confidence, type AS pick_type, result
       FROM picks WHERE id = $1 AND deleted_at IS NULL`,
      [pick_id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Pick not found' });
    const pick = rows[0];
    const explanation = buildExplanation(pick, type);
    const title = `${pick.pick || pick.matchup}`;
    res.json({ success: true, explanation, title });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/insights — publish an insight (admin only)
router.post('/', verifyToken, requireAdmin, async (req, res) => {
  const { type, title, explanation, pick_id, pick_data, week_start } = req.body;
  if (!type || !title || !explanation || !week_start) {
    return res.status(400).json({ success: false, error: 'type, title, explanation, week_start required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO hexa_insights (type, title, explanation, pick_id, pick_data, week_start)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING *`,
      [type, title, explanation, pick_id || null, JSON.stringify(pick_data || {}), week_start]
    );
    res.json({ success: true, insight: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/insights/:id — edit explanation or type (admin only)
router.put('/:id', verifyToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { type, title, explanation } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE hexa_insights
       SET type        = COALESCE($1, type),
           title       = COALESCE($2, title),
           explanation = COALESCE($3, explanation)
       WHERE id = $4 AND deleted_at IS NULL
       RETURNING *`,
      [type || null, title || null, explanation || null, id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, insight: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/insights/:id — soft delete (admin only)
router.delete('/:id', verifyToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `UPDATE hexa_insights SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export { getWeekStart };
export default router;
