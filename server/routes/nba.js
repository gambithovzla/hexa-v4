/**
 * server/routes/nba.js — NBA analysis and pick generation endpoints.
 *
 * POST /api/nba/analyze/game  — Oracle pick for a single NBA game (admin-only while MVP)
 * POST /api/nba/analyze/chat  — Conversational Oracle chat for admins
 *
 * Mirrors the structure of the MLB endpoints in server/index.js but scoped
 * to NBA. Does NOT import or modify any frozen MLB files.
 *
 * Feature-flagged: NBA_ANALYSIS_ENABLED=true required, otherwise 503.
 */

import { Router } from 'express';
import pool from '../db.js';
import { verifyToken, requireAdmin } from '../middleware/auth-middleware.js';
import { getNbaGamesForDate } from '../nba-api.js';
import { buildNbaGameContext } from '../nba-context-builder.js';
import { analyzeNbaGame, analyzeNbaChat } from '../services/oracleNba.js';
import { getNbaGameOdds, matchNbaOddsToGame, buildMarketOddsForGame } from '../nba-odds.js';
import { saveNbaPickFeatures, recordNbaShadowRun } from '../services/nbaShadowPersistence.js';

const router = Router();

function nbaEnabled(req, res, next) {
  if (process.env.NBA_ANALYSIS_ENABLED !== 'true') {
    return res.status(503).json({ success: false, error: 'NBA analysis is not yet enabled on this instance.' });
  }
  return next();
}

function safeErr(err) {
  return process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
}

/**
 * If the client didn't pass marketOdds, try fetching server-side from The Odds API.
 * Returns { marketOdds, source } where source ∈ 'client' | 'server' | null.
 * Never throws — failures just mean the LLM analyses without market context.
 */
async function resolveMarketOdds({ clientMarketOdds, date, game }) {
  if (clientMarketOdds) {
    return { marketOdds: { ...clientMarketOdds, provided: 'client' }, source: 'client' };
  }
  try {
    const events = await getNbaGameOdds({ date });
    if (!events.length) return { marketOdds: null, source: null };
    const match = matchNbaOddsToGame(events, game.home_team_name, game.away_team_name);
    if (!match) return { marketOdds: null, source: null };
    const odds = buildMarketOddsForGame(match);
    if (!odds) return { marketOdds: null, source: null };
    return { marketOdds: { ...odds, provided: 'server' }, source: 'server' };
  } catch (err) {
    console.warn(`[nba-route] server-side odds lookup failed: ${err.message}`);
    return { marketOdds: null, source: null };
  }
}

// ── Pick persistence ───────────────────────────────────────────────────────────

async function persistNbaPick({ userId, userEmail, matchup, analysisData, model, language, gameId, gameDate, marketOdds }) {
  if (!userId || !analysisData) return null;

  const mp  = analysisData.master_prediction ?? {};
  const bp  = analysisData.best_pick ?? {};
  const pickText = mp.pick ?? bp.detail ?? null;
  const conf = typeof mp.oracle_confidence === 'number' ? mp.oracle_confidence : null;

  // Convert NBA string game_id to integer for game_pk column (e.g. "0042500206" → 42500206)
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
      null,  // odds_at_pick — marketOdds handled separately if needed
      null,  // implied_prob_at_pick
      marketOdds ? JSON.stringify(marketOdds) : null,
      analysisData.kelly_recommendation ?? null,
      gamePkInt,
      gameDate,
      userEmail ?? null,
      'nba',
    ]
  );

  return rows[0] ?? null;
}

// ── POST /api/nba/analyze/game ─────────────────────────────────────────────────

