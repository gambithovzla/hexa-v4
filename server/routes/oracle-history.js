import express from 'express';
import pool from '../db.js';
import { verifyToken, requireAdmin } from '../middleware/auth-middleware.js';

const router = express.Router();

/**
 * Upsert an oracle chat session. Called fire-and-forget from chat handlers.
 * @param {object} p
 * @param {string} p.userId
 * @param {string} p.sessionKey  — client-generated UUID, stable for the session lifetime
 * @param {string} p.dateEt      — YYYY-MM-DD in ET
 * @param {string} p.mode        — 'partido' | 'jornada'
 * @param {Array}  p.gameIds
 * @param {string} p.matchups    — human-readable label e.g. "NYY @ BOS"
 * @param {Array}  p.messages    — [{role, text}] full conversation
 */
export async function upsertOracleSession({ userId, sessionKey, dateEt, mode, gameIds, matchups, messages }) {
  try {
    await pool.query(
      `INSERT INTO oracle_sessions (user_id, session_key, date_et, mode, game_ids, matchups, messages, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, NOW())
       ON CONFLICT (session_key) DO UPDATE SET
         messages   = EXCLUDED.messages,
         updated_at = NOW()`,
      [userId, sessionKey, dateEt, mode, JSON.stringify(gameIds || []), matchups || '', JSON.stringify(messages || [])]
    );
  } catch (err) {
    console.warn('[oracle-history] session save failed (non-critical):', err.message);
  }
}

// GET /api/oracle/history — list days that have sessions (admin only)
router.get('/history', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        date_et,
        COUNT(*)                            AS session_count,
        SUM(jsonb_array_length(messages))   AS message_count
      FROM oracle_sessions
      GROUP BY date_et
      ORDER BY date_et DESC
      LIMIT 90
    `);
    res.json({ success: true, days: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/oracle/history/:date — sessions for a specific date (admin only)
router.get('/history/:date', verifyToken, requireAdmin, async (req, res) => {
  const { date } = req.params;
  try {
    const result = await pool.query(
      `SELECT id, session_key, mode, game_ids, matchups, messages, created_at, updated_at
       FROM oracle_sessions
       WHERE date_et = $1
       ORDER BY created_at DESC`,
      [date]
    );
    res.json({ success: true, sessions: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
