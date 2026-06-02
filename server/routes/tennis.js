/**
 * server/routes/tennis.js — Tennis analysis and pick generation endpoints.
 *
 * POST /api/tennis/analyze/match — Oracle pick for a single match (admin-only while MVP)
 * POST /api/tennis/analyze/chat  — Conversational Oracle chat for admins
 *
 * Mirrors routes/nhl.js (date-based cadence) but tour-aware (atp/wta) and
 * individual-sport shaped (Player A vs Player B). Does NOT import or modify any
 * frozen file. Feature-flagged: TENNIS_ANALYSIS_ENABLED=true required, else 503.
 * Persists the pick with sport='tennis' and league=tour, resolves odds
 * server-side. pick_features/shadow persistence is deferred to Sprint 12.1.
 */

import { Router } from 'express';
import pool from '../db.js';
import { verifyToken, requireAdmin } from '../middleware/auth-middleware.js';
import { getTennisMatchesForDate } from '../tennis-api.js';
import { isSupportedTour } from '../tennis-tour-map.js';
import { buildTennisMatchContext } from '../tennis-context-builder.js';
import { analyzeTennisMatch, analyzeTennisChat } from '../services/oracleTennis.js';
import { getTennisMatchOdds, matchTennisOddsToMatch, buildMarketOddsForMatch } from '../tennis-odds.js';
import { validateTennisAnalysisOutput } from '../services/tennisOutputGuard.js';
import { saveTennisPickFeatures, recordTennisShadowRun } from '../services/tennisShadowPersistence.js';
import { augmentChatQuestion, processChatAnswer } from '../services/chatPickExtractor.js';
import { upsertOracleSession } from './oracle-history.js';

const router = Router();

function tennisEnabled(req, res, next) {
  if (process.env.TENNIS_ANALYSIS_ENABLED !== 'true') {
    return res.status(503).json({ success: false, error: 'Tennis analysis is not yet enabled on this instance.' });
  }
  return next();
}

function safeErr(err) {
  return process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
}