router.post('/analyze/game', nbaEnabled, verifyToken, requireAdmin, async (req, res) => {
  const {
    gameId,
    lang        = 'en',
    riskProfile = 'balanced',
    engine      = 'deep',
    marketOdds  = null,
    bankroll    = null,
  } = req.body;
  const date = req.body.date || new Date().toISOString().split('T')[0];

  if (!gameId) return res.status(400).json({ success: false, error: 'gameId is required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, error: 'Invalid date format (YYYY-MM-DD)' });
  if (!['deep', 'premium', 'haiku'].includes(engine)) return res.status(400).json({ success: false, error: 'Invalid engine (deep|premium|haiku)' });

  try {
    const games = await getNbaGamesForDate(date);
    const game  = games.find(g => String(g.game_id) === String(gameId));
    if (!game) {
      return res.status(404).json({ success: false, error: `NBA game ${gameId} not found on ${date}` });
    }

    const matchup = `${game.away_team_abbr ?? game.away_team_name ?? 'AWAY'} @ ${game.home_team_abbr ?? game.home_team_name ?? 'HOME'}`;

    const { marketOdds: resolvedOdds, source: oddsSource } = await resolveMarketOdds({
      clientMarketOdds: marketOdds,
      date,
      game,
    });

    const context = await buildNbaGameContext({
      homeTeamId: game.home_team_id,
      awayTeamId: game.away_team_id,
      homeTeamAbbr: game.home_team_abbr ?? null,
      awayTeamAbbr: game.away_team_abbr ?? null,
      gameDate: date,
      season: game.season,
      marketOdds: resolvedOdds,
    });

    const result = await analyzeNbaGame({
      context,
      gameDescription: `${matchup} — ${date}`,
      lang,
      riskProfile,
      userBankroll: bankroll != null ? Number(bankroll) : undefined,
      marketOdds: resolvedOdds,
      engine,
    });

    if (result.parseError) {
      console.warn(`[nba-route] parse error for game ${gameId} — raw text returned`);
    }

    if (String(result.data?.best_pick?.type ?? '').toLowerCase() === 'playerprop') {
      return res.status(422).json({
        success: false,
        error: 'NBA player props are temporarily disabled until the dedicated data pipeline is ready.',
      });
    }

    const savedPick = await persistNbaPick({
      userId:    req.user.id,
      userEmail: req.user.email ?? null,
      matchup,
      analysisData: result.data ?? {},
      model:    result.model,
      language: lang,
      gameId,
      gameDate: date,
      marketOdds: resolvedOdds,
    });

    // Fire-and-forget: persist NBA pick_features + shadow_model_runs.
    // Errors are swallowed inside the helpers; never break the response.
    if (savedPick?.id) {
      const gameMeta = {
        homeTeamId: game.home_team_id ?? null,
        awayTeamId: game.away_team_id ?? null,
        homeAbbr:   game.home_team_abbr ?? null,
        awayAbbr:   game.away_team_abbr ?? null,
      };
      const gamePkInt = gameId ? parseInt(gameId, 10) : null;

      saveNbaPickFeatures({
        pickId:    savedPick.id,
        gamePk:    gamePkInt,
        gameDate:  date,
        context,
        gameMeta,
        marketOdds: resolvedOdds,
        pickText:  result.data?.master_prediction?.pick ?? result.data?.best_pick?.detail ?? null,
        oracleConfidence: result.data?.master_prediction?.oracle_confidence ?? null,
        userEmail: req.user.email ?? null,
      }).catch(err => console.warn(`[nba-route] pick_features persist swallowed: ${err.message}`));

      recordNbaShadowRun({
        userId:    req.user.id,
        userEmail: req.user.email ?? null,
        pickId:    savedPick.id,
        gamePk:    gamePkInt,
        gameDate:  date,
        context,
        gameMeta,
        analysisData: result.data ?? {},
      }).catch(err => console.warn(`[nba-route] shadow_model persist swallowed: ${err.message}`));
    }

    console.log(`[nba-route] pick saved id=${savedPick?.id} game=${gameId} conf=${result.data?.master_prediction?.oracle_confidence} odds=${oddsSource ?? 'none'} flags=${context.context_meta?.staleFlags?.length ?? 0}`);

    return res.json({
      success: true,
      data:    result.data,
      rawText: result.parseError ? result.rawText : undefined,
      parseError: result.parseError,
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
        gameDate:     date,
        pickId:       savedPick?.id ?? null,
        oddsSource,
        context_meta: context.context_meta ?? null,
      },
    });
  } catch (err) {
    console.error(`[nba-route] analyze/game error: ${err.message}`);
    return res.status(500).json({ success: false, error: safeErr(err) });
  }
});

// ── POST /api/nba/analyze/chat ─────────────────────────────────────────────────

router.post('/analyze/chat', nbaEnabled, verifyToken, requireAdmin, async (req, res) => {
  const {
    gameId,
    question,
    lang       = 'en',
    marketOdds = null,
  } = req.body;
  const date = req.body.date || new Date().toISOString().split('T')[0];

  if (!gameId)   return res.status(400).json({ success: false, error: 'gameId is required' });
  if (!question) return res.status(400).json({ success: false, error: 'question is required' });

  try {
    const games = await getNbaGamesForDate(date);
    const game  = games.find(g => String(g.game_id) === String(gameId));
    if (!game) {
      return res.status(404).json({ success: false, error: `NBA game ${gameId} not found on ${date}` });
    }

    const matchup = `${game.away_team_abbr ?? 'AWAY'} @ ${game.home_team_abbr ?? 'HOME'}`;

    const { marketOdds: resolvedOdds, source: oddsSource } = await resolveMarketOdds({
      clientMarketOdds: marketOdds,
      date,
      game,
    });

    const context = await buildNbaGameContext({
      homeTeamId: game.home_team_id,
      awayTeamId: game.away_team_id,
      homeTeamAbbr: game.home_team_abbr ?? null,
      awayTeamAbbr: game.away_team_abbr ?? null,
      gameDate: date,
      season: game.season,
      marketOdds: resolvedOdds,
    });

    const result = await analyzeNbaChat({
      context,
      gameDescription: `${matchup} — ${date}`,
      question,
      lang,
      marketOdds: resolvedOdds,
    });

    return res.json({
      success: true,
      text: result.text,
      meta: {
        model:        result.model,
        usage:        result.usage,
        matchup,
        gameDate:     date,
        oddsSource,
        context_meta: context.context_meta ?? null,
      },
    });
  } catch (err) {
    console.error(`[nba-route] analyze/chat error: ${err.message}`);
    return res.status(500).json({ success: false, error: safeErr(err) });
  }
});

export default router;
