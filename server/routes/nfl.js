/**
 * server/routes/nfl.js — NFL analysis and pick generation endpoints.
 *
 * POST /api/nfl/analyze/game  — Oracle pick for a single NFL game (admin-only while MVP)
 * POST /api/nfl/analyze/chat  — Conversational Oracle chat for admins
 *
 * Mirrors routes/nba.js, scoped to NFL. Does NOT import or modify any frozen
 * MLB file. Feature-flagged: NFL_ANALYSIS_ENABLED=true required, else 503.
 *
 * NFL game lookup is BY WEEK (seasontype+week) — the structural NFL difference —
 * with a date fallback. pick_features / shadow_model_runs persistence lands in
 * Sprint 9.1 (nflShadowPersistence); this route persists the pick to `picks`
 * with sport='nfl' and resolves odds server-side.
 */

import { Router } from 'express';
import pool from '../db.js';
import { verifyToken, requireAdmin, requireSportAccess } from '../middleware/auth-middleware.js';
import { getNflGamesForWeek, getNflGamesForDate } from '../nfl-api.js';
import { buildNflGameContext } from '../nfl-context-builder.js';
import { analyzeNflGame, analyzeNflChat } from '../services/oracleNfl.js';
import { getNflGameOdds, matchNflOddsToGame, buildMarketOddsForGame } from '../nfl-odds.js';
import { getNflPlayerPropOdds } from '../nfl-props-odds.js';
import { enrichNflPropOffers } from '../services/nflPropFeatureEnricher.js';
import { parseNflProp } from '../nfl-props-resolver.js';
import { buildNflPropFeaturePayload, predictNflProp, predictNflGameModel } from '../services/nflMlClient.js';
import { enrichAndPersistNflPropPick } from '../services/nflPropFeaturePersistence.js';
import { getNflPlayerStats, findNflPlayerPropStat } from '../nfl-player-fetcher.js';
import { buildHexaNflBoard } from '../services/hexaNflBoardService.js';
import { buildNflParlayCandidates } from '../services/parlayEngine/nflParlayCandidates.js';
import { composeParlays } from '../services/parlayEngine/composer.js';
import { buildCorrelationMatrix } from '../services/parlayEngine/correl.js';
import { computeHitDistribution } from '../services/parlayEngine/hitMath.js';
import { validateNflAnalysisOutput } from '../services/nflOutputGuard.js';
import { saveNflPickFeatures, recordNflShadowRun } from '../services/nflShadowPersistence.js';
import { augmentChatQuestion, processChatAnswer } from '../services/chatPickExtractor.js';
import { upsertOracleSession } from './oracle-history.js';

const router = Router();

function nflEnabled(req, res, next) {
  if (process.env.NFL_ANALYSIS_ENABLED !== 'true') {
    return res.status(503).json({ success: false, error: 'NFL analysis is not yet enabled on this instance.' });
  }
  return next();
}

function nflPropsEnabled(req, res, next) {
  if (process.env.NFL_PROPS_ENABLED !== 'true') {
    return res.status(503).json({ success: false, error: 'NFL player props are not yet enabled on this instance.' });
  }
  return next();
}

function nflParlayEnabled(req, res, next) {
  if (process.env.PARLAY_SYNERGY_NFL_ENABLED !== 'true') {
    return res.status(503).json({ success: false, error: 'NFL parlay synergy is not yet enabled on this instance.' });
  }
  return next();
}

function safeErr(err) {
  return process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
}

/**
 * Locate an NFL game by id. Prefers an explicit date (single-day lookup); else
 * resolves by week (season/seasonType/week — defaults to the current week).
 */
async function findNflGame({ gameId, season, seasonType, week, date }) {
  let games;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    games = await getNflGamesForDate(date);
  } else {
    games = await getNflGamesForWeek({ season, seasonType, week });
  }
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
    const events = await getNflGameOdds({ date: game.game_date });
    if (!events.length) return { marketOdds: null, source: null };
    const match = matchNflOddsToGame(events, game.home_team_name, game.away_team_name);
    if (!match) return { marketOdds: null, source: null };
    const odds = buildMarketOddsForGame(match);
    if (!odds) return { marketOdds: null, source: null };
    return { marketOdds: { ...odds, provided: 'server' }, source: 'server' };
  } catch (err) {
    console.warn(`[nfl-route] server-side odds lookup failed: ${err.message}`);
    return { marketOdds: null, source: null };
  }
}

