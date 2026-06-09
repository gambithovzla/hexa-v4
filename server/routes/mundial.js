/**
 * server/routes/mundial.js — Mundial 2026 prediction game.
 *
 * GET  /api/mundial/all-matches    public; full WC schedule (cached 10min) + user predictions
 * POST /api/mundial/predict        auth; submit/update 1X2 prediction for a match
 * GET  /api/mundial/my-predictions auth; user's full history + summary
 * GET  /api/mundial/leaderboard    public; top 50 predictors
 *
 * Scoring: correct H or A = +2 credits, correct Draw = +3 credits, wrong = 0.
 * Predictions lock the moment a match goes live.
 */

import { Router }       from 'express';
import jwt              from 'jsonwebtoken';
import pool             from '../db.js';
import { verifyToken }  from '../middleware/auth-middleware.js';
import { getSoccerGamesForDate } from '../soccer-api.js';

const router = Router();

// ── optional auth ─────────────────────────────────────────────────────────
function optionalAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try { req.user = jwt.verify(auth.slice(7), process.env.JWT_SECRET); } catch {}
  }
  next();
}

// ── WC 2026 schedule ───────────────────────────────────────────────────────
// Group stage Jun 11 → ~Jul 2; knockouts Jul 4 → Jul 23
function getWc2026Dates() {
  const dates = [];
  const end = new Date('2026-07-23T00:00:00Z');
  for (let d = new Date('2026-06-11T00:00:00Z'); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

// Server-side cache (10 min) for the full schedule
let _allGames = null;
let _allGamesAt = 0;
const ALL_GAMES_TTL = 10 * 60 * 1000;

async function fetchAllWcMatches() {
  if (_allGames && Date.now() - _allGamesAt < ALL_GAMES_TTL) return _allGames;
  const results = await Promise.allSettled(
    getWc2026Dates().map(d => getSoccerGamesForDate('fifa.world', d))
  );
  const all = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const g of (r.value ?? [])) {
        all.push({
          eventId:   g.gameId ?? String(g.gamePk),
          homeTeam:  g.teams?.home?.name ?? 'TBD',
          awayTeam:  g.teams?.away?.name ?? 'TBD',
          gameDate:  (g.gameDate ?? '').split('T')[0],
          gameTime:  g.gameDate ?? null,
          status:    g.status,
          homeScore: g.teams?.home?.score ?? null,
          awayScore: g.teams?.away?.score ?? null,
          venue:     g.venue ?? null,
        });
      }
    }
  }
  all.sort((a, b) => new Date(a.gameTime ?? a.gameDate) - new Date(b.gameTime ?? b.gameDate));
  _allGames = all;
  _allGamesAt = Date.now();
  return all;
}

// GET /api/mundial/all-matches
router.get('/all-matches', optionalAuth, async (req, res) => {
  try {
    const games = await fetchAllWcMatches();

    let preds = {};
    if (req.user?.userId && games.length) {
      const eventIds = games.map(g => g.eventId).filter(Boolean);
      const { rows } = await pool.query(
        `SELECT event_id, predicted_side, credits_earned, status
         FROM mundial_predictions WHERE user_id = $1 AND event_id = ANY($2)`,
        [req.user.userId, eventIds]
      );
      for (const r of rows) preds[r.event_id] = r;
    }

    const enriched = games.map(g => ({ ...g, prediction: preds[g.eventId] ?? null }));
    res.json({ success: true, matches: enriched });
  } catch (err) {
    console.error(`[mundial] all-matches error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/mundial/predict
router.post('/predict', verifyToken, async (req, res) => {
  const { eventId, homeTeam, awayTeam, gameDate, predictedSide } = req.body;
  if (!eventId || !['H', 'D', 'A'].includes(predictedSide)) {
    return res.status(400).json({ success: false, error: 'eventId y predictedSide (H|D|A) son requeridos' });
  }

  // Guard: check match hasn't started
  if (gameDate) {
    try {
      const games = await getSoccerGamesForDate('fifa.world', gameDate);
      const match = games.find(g => (g.gameId ?? String(g.gamePk)) === eventId);
      if (match && (match.status === 'live' || match.status === 'final')) {
        return res.status(400).json({ success: false, error: 'No puedes predecir un partido que ya empezó.' });
      }
    } catch {}
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO mundial_predictions
         (user_id, event_id, home_team, away_team, game_date, predicted_side)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, event_id) DO UPDATE SET
         predicted_side = EXCLUDED.predicted_side,
         status         = CASE WHEN mundial_predictions.status IN ('correct','wrong') THEN mundial_predictions.status ELSE 'pending' END,
         credits_earned = CASE WHEN mundial_predictions.status IN ('correct','wrong') THEN mundial_predictions.credits_earned ELSE 0 END
       RETURNING event_id, predicted_side, status, credits_earned`,
      [req.user.userId, eventId, homeTeam ?? '', awayTeam ?? '', gameDate ?? '2026-06-11', predictedSide]
    );
    res.json({ success: true, prediction: rows[0] });
  } catch (err) {
    console.error(`[mundial] predict error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/mundial/my-predictions
router.get('/my-predictions', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mundial_predictions WHERE user_id=$1 ORDER BY game_date DESC, created_at DESC`,
      [req.user.userId]
    );
    const sum = rows.reduce((s, r) => s + (r.credits_earned ?? 0), 0);
    res.json({
      success: true,
      predictions: rows,
      summary: {
        total_credits: sum,
        correct: rows.filter(r => r.status === 'correct').length,
        wrong:   rows.filter(r => r.status === 'wrong').length,
        pending: rows.filter(r => r.status === 'pending').length,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/mundial/leaderboard
router.get('/leaderboard', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id,
        COALESCE(u.display_name, split_part(u.email,'@',1)) AS username,
        SUM(mp.credits_earned)                               AS total_credits,
        COUNT(*) FILTER (WHERE mp.status='correct')          AS correct_count,
        COUNT(*) FILTER (WHERE mp.status IN ('correct','wrong')) AS resolved_count
      FROM mundial_predictions mp
      JOIN users u ON u.id = mp.user_id
      GROUP BY u.id, u.email, u.display_name
      ORDER BY total_credits DESC, correct_count DESC
      LIMIT 50
    `);
    res.json({ success: true, leaderboard: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
