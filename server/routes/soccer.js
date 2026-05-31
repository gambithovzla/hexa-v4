/**
 * server/routes/soccer.js — Soccer analysis and pick generation endpoints.
 *
 * POST /api/soccer/analyze/game  — Oracle pick for a single soccer match (admin-only)
 * POST /api/soccer/analyze/chat  — Conversational Oracle chat for admins
 *
 * Mirrors routes/nhl.js (date-based cadence), scoped to soccer. Does NOT import or
 * modify any frozen MLB file. Feature-flagged: SOCCER_ANALYSIS_ENABLED=true required,
 * else 503. Persists the pick to `picks` with sport='soccer' and league=<leagueSlug>.
 * Resolves odds server-side. No shadow/dataset persistence in Sprint 11c (→ 11.1).
 *
 * Soccer-specific differences vs NHL route:
 *   - `leagueSlug` is a required parameter (soccer is league-aware from the base).
 *   - Game lookup uses `getSoccerGamesForDate(leagueSlug, date)` and matches by gamePk/teams.
 *   - Market odds: `getSoccerGameOdds({leagueSlug, date})` → `{threeWay, total, btts}`.
 *   - `buildSoccerGameContext` uses team display names (not numeric IDs).
 *   - Persists `league` column alongside `sport='soccer'`.
 */

import { Router } from 'express';
import pool from '../db.js';
import { verifyToken, requireAdmin } from '../middleware/auth-middleware.js';
import { getSoccerGamesForDate } from '../soccer-api.js';
import { isSupportedLeague } from '../soccer-league-map.js';
import { buildSoccerGameContext } from '../soccer-context-builder.js';
import { analyzeSoccerGame, analyzeSoccerChat } from '../services/oracleSoccer.js';
import { getSoccerGameOdds, matchSoccerOddsToGame, buildMarketOddsForGame } from '../soccer-odds.js';
import { validateSoccerAnalysisOutput } from '../services/soccerOutputGuard.js';
import { augmentChatQuestion, processChatAnswer } from '../services/chatPickExtractor.js';
import { upsertOracleSession } from './oracle-history.js';

const router = Router();

function soccerEnabled(req, res, next) {
  if (process.env.SOCCER_ANALYSIS_ENABLED !== 'true') {
    return res.status(503).json({ success: false, error: 'Soccer analysis is not yet enabled on this instance.' });
  }
  return next();
}

function safeErr(err) {
  return process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
}

function validateLeague(req, res) {
  const { leagueSlug } = req.body;
  if (!leagueSlug || !isSupportedLeague(leagueSlug)) {
    res.status(400).json({
      success: false,
      error: `leagueSlug is required and must be one of: eng.1, esp.1, ita.1, ger.1, fra.1, usa.1`,
    });
    return null;
  }
  return leagueSlug;
}

/** Locate a soccer game by gamePk or team name matching within the date's slate. */
async function findSoccerGame({ gameId, leagueSlug, date }) {
  const lookupDate = (date && /^\d{4}-\d{2}-\d{2}$/.test(date))
    ? date
    : new Date().toISOString().slice(0, 10);
  const games = await getSoccerGamesForDate(leagueSlug, lookupDate);
  return games.find(g => String(g.gamePk) === String(gameId) || String(g.gameId) === String(gameId)) ?? null;
}

/**
 * Resolve marketOdds: client-provided wins; else server-side via The Odds API.
 */
async function resolveMarketOdds({ clientMarketOdds, leagueSlug, gameDate, homeTeamName, awayTeamName }) {
  if (clientMarketOdds) {
    return { marketOdds: { ...clientMarketOdds, provided: 'client' }, source: 'client' };
  }
  try {
    const events = await getSoccerGameOdds({ leagueSlug, date: gameDate });
    if (!events.length) return { marketOdds: null, source: null };
    const match = matchSoccerOddsToGame(events, homeTeamName, awayTeamName);
    if (!match) return { marketOdds: null, source: null };
    const odds = buildMarketOddsForGame(match);
    if (!odds) return { marketOdds: null, source: null };
    return { marketOdds: { ...odds, provided: 'server' }, source: 'server' };
  } catch (err) {
    console.warn(`[soccer-route] server-side odds lookup failed: ${err.message}`);
    return { marketOdds: null, source: null };
  }
}