async function persistNflPick({ userId, userEmail, matchup, analysisData, model, language, gameId, gameDate, marketOdds }) {
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
      'nfl',
    ]
  );

  return rows[0] ?? null;
}

// ── POST /api/nfl/analyze/game ─────────────────────────────────────────────────

router.post('/analyze/game', nflEnabled, verifyToken, requireSportAccess('nfl'), async (req, res) => {
  const {
    gameId,
    season      = null,
    seasonType  = null,
    week        = null,
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
    const game = await findNflGame({
      gameId,
      season: season != null ? Number(season) : null,
      seasonType: seasonType != null ? Number(seasonType) : null,
      week: week != null ? Number(week) : null,
      date,
    });
    if (!game) {
      return res.status(404).json({ success: false, error: `NFL game ${gameId} not found` });
    }

    const matchup = `${game.away_team_abbr ?? game.away_team_name ?? 'AWAY'} @ ${game.home_team_abbr ?? game.home_team_name ?? 'HOME'}`;
    const gameDate = game.game_date ?? date ?? new Date().toISOString().split('T')[0];

    const { marketOdds: resolvedOdds, source: oddsSource } = await resolveMarketOdds({
      clientMarketOdds: marketOdds,
      game,
    });

    const context = await buildNflGameContext({
      homeTeamId: game.home_team_id,
      awayTeamId: game.away_team_id,
      homeTeamAbbr: game.home_team_abbr ?? null,
      awayTeamAbbr: game.away_team_abbr ?? null,
      gameDate,
      gameTime: game.game_datetime ?? null,
      season: game.season,
      seasonType: game.season_type ?? seasonType ?? null,
      marketOdds: resolvedOdds,
    });

    const result = await analyzeNflGame({
      context,
      gameDescription: `${matchup} — ${gameDate}`,
      lang,
      riskProfile,
      userBankroll: bankroll != null ? Number(bankroll) : undefined,
      marketOdds: resolvedOdds,
      engine,
    });

    if (result.parseError) {
      console.warn(`[nfl-route] parse error for game ${gameId} — raw text returned`);
    }

    const guard = validateNflAnalysisOutput(result.data, {
      parseError: result.parseError,
      isPreseason: context?.seasonPhase?.isPreseason === true,
    });
    if (!guard.ok) {
      return res.status(422).json({
        success: false,
        error: 'NFL analysis output failed validation',
        validation: { quality: guard.quality, errors: guard.errors, schema_version: guard.schema_version },
        rawText: result.parseError ? result.rawText : undefined,
      });
    }

    const analysisData = guard.data;

    const savedPick = await persistNflPick({
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

    // Fire-and-forget: persist NFL pick_features + shadow_model_runs (Sprint 9.1).
    // Errors are swallowed inside the helpers; never break the response.
    if (savedPick?.id) {
      const gameMeta = {
        homeTeamId: game.home_team_id ?? null,
        awayTeamId: game.away_team_id ?? null,
        homeAbbr:   game.home_team_abbr ?? null,
        awayAbbr:   game.away_team_abbr ?? null,
      };
      const gamePkInt = gameId ? parseInt(gameId, 10) : null;

      saveNflPickFeatures({
        pickId:    savedPick.id,
        gamePk:    gamePkInt,
        gameDate,
        context,
        gameMeta,
        marketOdds: resolvedOdds,
        pickText:  analysisData?.master_prediction?.pick ?? analysisData?.best_pick?.detail ?? null,
        oracleConfidence: analysisData?.master_prediction?.oracle_confidence ?? null,
        userEmail: req.user.email ?? null,
      }).catch(err => console.warn(`[nfl-route] pick_features persist swallowed: ${err.message}`));

      recordNflShadowRun({
        userId:    req.user.id,
        userEmail: req.user.email ?? null,
        pickId:    savedPick.id,
        gamePk:    gamePkInt,
        gameDate,
        context,
        gameMeta,
        analysisData,
      }).catch(err => console.warn(`[nfl-route] shadow_model persist swallowed: ${err.message}`));
    }

    console.log(`[nfl-route] pick saved id=${savedPick?.id} game=${gameId} conf=${analysisData?.master_prediction?.oracle_confidence} quality=${guard.quality} odds=${oddsSource ?? 'none'} flags=${context.context_meta?.staleFlags?.length ?? 0}`);

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
    console.error(`[nfl-route] analyze/game error: ${err.message}`);
    return res.status(500).json({ success: false, error: safeErr(err) });
  }
});

// ── POST /api/nfl/analyze/chat ─────────────────────────────────────────────────

function nflGameToChatData(game, matchup) {
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

router.post('/analyze/chat', nflEnabled, verifyToken, requireSportAccess('nfl'), async (req, res) => {
  const {
    gameId,
    question,
    conversationHistory = [],
    season     = null,
    seasonType = null,
    week       = null,
    date       = null,
    lang       = 'en',
    marketOdds = null,
    sessionKey,
    matchups,
  } = req.body;

  if (!gameId) return res.status(400).json({ success: false, error: 'gameId is required' });
  if (!question?.trim()) return res.status(400).json({ success: false, error: 'question is required' });

  try {
    const game = await findNflGame({
      gameId,
      season: season != null ? Number(season) : null,
      seasonType: seasonType != null ? Number(seasonType) : null,
      week: week != null ? Number(week) : null,
      date,
    });
    if (!game) {
      return res.status(404).json({ success: false, error: `NFL game ${gameId} not found` });
    }

    const matchup = matchups || `${game.away_team_abbr ?? 'AWAY'} @ ${game.home_team_abbr ?? 'HOME'}`;
    const gameDate = game.game_date ?? date ?? new Date().toISOString().split('T')[0];

    const { marketOdds: resolvedOdds, source: oddsSource } = await resolveMarketOdds({
      clientMarketOdds: marketOdds,
      game,
    });

    const context = await buildNflGameContext({
      homeTeamId: game.home_team_id,
      awayTeamId: game.away_team_id,
      homeTeamAbbr: game.home_team_abbr ?? null,
      awayTeamAbbr: game.away_team_abbr ?? null,
      gameDate,
      gameTime: game.game_datetime ?? null,
      seasonType: game.season_type ?? null,
      season: game.season,
      marketOdds: resolvedOdds,
    });

    const skipExtract = String(req.headers['x-hexa-skip-pick-extract'] ?? '') === '1';
    const augmentedQuestion = skipExtract
      ? question.trim()
      : augmentChatQuestion(question.trim(), lang, 'nfl');

    const result = await analyzeNflChat({
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
          gameData: nflGameToChatData(game, matchup),
          chatSessionId: null,
          lang,
          sport: 'nfl',
        });
        cleanAnswer = processed.answer;
        picked = processed.picked;
        // NFL prop pick → promote its feature row to a trainable source='live'
        // snapshot enriched with market + player signal (fire-and-forget).
        if (picked?.pick_id && picked.market_type === 'prop') {
          enrichAndPersistNflPropPick({
            pickId: picked.pick_id,
            rawPickText: picked.raw_pick_text,
            eventId: resolvedOdds?.eventId ?? null,
            season: game.season ?? null,
          }).catch(() => {});
        }
      } catch (err) {
        console.warn(`[nfl-route] chat pick extraction failed: ${err.message}`);
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
          ).catch((err) => console.warn(`[nfl-route] chat_session_id backfill failed: ${err.message}`));
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
        sport:        'nfl',
      },
    });
  } catch (err) {
    console.error(`[nfl-route] analyze/chat error: ${err.message}`);
    return res.status(500).json({ success: false, error: safeErr(err) });
  }
});

