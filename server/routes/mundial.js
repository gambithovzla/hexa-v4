/**
 * server/routes/mundial.js — Mundial 2026 prediction game endpoints.
 *
 * GET  /api/mundial/matches          — public; upcoming WC matches + user's prediction if authed
 * POST /api/mundial/predict          — auth required; upsert a prediction (locked once match starts)
 * GET  /api/mundial/my-predictions   — auth; all user predictions with results
 * GET  /api/mundial/leaderboard      — public; top 50 predictors
 *
 * Scoring: exact score = +5 credits, correct result = +2 credits, wrong = 0.
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { verifyToken } from '../middleware/auth-middleware.js';
import { getSoccerGamesForDate } from '../soccer-api.js';

const router = Router();

function optionalAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    } catch {}
  }
  next();
}

function getDateRange(dateParam) {
  if (dateParam) return [dateParam];
  const dates = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

router.get('/matches', optionalAuth, async (req, res) => {
  try {
    const dates = getDateRange(req.query.date);
    const allGames = [];
    await Promise.allSettled(
      dates.map(async (date) => {
        const games = await getSoccerGamesForDate('fifa.world', date);
        allGames.push(...(games ?? []));
      })
    );
    allGames.sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate));

    let userPredictions = {};
    if (req.user?.userId) {
      const eventIds = allGames.map(g => g.id).filter(Boolean);
      if (eventIds.length) {
        const { rows } = await pool.query(
          `SELECT event_id, predicted_home, predicted_away, credits_earned, status
           FROM mundial_predictions WHERE user_id = $1 AND event_id = ANY($2)`,
          [req.user.userId, eventIds]
        );
        for (const r of rows) userPredictions[r.event_id] = r;
      }
    }

    const enriched = allGames.map(g => ({
      ...g,
      prediction: userPredictions[g.id] ?? null,
    }));

    res.json({ success: true, matches: enriched });
  } catch (err) {
    console.error(`[mundial] /matches error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/predict', verifyToken, async (req, res) => {
  const { eventId, homeTeam, awayTeam, gameDate, predictedHome, predictedAway } = req.body;
  if (!eventId || predictedHome == null || predictedAway == null) {
    return res.status(400).json({ success: false, error: 'eventId, predictedHome, predictedAway required' });
  }
  const ph = parseInt(predictedHome, 10);
  const pa = parseInt(predictedAway, 10);
  if (isNaN(ph) || isNaN(pa) || ph < 0 || pa < 0 || ph > 20 || pa > 20) {
    return res.status(400).json({ success: false, error: 'Scores must be 0-20' });
  }

  let games = [];
  try {
    games = await getSoccerGamesForDate('fifa.world', gameDate ?? new Date().toISOString().split('T')[0]);
  } catch {}
  const match = games.find(g => g.id === eventId);
  if (match && (match.status === 'live' || match.status === 'final')) {
    return res.status(400).json({ success: false, error: 'No puedes predecir un partido que ya empezó.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO mundial_predictions
         (user_id, event_id, home_team, away_team, game_date, predicted_home, predicted_away)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, event_id) DO UPDATE SET
         predicted_home = EXCLUDED.predicted_home,
         predicted_away = EXCLUDED.predicted_away,
         status = 'pending',
         credits_earned = 0,
         resolved_at = NULL
       RETURNING *`,
      [req.user.userId, eventId, homeTeam ?? '', awayTeam ?? '',
       gameDate ?? new Date().toISOString().split('T')[0], ph, pa]
    );
    res.json({ success: true, prediction: rows[0] });
  } catch (err) {
    console.error(`[mundial] predict error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/my-predictions', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mundial_predictions WHERE user_id = $1 ORDER BY game_date DESC, created_at DESC`,
      [req.user.userId]
    );
    const total = rows.reduce((s, r) => s + (r.credits_earned ?? 0), 0);
    const exact   = rows.filter(r => r.status === 'exact').length;
    const correct = rows.filter(r => r.status === 'correct').length;
    const wrong   = rows.filter(r => r.status === 'wrong').length;
    res.json({ success: true, predictions: rows, summary: { total_credits: total, exact, correct, wrong, pending: rows.filter(r => r.status === 'pending').length } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/leaderboard', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id,
        u.email,
        COALESCE(u.display_name, split_part(u.email, '@', 1)) AS username,
        SUM(mp.credits_earned)                                  AS total_credits,
        COUNT(*) FILTER (WHERE mp.status = 'exact')            AS exact_count,
        COUNT(*) FILTER (WHERE mp.status = 'correct')          AS correct_count,
        COUNT(*) FILTER (WHERE mp.status IN ('exact','correct','wrong')) AS resolved_count,
        COUNT(*) FILTER (WHERE mp.status = 'pending')          AS pending_count
      FROM mundial_predictions mp
      JOIN users u ON u.id = mp.user_id
      GROUP BY u.id, u.email, u.display_name
      ORDER BY total_credits DESC, exact_count DESC
      LIMIT 50
    `);
    res.json({ success: true, leaderboard: rows });
  } catch (err) {
    console.error(`[mundial] leaderboard error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
