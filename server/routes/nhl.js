/**
 * server/routes/nhl.js — NHL analysis and pick generation endpoints.
 *
 * POST /api/nhl/analyze/game  — Oracle pick for a single NHL game (admin-only while MVP)
 * POST /api/nhl/analyze/chat  — Conversational Oracle chat for admins
 *
 * Mirrors routes/nba.js (date-based cadence), scoped to NHL. Does NOT import or
 * modify any frozen MLB file. Feature-flagged: NHL_ANALYSIS_ENABLED=true
 * required, else 503. Persists the pick to `picks` with sport='nhl', resolves
 * odds server-side, and fires NHL pick_features + shadow_model_runs.
 */

import { Router } from 'express';
import pool from '../db.js';
import { verifyToken, requireAdmin, requireSportAccess } from '../middleware/auth-middleware.js';
import { getNhlGamesForDate } from '../nhl-api.js';
import { buildNhlGameContext } from '../nhl-context-builder.js';
import { analyzeNhlGame, analyzeNhlChat } from '../services/oracleNhl.js';
import { getNhlGameOdds, matchNhlOddsToGame, buildMarketOddsForGame } from '../nhl-odds.js';
import { validateNhlAnalysisOutput } from '../services/nhlOutputGuard.js';
import { saveNhlPickFeatures, recordNhlShadowRun } from '../services/nhlShadowPersistence.js';
import { augmentChatQuestion, processChatAnswer } from '../services/chatPickExtractor.js';
import { upsertOracleSession } from './oracle-history.js';

const router = Router();

function nhlEnabled(req, res, next) {
  if (process.env.NHL_ANALYSIS_ENABLED !== 'true') {
    return res.status(503).json({ success: false, error: 'NHL analysis is not yet enabled on this instance.' });
  }
  return next();
}

function safeErr(err) {
  return process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
}

/** Locate an NHL game by id within the slate for its calendar date. */
async function findNhlGame({ gameId, date }) {
  const lookupDate = (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : new Date().toISOString().slice(0, 10);
  const games = await getNhlGamesForDate(lookupDate);
  return games.find(g => String(g.game_id) === String(gameId)) ?? null;
}

/**
 * Resolve marketOdds: client-provided wins; else server-side via The Odds API
 * keyed on the game's own date. Never throws.
 */
async function resolveMarketOdds({ clientMarketOdds, game }) {
  if (clientMarketOdds) {
    return { marketOdds: { ...clientMarketOdds, provided: 'client' }, source: 'client' };
  }
  try {
    const events = await getNhlGameOdds({ date: game.game_date });
    if (!events.length) return { marketOdds: null, source: null };
    const match = matchNhlOddsToGame(events, game.home_team_name, game.away_team_name);
    if (!match) return { marketOdds: null, source: null };
    const odds = buildMarketOddsForGame(match);
    if (!odds) return { marketOdds: null, source: null };
    return { marketOdds: { ...odds, provided: 'server' }, source: 'server' };
  } catch (err) {
    console.warn(`[nhl-route] server-side odds lookup failed: ${err.message}`);
    return { marketOdds: null, source: null };
  }
}

async function persistNhlPick({ userId, userEmail, matchup, analysisData, model, language, gameId, gameDate, marketOdds }) {
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
       model, language, odds_at_pick, implied_prob_at_pick, odds_details,
       kelly_recommendation, game_pk, game_date, user_email, sport,
       pick_time_lima
     )
     VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
       $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
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
      null,
      null,
      marketOdds ? JSON.stringify(marketOdds) : null,
      analysisData.kelly_recommendation ?? null,
      gamePkInt,
      gameDate,
      userEmail ?? null,
      'nhl',
    ]
  );

  return rows[0] ?? null;
}

// ── POST /api/nhl/analyze/game ─────────────────────────────────────────────────

