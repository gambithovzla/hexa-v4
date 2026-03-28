import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { getTodayGames, getTeams } from './mlb-api.js';
import { buildContext, buildContextById } from './context-builder.js';
import { analyzeGame, analyzeParlay, analyzeSafe, analyzeChat } from './oracle.js';
import { getGameOdds, matchOddsToGame, calculateImpliedProbability } from './odds-api.js';
import { getCacheStatus, refreshCache, getPitcherStatcast, getBatterStatcast } from './savant-fetcher.js';
import authRouter, { bankrollRouter, seedAdminUser } from './auth.js';
import { verifyToken } from './middleware/auth-middleware.js';
import { runMigrations } from './migrate.js';
import pool from './db.js';
import lemonRouter from './lemon.js';
import { handleBMCWebhook } from './bmc-webhook.js';
import { resolvePendingPicks } from './pick-resolver.js';
import { captureClosingLines } from './closing-line-capture.js';
import { captureOddsSnapshot, getLineMovement } from './line-movement.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // eslint-disable-line no-unused-vars

// ── Safe error helper — never leak internal details to client ──────────────
function safeError(err) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[H.E.X.A. Error]', err.message, err.stack?.split('\n')[1]);
    return 'Internal server error';
  }
  return err.message;
}

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ── CORS: strict origin (must be first) ───────────────────────────────────────
app.use(cors({
  origin: ['https://hexaoracle.lat', 'https://www.hexaoracle.lat', 'http://localhost:5173', /\.vercel\.app$/],
  credentials: true,
}));

// ── Security: HTTP headers ─────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://hexaoracle.lat", "https://www.hexaoracle.lat", "https://hexa-v4-production.up.railway.app"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com", "https://fonts.googleapis.com"],
      objectSrc:  ["'none'"],
      frameSrc:   ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// ── Rate limiting: 100 req / 15 min per IP (webhooks exempt) ──────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    req.path.startsWith('/api/lemon/webhook') ||
    req.path.startsWith('/api/bmc/webhook'),
});
app.use(limiter);

// ── Strict rate limiting for analysis endpoints (consume Anthropic API) ───────
const analysisLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute window
  max: 10,               // max 10 analysis requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many analysis requests. Please wait a moment.' },
});

// ── Body parsers (raw must come before json for webhook routes) ────────────────
app.use('/api/lemon/webhook', express.raw({ type: 'application/json' }));
app.use('/api/bmc/webhook',   express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));

// ── Auth routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',      authRouter);
app.use('/api/bankroll',  bankrollRouter);
app.use('/api/lemon',     lemonRouter);
app.post('/api/bmc/webhook', handleBMCWebhook);

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
  if (user.email === 'cdanielrr@hotmail.com') return user;
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
  if (email === 'cdanielrr@hotmail.com') return;
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

// ── Admin middleware ───────────────────────────────────────────────────────────

