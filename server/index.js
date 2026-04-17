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
import { getCacheStatus, refreshCache } from './savant-fetcher.js';
import authRouter, { bankrollRouter, seedAdminUser } from './auth.js';
import { verifyToken, requireVerifiedEmail } from './middleware/auth-middleware.js';
import { runMigrations } from './migrate.js';
import { getGameBoxscore, resolvePlayerProp } from './props-resolver.js';
import pool from './db.js';
import lemonRouter from './lemon.js';
import picksRouter from './routes/picks.js';
import { handleBMCWebhook } from './bmc-webhook.js';
import { findGame, parsePick, resolvePendingPicks, resolvePickResult, resolvePlayerPropPickResult } from './pick-resolver.js';
import { captureClosingLines } from './closing-line-capture.js';
import { getLiveGameData, getMultipleLiveGames, getGamePlayByPlay } from './live-feed.js';
import { parseLivePick, calculatePickProgress, buildPickOutcomeContext } from './pick-tracker.js';
import { captureOddsSnapshot, getLineMovement } from './line-movement.js';
import { savePickFeatures, updatePickFeatureResult } from './feature-store.js';
import { generatePickPostmortem, POSTMORTEM_SCHEMA_VERSION } from './pick-postmortem.js';
import { calculateParallelScore } from './services/xgboostValidator.js';
import { buildDeterministicSafePayload, buildValueBreakdown } from './market-intelligence.js';
import {
  buildShadowActualOutcome,
  getShadowModeDashboard,
  isShadowModeEnabled,
  refreshPendingShadowModelRuns,
  recordShadowModelRun,
  updateShadowModelRunsForGame,
} from './shadow-model.js';
import { buildHexaBoard } from './services/hexaBoardService.js';
import { getGameHighlightsAvailability } from './live-feed.js';

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

function normalizeDateInput(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  const s = String(value);
  const m = s.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

function getEasternDateString(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function shiftDateString(dateString, days) {
  const [year, month, day] = String(dateString).split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return shifted.toISOString().slice(0, 10);
}

function buildFeatureStoreDateCandidates(preferredDate) {
  const resolved = normalizeDateInput(preferredDate) ?? getEasternDateString();
  const todayEt = getEasternDateString();
  const candidates = [
    resolved,
    shiftDateString(resolved, -1),
    shiftDateString(resolved, 1),
    todayEt,
    shiftDateString(todayEt, -1),
    shiftDateString(todayEt, 1),
  ];
  return [...new Set(candidates.filter(Boolean))];
}

async function findGameForFeatureStore(gamePk, preferredDate) {
  const dateCandidates = buildFeatureStoreDateCandidates(preferredDate);

  for (const date of dateCandidates) {
    const games = await getTodayGames(date);
    const gameData = games.find(g => String(g.gamePk) === String(gamePk));
    if (gameData) {
      return { gameData, resolvedDate: date };
    }
  }

  return { gameData: null, resolvedDate: normalizeDateInput(preferredDate) ?? getEasternDateString() };
}

function parseJsonMaybe(value) {
  let parsed = value;
  for (let i = 0; i < 2; i++) {
    if (typeof parsed !== 'string') break;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      break;
    }
  }
  return parsed;
}

function normalizePickResult(result) {
  if (result == null) return null;
  const value = String(result).toLowerCase();
  if (value === 'won') return 'win';
  if (value === 'lost') return 'loss';
  return value;
}

function normalizeOracleConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

function buildFeatureStorePayload(gameData, requestedDate, features = {}) {
  return {
    gamePk: gameData?.gamePk ?? null,
    gameDate: normalizeDateInput(requestedDate ?? gameData?.gameDate) ?? null,
    features: features ?? {},
  };
}

function buildShadowStatcastData(features = {}) {
  const savantBatters = features.savantBatters ?? { home: [], away: [] };

  const summarizeLineup = (batters) => {
    const withData = (batters ?? []).filter((b) => b?.savant?.xwOBA != null);
    if (!withData.length) {
      return { avg_xwOBA: null, avg_woba_7d: null };
    }

    const avg_xwOBA = withData.reduce((sum, batter) => sum + Number(batter.savant.xwOBA ?? 0), 0) / withData.length;
    const avg_woba_7d = withData.reduce((sum, batter) => {
      const rolling = batter?.savant?.rolling_woba_7d ?? batter?.savant?.rolling_windows?.woba_7d ?? batter?.savant?.xwOBA ?? 0;
      return sum + Number(rolling);
    }, 0) / withData.length;

    return { avg_xwOBA, avg_woba_7d };
  };

  return {
    homePitcher: features.homePitcherSavant ?? null,
    awayPitcher: features.awayPitcherSavant ?? null,
    homeLineup: summarizeLineup(savantBatters.home),
    awayLineup: summarizeLineup(savantBatters.away),
  };
}

function buildAnalysisMeta(features = {}) {
  const homePitcherStatcast = features.homePitcherSavant ?? null;
  const awayPitcherStatcast = features.awayPitcherSavant ?? null;
  const savantBatters = features.savantBatters ?? { home: [], away: [] };

  const countNonNull = (values) => values.filter((value) => value != null).length;
  const hasLineupXwoba = (batters) => (batters ?? []).some((b) => b?.savant?.xwOBA != null);

  return {
    pitcher_profiles_loaded: countNonNull([homePitcherStatcast, awayPitcherStatcast]),
    pitcher_xwoba_loaded: countNonNull([
      homePitcherStatcast?.xwOBA_against,
      awayPitcherStatcast?.xwOBA_against,
    ]),
    pitcher_whiff_loaded: countNonNull([
      homePitcherStatcast?.whiff_percent,
      awayPitcherStatcast?.whiff_percent,
    ]),
    lineup_xwoba_loaded: countNonNull([
      hasLineupXwoba(savantBatters.home) ? 1 : null,
      hasLineupXwoba(savantBatters.away) ? 1 : null,
    ]),
  };
}

function annotateAnalysisData(data, features = {}, gameData = null) {
  if (!data || typeof data !== 'object') return data;

  const analysisMeta = buildAnalysisMeta(features);
  let alertFlags = Array.isArray(data.alert_flags) ? [...data.alert_flags] : [];

  if (analysisMeta.pitcher_xwoba_loaded > 0) {
    alertFlags = alertFlags.filter((flag) => (
      !/no statcast xwoba data available for either pitcher/i.test(String(flag))
    ));
  }

  const traceFlag = `Server check: P xwOBA ${analysisMeta.pitcher_xwoba_loaded}/2, Whiff ${analysisMeta.pitcher_whiff_loaded}/2, Lineups ${analysisMeta.lineup_xwoba_loaded}/2`;
  if (!alertFlags.some((flag) => String(flag).startsWith('Server check:'))) {
    alertFlags.push(traceFlag);
  }

  const valueBreakdown = buildValueBreakdown({
    data,
    oddsData: features?.oddsData ?? null,
    gameData,
  });

  // Coherence enforcement: keep bet_value and Kelly aligned with the computed edge.
  // Claude sometimes outputs "HIGH VALUE" on a negative-edge pick or a positive
  // Kelly when the implied probability actually exceeds the model's — that
  // breaks user trust. We override the tier server-side when we can compute the
  // real edge from the market odds.
  const mp = data.master_prediction ?? null;
  const edgeNum = valueBreakdown?.edge != null ? Number(valueBreakdown.edge) : null;
  if (mp && Number.isFinite(edgeNum)) {
    let tier;
    if (edgeNum > 5) tier = 'HIGH VALUE';
    else if (edgeNum > 2) tier = 'MODERATE VALUE';
    else if (edgeNum > 0) tier = 'MARGINAL VALUE';
    else tier = 'NO VALUE';
    mp.bet_value = tier;
    if (valueBreakdown) valueBreakdown.value_tier = tier;

    // Force negative-edge Kelly to "no mathematical edge"
    if (edgeNum <= 0 && data.kelly_recommendation) {
      const isSpanish = /recomendaci|ventaja|apostar|bankroll/i.test(String(data.kelly_recommendation));
      data.kelly_recommendation = isSpanish
        ? 'RECOMENDACIÓN KELLY: Sin ventaja matemática — No apostar.'
        : 'KELLY RECOMMENDATION: No mathematical edge — Do not bet.';
    }
  }

  return {
    ...data,
    alert_flags: alertFlags,
    analysis_meta: analysisMeta,
    value_breakdown: valueBreakdown ?? data.value_breakdown ?? null,
  };
}

async function saveFeatureStoreForGame({
  pickId = null,
  backtestId = null,
  gamePk,
  gameDate,
  pick,
  result = null,
  oddsData = null,
}) {
  const resolvedDate = normalizeDateInput(gameDate) ?? getEasternDateString();
  if (!gamePk) return false;

  try {
    const { gameData, resolvedDate: matchedDate } = await findGameForFeatureStore(gamePk, resolvedDate);
    if (!gameData) {
      console.warn(
        `[feature-store] Game ${gamePk} not found near ${resolvedDate}; ` +
        `tried dates: ${buildFeatureStoreDateCandidates(resolvedDate).join(', ')}`
      );
      return false;
    }

    let matchedOdds = parseJsonMaybe(oddsData);
    if (!matchedOdds?.odds) {
      try {
        const allOdds = await getGameOdds();
        matchedOdds = matchOddsToGame(allOdds, gameData.teams?.home?.name, gameData.teams?.away?.name);
      } catch {
        matchedOdds = null;
      }
    }

    const contextResult = await buildContext(gameData, matchedOdds);
    const features = contextResult._features ?? {};
    await savePickFeatures({
      pickId,
      backtestId,
      gamePk: Number(gamePk),
      gameDate: matchedDate,
      ...features,
      oddsData: features.oddsData ?? matchedOdds,
      pick,
      result,
    });

    return true;
  } catch (err) {
    console.warn(`[feature-store] Could not save features for game ${gamePk}: ${err.message}`);
    return false;
  }
}

async function persistAnalysisPick({
  userId,
  type = 'single',
  matchup,
  analysisData,
  model = 'deep',
  language = 'en',
  gamePk = null,
  gameDate = null,
  oddsData = null,
  featureStore = null,
}) {
  if (!userId || !analysisData) return null;

  const mp = analysisData.master_prediction ?? analysisData.safe_pick ?? {};
  const bp = analysisData.best_pick ?? {};
  const pickText = mp.pick ?? bp.detail ?? null;
  const oracleConfidence = normalizeOracleConfidence(mp.oracle_confidence ?? mp.hit_probability ?? null);
  const oddsAtPick = analysisData.value_breakdown?.odds ?? null;
  const impliedProbAtPick = oddsAtPick != null
    ? calculateImpliedProbability(oddsAtPick)
    : null;

  const { rows } = await pool.query(
    `INSERT INTO picks (
       user_id, type, matchup, pick, oracle_confidence, bet_value, model_risk,
       oracle_report, hexa_hunch, alert_flags, probability_model, best_pick,
       model, language, odds_at_pick, implied_prob_at_pick, odds_details, kelly_recommendation,
       game_pk, game_date, value_breakdown, safe_candidates, safe_scope, selection_method
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     RETURNING *`,
    [
      userId,
      type,
      matchup ?? null,
      pickText,
      oracleConfidence,
      mp.bet_value ?? null,
      analysisData.model_risk ?? null,
      analysisData.oracle_report ?? analysisData.safe_pick?.reasoning ?? null,
      analysisData.hexa_hunch ?? null,
      JSON.stringify(analysisData.alert_flags ?? []),
      JSON.stringify(analysisData.probability_model ?? {}),
      JSON.stringify(analysisData.best_pick ?? {}),
      model,
      language,
      oddsAtPick,
      impliedProbAtPick,
      oddsData != null ? JSON.stringify(oddsData) : null,
      analysisData.kelly_recommendation ?? null,
      gamePk ?? null,
      normalizeDateInput(gameDate),
      analysisData.value_breakdown != null ? JSON.stringify(analysisData.value_breakdown) : null,
      analysisData.safe_candidates != null ? JSON.stringify(analysisData.safe_candidates) : null,
      analysisData.safe_scope ?? null,
      analysisData.selection_method ?? null,
    ]
  );

  const savedPick = rows[0] ?? null;
  if (!savedPick) return null;

  const parsedFeatureStore = parseJsonMaybe(featureStore);
  const directFeatureGamePk = parsedFeatureStore?.gamePk ?? gamePk;
  const directFeatureGameDate = parsedFeatureStore?.gameDate ?? gameDate;
  const directFeatures = parsedFeatureStore?.features ?? null;

  if (directFeatureGamePk && directFeatures) {
    await savePickFeatures({
      pickId: savedPick.id,
      gamePk: Number(directFeatureGamePk),
      gameDate: normalizeDateInput(directFeatureGameDate),
      ...directFeatures,
      oddsData: directFeatures.oddsData ?? oddsData,
      pick: savedPick.pick,
      result: savedPick.result,
    });
  } else if (gamePk) {
    await saveFeatureStoreForGame({
      pickId: savedPick.id,
      gamePk,
      gameDate,
      pick: savedPick.pick,
      result: savedPick.result,
      oddsData,
    });
  }

  return savedPick;
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
app.use('/api/picks',     picksRouter);
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
    'SELECT id, email, credits, is_admin FROM users WHERE id = $1',
    [req.user.id]
  );
  const user = rows[0];
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  // Admin account bypasses credit deduction
  if (user.is_admin) return user;
  if (user.credits < cost) {
    res.status(403).json({ error: 'No credits remaining' });
    return null;
  }
  const updated = await pool.query(
    'UPDATE users SET credits = credits - $1 WHERE id = $2 RETURNING id, email, credits, is_admin',
    [cost, user.id]
  );
  return updated.rows[0];
}