/** Locate a tennis match by id within the slate for its tour + calendar date. */
async function findTennisMatch({ matchId, tour, date }) {
  const lookupDate = (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : new Date().toISOString().slice(0, 10);
  const matches = await getTennisMatchesForDate(tour, lookupDate);
  return matches.find(m => String(m.matchId) === String(matchId)) ?? null;
}

/**
 * Resolve marketOdds: client-provided wins; else server-side via The Odds API
 * keyed on the match's tour + date. Never throws.
 */
async function resolveMarketOdds({ clientMarketOdds, tour, match }) {
  if (clientMarketOdds) {
    return { marketOdds: { ...clientMarketOdds, provided: 'client' }, source: 'client' };
  }
  try {
    const date = match.matchDate ? String(match.matchDate).slice(0, 10) : null;
    const events = await getTennisMatchOdds({ tour, date });
    if (!events.length) return { marketOdds: null, source: null };
    const event = matchTennisOddsToMatch(events, match.players?.a?.name, match.players?.b?.name);
    if (!event) return { marketOdds: null, source: null };
    const odds = buildMarketOddsForMatch(event);
    if (!odds) return { marketOdds: null, source: null };
    return { marketOdds: { ...odds, provided: 'server' }, source: 'server' };
  } catch (err) {
    console.warn(`[tennis-route] server-side odds lookup failed: ${err.message}`);
    return { marketOdds: null, source: null };
  }
}

async function persistTennisPick({ userId, userEmail, matchup, analysisData, model, language, matchId, gameDate, tour, marketOdds }) {
  if (!userId || !analysisData) return null;

  const mp = analysisData.master_prediction ?? {};
  const bp = analysisData.best_pick ?? {};
  const pickText = mp.pick ?? bp.detail ?? null;
  const conf = typeof mp.oracle_confidence === 'number' ? mp.oracle_confidence : null;
  const gamePkInt = matchId ? parseInt(matchId, 10) : null;

  const { rows } = await pool.query(
    `INSERT INTO picks (
       user_id, type, matchup, pick, oracle_confidence, bet_value, model_risk,
       oracle_report, hexa_hunch, alert_flags, probability_model, best_pick,
       model, language, odds_at_pick, implied_prob_at_pick, odds_details,
       kelly_recommendation, game_pk, game_date, user_email, sport, league,
       pick_time_lima
     )
     VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
       $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
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
      'tennis',
      tour,
    ]
  );

  return rows[0] ?? null;
}

// ── POST /api/tennis/analyze/match ──────────────────────────────────────────────

router.post('/analyze/match', tennisEnabled, verifyToken, requireAdmin, async (req, res) => {
  const {
    matchId,
    tour,
    date        = null,
    lang        = 'en',
    riskProfile = 'balanced',
    engine      = 'deep',
    marketOdds  = null,
    bankroll    = null,
  } = req.body;

  if (!matchId) return res.status(400).json({ success: false, error: 'matchId is required' });
  if (!isSupportedTour(tour)) return res.status(400).json({ success: false, error: 'tour is required (atp|wta)' });
  if (!['deep', 'premium', 'haiku'].includes(engine)) return res.status(400).json({ success: false, error: 'Invalid engine (deep|premium|haiku)' });

  try {
    const match = await findTennisMatch({ matchId, tour, date });
    if (!match) {
      return res.status(404).json({ success: false, error: `Tennis match ${matchId} not found in ${tour} slate` });
    }

    const aName = match.players?.a?.name ?? 'Player A';
    const bName = match.players?.b?.name ?? 'Player B';
    const matchup = `${aName} vs ${bName}`;
    const gameDate = (match.matchDate ? String(match.matchDate).slice(0, 10) : null) ?? date ?? new Date().toISOString().split('T')[0];

    const { marketOdds: resolvedOdds, source: oddsSource } = await resolveMarketOdds({
      clientMarketOdds: marketOdds,
      tour,
      match,
    });

    const context = await buildTennisMatchContext({
      tour,
      playerAName: aName,
      playerBName: bName,
      playerAId: match.players?.a?.id ?? null,
      playerBId: match.players?.b?.id ?? null,
      matchDate: gameDate,
      surface: match.surface ?? null,
      round: match.round ?? null,
      roundDepth: match.roundDepth ?? null,
      marketOdds: resolvedOdds,
    });

    const result = await analyzeTennisMatch({
      context,
      matchDescription: `${matchup} — ${gameDate} — ${(tour ?? '').toUpperCase()}${match.surface ? ` (${match.surface})` : ''}`,
      lang,
      riskProfile,
      userBankroll: bankroll != null ? Number(bankroll) : undefined,
      marketOdds: resolvedOdds,
      engine,
    });

    if (result.parseError) {
      console.warn(`[tennis-route] parse error for match ${matchId} — raw text returned`);
    }

    const guard = validateTennisAnalysisOutput(result.data, { parseError: result.parseError });
    if (!guard.ok) {
      return res.status(422).json({
        success: false,
        error: 'Tennis analysis output failed validation',
        validation: { quality: guard.quality, errors: guard.errors, schema_version: guard.schema_version },
        rawText: result.parseError ? result.rawText : undefined,
      });
    }

    const analysisData = guard.data;

    const savedPick = await persistTennisPick({
      userId: req.user.id,
      userEmail: req.user.email ?? null,
      matchup,
      analysisData,
      model: result.model,
      language: lang,
      matchId,
      gameDate,
      tour,
      marketOdds: resolvedOdds,
    });

    // Fire-and-forget: persist Tennis pick_features + shadow_model_runs.
    // Errors are swallowed inside the helpers; never break the response.
    if (savedPick?.id) {
      const gamePkInt = matchId ? parseInt(matchId, 10) : null;
      saveTennisPickFeatures({
        pickId:    savedPick.id,
        gamePk:    gamePkInt,
        gameDate,
        tour,
        context,
        marketOdds: resolvedOdds,
        pickText:  analysisData?.master_prediction?.pick ?? analysisData?.best_pick?.detail ?? null,
        pickSide:  analysisData?.master_prediction?.pick_side ?? null,
        oracleConfidence: analysisData?.master_prediction?.oracle_confidence ?? null,
        userEmail: req.user.email ?? null,
      }).catch(err => console.warn(`[tennis-route] pick_features persist swallowed: ${err.message}`));

      recordTennisShadowRun({
        userId:    req.user.id,
        userEmail: req.user.email ?? null,
        pickId:    savedPick.id,
        gamePk:    gamePkInt,
        gameDate,
        tour,
        context,
        analysisData,
      }).catch(err => console.warn(`[tennis-route] shadow_model persist swallowed: ${err.message}`));
    }

    console.log(`[tennis-route] pick saved id=${savedPick?.id} match=${matchId} tour=${tour} conf=${analysisData?.master_prediction?.oracle_confidence} quality=${guard.quality} odds=${oddsSource ?? 'none'} flags=${context.context_meta?.staleFlags?.length ?? 0}`);

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
        tour,
        surface:      match.surface ?? null,
        pickId:       savedPick?.id ?? null,
        oddsSource,
        context_meta: context.context_meta ?? null,
      },
    });
  } catch (err) {
    console.error(`[tennis-route] analyze/match error: ${err.message}`);
    return res.status(500).json({ success: false, error: safeErr(err) });
  }
});

// ── POST /api/tennis/analyze/chat ───────────────────────────────────────────────

function tennisMatchToChatData(match, matchup) {
  return {
    gamePk: match.matchId,
    game_id: match.matchId,
    gameDate: match.matchDate,
    game_date: match.matchDate,
    matchup,
    away_team_name: match.players?.a?.name,
    home_team_name: match.players?.b?.name,
    teams: {
      away: { name: match.players?.a?.name, abbreviation: match.players?.a?.name },
      home: { name: match.players?.b?.name, abbreviation: match.players?.b?.name },
    },
  };
}

router.post('/analyze/chat', tennisEnabled, verifyToken, requireAdmin, async (req, res) => {
  const {
    matchId,
    tour,
    question,
    conversationHistory = [],
    date       = null,
    lang       = 'en',
    marketOdds = null,
    sessionKey,
    matchups,
  } = req.body;

  if (!matchId) return res.status(400).json({ success: false, error: 'matchId is required' });
  if (!isSupportedTour(tour)) return res.status(400).json({ success: false, error: 'tour is required (atp|wta)' });
  if (!question?.trim()) return res.status(400).json({ success: false, error: 'question is required' });

  try {
    const match = await findTennisMatch({ matchId, tour, date });
    if (!match) {
      return res.status(404).json({ success: false, error: `Tennis match ${matchId} not found in ${tour} slate` });
    }

    const aName = match.players?.a?.name ?? 'Player A';
    const bName = match.players?.b?.name ?? 'Player B';
    const matchup = matchups || `${aName} vs ${bName}`;
    const gameDate = (match.matchDate ? String(match.matchDate).slice(0, 10) : null) ?? date ?? new Date().toISOString().split('T')[0];

    const { marketOdds: resolvedOdds, source: oddsSource } = await resolveMarketOdds({
      clientMarketOdds: marketOdds,
      tour,
      match,
    });

    const context = await buildTennisMatchContext({
      tour,
      playerAName: aName,
      playerBName: bName,
      playerAId: match.players?.a?.id ?? null,
      playerBId: match.players?.b?.id ?? null,
      matchDate: gameDate,
      surface: match.surface ?? null,
      round: match.round ?? null,
      roundDepth: match.roundDepth ?? null,
      marketOdds: resolvedOdds,
    });

    const skipExtract = String(req.headers['x-hexa-skip-pick-extract'] ?? '') === '1';
    const augmentedQuestion = skipExtract
      ? question.trim()
      : augmentChatQuestion(question.trim(), lang, 'tennis');

    const result = await analyzeTennisChat({
      context,
      matchDescription: `${matchup} — ${gameDate} — ${(tour ?? '').toUpperCase()}`,
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
          gameData: tennisMatchToChatData(match, matchup),
          chatSessionId: null,
          lang,
          sport: 'tennis',
        });
        cleanAnswer = processed.answer;
        picked = processed.picked;
      } catch (err) {
        console.warn(`[tennis-route] chat pick extraction failed: ${err.message}`);
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
        gameIds: [String(matchId)],
        matchups: matchup,
        messages: fullMessages,
      }).then((sessionId) => {
        if (sessionId && picked?.pick_id) {
          pool.query(
            'UPDATE picks SET chat_session_id = $1 WHERE id = $2 AND chat_session_id IS NULL',
            [sessionId, picked.pick_id],
          ).catch((err) => console.warn(`[tennis-route] chat_session_id backfill failed: ${err.message}`));
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
        tour,
        oddsSource,
        context_meta: context.context_meta ?? null,
        sport:        'tennis',
      },
    });
  } catch (err) {
    console.error(`[tennis-route] analyze/chat error: ${err.message}`);
    return res.status(500).json({ success: false, error: safeErr(err) });
  }
});

export default router;