// ── GET /api/nfl/props/board ───────────────────────────────────────────────────
//
// Admin-only player-props board: market odds (event endpoint) + no-vig fair
// probability, plus the user's Oracle-Chat-sourced NFL prop picks for the date.
// ML model probability is intentionally null until the dedicated NFL-prop model
// ships (mirrors MLB props gating). Flag: NFL_PROPS_ENABLED.

const MAX_MODEL_PREDICTIONS = 40; // cap sidecar calls per game on the admin board

function todayEt() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

async function fetchOraclePropPicks(userId, date) {
  const { rows } = await pool.query(
    `SELECT id, pick, matchup, game_pk, game_date::text AS game_date,
            oracle_confidence, result, created_at
     FROM picks
     WHERE user_id = $1 AND sport = 'nfl' AND deleted_at IS NULL AND pick IS NOT NULL
       AND (game_date::date = $2 OR created_at::date = $2)
     ORDER BY created_at DESC
     LIMIT 60`,
    [userId, date]
  );
  const out = [];
  for (const r of rows) {
    const parsed = parseNflProp(r.pick);
    if (!parsed) continue;
    out.push({
      pickId: r.id,
      pick: r.pick,
      matchup: r.matchup,
      gamePk: r.game_pk,
      propKind: parsed.propKind,
      side: parsed.side,
      line: parsed.line,
      playerName: parsed.playerName,
      confidence: r.oracle_confidence,
      result: r.result,
      createdAt: r.created_at,
      source: 'oracle_chat',
    });
  }
  return out;
}