/**
 * refundCredits(userId, cost, isAdmin)
 * Adds `cost` credits back to the user account.
 * Admin accounts are skipped (they were never charged).
 */
async function refundCredits(userId, cost, isAdmin) {
  if (isAdmin) return;
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

function normalizeRequestLanguage(value, fallback = 'en') {
  const normalized = String(value ?? fallback ?? 'en').toLowerCase();
  return normalized.startsWith('es') ? 'es' : 'en';
}

// ── Admin middleware ───────────────────────────────────────────────────────────

function isAdmin(req, res, next) {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ── App settings (site-wide flags) ─────────────────────────────────────────────

async function getAppSetting(key, fallback) {
  try {
    const { rows } = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
    if (rows.length === 0) return fallback;
    return rows[0].value;
  } catch (err) {
    console.warn(`[app-settings] read failed for ${key}:`, err.message);
    return fallback;
  }
}

async function setAppSetting(key, value) {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
}

export async function isPerformancePublic() {
  const raw = await getAppSetting('performance_public', false);
  return raw === true || raw === 'true';
}

// Public: anyone can read the flag so the UI knows whether to render the page.
app.get('/api/settings/performance-public', async (_req, res) => {
  const enabled = await isPerformancePublic();
  res.json({ success: true, enabled });
});

// Admin-only: flip the flag.
app.put('/api/settings/performance-public', verifyToken, isAdmin, async (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  try {
    await setAppSetting('performance_public', enabled);
    res.json({ success: true, enabled });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/games?date=YYYY-MM-DD
app.get('/api/games', async (req, res) => {
  try {
    const date = req.query.date || getEasternDateString();
    const games = await getTodayGames(date);
    res.json({ success: true, data: games });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/hexa/board?date=YYYY-MM-DD&force=0|1
// Public endpoint — no auth. Heavy lift is cached until 04:00 ET.
app.get('/api/hexa/board', async (req, res) => {
  try {
    const date  = req.query.date || undefined;
    const force = req.query.force === '1' || req.query.force === 'true';
    const board = await buildHexaBoard({ date, force });
    res.json({ success: true, data: board });
  } catch (err) {
    console.error('[hexa/board] failed:', err.message);
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/games/:gamePk/highlights-link — safe external link only (Tarea 4)
// Returns { available, externalUrl } — never serves video URLs directly.
app.get('/api/games/:gamePk/highlights-link', async (req, res) => {
  try {
    const info = await getGameHighlightsAvailability(req.params.gamePk);
    res.json({ success: true, data: info });
  } catch (err) {
    // Fail-soft: treat errors as "no highlights available"
    res.json({ success: true, data: { available: false, externalUrl: null, reason: 'fetch_failed' } });
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
    const contextResult = await buildContextById(req.params.gameId);
    const context = contextResult.context ?? contextResult;
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
  if (model && !['fast', 'deep', 'premium'].includes(model)) return res.status(400).json({ success: false, error: 'Invalid model' });
  if (model === 'premium' && !req.user.is_admin) {
    return res.status(403).json({ success: false, error: 'Premium model is currently admin-only' });
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, error: 'Invalid date format' });
  const resolvedLang = lang ?? language;
  const cost         = calcServerCost('single', model, webSearch);

  // Require email verification before allowing analysis
  const gameUserCheck = await pool.query('SELECT email_verified FROM users WHERE id = $1', [req.user.id]);
  if (gameUserCheck.rows[0] && !gameUserCheck.rows[0].email_verified) {
    return res.status(403).json({ success: false, error: 'Please verify your email before running analysis' });
  }

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
    let featureStore = null;
    try {
      const contextResult = await buildContext(gameData, matchedOdds);
      const context = contextResult.context ?? contextResult;
      const shadowFeatures = contextResult._features ?? {};
      featureStore = buildFeatureStorePayload(gameData, date, shadowFeatures);
      const matchup = `${gameData.teams?.away?.abbreviation ?? 'AWAY'} @ ${gameData.teams?.home?.abbreviation ?? 'HOME'}`;

      const statcastData = buildShadowStatcastData(shadowFeatures);

      analysis = await analyzeGame({
        matchup, betType, context, riskProfile,
        mode: 'single', lang: resolvedLang, webSearch, model, timeoutMs: 90000,
        statcastData,
        mlbApiData: gameData,
        userBankroll,
      });
    } catch (err) {
      await refundCredits(updatedUser.id, cost, updatedUser.is_admin);
      const isTimeout = err.message === 'TIMEOUT';
      return res.status(500).json({
        success: false,
        error: isTimeout
          ? 'El análisis tardó demasiado. Créditos reembolsados. Por favor reintenta.'
          : 'Análisis fallido. Tus créditos han sido reembolsados.',
      });
    }

    const responseData = analysis.data
      ? {
          ...annotateAnalysisData(analysis.data, featureStore?.features ?? {}, gameData),
          matchup: `${gameData.teams?.away?.abbreviation ?? 'AWAY'} @ ${gameData.teams?.home?.abbreviation ?? 'HOME'}`,
          odds: matchedOdds ?? undefined,
        }
      : null;

    if (isShadowModeEnabled() && analysis?.data && analysis?.xgboostResult && gameData) {
      try {
        await recordShadowModelRun({
          userId: req.user.id,
          sourceType: 'analysis',
          analysisMode: 'single',
          gameData,
          gameDate: normalizeDateInput(date ?? gameData?.gameDate),
          analysisData: analysis.data,
          xgboostResult: analysis.xgboostResult,
          statcastData: buildShadowStatcastData(featureStore?.features ?? {}),
          features: featureStore?.features ?? {},
        });
      } catch (shadowErr) {
        console.warn('[shadow-mode] Could not persist analysis run:', shadowErr.message);
      }
    }

    res.json({
      success: true,
      data: responseData,
      odds: matchedOdds ?? null,
      featureStore,
      parseError: analysis.parseError,
      rawText: analysis.rawText,
      credits: updatedUser.credits,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/analyze/parlay  — requires auth, costs 4 (fast) or 8 (deep) credits
app.post('/api/analyze/parlay', analysisLimiter, verifyToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ success: false, error: 'Parlay analysis is currently admin-only' });
  }
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

  // Require email verification before allowing analysis
  const parlayUserCheck = await pool.query('SELECT email_verified FROM users WHERE id = $1', [req.user.id]);
  if (parlayUserCheck.rows[0] && !parlayUserCheck.rows[0].email_verified) {
    return res.status(403).json({ success: false, error: 'Please verify your email before running analysis' });
  }

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
          return buildContext(gameData, legOddsArr[i] ?? null).then(r => r.context ?? r);
        })
      );
      analysis = await analyzeParlay(contexts, resolvedLang, { betType, riskProfile, webSearch, legs: parlayLegs, model, timeoutMs: 90000 });
    } catch (err) {
      await refundCredits(updatedUser.id, cost, updatedUser.is_admin);
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

// POST /api/analyze/safe — Safe Pick mode (supports single gameId or multiple gameIds for parlay safe picks)
app.post('/api/analyze/safe', analysisLimiter, verifyToken, async (req, res) => {
  const { gameId, gameIds, lang = 'en', date } = req.body;
  const resolvedDate = date || new Date().toISOString().split('T')[0];

  // Determine if this is a multi-game safe pick request
  const ids = gameIds && Array.isArray(gameIds) && gameIds.length > 0
    ? gameIds
    : gameId ? [gameId] : [];

  if (ids.length === 0) {
    return res.status(400).json({ success: false, error: 'gameId or gameIds is required' });
  }

  // Cost: 2 credits per game
  const cost = 2 * ids.length;
  const isMulti = ids.length > 1;

  // Require email verification before allowing analysis
  const safeUserCheck = await pool.query('SELECT email_verified FROM users WHERE id = $1', [req.user.id]);
  if (safeUserCheck.rows[0] && !safeUserCheck.rows[0].email_verified) {
    return res.status(403).json({ success: false, error: 'Please verify your email before running analysis' });
  }

  try {
    let games = await getTodayGames(resolvedDate);

    // Fallback: try today if requested date returned nothing
    if (games.length === 0) {
      const todayStr = new Date().toISOString().split('T')[0];
      if (todayStr !== resolvedDate) {
        games = await getTodayGames(todayStr);
      }
    }

    let allOdds = [];
    try { allOdds = await getGameOdds(); } catch { /* optional */ }

    const updatedUser = await deductCredits(req, res, cost);
    if (!updatedUser) return;

    // Analyze each game individually in parallel
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const gameData = games.find(g => String(g.gamePk) === String(id));
        if (!gameData) return { gameId: id, error: `Game ${id} not found` };

        let matchedOdds = null;
        try {
          matchedOdds = matchOddsToGame(allOdds, gameData.teams?.home?.name, gameData.teams?.away?.name);
        } catch { /* optional */ }

        try {
          const contextBuildResult = await buildContext(gameData, matchedOdds);
          const contextString = contextBuildResult.context ?? contextBuildResult;
          const analysis = await analyzeSafe({ contextString, lang });
          const shadowFeatures = contextBuildResult._features ?? {};
          const shadowStatcastData = buildShadowStatcastData(shadowFeatures);
          const xgboostResult = calculateParallelScore(shadowStatcastData, gameData);
          const deterministicSafe = buildDeterministicSafePayload({
            gameData,
            features: shadowFeatures,
            oddsData: matchedOdds ?? shadowFeatures?.oddsData ?? null,
            xgboostResult,
            lang,
            llmData: analysis.data,
          });

          const homeAbbr = gameData.teams?.home?.abbreviation ?? 'HOME';
          const awayAbbr = gameData.teams?.away?.abbreviation ?? 'AWAY';

          if (isShadowModeEnabled() && deterministicSafe && xgboostResult) {
            try {
              await recordShadowModelRun({
                userId: req.user.id,
                sourceType: 'analysis',
                analysisMode: isMulti ? 'safe_multi' : 'safe_single',
                gameData,
                gameDate: normalizeDateInput(resolvedDate ?? gameData?.gameDate),
                analysisData: deterministicSafe,
                xgboostResult,
                statcastData: shadowStatcastData,
                features: shadowFeatures,
              });
            } catch (shadowErr) {
              console.warn('[shadow-mode] Could not persist safe analysis run:', shadowErr.message);
            }
          }

          let savedPick = null;
          if (deterministicSafe && !analysis.parseError) {
            try {
              savedPick = await persistAnalysisPick({
                userId: req.user.id,
                type: 'safe',
                matchup: `${awayAbbr} @ ${homeAbbr}`,
                analysisData: annotateAnalysisData(deterministicSafe, shadowFeatures, gameData),
                model: 'deep',
                language: lang,
                gamePk: gameData.gamePk,
                gameDate: resolvedDate,
                oddsData: matchedOdds ?? null,
                featureStore: buildFeatureStorePayload(gameData, resolvedDate, shadowFeatures),
              });
            } catch (saveErr) {
              console.warn('[safe-persist] Could not auto-save safe pick:', saveErr.message);
            }
          }

          return {
            gameId: id,
            matchup: `${awayAbbr} @ ${homeAbbr}`,
            data: annotateAnalysisData(deterministicSafe, shadowFeatures, gameData),
            rawText: analysis.rawText,
            parseError: analysis.parseError,
            odds: matchedOdds ?? undefined,
            featureStore: buildFeatureStorePayload(gameData, resolvedDate, shadowFeatures),
            savedPick,
          };
        } catch (err) {
          return {
            gameId: id,
            matchup: `Game ${id}`,
            error: err.message === 'TIMEOUT' ? 'Analysis timed out' : err.message,
          };
        }
      })
    );

    const processedResults = results.map(r =>
      r.status === 'fulfilled' ? r.value : { error: r.reason?.message ?? 'Unknown error' }
    );

    const successCount = processedResults.filter(r => r.data && !r.error).length;
    const failCount = processedResults.filter(r => r.error).length;

    // If any failed, refund those credits
    if (failCount > 0) {
      await refundCredits(updatedUser.id, failCount * 2, updatedUser.is_admin);
    }

    // For single game (backward compatible), return the old format
    if (!isMulti) {
      const single = processedResults[0];
      if (single.error) {
        return res.status(500).json({ success: false, error: single.error });
      }
      return res.json({
        success: true,
        data: single.data,
        odds: single.odds ?? null,
        featureStore: single.featureStore ?? null,
        savedPick: single.savedPick ?? null,
        parseError: single.parseError,
        rawText: single.rawText,
        credits: updatedUser.credits - (failCount * 2),
        mode: 'safe',
      });
    }

    // Multi-game: return array of results
    res.json({
      success: true,
      data: {
        mode: 'safe_multi',
        results: processedResults,
        summary: { total: ids.length, analyzed: successCount, failed: failCount },
      },
      credits: updatedUser.credits - (failCount * 2),
      mode: 'safe',
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

// POST /api/analyze/batch — Admin Batch Scan: analyze multiple games individually in parallel
app.post('/api/analyze/batch', analysisLimiter, verifyToken, isAdmin, async (req, res) => {
  const { gameIds, lang = 'es', date } = req.body;

  // Input validation
  if (!gameIds || !Array.isArray(gameIds) || gameIds.length === 0) {
    return res.status(400).json({ success: false, error: 'gameIds array is required' });
  }
  if (gameIds.length > 16) {
    return res.status(400).json({ success: false, error: 'Maximum 16 games per batch scan' });
  }

  const resolvedDate = date || new Date().toISOString().split('T')[0];

  try {
    const games = await getTodayGames(resolvedDate);

    let allOdds = [];
    try { allOdds = await getGameOdds(); } catch { /* optional */ }

    // Build context for each game
    const gameContexts = await Promise.all(
      gameIds.map(async (id) => {
        const gameData = games.find(g => String(g.gamePk) === String(id));
        if (!gameData) return { id, error: `Game ${id} not found` };

        let matchedOdds = null;
        try {
          matchedOdds = matchOddsToGame(allOdds, gameData.teams?.home?.name, gameData.teams?.away?.name);
        } catch { /* optional */ }

        try {
          const contextBuildResult2 = await buildContext(gameData, matchedOdds);
          const contextString = contextBuildResult2.context ?? contextBuildResult2;
          const homeAbbr = gameData.teams?.home?.abbreviation ?? 'HOME';
          const awayAbbr = gameData.teams?.away?.abbreviation ?? 'AWAY';
          return {
            id,
            gameData,
            contextString,
            features: contextBuildResult2._features ?? {},
            matchedOdds,
            matchup: `${awayAbbr} @ ${homeAbbr}`,
          };
        } catch (err) {
          return { id, error: `Context build failed: ${err.message}` };
        }
      })
    );

    // Analyze games in batches of 3 to avoid Anthropic API rate limits (30k tokens/min)
    const BATCH_SIZE = 3;
    const BATCH_DELAY_MS = 5000; // 5 seconds between batches
    const allResults = [];

    for (let i = 0; i < gameContexts.length; i += BATCH_SIZE) {
      const batch = gameContexts.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(gameContexts.length / BATCH_SIZE);
      console.log(`[Admin Batch] Processing batch ${batchNum}/${totalBatches} (${batch.length} games)`);

      const batchResults = await Promise.allSettled(
        batch.map(async (ctx) => {
          if (ctx.error) return { matchup: `Game ${ctx.id}`, error: ctx.error };

          try {
            const analysis = await analyzeGame({
              mode: 'single',
              matchup: ctx.matchup,
              context: ctx.contextString,
              lang,
              betType: 'all',
              riskProfile: 'balanced',
              webSearch: false,
              model: 'deep',
              timeoutMs: 120000,
            });

            return {
              gameId: ctx.id,
              matchup: ctx.matchup,
              data: annotateAnalysisData(analysis.data, ctx.features ?? {}, ctx.gameData ?? null),
              rawText: analysis.rawText,
              parseError: analysis.parseError,
              odds: ctx.matchedOdds ?? undefined,
              _featureStore: {
                gamePk: ctx.id,
                gameDate: resolvedDate,
                features: ctx.features ?? {},
              },
            };
          } catch (err) {
            return {
              gameId: ctx.id,
              matchup: ctx.matchup,
              error: err.message === 'TIMEOUT' ? 'Analysis timed out' : err.message,
            };
          }
        })
      );

      allResults.push(...batchResults);

      // Wait between batches to respect rate limits (skip delay after last batch)
      if (i + BATCH_SIZE < gameContexts.length) {
        console.log(`[Admin Batch] Waiting ${BATCH_DELAY_MS / 1000}s before next batch...`);
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    const results = allResults;

    // Process results and auto-save picks
    const processedResults = [];

    for (const result of results) {
      const value = result.status === 'fulfilled' ? result.value : { error: result.reason?.message ?? 'Unknown error' };

      if (value.error) {
        processedResults.push(value);
        continue;
      }

      // Auto-save pick to database
      if (value.data && !value.parseError) {
        try {
          const d = value.data;
          const mp = d.master_prediction ?? d.safe_pick ?? {};
          const bp = d.best_pick ?? {};

          const oddsAtPick = d.value_breakdown?.odds ?? value.odds?.moneyline?.home ?? value.odds?.moneyline?.away ?? null;
          const impliedProbAtPick = oddsAtPick != null
            ? (oddsAtPick < 0
                ? Math.abs(oddsAtPick) / (Math.abs(oddsAtPick) + 100)
                : 100 / (oddsAtPick + 100))
            : null;

          const pickResult = await pool.query(
            `INSERT INTO picks (user_id, type, matchup, pick, oracle_confidence, bet_value,
             model_risk, oracle_report, hexa_hunch, alert_flags, probability_model, best_pick,
             model, language, odds_at_pick, implied_prob_at_pick, odds_details, value_breakdown,
             safe_candidates, safe_scope, selection_method)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
             RETURNING id`,
            [
              req.user.id,
              'batch',
              value.matchup,
              mp.pick ?? bp.detail ?? null,
              mp.oracle_confidence ?? null,
              mp.bet_value ?? null,
              d.model_risk ?? null,
              d.oracle_report ?? null,
              d.hexa_hunch ?? null,
              JSON.stringify(d.alert_flags ?? []),
              JSON.stringify(d.probability_model ?? {}),
              JSON.stringify(d.best_pick ?? {}),
              'deep',
              lang,
              oddsAtPick,
              impliedProbAtPick,
              JSON.stringify(value.odds ?? {}),
              d.value_breakdown != null ? JSON.stringify(d.value_breakdown) : null,
              d.safe_candidates != null ? JSON.stringify(d.safe_candidates) : null,
              d.safe_scope ?? null,
              d.selection_method ?? null,
            ]
          );

          value.pickId = pickResult.rows[0]?.id;
          if (value.pickId) {
            await savePickFeatures({
              pickId: value.pickId,
              gamePk: Number(value._featureStore?.gamePk ?? value.gameId),
              gameDate: value._featureStore?.gameDate ?? resolvedDate,
              ...(value._featureStore?.features ?? {}),
              oddsData: value._featureStore?.features?.oddsData ?? value.odds ?? null,
              pick: mp.pick ?? bp.detail ?? null,
              result: null,
            });
          }
        } catch (saveErr) {
          console.error(`[Batch] Failed to save pick for ${value.matchup}:`, saveErr.message);
        }
      }

      delete value._featureStore;
      processedResults.push(value);
    }

    const successCount = processedResults.filter(r => r.data && !r.error).length;
    const failCount = processedResults.filter(r => r.error).length;

    console.log(`[Admin Batch] Completed: ${successCount} success, ${failCount} failed out of ${gameIds.length} games`);

    res.json({
      success: true,
      data: {
        results: processedResults,
        summary: {
          total: gameIds.length,
          analyzed: successCount,
          failed: failCount,
          date: resolvedDate,
        },
      },
    });
  } catch (err) {
    console.error('[Admin Batch] Error:', err);
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/analyze/chat — Direct chat with Oracle (admin only, no credits)
app.post('/api/analyze/chat', analysisLimiter, verifyToken, isAdmin, async (req, res) => {
  const { gameId, question, conversationHistory = [], lang = 'en', date } = req.body;

  if (!question || !question.trim()) {
    return res.status(400).json({ error: 'Question is required' });
  }

  try {
    const resolvedDate = date || getEasternDateString();
    let games    = await getTodayGames(resolvedDate);
    let gameData = games.find(g => String(g.gamePk) === String(gameId));

    if (!gameData) {
      // Widen the search to yesterday/tomorrow ET — covers edge cases around
      // day boundaries and schedules that wrap past midnight.
      for (const candidate of [shiftDateString(resolvedDate, -1), shiftDateString(resolvedDate, 1)]) {
        const retryGames = await getTodayGames(candidate);
        gameData = retryGames.find(g => String(g.gamePk) === String(gameId));
        if (gameData) {
          games = retryGames;
          break;
        }
      }
    }

    if (!gameData) return res.status(404).json({ success: false, error: `Partido ${gameId} no encontrado` });

    let matchedOdds = null;
    try {
      const allOdds = await getGameOdds();
      matchedOdds = matchOddsToGame(allOdds, gameData.teams?.home?.name, gameData.teams?.away?.name);
    } catch { /* odds are optional */ }

    const contextBuildResult3 = await buildContext(gameData, matchedOdds);
    const contextString = contextBuildResult3.context ?? contextBuildResult3;

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
  res.json({ isAdmin: req.user.is_admin === true });
});

// GET /api/games/:gamePk/live — Live game feed (GUMBO) with normalized data
app.get('/api/games/:gamePk/live', async (req, res) => {
  try {
    const data = await getLiveGameData(req.params.gamePk);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/games/:gamePk/play-by-play - Complete game timeline for Gameday detail
app.get('/api/games/:gamePk/play-by-play', async (req, res) => {
  try {
    const data = await getGamePlayByPlay(req.params.gamePk);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/picks/live-progress — Calculate live progress for user's pending picks
app.post('/api/picks/live-progress', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's pending picks
    const { rows: pendingPicks } = await pool.query(
      `SELECT
         p.id,
         p.matchup,
         p.pick,
         p.oracle_confidence,
         p.type,
         p.created_at,
         COALESCE(p.game_pk, pf.game_pk) AS game_pk,
         COALESCE(p.game_date::text, pf.game_date::text) AS game_date
       FROM picks p
       LEFT JOIN LATERAL (
         SELECT game_pk, game_date
         FROM pick_features
         WHERE pick_id = p.id
         ORDER BY created_at DESC
         LIMIT 1
       ) pf ON TRUE
       WHERE p.user_id = $1 AND p.result = 'pending' AND p.deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId]
    );

    if (pendingPicks.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const results = [];

    for (const pick of pendingPicks) {
      try {
        let resolvedGamePk = pick.game_pk;

        // Fallback for older picks that predate game_pk persistence.
        if (!resolvedGamePk) {
          const lookupDate = normalizeDateInput(pick.game_date) ?? getEasternDateString(pick.created_at);
          const games = await getTodayGames(lookupDate);
          const matchedGame = games.find((g) => {
            const homeAbbr = g.teams?.home?.abbreviation?.toLowerCase() ?? '';
            const awayAbbr = g.teams?.away?.abbreviation?.toLowerCase() ?? '';
            const homeName = g.teams?.home?.name?.toLowerCase() ?? '';
            const awayName = g.teams?.away?.name?.toLowerCase() ?? '';
            const matchup = (pick.matchup ?? '').toLowerCase();
            return matchup.includes(homeAbbr) || matchup.includes(awayAbbr) ||
                   matchup.includes(homeName) || matchup.includes(awayName);
          });
          resolvedGamePk = matchedGame?.gamePk ?? null;
        }

        if (!resolvedGamePk) {
          results.push({
            pickId: pick.id,
            pick: pick.pick,
            matchup: pick.matchup,
            progress: null,
            status: 'no_game_found',
          });
          continue;
        }

        const liveData = await getLiveGameData(resolvedGamePk);
        const liveStatus = String(liveData?.status ?? '').toLowerCase();
        if (liveStatus === 'scheduled' || liveStatus === 'pre-game' || liveStatus === 'preview') {
          results.push({
            pickId: pick.id,
            pick: pick.pick,
            matchup: pick.matchup,
            gamePk: resolvedGamePk,
            progress: null,
            status: 'not_started',
          });
          continue;
        }

        const parsed = parseLivePick(pick.pick);
        const progress = calculatePickProgress(parsed, liveData);

        results.push({
          pickId: pick.id,
          pick: pick.pick,
          matchup: pick.matchup,
          gamePk: resolvedGamePk,
          confidence: pick.oracle_confidence,
          ...progress,
        });
      } catch (err) {
        results.push({
          pickId: pick.id,
          pick: pick.pick,
          matchup: pick.matchup,
          gamePk: pick.game_pk ?? null,
          progress: null,
          status: 'fetch_error',
          error: err.message,
        });
      }
    }

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/games/live — Live data for multiple games at once
app.post('/api/games/live', async (req, res) => {
  try {
    const { gamePks } = req.body;
    if (!gamePks || !Array.isArray(gamePks) || gamePks.length === 0) {
      return res.status(400).json({ success: false, error: 'gamePks array is required' });
    }
    if (gamePks.length > 20) {
      return res.status(400).json({ success: false, error: 'Maximum 20 games per request' });
    }
    const data = await getMultipleLiveGames(gamePks);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
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

// POST /api/picks/resolve-game — Resolve picks for a specific finished game
app.post('/api/picks/resolve-game', verifyToken, async (req, res) => {
  try {
    const { gamePk } = req.body;
    if (!gamePk) return res.status(400).json({ success: false, error: 'gamePk required' });

    // Get final game data
    const liveData = await getLiveGameData(gamePk);
    if (liveData.status !== 'final') {
      return res.json({ success: false, error: 'Game not finished yet', status: liveData.status });
    }

    const gameForResolver = {
      gamePk: liveData.gamePk,
      gameDate: liveData.lastUpdated,
      status: { simplified: 'final' },
      teams: {
        home: {
          name: liveData.home?.name ?? '',
          abbreviation: liveData.home?.abbreviation ?? '',
          score: liveData.home?.score ?? 0,
        },
        away: {
          name: liveData.away?.name ?? '',
          abbreviation: liveData.away?.abbreviation ?? '',
          score: liveData.away?.score ?? 0,
        },
      },
    };
    const homeTeam = gameForResolver.teams.home.abbreviation;
    const awayTeam = gameForResolver.teams.away.abbreviation;
    const homeName = gameForResolver.teams.home.name;
    const awayName = gameForResolver.teams.away.name;
    const homeScore = gameForResolver.teams.home.score;
    const awayScore = gameForResolver.teams.away.score;
    const totalRuns = homeScore + awayScore;

    // Find pending picks that match this game
    const { rows: pendingPicks } = await pool.query(
      `SELECT id, pick, matchup FROM picks WHERE result = 'pending' AND deleted_at IS NULL`
    );

    let resolved = 0;
    for (const pick of pendingPicks) {
      if (!findGame(pick.matchup, [gameForResolver])) continue;

      const pickStr = (pick.pick ?? '').toLowerCase();
      let result = null;
      const parsed = parsePick(pick.pick);

      if (parsed?.type === 'player_prop') {
        const propResult = resolvePlayerPropPickResult(parsed, liveData.playerStats);
        result = propResult?.result ?? null;
      } else if (parsed) {
        result = resolvePickResult(parsed, gameForResolver);
      } else {
        console.log(`[auto-resolve] Pick ${pick.id} unparseable: "${pick.pick}"`);
      }

      // Over/Under
      const ouMatch = pickStr.match(/^(over|under|más\s+de|menos\s+de)\s+(\d+\.?\d*)/i);
      if (ouMatch) {
        const dir = ouMatch[1].toLowerCase().startsWith('o') || ouMatch[1].toLowerCase().startsWith('m') ? 'over' : 'under';
        const line = parseFloat(ouMatch[2]);
        if (dir === 'over') result = totalRuns > line ? 'win' : totalRuns < line ? 'loss' : 'push';
        else result = totalRuns < line ? 'win' : totalRuns > line ? 'loss' : 'push';
      }

      // Moneyline
      if (!result && pickStr.match(/\bml\b|moneyline|a ganar/i)) {
        const teamInPick = pickStr.replace(/\s*(ml|moneyline|a ganar).*$/i, '').trim();
        const isHome = homeTeam.toLowerCase() === teamInPick || homeName.toLowerCase().includes(teamInPick);
        const isAway = awayTeam.toLowerCase() === teamInPick || awayName.toLowerCase().includes(teamInPick);
        if (isHome) result = homeScore > awayScore ? 'win' : homeScore < awayScore ? 'loss' : 'push';
        else if (isAway) result = awayScore > homeScore ? 'win' : awayScore < homeScore ? 'loss' : 'push';
      }

      // Run Line
      if (!result) {
        const rlMatch = pickStr.match(/^(.+?)\s+([+-]?\d+\.?\d*)\s*(?:run\s*line|rl)?/i);
        if (rlMatch && (rlMatch[2].includes('+') || rlMatch[2].includes('-') || rlMatch[2].includes('1.5'))) {
          const teamInPick = rlMatch[1].trim().toLowerCase();
          const spread = parseFloat(rlMatch[2]);
          const isHome = homeTeam.toLowerCase() === teamInPick || homeName.toLowerCase().includes(teamInPick);
          const myScore = isHome ? homeScore : awayScore;
          const oppScore = isHome ? awayScore : homeScore;
          const adjusted = myScore + spread;
          result = adjusted > oppScore ? 'win' : adjusted < oppScore ? 'loss' : 'push';
        }
      }

      if (result) {
        await pool.query(`UPDATE picks SET result = $1 WHERE id = $2`, [result, pick.id]);
        await updatePickFeatureResult({ pickId: pick.id, result });
        resolved++;
        console.log(`[auto-resolve] Pick ${pick.id} "${pick.pick}" → ${result} (${awayTeam} ${awayScore} - ${homeTeam} ${homeScore})`);
      }
    }

    try {
      await updateShadowModelRunsForGame({
        gamePk,
        homeTeamId: liveData.home?.id ?? null,
        awayTeamId: liveData.away?.id ?? null,
        homeAbbr: liveData.home?.abbreviation ?? null,
        awayAbbr: liveData.away?.abbreviation ?? null,
        homeScore,
        awayScore,
      });
    } catch (shadowErr) {
      console.warn('[shadow-mode] Could not resolve shadow runs for game:', shadowErr.message);
    }

    res.json({ success: true, resolved, totalRuns, homeScore, awayScore });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/picks — guarda un pick en el historial (requiere email verificado)
app.post('/api/picks', verifyToken, requireVerifiedEmail, async (req, res) => {
  try {
    const {
      type, matchup, pick, oracle_confidence, bet_value,
      model_risk, oracle_report, hexa_hunch, alert_flags,
      probability_model, best_pick, model, language,
      odds_at_pick, odds_details, kelly_recommendation,
      value_breakdown, safe_candidates, safe_scope, selection_method,
      game_pk, gamePk, game_id, gameId, game_date, gameDate, date,
      feature_store, featureStore,
    } = req.body;

    // Calculate implied probability server-side from the American odds provided by the client
    const implied_prob_at_pick = odds_at_pick != null
      ? calculateImpliedProbability(odds_at_pick)
      : null;
    const parsedOddsDetails = odds_details != null ? parseJsonMaybe(odds_details) : null;
    const parsedFeatureStore = parseJsonMaybe(feature_store ?? featureStore);

    const { rows } = await pool.query(
      `INSERT INTO picks (
         user_id, type, matchup, pick, oracle_confidence, bet_value, model_risk,
         oracle_report, hexa_hunch, alert_flags, probability_model, best_pick,
         model, language, odds_at_pick, implied_prob_at_pick, odds_details, kelly_recommendation,
         game_pk, game_date, value_breakdown, safe_candidates, safe_scope, selection_method
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`,
      [
        req.user.id, type, matchup, pick, normalizeOracleConfidence(oracle_confidence), bet_value, model_risk,
        oracle_report, hexa_hunch,
        JSON.stringify(alert_flags ?? []), JSON.stringify(probability_model ?? {}),
        JSON.stringify(best_pick ?? {}), model, language,
        odds_at_pick ?? null,
        implied_prob_at_pick,
        parsedOddsDetails != null ? JSON.stringify(parsedOddsDetails) : null,
        kelly_recommendation ?? null,
        game_pk ?? gamePk ?? game_id ?? gameId ?? null,
        normalizeDateInput(game_date ?? gameDate ?? date),
        value_breakdown != null ? JSON.stringify(value_breakdown) : null,
        safe_candidates != null ? JSON.stringify(safe_candidates) : null,
        safe_scope ?? null,
        selection_method ?? null,
      ]
    );
    const savedPick = rows[0];
    const featureGamePk = game_pk ?? gamePk ?? game_id ?? gameId ?? null;
    const featureGameDate = game_date ?? gameDate ?? date ?? null;
    const directFeatureGamePk = parsedFeatureStore?.gamePk ?? featureGamePk;
    const directFeatureGameDate = parsedFeatureStore?.gameDate ?? featureGameDate;
    const directFeatures = parsedFeatureStore?.features ?? null;

    if (directFeatureGamePk && directFeatures) {
      await savePickFeatures({
        pickId: savedPick.id,
        gamePk: Number(directFeatureGamePk),
        gameDate: normalizeDateInput(directFeatureGameDate),
        ...directFeatures,
        oddsData: directFeatures.oddsData ?? parsedOddsDetails,
        pick: savedPick.pick,
        result: savedPick.result,
      });
    } else if (featureGamePk) {
      await saveFeatureStoreForGame({
        pickId: savedPick.id,
        gamePk: featureGamePk,
        gameDate: featureGameDate,
        pick: savedPick.pick,
        result: savedPick.result,
        oddsData: parsedOddsDetails,
      });
    }

    res.json({ success: true, data: savedPick });
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
      WHERE user_id = $1 AND deleted_at IS NULL
    `, [userId]);

    // Last 20 picks with CLV fields
    const { rows: recentPicks } = await pool.query(`
      SELECT id, matchup, pick, model, result,
             odds_at_pick, implied_prob_at_pick,
             closing_odds, implied_prob_closing, clv,
             created_at
      FROM picks
      WHERE user_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 20
    `, [userId]);

    // Group by bet type (parsed from pick string in JS to avoid SQL regex complexity)
    const betTypeMap = { moneyline: { count: 0, totalCLV: 0 }, runline: { count: 0, totalCLV: 0 }, over_under: { count: 0, totalCLV: 0 } };
    const modelMap   = {};

    const { rows: allWithCLV } = await pool.query(`
      SELECT pick, model, clv FROM picks WHERE user_id = $1 AND clv IS NOT NULL AND deleted_at IS NULL
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
    const [historyResult, summaryResult] = await Promise.all([
      pool.query(
        'SELECT * FROM picks WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100',
        [req.user.id]
      ),
      pool.query(
        `SELECT
           COUNT(*) AS total_picks,
           COUNT(*) FILTER (WHERE result = 'win') AS wins,
           COUNT(*) FILTER (WHERE result = 'loss') AS losses,
           COUNT(*) FILTER (WHERE result = 'push') AS pushes,
           COUNT(*) FILTER (WHERE result = 'pending' OR result IS NULL) AS pending
         FROM picks
         WHERE user_id = $1 AND deleted_at IS NULL`,
        [req.user.id]
      ),
    ]);

    const summaryRow = summaryResult.rows[0] ?? {};
    const total = Number(summaryRow.total_picks ?? 0);
    const wins = Number(summaryRow.wins ?? 0);
    const losses = Number(summaryRow.losses ?? 0);
    const pushes = Number(summaryRow.pushes ?? 0);
    const pending = Number(summaryRow.pending ?? 0);
    const resolved = wins + losses;
    const winRate = resolved > 0 ? Math.round((wins / resolved) * 100) : 0;

    res.json({
      success: true,
      data: historyResult.rows,
      summary: {
        total,
        wins,
        losses,
        pushes,
        pending,
        winRate,
        shown: historyResult.rows.length,
        hasMore: total > historyResult.rows.length,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// PATCH /api/picks/:id — actualiza resultado (win/loss/pending)
app.patch('/api/picks/:id', verifyToken, async (req, res) => {
  try {
    const result = normalizePickResult(req.body?.result);
    if (!['pending', 'win', 'loss', 'push'].includes(result)) {
      return res.status(400).json({ success: false, error: 'result must be pending, win, loss, or push' });
    }
    const { rows } = await pool.query(
      `UPDATE picks
       SET result = $1,
           postmortem = NULL,
           postmortem_summary = NULL,
           postmortem_generated_at = NULL
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [result, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Pick not found' });
    await updatePickFeatureResult({ pickId: rows[0].id, result: rows[0].result });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/picks/:id/postmortem — generate or return persisted postmortem analysis
app.post('/api/picks/:id/postmortem', verifyToken, async (req, res) => {
  try {
    const force = req.body?.force === true;
    const requestedLang = normalizeRequestLanguage(req.body?.lang ?? req.body?.language, null);
    const { rows } = await pool.query(
      `SELECT
         p.*,
         pf.game_pk AS feature_game_pk,
         pf.game_date AS feature_game_date,
         pf.home_pitcher_xwoba,
         pf.away_pitcher_xwoba,
         pf.home_pitcher_whiff,
         pf.away_pitcher_whiff,
         pf.home_pitcher_k_pct,
         pf.away_pitcher_k_pct,
         pf.home_pitcher_era,
         pf.away_pitcher_era,
         pf.home_team_ops,
         pf.away_team_ops,
         pf.home_lineup_avg_xwoba,
         pf.away_lineup_avg_xwoba,
         pf.park_factor_overall,
         pf.park_factor_hr,
         pf.temperature,
         pf.wind_speed,
         pf.data_quality_score,
         pf.signal_coherence_score,
         pf.odds_ml_home,
         pf.odds_ml_away,
         pf.odds_ou_total
       FROM picks p
       LEFT JOIN LATERAL (
         SELECT *
         FROM pick_features
         WHERE pick_id = p.id
         ORDER BY created_at DESC
         LIMIT 1
       ) pf ON TRUE
       WHERE p.id = $1 AND p.user_id = $2 AND p.deleted_at IS NULL
       LIMIT 1`,
      [req.params.id, req.user.id]
    );

    const pickRow = rows[0];
    if (!pickRow) {
      return res.status(404).json({ success: false, error: 'Pick not found' });
    }
    if (normalizePickResult(pickRow.result) === 'pending') {
      return res.status(400).json({ success: false, error: 'Pick must be resolved first' });
    }

    const storedPostmortemLang = normalizeRequestLanguage(
      pickRow.postmortem?.lang ?? pickRow.language,
      'en'
    );
    const effectiveLang = normalizeRequestLanguage(
      requestedLang ?? pickRow.postmortem?.lang ?? pickRow.language,
      storedPostmortemLang
    );
    const storedPostmortemVersion = Number(pickRow.postmortem?.version ?? 1);
    const shouldReuseStoredPostmortem =
      Boolean(pickRow.postmortem) &&
      !force &&
      storedPostmortemLang === effectiveLang &&
      storedPostmortemVersion >= POSTMORTEM_SCHEMA_VERSION;

    if (shouldReuseStoredPostmortem) {
      await pool.query(
        'UPDATE picks SET postmortem_requested_at = NOW() WHERE id = $1 AND user_id = $2',
        [pickRow.id, req.user.id]
      );
      return res.json({
        success: true,
        data: {
          postmortem: pickRow.postmortem,
          postmortem_summary: pickRow.postmortem_summary,
          postmortem_generated_at: pickRow.postmortem_generated_at,
        },
      });
    }

    const gamePk = pickRow.game_pk ?? pickRow.feature_game_pk ?? null;
    const gameDate =
      normalizeDateInput(pickRow.game_date) ??
      normalizeDateInput(pickRow.feature_game_date) ??
      getEasternDateString(pickRow.created_at);

    let liveData = null;
    let playByPlay = null;
    if (gamePk) {
      try {
        liveData = await getLiveGameData(gamePk);
      } catch {
        liveData = null;
      }

      try {
        playByPlay = await getGamePlayByPlay(gamePk);
      } catch {
        playByPlay = null;
      }
    }

    const parsedPick = parseLivePick(pickRow.pick);
    const progress = liveData ? calculatePickProgress(parsedPick, liveData) : null;
    const pickOutcomeContext = (liveData && playByPlay)
      ? buildPickOutcomeContext(parsedPick, liveData, playByPlay)
      : null;

    const gameSummary = liveData ? {
      gamePk: liveData.gamePk,
      status: liveData.status,
      away: {
        name: liveData.away?.name ?? null,
        abbreviation: liveData.away?.abbreviation ?? null,
        score: liveData.away?.score ?? null,
      },
      home: {
        name: liveData.home?.name ?? null,
        abbreviation: liveData.home?.abbreviation ?? null,
        score: liveData.home?.score ?? null,
      },
      pickProgress: progress,
      pickOutcomeContext,
      recentPlays: Array.isArray(liveData.recentPlays) ? liveData.recentPlays.slice(0, 5) : [],
    } : {
      gamePk,
      gameDate,
      pickProgress: null,
      pickOutcomeContext: null,
    };

    const featureSnapshot = {
      gamePk,
      gameDate,
      home_pitcher_xwoba: pickRow.home_pitcher_xwoba,
      away_pitcher_xwoba: pickRow.away_pitcher_xwoba,
      home_pitcher_whiff: pickRow.home_pitcher_whiff,
      away_pitcher_whiff: pickRow.away_pitcher_whiff,
      home_pitcher_k_pct: pickRow.home_pitcher_k_pct,
      away_pitcher_k_pct: pickRow.away_pitcher_k_pct,
      home_pitcher_era: pickRow.home_pitcher_era,
      away_pitcher_era: pickRow.away_pitcher_era,
      home_team_ops: pickRow.home_team_ops,
      away_team_ops: pickRow.away_team_ops,
      home_lineup_avg_xwoba: pickRow.home_lineup_avg_xwoba,
      away_lineup_avg_xwoba: pickRow.away_lineup_avg_xwoba,
      park_factor_overall: pickRow.park_factor_overall,
      park_factor_hr: pickRow.park_factor_hr,
      temperature: pickRow.temperature,
      wind_speed: pickRow.wind_speed,
      data_quality_score: pickRow.data_quality_score,
      signal_coherence_score: pickRow.signal_coherence_score,
      odds_ml_home: pickRow.odds_ml_home,
      odds_ml_away: pickRow.odds_ml_away,
      odds_ou_total: pickRow.odds_ou_total,
    };

    const postmortem = await generatePickPostmortem({
      lang: effectiveLang,
      pick: {
        id: pickRow.id,
        matchup: pickRow.matchup,
        pick: pickRow.pick,
        result: normalizePickResult(pickRow.result),
        oracle_confidence: pickRow.oracle_confidence,
        bet_value: pickRow.bet_value,
        model_risk: pickRow.model_risk,
        oracle_report: pickRow.oracle_report,
        hexa_hunch: pickRow.hexa_hunch,
        alert_flags: Array.isArray(pickRow.alert_flags) ? pickRow.alert_flags : [],
        best_pick: pickRow.best_pick,
        odds_at_pick: pickRow.odds_at_pick,
      },
      featureSnapshot,
      gameSummary,
    });

    const { rows: saved } = await pool.query(
      `UPDATE picks
       SET postmortem = $1,
           postmortem_summary = $2,
           postmortem_generated_at = NOW(),
           postmortem_requested_at = NOW()
       WHERE id = $3 AND user_id = $4
       RETURNING postmortem, postmortem_summary, postmortem_generated_at`,
      [JSON.stringify(postmortem), postmortem.summary, pickRow.id, req.user.id]
    );

    return res.json({ success: true, data: saved[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// DELETE /api/picks/:id — elimina un pick individual del historial
app.delete('/api/picks/:id', verifyToken, async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ success: false, error: 'Only admin can delete picks' });
    }
    const { rows } = await pool.query(
      'UPDATE picks SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Pick not found' });
    res.json({ success: true, id: rows[0].id });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// DELETE /api/picks — elimina todo el historial del usuario autenticado (solo admin)
app.delete('/api/picks', verifyToken, async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ success: false, error: 'Only admin can clear all history' });
    }
    await pool.query('UPDATE picks SET deleted_at = NOW() WHERE user_id = $1 AND deleted_at IS NULL', [req.user.id]);
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

// GET /api/admin/backtest-stats — backtest results dashboard (admin only)
app.get('/api/admin/backtest-stats', verifyToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  try {
    // Summary
    const summary = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE actual_result = 'win') as wins,
        COUNT(*) FILTER (WHERE actual_result = 'loss') as losses,
        COUNT(*) FILTER (WHERE actual_result = 'push') as pushes,
        COUNT(*) FILTER (WHERE actual_result IS NULL) as unresolved,
        ROUND(AVG(oracle_confidence)::numeric, 1) as avg_confidence,
        ROUND(AVG(latency_ms)::numeric, 0) as avg_latency_ms
      FROM backtest_results
    `);

    // By date
    const byDate = await pool.query(`
      SELECT
        historical_date,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE actual_result = 'win') as wins,
        COUNT(*) FILTER (WHERE actual_result = 'loss') as losses,
        COUNT(*) FILTER (WHERE actual_result IS NULL) as unresolved
      FROM backtest_results
      GROUP BY historical_date
      ORDER BY historical_date DESC
    `);

    // By pick type
    const byType = await pool.query(`
      SELECT
        pick_type,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE actual_result = 'win') as wins,
        COUNT(*) FILTER (WHERE actual_result = 'loss') as losses
      FROM backtest_results
      WHERE actual_result IS NOT NULL
      GROUP BY pick_type
    `);

    // By confidence bucket
    const byConfidence = await pool.query(`
      SELECT
        CASE
          WHEN oracle_confidence >= 65 THEN '65-70'
          WHEN oracle_confidence >= 60 THEN '60-64'
          WHEN oracle_confidence >= 55 THEN '55-59'
          WHEN oracle_confidence >= 50 THEN '50-54'
          ELSE 'under-50'
        END as bucket,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE actual_result = 'win') as wins,
        COUNT(*) FILTER (WHERE actual_result = 'loss') as losses
      FROM backtest_results
      WHERE actual_result IS NOT NULL
      GROUP BY bucket
      ORDER BY bucket
    `);

    // By flags
    const byFlags = await pool.query(`
      SELECT
        has_critical_flags,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE actual_result = 'win') as wins,
        COUNT(*) FILTER (WHERE actual_result = 'loss') as losses
      FROM backtest_results
      WHERE actual_result IS NOT NULL
      GROUP BY has_critical_flags
    `);

    // Recent picks detail
    const recent = await pool.query(`
      SELECT matchup, pick, oracle_confidence, actual_result,
             actual_home_score, actual_away_score, historical_date, latency_ms
      FROM backtest_results
      ORDER BY created_at DESC
      LIMIT 50
    `);

    // Run history
    const runs = await pool.query(`
      SELECT run_id,
        MIN(historical_date) as date,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE actual_result = 'win') as wins,
        COUNT(*) FILTER (WHERE actual_result = 'loss') as losses,
        MIN(created_at) as run_time
      FROM backtest_results
      GROUP BY run_id
      ORDER BY MIN(created_at) DESC
      LIMIT 20
    `);

    res.json({
      success: true,
      data: {
        summary: summary.rows[0],
        byDate: byDate.rows,
        byType: byType.rows,
        byConfidence: byConfidence.rows,
        byFlags: byFlags.rows,
        recent: recent.rows,
        runs: runs.rows,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/historical-games?date=YYYY-MM-DD — fetch completed games for a date
app.get('/api/admin/historical-games', verifyToken, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ success: false, error: 'Admin access required' });
  const date = req.query.date;
  if (!date) return res.status(400).json({ success: false, error: 'date query param required' });

  try {
    const url = `https://statsapi.mlb.com/api/v1/schedule?date=${date}&sportId=1&hydrate=team,linescore,probablePitcher`;
    const mlbRes = await fetch(url);
    const data = await mlbRes.json();
    const games = [];
    for (const dateObj of data.dates ?? []) {
      for (const game of dateObj.games ?? []) {
        const status = game.status?.detailedState ?? '';
        const isFinal = status.toLowerCase().includes('final');
        const home = game.teams?.home;
        const away = game.teams?.away;
        games.push({
          gamePk: game.gamePk,
          status: isFinal ? 'final' : status,
          isFinal,
          home: { name: home?.team?.name ?? '', abbreviation: home?.team?.abbreviation ?? '', score: home?.score ?? 0 },
          away: { name: away?.team?.name ?? '', abbreviation: away?.team?.abbreviation ?? '', score: away?.score ?? 0 },
          totalRuns: (home?.score ?? 0) + (away?.score ?? 0),
          homePitcher: home?.probablePitcher?.fullName ?? 'TBD',
          awayPitcher: away?.probablePitcher?.fullName ?? 'TBD',
        });
      }
    }
    // Check which games already have backtest results
    const existing = await pool.query(
      'SELECT DISTINCT game_pk FROM backtest_results WHERE historical_date = $1',
      [date]
    );
    const existingPks = new Set(existing.rows.map(r => r.game_pk));
    games.forEach(g => { g.alreadyTested = existingPks.has(g.gamePk); });

    res.json({ success: true, data: { date, games } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/run-backtest — analyze a single historical game and save to backtest_results
app.post('/api/admin/run-backtest', verifyToken, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ success: false, error: 'Admin access required' });
  const { gamePk, date, runId, homeTeam, awayTeam, homeScore, awayScore, totalRuns, betType } = req.body;
  if (!gamePk || !date) return res.status(400).json({ success: false, error: 'gamePk and date required' });

  try {
    const matchup = `${awayTeam} vs ${homeTeam}`;
    const start = Date.now();

    // Use existing analyze/game endpoint logic internally
    const games = await getTodayGames(date);
    const gameData = games.find(g => String(g.gamePk) === String(gamePk));
    if (!gameData) return res.status(404).json({ success: false, error: 'Game not found in MLB schedule' });

    let allOdds = [];
    try { allOdds = await getGameOdds(); } catch {}
    const matchedOdds = matchOddsToGame(allOdds, gameData.teams?.home?.name, gameData.teams?.away?.name);

    const contextResult2 = await buildContext(gameData, matchedOdds);
    const context = contextResult2.context ?? contextResult2;
    const shadowFeatures = contextResult2._features ?? {};
    const shadowStatcastData = buildShadowStatcastData(shadowFeatures);
    const analysis = await analyzeGame({
      mode: 'single', matchup, context, lang: 'en',
      betType: betType || 'all', riskProfile: 'balanced', webSearch: false, model: 'deep', timeoutMs: 90000,
      statcastData: shadowStatcastData,
      mlbApiData: gameData,
    });

    const latency = Date.now() - start;
    const mp = analysis.data?.master_prediction;
    const pick = mp?.pick ?? null;
    const confidence = mp?.oracle_confidence ?? null;
    const betValue = mp?.bet_value ?? null;
    const modelRisk = analysis.data?.model_risk ?? null;
    const alertFlags = analysis.data?.alert_flags ?? [];
    const hasCriticalFlags = alertFlags.some(f =>
      /statcast.*no.*available|no.*statcast|data.*limited|minimal.*analysis|small.*sample/i.test(f)
    );
    let pickType = pick ? (
      /over|under/i.test(pick) ? 'total' :
      /moneyline|ml/i.test(pick) ? 'moneyline' :
      /run\s*line|rl/i.test(pick) ? 'runline' : 'other'
    ) : 'unknown';

    // Resolve result
    let actualResult = null;
    if (pick && homeScore != null && awayScore != null) {
      const total = parseInt(homeScore) + parseInt(awayScore);
      const cleaned = pick.replace(/\s*\([+-]?\d+\)\s*$/i, '').replace(/\s+[+-]\d{2,3}\s*$/i, '').replace(/\s*\(estimated\s+line\)\s*$/i, '').replace(/\s*\(est\.?\)\s*$/i, '').replace(/\s*\([^)]*total[^)]*\)\s*$/i, '').trim();

      let m = cleaned.match(/(?:Over|O)\s*\(?(?:estimated\s+|est\.?\s*)?(\d+\.?\d*)\)?/i);
      if (m) { const line = parseFloat(m[1]); actualResult = total > line ? 'win' : total < line ? 'loss' : 'push'; }
      if (!actualResult) { m = cleaned.match(/(?:Under|U)\s*\(?(?:estimated\s+|est\.?\s*)?(\d+\.?\d*)\)?/i); }
      if (m && !actualResult) { const line = parseFloat(m[1]); actualResult = total < line ? 'win' : total > line ? 'loss' : 'push'; }
      if (!actualResult && /moneyline|ml|a ganar/i.test(cleaned)) {
        const teamToken = cleaned.replace(/\s*(moneyline|ml|a ganar|dinero)\s*/gi, '').trim().toLowerCase();
        const pickedHome = homeTeam?.toLowerCase().includes(teamToken) || teamToken.includes(homeTeam?.toLowerCase()?.split(' ').pop());
        const pickedAway = awayTeam?.toLowerCase().includes(teamToken) || teamToken.includes(awayTeam?.toLowerCase()?.split(' ').pop());
        if (pickedHome) actualResult = parseInt(homeScore) > parseInt(awayScore) ? 'win' : 'loss';
        else if (pickedAway) actualResult = parseInt(awayScore) > parseInt(homeScore) ? 'win' : 'loss';
      }
    }

    // Si no se resolvió con los patterns estándar, intentar como player prop
    if (!actualResult && pick) {
      try {
        const boxscorePlayers = await getGameBoxscore(gamePk);
        if (boxscorePlayers) {
          const propResult = resolvePlayerProp(pick, boxscorePlayers);
          if (propResult?.result) {
            actualResult = propResult.result;
            // Override pickType for props
            pickType = `prop_${propResult.propType}`;
            console.log(`[backtest] Prop resolved: ${propResult.playerName} ${propResult.propType} — actual: ${propResult.actual} — ${actualResult}`);
          }
        }
      } catch (err) {
        console.warn(`[backtest] Props resolver failed: ${err.message}`);
      }
    }

    // Save to DB
    const backtestInsert = await pool.query(`
      INSERT INTO backtest_results (run_id, historical_date, game_pk, matchup, home_team, away_team,
        pick, oracle_confidence, bet_value, model_risk, pick_type,
        actual_home_score, actual_away_score, actual_result, model, latency_ms,
        alert_flags, bet_value_raw, has_critical_flags)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT (run_id, game_pk, pick_type) DO UPDATE SET
        matchup = EXCLUDED.matchup,
        home_team = EXCLUDED.home_team,
        away_team = EXCLUDED.away_team,
        pick = EXCLUDED.pick,
        oracle_confidence = EXCLUDED.oracle_confidence,
        bet_value = EXCLUDED.bet_value,
        model_risk = EXCLUDED.model_risk,
        actual_home_score = EXCLUDED.actual_home_score,
        actual_away_score = EXCLUDED.actual_away_score,
        actual_result = EXCLUDED.actual_result,
        model = EXCLUDED.model,
        latency_ms = EXCLUDED.latency_ms,
        alert_flags = EXCLUDED.alert_flags,
        bet_value_raw = EXCLUDED.bet_value_raw,
        has_critical_flags = EXCLUDED.has_critical_flags
      RETURNING id
    `, [
      runId, date, gamePk, matchup, homeTeam, awayTeam,
      pick, confidence, betValue, modelRisk, pickType,
      homeScore, awayScore, actualResult, 'deep', latency,
      JSON.stringify(alertFlags), betValue, hasCriticalFlags,
    ]);

    const backtestId = backtestInsert.rows[0]?.id;
    if (backtestId) {
      await savePickFeatures({
        backtestId,
        gamePk: Number(gamePk),
        gameDate: date,
        ...(contextResult2._features ?? {}),
        oddsData: contextResult2._features?.oddsData ?? matchedOdds,
        pick,
        result: actualResult,
      });

      if (isShadowModeEnabled() && analysis?.data && analysis?.xgboostResult) {
        try {
          await recordShadowModelRun({
            backtestId,
            sourceType: 'backtest',
            analysisMode: 'single',
            gameData,
            gameDate: normalizeDateInput(date ?? gameData?.gameDate),
            analysisData: analysis.data,
            xgboostResult: analysis.xgboostResult,
            statcastData: shadowStatcastData,
            features: shadowFeatures,
            actual: buildShadowActualOutcome({
              gameData,
              actualResult,
              homeScore,
              awayScore,
            }),
          });
        } catch (shadowErr) {
          console.warn('[shadow-mode] Could not persist backtest run:', shadowErr.message);
        }
      }
    }

    res.json({
      success: true,
      data: { gamePk, matchup, pick, confidence, betValue, modelRisk, actualResult, alertFlags, latency, pickType, backtestId },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/shadow-model — view shadow model dashboard (admin only)
app.get('/api/admin/shadow-model', verifyToken, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ success: false, error: 'Admin access required' });

  try {
    const limit = Number(req.query.limit ?? 50);
    await refreshPendingShadowModelRuns(Math.min(limit, 50));
    const data = await getShadowModeDashboard(limit);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/admin/feature-store — view ML training dataset (admin only)
app.get('/api/admin/feature-store', verifyToken, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ success: false, error: 'Admin access required' });
  try {
    const requestedMonth = String(req.query.month ?? '').trim();
    if (requestedMonth && !/^\d{4}-\d{2}$/.test(requestedMonth)) {
      return res.status(400).json({ success: false, error: 'Invalid month format. Use YYYY-MM.' });
    }

    const summary = await pool.query(`
      SELECT
        COUNT(*) as total_records,
        COUNT(*) FILTER (WHERE result = 'win') as wins,
        COUNT(*) FILTER (WHERE result = 'loss') as losses,
        COUNT(*) FILTER (WHERE result IS NULL) as pending,
        COUNT(*) FILTER (WHERE pick_id IS NOT NULL) as from_real_picks,
        COUNT(*) FILTER (WHERE backtest_id IS NOT NULL) as from_backtests,
        ROUND(AVG(home_pitcher_xwoba)::numeric, 3) as avg_home_p_xwoba,
        ROUND(AVG(away_pitcher_xwoba)::numeric, 3) as avg_away_p_xwoba,
        ROUND(AVG(temperature)::numeric, 1) as avg_temperature,
        ROUND(AVG(data_quality_score)::numeric, 0) as avg_data_quality,
        MIN(game_date) as earliest_date,
        MAX(game_date) as latest_date
      FROM pick_features
    `);

    const monthOptions = await pool.query(`
      SELECT
        TO_CHAR(game_date::date, 'YYYY-MM') as month_key,
        MIN(game_date::date) as month_start,
        COUNT(*) as total_records,
        COUNT(*) FILTER (WHERE result = 'win') as wins,
        COUNT(*) FILTER (WHERE result = 'loss') as losses,
        COUNT(*) FILTER (WHERE result IS NULL) as pending
      FROM pick_features
      WHERE game_date IS NOT NULL
      GROUP BY 1
      ORDER BY month_key DESC
    `);

    const selectedMonth = requestedMonth || monthOptions.rows[0]?.month_key || null;

    const dailySummaries = selectedMonth
      ? await pool.query(`
          SELECT
            TO_CHAR(game_date::date, 'YYYY-MM-DD') as day_key,
            COUNT(*) as total_records,
            COUNT(*) FILTER (WHERE result = 'win') as wins,
            COUNT(*) FILTER (WHERE result = 'loss') as losses,
            COUNT(*) FILTER (WHERE result IS NULL) as pending
          FROM pick_features
          WHERE TO_CHAR(game_date::date, 'YYYY-MM') = $1
          GROUP BY 1
          ORDER BY day_key DESC
        `, [selectedMonth])
      : { rows: [] };

    const monthRecords = selectedMonth
      ? await pool.query(`
          SELECT game_date, game_pk, pick, result,
            home_pitcher_xwoba, away_pitcher_xwoba,
            home_pitcher_whiff, away_pitcher_whiff,
            home_lineup_avg_xwoba, away_lineup_avg_xwoba,
            park_factor_overall, temperature, wind_speed,
            data_quality_score, signal_coherence_score,
            odds_ml_home, odds_ml_away, odds_ou_total
          FROM pick_features
          WHERE TO_CHAR(game_date::date, 'YYYY-MM') = $1
          ORDER BY game_date DESC, created_at DESC
          LIMIT 750
        `, [selectedMonth])
      : { rows: [] };

    const featureCoverage = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(home_pitcher_xwoba) as has_home_xwoba,
        COUNT(away_pitcher_xwoba) as has_away_xwoba,
        COUNT(home_pitcher_whiff) as has_home_whiff,
        COUNT(away_pitcher_whiff) as has_away_whiff,
        COUNT(home_lineup_avg_xwoba) as has_home_lineup,
        COUNT(away_lineup_avg_xwoba) as has_away_lineup,
        COUNT(temperature) as has_temperature,
        COUNT(odds_ml_home) as has_odds,
        COUNT(park_factor_overall) as has_park
      FROM pick_features
    `);

    const winRateByFeature = await pool.query(`
      SELECT
        CASE WHEN temperature < 50 THEN 'COLD (<50F)' WHEN temperature < 70 THEN 'MILD (50-70F)' ELSE 'WARM (70F+)' END as temp_bucket,
        COUNT(*) FILTER (WHERE result = 'win') as wins,
        COUNT(*) FILTER (WHERE result IN ('win','loss')) as total
      FROM pick_features
      WHERE temperature IS NOT NULL AND result IN ('win','loss')
      GROUP BY temp_bucket
      ORDER BY temp_bucket
    `);

    res.json({
      success: true,
      data: {
        summary: summary.rows[0],
        selectedMonth,
        monthOptions: monthOptions.rows,
        dailySummaries: dailySummaries.rows,
        records: monthRecords.rows,
        featureCoverage: featureCoverage.rows[0],
        winRateByTemperature: winRateByFeature.rows,
        statcastCache: getCacheStatus(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Startup: run migrations → seed admin → start server ───────────────────────
app.post('/api/admin/feature-store/backfill', verifyToken, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ success: false, error: 'Admin access required' });

  const requestedLimit = Number(req.body?.limit);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(250, Math.floor(requestedLimit))) : 50;
  const scope = String(req.body?.scope ?? 'all').toLowerCase();
  const onlyMissing = req.body?.onlyMissing !== false;

  const missingPredicate = `
    pf.id IS NULL OR
    pf.home_pitcher_xwoba IS NULL OR
    pf.away_pitcher_xwoba IS NULL OR
    pf.home_pitcher_whiff IS NULL OR
    pf.away_pitcher_whiff IS NULL OR
    pf.home_lineup_avg_xwoba IS NULL OR
    pf.away_lineup_avg_xwoba IS NULL
  `;

  try {
    const candidates = [];

    if (scope === 'all' || scope === 'picks') {
      const picksRes = await pool.query(`
        SELECT
          'pick' AS source,
          p.id AS entity_id,
          p.id AS pick_id,
          NULL::INTEGER AS backtest_id,
          p.game_pk,
          p.game_date,
          p.pick,
          p.result,
          p.odds_details
        FROM picks p
        LEFT JOIN pick_features pf ON pf.pick_id = p.id
        WHERE p.deleted_at IS NULL
          AND p.game_pk IS NOT NULL
          ${onlyMissing ? `AND (${missingPredicate})` : ''}
        ORDER BY p.created_at DESC
        LIMIT $1
      `, [limit]);
      candidates.push(...picksRes.rows);
    }

    if (scope === 'all' || scope === 'backtests') {
      const backtestsRes = await pool.query(`
        SELECT
          'backtest' AS source,
          b.id AS entity_id,
          NULL::INTEGER AS pick_id,
          b.id AS backtest_id,
          b.game_pk,
          b.historical_date AS game_date,
          b.pick,
          b.actual_result AS result,
          NULL::JSONB AS odds_details
        FROM backtest_results b
        LEFT JOIN pick_features pf ON pf.backtest_id = b.id
        WHERE b.game_pk IS NOT NULL
          ${onlyMissing ? `AND (${missingPredicate})` : ''}
        ORDER BY b.created_at DESC
        LIMIT $1
      `, [limit]);
      candidates.push(...backtestsRes.rows);
    }

    const deduped = Array.from(
      new Map(candidates.map((row) => [`${row.source}:${row.entity_id}`, row])).values()
    ).slice(0, limit);

    let rebuilt = 0;
    let failed = 0;
    const failures = [];

    for (const row of deduped) {
      try {
        const ok = await saveFeatureStoreForGame({
          pickId: row.pick_id,
          backtestId: row.backtest_id,
          gamePk: row.game_pk,
          gameDate: row.game_date,
          pick: row.pick,
          result: row.result,
          oddsData: row.odds_details,
        });

        if (ok) rebuilt += 1;
        else {
          failed += 1;
          failures.push({
            source: row.source,
            entity_id: row.entity_id,
            game_pk: row.game_pk,
            reason: 'game_not_found_or_feature_save_skipped',
          });
        }
      } catch (err) {
        failed += 1;
        failures.push({
          source: row.source,
          entity_id: row.entity_id,
          game_pk: row.game_pk,
          reason: err.message,
        });
      }
    }

    res.json({
      success: true,
      data: {
        scanned: deduped.length,
        rebuilt,
        failed,
        scope,
        onlyMissing,
        failures: failures.slice(0, 20),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

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

      // ── Line movement snapshot: every 6 hours between 9am–7pm ET ────────
      const SIX_HOURS_LM = 6 * 60 * 60 * 1000;
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
      }, SIX_HOURS_LM).unref();

      // ── Pick resolver: every 30 min between 7pm–6am ET ───────────────────
      const THIRTY_MIN = 30 * 60 * 1000;
      setInterval(() => {
        // Get current hour in US Eastern Time (handles EDT/EST automatically)
        const etHour = parseInt(
          new Intl.DateTimeFormat('en-US', {
            hour: 'numeric', hour12: false, timeZone: 'America/New_York',
          }).format(new Date()),
          10
        );
        // Window: 19:00–05:59 ET (west coast games finish ~7pm ET; extras/rain delays can run past 3am)
        if (etHour >= 19 || etHour < 6) {
          console.log(`[pick-resolver] Scheduled run triggered (ET hour: ${etHour})`);
          resolvePendingPicks().catch(err => {
            console.error('[pick-resolver] Scheduled run failed:', err.message);
          });
        }
      }, THIRTY_MIN).unref();

      // ── Closing line capture: every 2 hours between 5pm–1am ET ──────────
      const TWO_HOURS = 2 * 60 * 60 * 1000;
      setInterval(() => {
        const etHour = parseInt(
          new Intl.DateTimeFormat('en-US', {
            hour: 'numeric', hour12: false, timeZone: 'America/New_York',
          }).format(new Date()),
          10
        );
        // Closing line capture: 17:00–00:59 ET (before and during MLB game windows)
        if (etHour >= 17 || etHour < 1) {
          console.log(`[closing-line] Scheduled capture triggered (ET hour: ${etHour})`);
          captureClosingLines().catch(err => {
            console.error('[closing-line] Scheduled capture failed:', err.message);
          });
        }
      }, TWO_HOURS).unref();
    });
  })
  .catch(err => {
    console.error('[H.E.X.A.] Startup failed:', err.message);
    process.exit(1);
  });
