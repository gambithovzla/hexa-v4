import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { getTodayGames, getTeams } from './mlb-api.js';
import { buildContext, buildContextById } from './context-builder.js';
import { analyzeGame, analyzeParlay, analyzeFullDay } from './oracle.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

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

// POST /api/analyze/game
app.post('/api/analyze/game', async (req, res) => {
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
    const context  = await buildContext(gameData);
    const matchup  = `${gameData.teams?.away?.abbreviation ?? 'AWAY'} @ ${gameData.teams?.home?.abbreviation ?? 'HOME'}`;
    const analysis = await analyzeGame({ matchup, betType, context, riskProfile, mode: 'single', lang: resolvedLang, webSearch, model });
    res.json({ success: true, data: analysis });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/analyze/parlay
app.post('/api/analyze/parlay', async (req, res) => {
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
    const contexts = await Promise.all(
      gameIds.map(async (id) => {
        const gameData = games.find(g => String(g.gamePk) === String(id));
        if (!gameData) throw new Error(`Partido ${id} no encontrado`);
        return buildContext(gameData);
      })
    );
    const analysis = await analyzeParlay(contexts, resolvedLang, { betType, riskProfile, webSearch, legs: parlayLegs, model });
    res.json({ success: true, data: analysis });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/analyze/full-day
app.post('/api/analyze/full-day', async (req, res) => {
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
    const contexts = await Promise.all(games.map(g => buildContext(g)));
    const analysis = await analyzeFullDay(contexts, resolvedDate, resolvedLang, { betType, riskProfile, webSearch, model });
    res.json({ success: true, data: analysis });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Hexa-v4 server running on http://localhost:${PORT}`);
});
