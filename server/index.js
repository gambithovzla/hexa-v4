import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { getTodayGames, getTeams } from './mlb-api.js';
import { buildContext, buildContextById } from './context-builder.js';
import { analyzeGame, analyzeParlay } from './oracle.js';
import { getGameOdds, matchOddsToGame } from './odds-api.js';
import { getCacheStatus, refreshCache } from './savant-fetcher.js';
import authRouter, { bankrollRouter, seedAdminUser } from './auth.js';
import { verifyToken } from './middleware/auth-middleware.js';
import { runMigrations } from './migrate.js';
import pool from './db.js';
import lemonRouter from './lemon.js';
import { resolvePendingPicks } from './pick-resolver.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // eslint-disable-line no-unused-vars

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use('/api/lemon/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ── Auth routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',      authRouter);
app.use('/api/bankroll',  bankrollRouter);
app.use('/api/lemon',     lemonRouter);

// ── Credit helpers ────────────────────────────────────────────────────────────

const CREDIT_COSTS = {
  single:  { fast: 1,  deep: 2  },
  parlay:  { fast: 4,  deep: 8  },
};
const WEB_INTEL_COST = 3; // only applied to single-game

function calcServerCost(type, model, webSearch) {
  const base = CREDIT_COSTS[type]?.[model] ?? 1;
  const webBonus = (type === 'single' && webSearch) ? WEB_INTEL_COST : 0;
  return base + webBonus;
}

/**
 * deductCredits(req, res, cost)
 * Looks up the user in PostgreSQL, checks credits, deducts `cost` atomically.
 * Admin account bypasses deduction entirely.
 * Returns the updated user row, or null after sending an error response.
 */
async function deductCredits(req, res, cost) {
  const { rows } = await pool.query(
    'SELECT id, email, credits FROM users WHERE id = $1',
    [req.user.id]
  );
  const user = rows[0];
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  // Admin account bypasses credit deduction
  if (user.email === 'admin@hexa.com') return user;
  if (user.credits < cost) {
    res.status(403).json({ error: 'No credits remaining' });
    return null;
  }
  const updated = await pool.query(
    'UPDATE users SET credits = credits - $1 WHERE id = $2 RETURNING id, email, credits',
    [cost, user.id]
  );
  return updated.rows[0];
}

/**
 * refundCredits(userId, cost, email)
 * Adds `cost` credits back to the user account.
 * Admin accounts are skipped (they were never charged).
 */
async function refundCredits(userId, cost, email) {
  if (email === 'admin@hexa.com') return;
  try {
    await pool.query(
      'UPDATE users SET credits = credits + $1 WHERE id = $2',
      [cost, String(userId)]
    );
    console.log(`[Credits] Refunding ${cost} credits to user ${userId} due to analysis failure`);
  } catch (err) {
    console.error(`[Credits] Refund failed for user ${userId}:`, err.message);
  }
}