router.get('/props/board', nflPropsEnabled, verifyToken, requireAdmin, async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date ?? '')) ? req.query.date : todayEt();
  const propKindFilter = req.query.propKind ? String(req.query.propKind) : null;

  try {
    const [games, oddsEvents] = await Promise.all([
      getNflGamesForDate(date),
      getNflGameOdds({ date }),
    ]);

    const boardGames = [];
    let oddsAvailable = false;

    for (const game of games) {
      const event = matchNflOddsToGame(oddsEvents, game.home_team_name, game.away_team_name);
      let props = [];
      if (event?.eventId) {
        const offers = await getNflPlayerPropOdds({ eventId: event.eventId });
        if (offers.length) oddsAvailable = true;
        props = enrichNflPropOffers(offers)
          .filter(o => !propKindFilter || o.propKind === propKindFilter)
          .map(o => ({
            propKind: o.propKind,
            playerName: o.playerName,
            side: o.side,
            line: o.line,
            oddsAmerican: o.oddsAmerican,
            impliedProb: o.impliedProb,
            fairProb: o.fairProb,
            vig: o.vig,
            modelProb: null, // filled below when the nfl_prop model is live
            edge: null,
          }))
          .sort((a, b) =>
            a.propKind.localeCompare(b.propKind) || String(a.playerName).localeCompare(String(b.playerName)));

        // Admin board: attach the pooled nfl_prop model probability when the
        // sidecar is up and the model is trained. predictNflProp returns null
        // (circuit open / disabled / no artifact) → modelProb stays null. Player
        // averages mirror the training features so board preds are consistent.
        const top = props.slice(0, MAX_MODEL_PREDICTIONS);
        const playerStats = await getNflPlayerStats(game.season);
        await Promise.all(top.map(async (p) => {
          const ps = findNflPlayerPropStat(playerStats, p.playerName, p.propKind);
          const payload = buildNflPropFeaturePayload({
            propKind: p.propKind, side: p.side, line: p.line,
            oddsAmerican: p.oddsAmerican, impliedProb: p.impliedProb, fairProb: p.fairProb,
            playerSeasonAvg: ps?.seasonAvg ?? null,
            playerRecentAvg: ps?.recentAvg ?? null,
            playerGames: ps?.games ?? null,
          });
          const pred = await predictNflProp(payload);
          if (pred && typeof pred.probability === 'number') {
            p.modelProb = Math.round(pred.probability * 1e4) / 1e4;
            if (p.impliedProb != null) p.edge = Math.round((p.modelProb - p.impliedProb) * 1e4) / 1e4;
          }
        }));
      }
      boardGames.push({
        gameId: game.game_id,
        eventId: event?.eventId ?? null,
        awayTeam: game.away_team_abbr,
        homeTeam: game.home_team_abbr,
        startTime: game.game_datetime ?? null,
        props,
      });
    }

    const oraclePropPicks = await fetchOraclePropPicks(req.user.id, date);

    return res.json({
      success: true,
      date,
      sport: 'nfl',
      mlPublic: false,
      mlEnabled: boardGames.some(g => g.props.some(p => p.modelProb != null)),
      games: boardGames,
      oraclePropPicks,
      oddsAvailable,
    });
  } catch (err) {
    console.error(`[nfl-route] props/board error: ${err.message}`);
    return res.status(500).json({ success: false, error: safeErr(err) });
  }
});