router.post('/analyze/game', nhlEnabled, verifyToken, requireSportAccess('nhl'), async (req, res) => {
  const {
    gameId,
    date        = null,
    lang        = 'en',
    riskProfile = 'balanced',
    engine      = 'deep',
    marketOdds  = null,
    bankroll    = null,
  } = req.body;

  if (!gameId) return res.status(400).json({ success: false, error: 'gameId is required' });
  if (!['deep', 'premium', 'haiku'].includes(engine)) return res.status(400).json({ success: false, error: 'Invalid engine (deep|premium|haiku)' });

  try {
    const game = await findNhlGame({ gameId, date });
    if (!game) {
      return res.status(404).json({ success: false, error: `NHL game ${gameId} not found` });
    }

    const matchup = `${game.away_team_abbr ?? game.away_team_name ?? 'AWAY'} @ ${game.home_team_abbr ?? game.home_team_name ?? 'HOME'}`;
    const gameDate = game.game_date ?? date ?? new Date().toISOString().split('T')[0];

    const { marketOdds: resolvedOdds, source: oddsSource } = await resolveMarketOdds({
      clientMarketOdds: marketOdds,
      game,
    });

    const context = await buildNhlGameContext({
      homeTeamId: game.home_team_id,
      awayTeamId: game.away_team_id,
      homeTeamAbbr: game.home_team_abbr ?? null,
      awayTeamAbbr: game.away_team_abbr ?? null,
      gameDate,
      season: game.season,
      marketOdds: resolvedOdds,
    });

    const result = await analyzeNhlGame({
      context,
      gameDescription: `${matchup} — ${gameDate}`,
      lang,
      riskProfile,
      userBankroll: bankroll != null ? Number(bankroll) : undefined,
      marketOdds: resolvedOdds,
      engine,
    });

    if (result.parseError) {
      console.warn(`[nhl-route] parse error for game ${gameId} — raw text returned`);
    }

    const guard = validateNhlAnalysisOutput(result.data, { parseError: result.parseError });
    if (!guard.ok) {
      return res.status(422).json({
        success: false,
        error: 'NHL analysis output failed validation',
        validation: { quality: guard.quality, errors: guard.errors, schema_version: guard.schema_version },
        rawText: result.parseError ? result.rawText : undefined,
      });
    }

    const analysisData = guard.data;

    const savedPick = await persistNhlPick({
      userId: req.user.id,
      userEmail: req.user.email ?? null,
      matchup,
      analysisData,
      model: result.model,
      language: lang,
      gameId,
      gameDate,
      marketOdds: resolvedOdds,
    });

    // Fire-and-forget: persist NHL pick_features + shadow_model_runs.
    // Errors are swallowed inside the helpers; never break the response.
    if (savedPick?.id) {
      const gameMeta = {
        homeTeamId: game.home_team_id ?? null,
        awayTeamId: game.away_team_id ?? null,
        homeAbbr:   game.home_team_abbr ?? null,
        awayAbbr:   game.away_team_abbr ?? null,
      };
      const gamePkInt = gameId ? parseInt(gameId, 10) : null;

      saveNhlPickFeatures({
        pickId:    savedPick.id,
        gamePk:    gamePkInt,
        gameDate,
        context,
        gameMeta,
        marketOdds: resolvedOdds,
        pickText:  analysisData?.master_prediction?.pick ?? analysisData?.best_pick?.detail ?? null,
        oracleConfidence: analysisData?.master_prediction?.oracle_confidence ?? null,
        userEmail: req.user.email ?? null,
      }).catch(err => console.warn(`[nhl-route] pick_features persist swallowed: ${err.message}`));

      recordNhlShadowRun({
        userId:    req.user.id,
        userEmail: req.user.email ?? null,
        pickId:    savedPick.id,
        gamePk:    gamePkInt,
        gameDate,
        context,
        gameMeta,
        analysisData,
      }).catch(err => console.warn(`[nhl-route] shadow_model persist swallowed: ${err.message}`));
    }

    console.log(`[nhl-route] pick saved id=${savedPick?.id} game=${gameId} conf=${analysisData?.master_prediction?.oracle_confidence} quality=${guard.quality} odds=${oddsSource ?? 'none'} flags=${context.context_meta?.staleFlags?.length ?? 0}`);

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
      } : null,
      meta: {
        model:        result.model,
        stopReason:   result.stopReason,
        usage:        result.usage,
        matchup,
        gameDate,
        pickId:       savedPick?.id ?? null,
        oddsSource,
        context_meta: context.context_meta ?? null,
      },
    });
  } catch (err) {
    console.error(`[nhl-route] analyze/game error: ${err.message}`);
    return res.status(500).json({ success: false, error: safeErr(err) });
  }
});

// ── POST /api/nhl/analyze/chat ─────────────────────────────────────────────────

function nhlGameToChatData(game, matchup) {
  return {
    gamePk: game.game_id,
    game_id: game.game_id,
    gameDate: game.game_date,
    game_date: game.game_date,
    matchup,
    away_team_name: game.away_team_name,
    home_team_name: game.home_team_name,
    teams: {
      away: { name: game.away_team_name, abbreviation: game.away_team_abbr },
      home: { name: game.home_team_name, abbreviation: game.home_team_abbr },
    },
  };
}

router.post('/analyze/chat', nhlEnabled, verifyToken, requireSportAccess('nhl'), async (req, res) => {
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

  if (!gameId) return res.status(400).json({ success: false, error: 'gameId is required' });
  if (!question?.trim()) return res.status(400).json({ success: false, error: 'question is required' });

  try {
    const game = await findNhlGame({ gameId, date });
    if (!game) {
      return res.status(404).json({ success: false, error: `NHL game ${gameId} not found` });
    }

    const matchup = matchups || `${game.away_team_abbr ?? 'AWAY'} @ ${game.home_team_abbr ?? 'HOME'}`;
    const gameDate = game.game_date ?? date ?? new Date().toISOString().split('T')[0];

    const { marketOdds: resolvedOdds, source: oddsSource } = await resolveMarketOdds({
      clientMarketOdds: marketOdds,
      game,
    });

    const context = await buildNhlGameContext({
      homeTeamId: game.home_team_id,
      awayTeamId: game.away_team_id,
      homeTeamAbbr: game.home_team_abbr ?? null,
      awayTeamAbbr: game.away_team_abbr ?? null,
      gameDate,
      season: game.season,
      marketOdds: resolvedOdds,
    });

    const skipExtract = String(req.headers['x-hexa-skip-pick-extract'] ?? '') === '1';
    const augmentedQuestion = skipExtract
      ? question.trim()
      : augmentChatQuestion(question.trim(), lang, 'nhl');

    const result = await analyzeNhlChat({
      context,
      gameDescription: `${matchup} — ${gameDate}`,
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
          gameData: nhlGameToChatData(game, matchup),
          chatSessionId: null,
          lang,
          sport: 'nhl',
        });
        cleanAnswer = processed.answer;
        picked = processed.picked;
      } catch (err) {
        console.warn(`[nhl-route] chat pick extraction failed: ${err.message}`);
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
          ).catch((err) => console.warn(`[nhl-route] chat_session_id backfill failed: ${err.message}`));
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
        oddsSource,
        context_meta: context.context_meta ?? null,
        sport:        'nhl',
      },
    });
  } catch (err) {
    console.error(`[nhl-route] analyze/chat error: ${err.message}`);
    return res.status(500).json({ success: false, error: safeErr(err) });
  }
});

export default router;