async function persistSoccerPick({ userId, userEmail, matchup, analysisData, model, language, gameId, gameDate, leagueSlug, marketOdds }) {
  if (!userId || !analysisData) return null;

  const mp = analysisData.master_prediction ?? {};
  const bp = analysisData.best_pick ?? {};
  const pickText = mp.pick ?? bp.detail ?? null;
  const conf = typeof mp.oracle_confidence === 'number' ? mp.oracle_confidence : null;
  const gamePkInt = gameId ? parseInt(gameId, 10) : null;

  const { rows } = await pool.query(
    `INSERT INTO picks (
       user_id, type, matchup, pick, oracle_confidence, bet_value, model_risk,
       oracle_report, hexa_hunch, alert_flags, probability_model, best_pick,
       model, language, odds_details, kelly_recommendation,
       game_pk, game_date, user_email, sport, league,
       pick_time_lima
     )
     VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
       $13,$14,$15,$16,$17,$18,$19,$20,$21,
       (NOW() AT TIME ZONE 'America/Lima')::TIMESTAMP
     )
     RETURNING *`,
    [
      userId,
      'single',
      matchup,
      pickText,
      conf,
      mp.bet_value ?? null,
      analysisData.model_risk ?? null,
      analysisData.oracle_report ?? null,
      analysisData.hexa_hunch ?? null,
      JSON.stringify(analysisData.alert_flags ?? []),
      JSON.stringify(analysisData.probability_model ?? {}),
      JSON.stringify(analysisData.best_pick ?? {}),
      model,
      language,
      marketOdds ? JSON.stringify(marketOdds) : null,
      analysisData.kelly_recommendation ?? null,
      gamePkInt,
      gameDate,
      userEmail ?? null,
      'soccer',
      leagueSlug,
    ]
  );

  return rows[0] ?? null;
}

// ── POST /api/soccer/analyze/game ─────────────────────────────────────────────