// ── POST /api/nfl/parlay ───────────────────────────────────────────────────────
// NFL Parlay Synergy (admin-only, flag PARLAY_SYNERGY_NFL_ENABLED). Builds NFL
// candidates (spread/total/moneyline) and feeds them to the FROZEN, sport-agnostic
// engine (correlation matrix → composer → hit distribution). Model probabilities
// come from the pre-trained nfl_moneyline/spread/total sidecar models (live since
// Sprint 9.3); when the sidecar is down per-leg probs fall back to de-vigged
// market so the parlay still composes.
router.post('/parlay', nflParlayEnabled, verifyToken, requireAdmin, async (req, res) => {
  const {
    season = null, seasonType = null, week = null, date = null,
    requestedLegs = 3, mode = 'safe', lang = 'en',
  } = req.body ?? {};

  try {
    let games;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      games = await getNflGamesForDate(date);
    } else {
      games = await getNflGamesForWeek({
        season: season != null ? Number(season) : null,
        seasonType: seasonType != null ? Number(seasonType) : null,
        week: week != null ? Number(week) : null,
      });
    }
    if (!games?.length) {
      return res.json({ success: true, sport: 'nfl', mode, parlays: [], candidateCount: 0, note: 'no NFL games for the requested window' });
    }

    const oddsEvents = await getNflGameOdds({ date: games[0]?.game_date });
    const entries = (await Promise.all(games.map(async (g) => {
      const ev = matchNflOddsToGame(oddsEvents, g.home_team_name, g.away_team_name);
      const odds = ev ? buildMarketOddsForGame(ev) : null;
      if (!odds) return null;

      // Enrich each game's leg probabilities with the pre-trained sidecar models.
      // Heavy (context build + 3 predicts per game) but admin-only / low-frequency;
      // the underlying fetchers cache and the circuit breaker shorts out if down.
      let context = null;
      let model = null;
      try {
        context = await buildNflGameContext({
          homeTeamId: g.home_team_id,
          awayTeamId: g.away_team_id,
          homeTeamAbbr: g.home_team_abbr,
          awayTeamAbbr: g.away_team_abbr,
          gameDate: g.game_date,
          gameTime: g.game_time ?? null,
          seasonType: g.season_type ?? null,
          season: g.season ?? null,
          marketOdds: odds,
        });
        const gameMeta = {
          homeTeamId: g.home_team_id, awayTeamId: g.away_team_id,
          homeAbbr: g.home_team_abbr, awayAbbr: g.away_team_abbr,
          homeRestDays: context.home?.restDays ?? null,
          awayRestDays: context.away?.restDays ?? null,
          homeIsShortWeek: context.home?.isShortWeek ?? null,
          awayIsShortWeek: context.away?.isShortWeek ?? null,
          homeIsOffBye: context.home?.isOffBye ?? null,
          awayIsOffBye: context.away?.isOffBye ?? null,
          isDome: context.weather?.dome ?? null,
        };
        model = await predictNflGameModel(context, gameMeta, odds);
      } catch (err) {
        console.warn(`[nfl-route] parlay model enrich failed for ${g.game_id}: ${err.message}`);
      }

      return {
        gameId: String(g.game_id),
        matchup: `${g.away_team_abbr ?? 'AWAY'} @ ${g.home_team_abbr ?? 'HOME'}`,
        gameDate: g.game_date,
        homeAbbr: g.home_team_abbr,
        awayAbbr: g.away_team_abbr,
        odds,
        model, // { moneyline, spread, total } in [0,1], or null → de-vig fallback
        dataQuality: Math.round((context?.context_meta?.overallCompleteness ?? 0.7) * 100),
      };
    }))).filter(Boolean);

    const modelEnriched = entries.some(e => e.model != null);
    const candidates = buildNflParlayCandidates(entries);
    if (candidates.length < 2) {
      return res.json({ success: true, sport: 'nfl', mode, parlays: [], candidateCount: candidates.length, modelEnriched, note: 'not enough priced NFL candidates' });
    }

    const correlationMatrix = buildCorrelationMatrix(candidates);
    const { parlays, meta } = composeParlays({ candidates, correlationMatrix, N: Number(requestedLegs) || 3, mode });
    const enriched = parlays.map(p => ({
      ...p,
      hit_distribution: computeHitDistribution(p.legs.map(l => l.modelProbability / 100)),
    }));

    return res.json({ success: true, sport: 'nfl', mode, lang, candidateCount: candidates.length, modelEnriched, parlays: enriched, meta });
  } catch (err) {
    console.error(`[nfl-route] parlay error: ${err.message}`);
    return res.status(500).json({ success: false, error: safeErr(err) });
  }
});

// ── GET /api/nfl/board ─────────────────────────────────────────────────────────
// Daily NFL "pizarra" — slate + division leaders + point-diff. Public read like
// the NBA/soccer boards (no auth), cached until 04:00 ET.
router.get('/board', async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date ?? '')) ? req.query.date : null;
  const force = req.query.force === '1' || req.query.force === 'true';
  try {
    const data = await buildHexaNflBoard({ date, force });
    return res.json({ success: true, data });
  } catch (err) {
    console.error(`[nfl-route] board error: ${err.message}`);
    return res.status(500).json({ success: false, error: safeErr(err) });
  }
});

export default router;
