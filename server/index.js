import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { getTodayGames, getTeams } from './mlb-api.js';
import { buildContext, buildContextById } from './context-builder.js';
import { analyzeGame, analyzeParlay, analyzeFullDay } from './oracle.js';
import { getGameOdds, matchOddsToGame } from './odds-api.js';
import { getCacheStatus, refreshCache } from './savant-fetcher.js';
import authRouter, { bankrollRouter, seedAdminUser } from './auth.js';
import { verifyToken } from './middleware/auth-middleware.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, 'users.db.json');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ── Auth routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',      authRouter);
app.use('/api/bankroll',  bankrollRouter);

// ── Credit helpers ────────────────────────────────────────────────────────────

function readUsers() {
  if (!existsSync(DB_PATH)) return [];
  try { return JSON.parse(readFileSync(DB_PATH, 'utf8')); } catch { return []; }
}

function writeUsers(users) {
  writeFileSync(DB_PATH, JSON.stringify(users, null, 2), 'utf8');
}

/**
 * deductCredits(req, res, cost)
 * Reads the user from DB, checks credits, deducts `cost`, saves.
 * Returns the updated user or responds with 403 if insufficient credits.
 */
function deductCredits(req, res, cost) {
  const users = readUsers();
  const idx   = users.findIndex(u => u.id === req.user.id);
  if (idx === -1) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const user = users[idx];
  // Admin account bypasses credit deduction
  if (user.email === 'admin@hexa.com') return user;
  if (user.credits < cost) {
    res.status(403).json({ error: 'No credits remaining' });
    return null;
  }
  users[idx] = { ...user, credits: user.credits - cost };
  writeUsers(users);
  return users[idx];
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

// POST /api/analyze/game  — requires auth, costs 1 credit
app.post('/api/analyze/game', verifyToken, async (req, res) => {
  try {
    const {
      gameId,
      language    = 'en',
      lang,
      betType,
      riskProfile = 'medium',
      webSearch   = false,
      model       = 'fast',
    } = req.body;
    const date    = req.body.date || new Date().toISOString().split('T')[0];
    const resolvedLang = lang ?? language;
    const games   = await getTodayGames(date);
    const gameData = games.find(g => String(g.gamePk) === String(gameId));
    if (!gameData) return res.status(404).json({ success: false, error: `Partido ${gameId} no encontrado` });

    // Fetch odds (non-blocking — analysis proceeds even if odds unavailable)
    let matchedOdds = null;
    try {
      const allOdds = await getGameOdds();
      matchedOdds = matchOddsToGame(allOdds, gameData.teams?.home?.name, gameData.teams?.away?.name);
    } catch { /* odds are optional */ }

    const updatedUser = deductCredits(req, res, 1);
    if (!updatedUser) return;

    const context  = await buildContext(gameData, matchedOdds);
    const matchup  = `${gameData.teams?.away?.abbreviation ?? 'AWAY'} @ ${gameData.teams?.home?.abbreviation ?? 'HOME'}`;
    const analysis = await analyzeGame({ matchup, betType, context, riskProfile, mode: 'single', lang: resolvedLang, webSearch, model });

    const responseData = analysis.data ? { ...analysis.data, odds: matchedOdds ?? undefined } : null;
    res.json({ success: true, data: responseData, parseError: analysis.parseError, rawText: analysis.rawText, credits: updatedUser.credits });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/analyze/parlay  — requires auth, costs 2 credits
app.post('/api/analyze/parlay', verifyToken, async (req, res) => {
  try {
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
    const date = req.body.date || new Date().toISOString().split('T')[0];
    const resolvedLang = lang ?? language;
    const games = await getTodayGames(date);

    // Fetch odds once for all games
    let allOdds = [];
    try { allOdds = await getGameOdds(); } catch { /* optional */ }

    const legOddsArr = gameIds.map(id => {
      const gameData = games.find(g => String(g.gamePk) === String(id));
      if (!gameData) return null;
      return matchOddsToGame(allOdds, gameData.teams?.home?.name, gameData.teams?.away?.name);
    });

    const updatedUser = deductCredits(req, res, 2);
    if (!updatedUser) return;

    const contexts = await Promise.all(
      gameIds.map(async (id, i) => {
        const gameData = games.find(g => String(g.gamePk) === String(id));
        if (!gameData) throw new Error(`Partido ${id} no encontrado`);
        return buildContext(gameData, legOddsArr[i] ?? null);
      })
    );
    const analysis = await analyzeParlay(contexts, resolvedLang, { betType, riskProfile, webSearch, legs: parlayLegs, model });

    const responseData = analysis.data
      ? { ...analysis.data, legOdds: legOddsArr.some(Boolean) ? legOddsArr : undefined }
      : null;
    res.json({ success: true, data: responseData, parseError: analysis.parseError, rawText: analysis.rawText, credits: updatedUser.credits });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/analyze/full-day  — requires auth, costs 3 credits
app.post('/api/analyze/full-day', verifyToken, async (req, res) => {
  try {
    const {
      date,
      language    = 'en',
      lang,
      betType,
      riskProfile = 'medium',
      webSearch   = false,
      model       = 'fast',
    } = req.body;
    const resolvedLang = lang ?? language;
    const resolvedDate = date || new Date().toISOString().split('T')[0];
    const games = await getTodayGames(resolvedDate);

    let allOdds = [];
    try { allOdds = await getGameOdds(); } catch { /* optional */ }

    const updatedUser = deductCredits(req, res, 3);
    if (!updatedUser) return;

    const contexts = await Promise.all(
      games.map(g => {
        const gameOdds = matchOddsToGame(allOdds, g.teams?.home?.name, g.teams?.away?.name);
        return buildContext(g, gameOdds);
      })
    );
    const analysis = await analyzeFullDay(contexts, resolvedDate, resolvedLang, { betType, riskProfile, webSearch, model });
    res.json({ success: true, data: analysis.data, parseError: analysis.parseError, rawText: analysis.rawText, credits: updatedUser.credits });
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

app.listen(PORT, () => {
  console.log(`Hexa-v4 server running on http://localhost:${PORT}`);
  seedAdminUser().catch(err => console.error('[H.E.X.A.] Admin seed failed:', err.message));

  // ── Statcast cache warm-up (non-blocking) ──────────────────────────────
  console.log('[H.E.X.A.] Warming up Statcast cache...');
  refreshCache()
    .then(status => {
      const total = Object.values(status?.recordCounts ?? {}).reduce((a, b) => a + b, 0);
      console.log(`[H.E.X.A.] Statcast cache ready: ${total} records loaded`);
    })
    .catch(err => {
      console.warn('[H.E.X.A.] Statcast warm-up failed (will retry on first request):', err.message);
    });

  // ── Auto-refresh every 6 hours ─────────────────────────────────────────
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
  }, SIX_HOURS).unref(); // .unref() so the interval doesn't keep the process alive if everything else exits
});