router.post('/analyze/game', soccerEnabled, verifyToken, requireAdmin, async (req, res) => {
  const {
    gameId,
    date        = null,
    lang        = 'en',
    riskProfile = 'balanced',
    engine      = 'deep',
    marketOdds  = null,
    bankroll    = null,
  } = req.body;

  const leagueSlug = validateLeague(req, res);
  if (!leagueSlug) return;
  if (!gameId) return res.status(400).json({ success: false, error: 'gameId is required' });
  if (!['deep', 'premium', 'haiku'].includes(engine)) {
    return res.status(400).json({ success: false, error: 'Invalid engine (deep|premium|haiku)' });
  }

  try {
    const game = await findSoccerGame({ gameId, leagueSlug, date });
    if (!game) {
      return res.status(404).json({ success: false, error: `Soccer game ${gameId} not found in ${leagueSlug}` });
    }

    const homeTeamName = game.teams?.home?.name ?? 'HOME';
    const awayTeamName = game.teams?.away?.name ?? 'AWAY';
    const homeAbbr     = game.teams?.home?.abbreviation ?? null;
    const awayAbbr     = game.teams?.away?.abbreviation ?? null;
    const matchup      = `${awayAbbr ?? awayTeamName} @ ${homeAbbr ?? homeTeamName}`;
    const gameDate     = game.gameDate?.slice(0, 10) ?? date ?? new Date().toISOString().slice(0, 10);

    const { marketOdds: resolvedOdds, source: oddsSource } = await resolveMarketOdds({
      clientMarketOdds: marketOdds,
      leagueSlug,
      gameDate,
      homeTeamName,
      awayTeamName,
    });

    const context = await buildSoccerGameContext({
      leagueSlug,
      homeTeamName,
      awayTeamName,
      homeTeamId: game.teams?.home?.id ?? null,
      awayTeamId: game.teams?.away?.id ?? null,
      gameDate,
      marketOdds: resolvedOdds,
    });

    const result = await analyzeSoccerGame({
      context,
      gameDescription: `${awayTeamName} vs ${homeTeamName} — ${gameDate} — ${leagueSlug}`,
      lang,
      riskProfile,
      userBankroll: bankroll != null ? Number(bankroll) : undefined,
      marketOdds: resolvedOdds,
      engine,
    });

    if (result.parseError) {
      console.warn(`[soccer-route] parse error for game ${gameId} (${leagueSlug})`);
    }

    const guard = validateSoccerAnalysisOutput(result.data, { parseError: result.parseError });
    if (!guard.ok) {
      return res.status(422).json({
        success: false,
        error: 'Soccer analysis output failed validation',
        validation: { quality: guard.quality, errors: guard.errors, schema_version: guard.schema_version },
        rawText: result.parseError ? result.rawText : undefined,
      });
    }

    const analysisData = guard.data;

    const savedPick = await persistSoccerPick({
      userId: req.user.id,
      userEmail: req.user.email ?? null,
      matchup,
      analysisData,
      model: result.model,
      language: lang,
      gameId,
      gameDate,
      leagueSlug,
      marketOdds: resolvedOdds,
    });

    console.log(
      `[soccer-route] pick saved id=${savedPick?.id} game=${gameId} league=${leagueSlug} ` +
      `conf=${analysisData?.master_prediction?.oracle_confidence} quality=${guard.quality} odds=${oddsSource ?? 'none'}`
    );

    return res.json({
      success: true,
      data: analysisData,
      rawText: result.parseError ? result.rawText : undefined,
      parseError: result.parseError,
      outputQuality: guard.quality,
      validationErrors: guard.errors.length ? guard.errors : undefined,
      savedPick: savedPick ? {
        id:                savedPick.id,
        matchup:           savedPick.matchup,
        pick:              savedPick.pick,
        oracle_confidence: savedPick.oracle_confidence,
        bet_value:         savedPick.bet_value,
        model_risk:        savedPick.model_risk,
        oracle_report:     savedPick.oracle_report,
        hexa_hunch:        savedPick.hexa_hunch,
        alert_flags:       savedPick.alert_flags,
        kelly_recommendation: savedPick.kelly_recommendation,
        result:            savedPick.result,
        game_pk:           savedPick.game_pk,
        game_date:         savedPick.game_date,
        created_at:        savedPick.created_at,
        type:              savedPick.type,
        sport:             savedPick.sport,
        league:            savedPick.league,
      } : null,
      meta: {
        model:        result.model,
        stopReason:   result.stopReason,
        usage:        result.usage,
        matchup,
        gameDate,
        leagueSlug,
        pickId:       savedPick?.id ?? null,
        oddsSource,
        context_meta: context.context_meta ?? null,
      },
    });
  } catch (err) {
    console.error(`[soccer-route] analyze/game error: ${err.message}`);
    return res.status(500).json({ success: false, error: safeErr(err) });
  }
});

// ── POST /api/soccer/analyze/chat ─────────────────────────────────────────────

function soccerGameToChatData(game, matchup) {
  return {
    gamePk: game.gamePk,
    game_id: game.gameId,
    gameDate: game.gameDate,
    game_date: game.gameDate,
    matchup,
    away_team_name: game.teams?.away?.name,
    home_team_name: game.teams?.home?.name,
    teams: game.teams,
  };
}