// GET /api/games?date=YYYY-MM-DD
app.get('/api/games', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const games = await getTodayGames(date);
    res.json({ success: true, data: games });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/odds/today
app.get('/api/odds/today', async (req, res) => {
  try {
    const odds = await getGameOdds();
    res.json({ success: true, data: odds });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/teams
app.get('/api/teams', async (req, res) => {
  try {
    const teams = await getTeams();
    res.json({ success: true, data: teams });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/games/:gameId/context  — devuelve el contexto en texto plano
app.get('/api/games/:gameId/context', async (req, res) => {
  try {
    const context = await buildContextById(req.params.gameId);
    res.json({ success: true, data: context });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/analyze/game  — requires auth, costs 1 (fast) or 2 (deep) + 3 if webSearch
app.post('/api/analyze/game', verifyToken, async (req, res) => {
  const {
    gameId,
    language    = 'en',
    lang,
    betType,
    riskProfile = 'medium',
    webSearch   = false,
    model       = 'fast',
  } = req.body;
  const date         = req.body.date || new Date().toISOString().split('T')[0];
  const resolvedLang = lang ?? language;
  const cost         = calcServerCost('single', model, webSearch);

  try {
    let games    = await getTodayGames(date);
    let gameData = games.find(g => String(g.gamePk) === String(gameId));

    if (!gameData) {
      // Retry with today's explicit date in case the caller passed a stale/different date
      const todayStr = new Date().toISOString().split('T')[0];
      if (todayStr !== date) {
        const retryGames = await getTodayGames(todayStr);
        console.log(`[index] gamePk ${gameId} not found in date=${date}; retrying with today=${todayStr}. ` +
          `Found gamePks: [${retryGames.map(g => g.gamePk).join(', ')}]`);
        gameData = retryGames.find(g => String(g.gamePk) === String(gameId));
        if (gameData) games = retryGames;
      } else {
        console.log(`[index] gamePk ${gameId} not found. Available gamePks for ${date}: [${games.map(g => g.gamePk).join(', ')}]`);
      }
    }

    if (!gameData) return res.status(404).json({ success: false, error: `Partido ${gameId} no encontrado` });

    let matchedOdds = null;
    try {
      const allOdds = await getGameOdds();
      matchedOdds = matchOddsToGame(allOdds, gameData.teams?.home?.name, gameData.teams?.away?.name);
    } catch { /* odds are optional */ }

    const updatedUser = await deductCredits(req, res, cost);
    if (!updatedUser) return;

    let analysis;
    try {
      const context = await buildContext(gameData, matchedOdds);
      const matchup = `${gameData.teams?.away?.abbreviation ?? 'AWAY'} @ ${gameData.teams?.home?.abbreviation ?? 'HOME'}`;
      analysis = await analyzeGame({ matchup, betType, context, riskProfile, mode: 'single', lang: resolvedLang, webSearch, model, timeoutMs: 90000 });
    } catch (err) {
      await refundCredits(updatedUser.id, cost, updatedUser.email);
      const isTimeout = err.message === 'TIMEOUT';
      return res.status(500).json({
        success: false,
        error: isTimeout
          ? 'El análisis tardó demasiado. Créditos reembolsados. Por favor reintenta.'
          : 'Análisis fallido. Tus créditos han sido reembolsados.',
      });
    }

    const responseData = analysis.data ? { ...analysis.data, odds: matchedOdds ?? undefined } : null;
    res.json({ success: true, data: responseData, parseError: analysis.parseError, rawText: analysis.rawText, credits: updatedUser.credits });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/analyze/parlay  — requires auth, costs 4 (fast) or 8 (deep) credits
app.post('/api/analyze/parlay', verifyToken, async (req, res) => {
  const {
    gameIds,
    language    = 'en',
    lang,
    betType,
    riskProfile = 'medium',
    webSearch   = false,
    parlayLegs,
    model       = 'fast',
  } = req.body;
  const date         = req.body.date || new Date().toISOString().split('T')[0];
  const resolvedLang = lang ?? language;
  const cost         = calcServerCost('parlay', model, false);

  try {
    const games = await getTodayGames(date);

    let allOdds = [];
    try { allOdds = await getGameOdds(); } catch { /* optional */ }

    const legOddsArr = gameIds.map(id => {
      const gameData = games.find(g => String(g.gamePk) === String(id));
      if (!gameData) return null;
      return matchOddsToGame(allOdds, gameData.teams?.home?.name, gameData.teams?.away?.name);
    });

    const updatedUser = await deductCredits(req, res, cost);
    if (!updatedUser) return;

    let analysis;
    try {
      const contexts = await Promise.all(
        gameIds.map(async (id, i) => {
          const gameData = games.find(g => String(g.gamePk) === String(id));
          if (!gameData) throw new Error(`Partido ${id} no encontrado`);
          return buildContext(gameData, legOddsArr[i] ?? null);
        })
      );
      analysis = await analyzeParlay(contexts, resolvedLang, { betType, riskProfile, webSearch, legs: parlayLegs, model, timeoutMs: 90000 });
    } catch (err) {
      await refundCredits(updatedUser.id, cost, updatedUser.email);
      const isTimeout = err.message === 'TIMEOUT';
      return res.status(500).json({
        success: false,
        error: isTimeout
          ? 'El análisis tardó demasiado. Créditos reembolsados. Por favor reintenta.'
          : 'Análisis fallido. Tus créditos han sido reembolsados.',
      });
    }

    const responseData = analysis.data
      ? { ...analysis.data, legOdds: legOddsArr.some(Boolean) ? legOddsArr : undefined }
      : null;
    res.json({ success: true, data: responseData, parseError: analysis.parseError, rawText: analysis.rawText, credits: updatedUser.credits });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/savant/status
app.get('/api/savant/status', (_req, res) => {
  try {
    res.json({ success: true, data: getCacheStatus() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/savant/refresh
app.post('/api/savant/refresh', async (_req, res) => {
  try {
    await refreshCache();
    res.json({ success: true, data: getCacheStatus() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/picks/resolve — manually trigger pick resolution (admin/testing)
app.get('/api/picks/resolve', verifyToken, async (_req, res) => {
  try {
    const summary = await resolvePendingPicks();
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/picks — guarda un pick en el historial
app.post('/api/picks', verifyToken, async (req, res) => {
  try {
    const {
      type, matchup, pick, oracle_confidence, bet_value,
      model_risk, oracle_report, hexa_hunch, alert_flags,
      probability_model, best_pick, model, language,
    } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO picks (user_id, type, matchup, pick, oracle_confidence, bet_value, model_risk, oracle_report, hexa_hunch, alert_flags, probability_model, best_pick, model, language)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.user.id, type, matchup, pick, oracle_confidence, bet_value, model_risk, oracle_report, hexa_hunch,
       JSON.stringify(alert_flags ?? []), JSON.stringify(probability_model ?? {}), JSON.stringify(best_pick ?? {}), model, language]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/picks — obtiene el historial del usuario
app.get('/api/picks', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM picks WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/picks/:id — actualiza resultado (win/loss/pending)
app.patch('/api/picks/:id', verifyToken, async (req, res) => {
  try {
    const { result } = req.body;
    const { rows } = await pool.query(
      'UPDATE picks SET result = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [result, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Pick not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Startup: run migrations → seed admin → start server ───────────────────────
runMigrations()
  .then(() => seedAdminUser())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Hexa-v4 server running on http://localhost:${PORT}`);

      // ── Statcast cache warm-up (non-blocking, delayed 30s) ──────────────
      console.log('[H.E.X.A.] Statcast cache warm-up programado en 30s...');
      setTimeout(() => {
        console.log('[H.E.X.A.] Warming up Statcast cache...');
        refreshCache()
          .then(status => {
            const total = Object.values(status?.recordCounts ?? {}).reduce((a, b) => a + b, 0);
            console.log(`[H.E.X.A.] Statcast cache ready: ${total} records loaded`);
          })
          .catch(err => {
            console.warn('[H.E.X.A.] Statcast warm-up failed (will retry on first request):', err.message);
          });
      }, 30000).unref();

      // ── Auto-refresh every 6 hours ───────────────────────────────────────
      const SIX_HOURS = 6 * 60 * 60 * 1000;
      setInterval(() => {
        console.log('[H.E.X.A.] Refreshing Statcast cache (scheduled)...');
        refreshCache()
          .then(status => {
            const total = Object.values(status?.recordCounts ?? {}).reduce((a, b) => a + b, 0);
            console.log(`[H.E.X.A.] Statcast cache refreshed: ${total} records`);
          })
          .catch(err => {
            console.warn('[H.E.X.A.] Scheduled Statcast refresh failed:', err.message);
          });
      }, SIX_HOURS).unref();

      // ── Pick resolver: every 30 min between 10pm–3am ET ──────────────────
      const THIRTY_MIN = 30 * 60 * 1000;
      setInterval(() => {
        // Get current hour in US Eastern Time (handles EDT/EST automatically)
        const etHour = parseInt(
          new Intl.DateTimeFormat('en-US', {
            hour: 'numeric', hour12: false, timeZone: 'America/New_York',
          }).format(new Date()),
          10
        );
        // Window: 22:00–02:59 ET (when MLB games finish)
        if (etHour >= 22 || etHour < 3) {
          console.log(`[pick-resolver] Scheduled run triggered (ET hour: ${etHour})`);
          resolvePendingPicks().catch(err => {
            console.error('[pick-resolver] Scheduled run failed:', err.message);
          });
        }
      }, THIRTY_MIN).unref();
    });
  })
  .catch(err => {
    console.error('[H.E.X.A.] Startup failed:', err.message);
    process.exit(1);
  });