function isAdmin(req, res, next) {
  if (req.user.email !== 'cdanielrr@hotmail.com') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// GET /api/games?date=YYYY-MM-DD
app.get('/api/games', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const games = await getTodayGames(date);
    res.json({ success: true, data: games });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/odds/today
app.get('/api/odds/today', async (req, res) => {
  try {
    const odds = await getGameOdds();
    res.json({ success: true, data: odds });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/teams
app.get('/api/teams', async (req, res) => {
  try {
    const teams = await getTeams();
    res.json({ success: true, data: teams });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/games/:gameId/context  — devuelve el contexto en texto plano
app.get('/api/games/:gameId/context', verifyToken, async (req, res) => {
  try {
    const context = await buildContextById(req.params.gameId);
    res.json({ success: true, data: context });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/analyze/game  — requires auth, costs 1 (fast) or 2 (deep) + 3 if webSearch
app.post('/api/analyze/game', analysisLimiter, verifyToken, async (req, res) => {
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
  // Input validation
  if (!gameId) return res.status(400).json({ success: false, error: 'gameId is required' });
  if (model && !['fast', 'deep'].includes(model)) return res.status(400).json({ success: false, error: 'Invalid model' });
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, error: 'Invalid date format' });
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

    // Fetch user bankroll for Kelly Criterion calculation
    let userBankroll = null;
    try {
      const brResult = await pool.query(
        'SELECT current_bankroll FROM bankroll WHERE user_id = $1',
        [req.user.id]
      );
      if (brResult.rows.length > 0) {
        userBankroll = parseFloat(brResult.rows[0].current_bankroll);
      }
    } catch { /* bankroll is optional — never block the analysis */ }

    let analysis;
    try {
      const context = await buildContext(gameData, matchedOdds);
      const matchup = `${gameData.teams?.away?.abbreviation ?? 'AWAY'} @ ${gameData.teams?.home?.abbreviation ?? 'HOME'}`;

      // Construir statcastData para el validador XGBoost.
      // Los datos ya están en caché desde buildContext, por lo que no hay overhead.
      let statcastData = null;
      try {
        const homePitcherName = gameData.teams?.home?.probablePitcher?.fullName;
        const awayPitcherName = gameData.teams?.away?.probablePitcher?.fullName;

        const [homePitcherStat, awayPitcherStat] = await Promise.all([
          homePitcherName ? getPitcherStatcast(homePitcherName) : Promise.resolve(null),
          awayPitcherName ? getPitcherStatcast(awayPitcherName) : Promise.resolve(null),
        ]);

        // Calcular xwOBA y wOBA promedios de la alineación local y visitante
        const buildLineupStats = async (lineupArr) => {
          if (!lineupArr?.length) return { avg_xwOBA: null, avg_woba_7d: null };
          const stats = await Promise.all(
            lineupArr.slice(0, 5).map(p => getBatterStatcast(p.fullName).catch(() => null))
          );
          const valid = stats.filter(s => s?.xwOBA != null);
          if (!valid.length) return { avg_xwOBA: null, avg_woba_7d: null };
          const avg_xwOBA  = valid.reduce((s, p) => s + p.xwOBA, 0) / valid.length;
          const avg_woba_7d = valid.reduce((s, p) => s + (p.rolling_windows?.woba_7d ?? p.xwOBA), 0) / valid.length;
          return { avg_xwOBA, avg_woba_7d };
        };

        const [homeLineup, awayLineup] = await Promise.all([
          buildLineupStats(gameData.lineups?.home),
          buildLineupStats(gameData.lineups?.away),
        ]);

        statcastData = {
          homePitcher: homePitcherStat,
          awayPitcher: awayPitcherStat,
          homeLineup,
          awayLineup,
        };
      } catch (statcastErr) {
        console.warn('[index] statcastData build failed (non-critical):', statcastErr.message);
      }

      analysis = await analyzeGame({
        matchup, betType, context, riskProfile,
        mode: 'single', lang: resolvedLang, webSearch, model, timeoutMs: 90000,
        statcastData,
        mlbApiData: gameData,
        userBankroll,
      });
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
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/analyze/parlay  — requires auth, costs 4 (fast) or 8 (deep) credits
app.post('/api/analyze/parlay', analysisLimiter, verifyToken, async (req, res) => {
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
  // Input validation
  if (!gameIds || !Array.isArray(gameIds) || gameIds.length === 0) return res.status(400).json({ success: false, error: 'gameIds array is required' });
  if (gameIds.length > 10) return res.status(400).json({ success: false, error: 'Maximum 10 games per parlay' });
  if (model && !['fast', 'deep'].includes(model)) return res.status(400).json({ success: false, error: 'Invalid model' });
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
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/analyze/safe — Safe Pick mode (highest probability pick across all bet types)
app.post('/api/analyze/safe', analysisLimiter, verifyToken, async (req, res) => {
  const { gameId, lang = 'en', date } = req.body;
  const resolvedDate = date || new Date().toISOString().split('T')[0];
  // Input validation
  if (!gameId) return res.status(400).json({ success: false, error: 'gameId is required' });
  const cost = 2; // Same as deep single

  try {
    let games    = await getTodayGames(resolvedDate);
    let gameData = games.find(g => String(g.gamePk) === String(gameId));

    if (!gameData) {
      const todayStr = new Date().toISOString().split('T')[0];
      if (todayStr !== resolvedDate) {
        const retryGames = await getTodayGames(todayStr);
        gameData = retryGames.find(g => String(g.gamePk) === String(gameId));
        if (gameData) games = retryGames;
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
      const contextString = await buildContext(gameData, matchedOdds);
      analysis = await analyzeSafe({ contextString, lang });
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

    res.json({
      success: true,
      data:    analysis.data,
      parseError: analysis.parseError,
      rawText: analysis.rawText,
      credits: updatedUser.credits,
      mode:    'safe',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/admin/grant-credits — Manually add credits to a user (admin only)
app.post('/api/admin/grant-credits', verifyToken, isAdmin, async (req, res) => {
  const { email, amount } = req.body;

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'email is required' });
  }
  if (amount === undefined || amount === null) {
    return res.status(400).json({ error: 'amount is required' });
  }
  const parsedAmount = Number(amount);
  if (!Number.isInteger(parsedAmount) || parsedAmount === 0) {
    return res.status(400).json({ error: 'amount must be a non-zero integer' });
  }

  try {
    const { rows } = await pool.query(
      'UPDATE users SET credits = credits + $2 WHERE email = $1 RETURNING credits',
      [email.toLowerCase().trim(), parsedAmount]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: `User with email '${email}' not found` });
    }

    console.log(`[Admin] Granted ${parsedAmount} credits to ${email}. New balance: ${rows[0].credits}`);
    res.json({ success: true, email: email.toLowerCase().trim(), credits: rows[0].credits });
  } catch (err) {
    console.error('[Admin] grant-credits error:', err.message);
    res.status(500).json({ error: 'Failed to update credits', details: safeError(err) });
  }
});

// POST /api/analyze/chat — Direct chat with Oracle (admin only, no credits)
app.post('/api/analyze/chat', analysisLimiter, verifyToken, isAdmin, async (req, res) => {
  const { gameId, question, conversationHistory = [], lang = 'en', date } = req.body;

  if (!question || !question.trim()) {
    return res.status(400).json({ error: 'Question is required' });
  }

  try {
    const resolvedDate = date || new Date().toISOString().split('T')[0];
    let games    = await getTodayGames(resolvedDate);
    let gameData = games.find(g => String(g.gamePk) === String(gameId));

    if (!gameData) {
      const todayStr = new Date().toISOString().split('T')[0];
      if (todayStr !== resolvedDate) {
        const retryGames = await getTodayGames(todayStr);
        gameData = retryGames.find(g => String(g.gamePk) === String(gameId));
        if (gameData) games = retryGames;
      }
    }

    if (!gameData) return res.status(404).json({ success: false, error: `Partido ${gameId} no encontrado` });

    let matchedOdds = null;
    try {
      const allOdds = await getGameOdds();
      matchedOdds = matchOddsToGame(allOdds, gameData.teams?.home?.name, gameData.teams?.away?.name);
    } catch { /* odds are optional */ }

    const contextString = await buildContext(gameData, matchedOdds);

    const answer = await analyzeChat({
      contextString,
      question: question.trim(),
      conversationHistory,
      lang,
    });

    res.json({
      success: true,
      answer,
      mode: 'chat',
    });
  } catch (err) {
    console.error('[Oracle Chat] Error:', err);
    res.status(500).json({ error: 'Chat failed', details: safeError(err) });
  }
});

// GET /api/auth/is-admin — check if the authenticated user is admin
app.get('/api/auth/is-admin', verifyToken, (req, res) => {
  res.json({ isAdmin: req.user.email === 'cdanielrr@hotmail.com' });
});

// GET /api/savant/status
app.get('/api/savant/status', (_req, res) => {
  try {
    res.json({ success: true, data: getCacheStatus() });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/savant/refresh
app.post('/api/savant/refresh', verifyToken, isAdmin, async (_req, res) => {
  try {
    await refreshCache();
    res.json({ success: true, data: getCacheStatus() });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/picks/resolve — manually trigger pick resolution (admin/testing)
app.get('/api/picks/resolve', verifyToken, async (_req, res) => {
  try {
    const summary = await resolvePendingPicks();
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/picks — guarda un pick en el historial
app.post('/api/picks', verifyToken, async (req, res) => {
  try {
    const {
      type, matchup, pick, oracle_confidence, bet_value,
      model_risk, oracle_report, hexa_hunch, alert_flags,
      probability_model, best_pick, model, language,
      odds_at_pick, odds_details,
    } = req.body;

    // Calculate implied probability server-side from the American odds provided by the client
    const implied_prob_at_pick = odds_at_pick != null
      ? calculateImpliedProbability(odds_at_pick)
      : null;

    const { rows } = await pool.query(
      `INSERT INTO picks (
         user_id, type, matchup, pick, oracle_confidence, bet_value, model_risk,
         oracle_report, hexa_hunch, alert_flags, probability_model, best_pick,
         model, language, odds_at_pick, implied_prob_at_pick, odds_details
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [
        req.user.id, type, matchup, pick, oracle_confidence, bet_value, model_risk,
        oracle_report, hexa_hunch,
        JSON.stringify(alert_flags ?? []), JSON.stringify(probability_model ?? {}),
        JSON.stringify(best_pick ?? {}), model, language,
        odds_at_pick ?? null,
        implied_prob_at_pick,
        odds_details != null ? JSON.stringify(odds_details) : null,
      ]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/picks/clv-stats — CLV dashboard stats for authenticated user
app.get('/api/picks/clv-stats', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Aggregate stats for picks with CLV data
    const { rows: [stats] } = await pool.query(`
      SELECT
        COUNT(*)                                              AS "totalPicks",
        COUNT(*) FILTER (WHERE clv IS NOT NULL)              AS "picksWithCLV",
        ROUND(AVG(clv) FILTER (WHERE clv IS NOT NULL), 2)   AS "avgCLV",
        COUNT(*) FILTER (WHERE clv > 0)                     AS "positiveCLV",
        COUNT(*) FILTER (WHERE clv < 0)                     AS "negativeCLV"
      FROM picks
      WHERE user_id = $1
    `, [userId]);

    // Last 20 picks with CLV fields
    const { rows: recentPicks } = await pool.query(`
      SELECT id, matchup, pick, model, result,
             odds_at_pick, implied_prob_at_pick,
             closing_odds, implied_prob_closing, clv,
             created_at
      FROM picks
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 20
    `, [userId]);

    // Group by bet type (parsed from pick string in JS to avoid SQL regex complexity)
    const betTypeMap = { moneyline: { count: 0, totalCLV: 0 }, runline: { count: 0, totalCLV: 0 }, over_under: { count: 0, totalCLV: 0 } };
    const modelMap   = {};

    const { rows: allWithCLV } = await pool.query(`
      SELECT pick, model, clv FROM picks WHERE user_id = $1 AND clv IS NOT NULL
    `, [userId]);

    for (const row of allWithCLV) {
      const p = (row.pick ?? '').toLowerCase();
      let betType = 'moneyline';
      if (/over|under|m[aá]s\s+de|menos\s+de|alta|baja/i.test(p)) betType = 'over_under';
      else if (/run\s+line|rl|l[ií]nea\s+de\s+carrera/i.test(p)) betType = 'runline';

      betTypeMap[betType].count++;
      betTypeMap[betType].totalCLV += parseFloat(row.clv);

      const m = row.model ?? 'unknown';
      if (!modelMap[m]) modelMap[m] = { count: 0, totalCLV: 0 };
      modelMap[m].count++;
      modelMap[m].totalCLV += parseFloat(row.clv);
    }

    const clvByBetType = {};
    for (const [key, val] of Object.entries(betTypeMap)) {
      clvByBetType[key] = {
        count:  val.count,
        avgCLV: val.count > 0 ? Math.round((val.totalCLV / val.count) * 100) / 100 : null,
      };
    }

    const clvByModel = {};
    for (const [key, val] of Object.entries(modelMap)) {
      clvByModel[key] = {
        count:  val.count,
        avgCLV: val.count > 0 ? Math.round((val.totalCLV / val.count) * 100) / 100 : null,
      };
    }

    res.json({
      success: true,
      data: {
        totalPicks:   parseInt(stats.totalPicks),
        picksWithCLV: parseInt(stats.picksWithCLV),
        avgCLV:       stats.avgCLV != null ? parseFloat(stats.avgCLV) : null,
        positiveCLV:  parseInt(stats.positiveCLV),
        negativeCLV:  parseInt(stats.negativeCLV),
        clvByBetType,
        clvByModel,
        recentPicks,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
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
    res.status(500).json({ success: false, error: safeError(err) });
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
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// DELETE /api/picks/:id — elimina un pick individual del historial
app.delete('/api/picks/:id', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM picks WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Pick not found' });
    res.json({ success: true, id: rows[0].id });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// DELETE /api/picks — elimina todo el historial del usuario autenticado
app.delete('/api/picks', verifyToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM picks WHERE user_id = $1', [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/odds/movement — line movement data for a specific game
app.get('/api/odds/movement', verifyToken, async (req, res) => {
  try {
    const { home, away, date } = req.query;
    if (!home || !away || !date) {
      return res.status(400).json({ success: false, error: 'home, away and date query params are required' });
    }
    const movement = await getLineMovement(home, away, date);
    if (!movement) {
      return res.json({ success: true, data: null, message: 'Not enough snapshots for line movement (need at least 2)' });
    }
    res.json({ success: true, data: movement });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// ── Startup: run migrations → seed admin → start server ───────────────────────
runMigrations()
  .then(() => seedAdminUser())
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Hexa-v4 server running on http://0.0.0.0:${PORT}`);

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

      // ── Line movement snapshot: every 3 hours between 9am–7pm ET ────────
      const THREE_HOURS = 3 * 60 * 60 * 1000;
      setInterval(() => {
        const etHour = parseInt(
          new Intl.DateTimeFormat('en-US', {
            hour: 'numeric', hour12: false, timeZone: 'America/New_York',
          }).format(new Date()),
          10
        );
        // Window: 09:00–18:59 ET (lines open in the morning, games start ~18:00+)
        if (etHour >= 9 && etHour < 19) {
          console.log(`[line-movement] Scheduled snapshot triggered (ET hour: ${etHour})`);
          captureOddsSnapshot().catch(err => {
            console.error('[line-movement] Scheduled snapshot failed:', err.message);
          });
        }
      }, THREE_HOURS).unref();

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
        // Closing line capture: 17:00–00:59 ET (before and during MLB game windows)
        if (etHour >= 17 || etHour < 1) {
          console.log(`[closing-line] Scheduled capture triggered (ET hour: ${etHour})`);
          captureClosingLines().catch(err => {
            console.error('[closing-line] Scheduled capture failed:', err.message);
          });
        }
      }, THIRTY_MIN).unref();
    });
  })
  .catch(err => {
    console.error('[H.E.X.A.] Startup failed:', err.message);
    process.exit(1);
  });