router.post('/analyze/chat', soccerEnabled, verifyToken, requireAdmin, async (req, res) => {
  const {
    gameId,
    question,
    conversationHistory = [],
    date       = null,
    lang       = 'en',
    marketOdds = null,
    sessionKey,
    matchups,
  } = req.body;

  const leagueSlug = validateLeague(req, res);
  if (!leagueSlug) return;
  if (!gameId) return res.status(400).json({ success: false, error: 'gameId is required' });
  if (!question?.trim()) return res.status(400).json({ success: false, error: 'question is required' });

  try {
    const game = await findSoccerGame({ gameId, leagueSlug, date });
    if (!game) {
      return res.status(404).json({ success: false, error: `Soccer game ${gameId} not found in ${leagueSlug}` });
    }

    const homeTeamName = game.teams?.home?.name ?? 'HOME';
    const awayTeamName = game.teams?.away?.name ?? 'AWAY';
    const homeAbbr     = game.teams?.home?.abbreviation ?? null;
    const awayAbbr     = game.teams?.away?.abbreviation ?? null;
    const matchup      = matchups || `${awayAbbr ?? awayTeamName} @ ${homeAbbr ?? homeTeamName}`;
    const gameDate     = game.gameDate?.slice(0, 10) ?? date ?? new Date().toISOString().slice(0, 10);

    const { marketOdds: resolvedOdds, source: oddsSource } = await resolveMarketOdds({
      clientMarketOdds: marketOdds,
      leagueSlug,
      gameDate,
      homeTeamName,
      awayTeamName,
    });

    const context = await buildSoccerGameContext({
      leagueSlug,
      homeTeamName,
      awayTeamName,
      homeTeamId: game.teams?.home?.id ?? null,
      awayTeamId: game.teams?.away?.id ?? null,
      gameDate,
      marketOdds: resolvedOdds,
    });

    const skipExtract = String(req.headers['x-hexa-skip-pick-extract'] ?? '') === '1';
    const augmentedQuestion = skipExtract
      ? question.trim()
      : augmentChatQuestion(question.trim(), lang, 'soccer');

    const result = await analyzeSoccerChat({
      context,
      gameDescription: `${awayTeamName} vs ${homeTeamName} — ${gameDate} — ${leagueSlug}`,
      question: augmentedQuestion,
      conversationHistory,
      lang,
      marketOdds: resolvedOdds,
    });

    let cleanAnswer = result.text;
    let picked = null;
    if (!skipExtract) {
      try {
        const processed = await processChatAnswer({
          rawAnswer: result.text,
          question: question.trim(),
          userId: req.user.id,
          gameData: soccerGameToChatData(game, matchup),
          chatSessionId: null,
          lang,
          sport: 'soccer',
        });
        cleanAnswer = processed.answer;
        picked = processed.picked;
      } catch (err) {
        console.warn(`[soccer-route] chat pick extraction failed: ${err.message}`);
      }
    }

    if (sessionKey) {
      const fullMessages = [
        ...conversationHistory.flatMap(t => [
          { role: 'user', text: t.question },
          { role: 'assistant', text: t.answer },
        ]),
        { role: 'user', text: question.trim() },
        { role: 'assistant', text: cleanAnswer },
      ];
      upsertOracleSession({
        userId: req.user.id,
        sessionKey,
        dateEt: gameDate,
        mode: 'partido',
        gameIds: [String(gameId)],
        matchups: matchup,
        messages: fullMessages,
      }).then((sessionId) => {
        if (sessionId && picked?.pick_id) {
          pool.query(
            'UPDATE picks SET chat_session_id = $1 WHERE id = $2 AND chat_session_id IS NULL',
            [sessionId, picked.pick_id],
          ).catch((err) => console.warn(`[soccer-route] chat_session_id backfill failed: ${err.message}`));
        }
      });
    }

    return res.json({
      success: true,
      answer: cleanAnswer,
      text: cleanAnswer,
      picked,
      mode: 'chat',
      meta: {
        model:        result.model,
        usage:        result.usage,
        matchup,
        gameDate,
        leagueSlug,
        oddsSource,
        context_meta: context.context_meta ?? null,
        sport:        'soccer',
      },
    });
  } catch (err) {
    console.error(`[soccer-route] analyze/chat error: ${err.message}`);
    return res.status(500).json({ success: false, error: safeErr(err) });
  }
});

export default router;
