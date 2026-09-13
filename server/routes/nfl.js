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
import { findNflGame, resolveNflSlate } from '../services/nflGameLookup.js';
import { buildNflGameContext } from '../nfl-context-builder.js';
import { analyzeNflGame, analyzeNflChat } from '../services/oracleNfl.js';
import { analyzeNflParlay } from '../services/nflParlayOracle.js';
import { getNflGameOdds, matchNflOddsToGame, buildMarketOddsForGame } from '../nfl-odds.js';
import { getNflPlayerPropOdds } from '../nfl-props-odds.js';
import { enrichNflPropOffers } from '../services/nflPropFeatureEnricher.js';
import { parseNflProp } from '../nfl-props-resolver.js';
import { buildNflPropFeaturePayload, predictNflProp, predictNflGameModel } from '../services/nflMlClient.js';
import { buildNflPropCandidates, propOffersFromRanked, appendPropPrice } from '../services/nflPropCandidates.js';
import { buildNflPropLegCandidates } from '../services/nflParlayPropLegs.js';
import { resolveNflBetTypeDirective } from '../services/nflBetTypeDirective.js';
import { resolveNflObjective } from '../services/nflObjectiveDirective.js';
import { enrichAndPersistNflPropPick } from '../services/nflPropFeaturePersistence.js';
import { getNflPlayerStats, findNflPlayerPropStat } from '../nfl-player-fetcher.js';
import { getNflLeagueInjuries } from '../nfl-api.js';
import { buildNflAvailabilityIndex, findNflPlayerAvailability, summarizeNflUnavailable } from '../services/nflAvailability.js';
import { buildHexaNflBoard } from '../services/hexaNflBoardService.js';
import { buildNflParlayCandidates } from '../services/parlayEngine/nflParlayCandidates.js';
import { composeParlays } from '../services/parlayEngine/composer.js';
import { buildCorrelationMatrix } from '../services/parlayEngine/correl.js';
import { computeHitDistribution } from '../services/parlayEngine/hitMath.js';
import { askArchitect, resolveLegs } from '../services/parlayEngine/architect.js';
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
 * Resolve marketOdds: client-provided wins; else server-side via The Odds API
 * keyed on the game's own date. Never throws.
 */
async function resolveMarketOdds({ clientMarketOdds, game }) {
  if (clientMarketOdds) {
    return { marketOdds: { ...clientMarketOdds, provided: 'client' }, source: 'client', event: null };
  }
  try {
    const events = await getNflGameOdds({ date: game.game_date, seasonType: game.season_type ?? null });
    if (!events.length) return { marketOdds: null, source: null, event: null };
    const match = matchNflOddsToGame(events, game.home_team_name, game.away_team_name);
    if (!match) return { marketOdds: null, source: null, event: null };
    const odds = buildMarketOddsForGame(match);
    if (!odds) return { marketOdds: null, source: null, event: match };
    return { marketOdds: { ...odds, provided: 'server' }, source: 'server', event: match };
  } catch (err) {
    console.warn(`[nfl-route] server-side odds lookup failed: ${err.message}`);
    return { marketOdds: null, source: null, event: null };
  }
}

/**
 * Build the player-prop menu for a game, or null when props are off, the flag is
 * disabled, or nothing survives the projection gate. Never throws: a prop
 * failure must not cost the user their team-market analysis.
 */
async function buildPropMarket({ game, oddsEvent, resolvedOdds, propKinds = null, propsRequested = false, rankOptions = {} }) {
  if (process.env.NFL_PROPS_ENABLED !== 'true') return null;
  if (!oddsEvent?.eventId) return null;

  try {
    const injuryFeed = await getNflLeagueInjuries().catch(() => null);
    const availability = buildNflAvailabilityIndex(injuryFeed, [
      { teamId: game.home_team_id, teamAbbr: game.home_team_abbr },
      { teamId: game.away_team_id, teamAbbr: game.away_team_abbr },
    ]);

    const candidates = await buildNflPropCandidates({
      game,
      event: oddsEvent,
      marketOdds: resolvedOdds,
      availability,
      findAvailability: findNflPlayerAvailability,
      markets: 'core',
      limit: 12,
      propKinds,
      // An explicit prop request means "your best prop", so the edge floor comes
      // off — the user asked for this market. Left on, a thin slate would answer
      // a prop request with a spread. The data-quality floor stays: a projection
      // with no history behind it is still not shown. The objective's own options
      // win when it is not the default: asking for "most likely" already means
      // edge is not the criterion, and conviction deliberately tightens instead.
      rankOptions: Object.keys(rankOptions).length
        ? rankOptions
        : (propsRequested ? { minEdge: 0, minConfidence: 0.35 } : {}),
    });

    if (!candidates.ranked.length) {
      console.log(
        `[nfl-route] props: 0 of ${candidates.meta.offerCount} offers cleared the gate` +
        `${candidates.meta.reason ? ` (${candidates.meta.reason})` : ''}`
      );
      return null;
    }
    console.log(
      `[nfl-route] props: ${candidates.meta.rankedCount}/${candidates.meta.offerCount} offers cleared ` +
      `(projected ${candidates.meta.projectedCount}, defense=${candidates.meta.defenseStats})`
    );
    return { ranked: candidates.ranked, meta: candidates.meta };
  } catch (err) {
    console.warn(`[nfl-route] prop market build failed: ${err.message}`);
    return null;
  }
}

/** American odds → implied probability percentage. */
function impliedProbPct(american) {
  const n = Number(american);
  if (!Number.isFinite(n) || n === 0) return null;
  const p = n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
  return Math.round(p * 1000) / 10;
}

async function persistNflPick({ userId, userEmail, matchup, analysisData, model, language, gameId, gameDate, marketOdds }) {
  if (!userId || !analysisData) return null;

  const mp = analysisData.master_prediction ?? {};
  const bp = analysisData.best_pick ?? {};
  let pickText = mp.pick ?? bp.detail ?? null;
  const conf = typeof mp.oracle_confidence === 'number' ? mp.oracle_confidence : null;
  const gamePkInt = gameId ? parseInt(gameId, 10) : null;

  // A prop's price lives in the per-event odds endpoint, not the MARKET ODDS
  // block, so the prompt (rightly) tells the model to omit it rather than guess.
  // The guard knows it though: prop_selection carries the offer the pick was
  // matched against. Attaching that verified price is what lets a prop be staked
  // and tracked like every other pick — without it the bankroll card has nothing
  // to size against and the pick sits outside CLV entirely.
  const propOdds = analysisData.prop_selection?.offer?.oddsAmerican ?? null;
  const oddsAtPick = Number.isFinite(Number(propOdds)) ? Number(propOdds) : null;
  pickText = appendPropPrice(pickText, oddsAtPick);

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
      oddsAtPick,
      impliedProbPct(oddsAtPick),
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
    betType     = 'all',
    objective   = 'value',
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

    const { marketOdds: resolvedOdds, source: oddsSource, event: oddsEvent } = await resolveMarketOdds({
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
      oddsEventId: oddsEvent?.eventId ?? null,
    });

    // Player props (flag NFL_PROPS_ENABLED). The Oracle only gets the prop menu
    // when there is one: if nothing clears the edge and data-quality gate we fall
    // back to the props-disabled prompt, so the model is never invited to pick
    // from an empty board and invent a line instead.
    const focus = resolveNflBetTypeDirective(betType, { propsAvailable: false });
    const analysisObjective = resolveNflObjective(objective);
    const propMarket = await buildPropMarket({
      game,
      oddsEvent,
      resolvedOdds,
      propKinds: focus.propKinds,
      propsRequested: focus.propsRequested,
      rankOptions: analysisObjective.rankOptions,
    });
    const propsActive = Boolean(propMarket);
    if (propsActive) context.propMarket = propMarket;
    const betDirective = resolveNflBetTypeDirective(betType, { propsAvailable: propsActive });

    const result = await analyzeNflGame({
      context,
      gameDescription: `${matchup} — ${gameDate}`,
      lang,
      riskProfile,
      userBankroll: bankroll != null ? Number(bankroll) : undefined,
      marketOdds: resolvedOdds,
      engine,
      propsEnabled: propsActive,
      betDirective: `${betDirective.directive}\n${analysisObjective.directive}`,
    });

    if (result.parseError) {
      console.warn(`[nfl-route] parse error for game ${gameId} — raw text returned`);
    }

    const guard = validateNflAnalysisOutput(result.data, {
      parseError: result.parseError,
      isPreseason: context?.seasonPhase?.isPreseason === true,
      marketOdds: resolvedOdds,
      propsEnabled: propsActive,
      propOffers: propsActive ? propOffersFromRanked(propMarket.ranked) : null,
      allowPass: analysisObjective.allowPass,
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

    // The conviction objective declined this game. Persisting a "PASS" row would
    // put an ungradeable pick into the history, the resolver queue and the ROI
    // maths, so the read is returned and nothing is saved.
    if (guard.is_pass) {
      console.log(`[nfl-route] conviction PASS on game=${gameId} — no pick saved`);
      return res.json({
        success: true,
        pass: true,
        data: analysisData,
        outputQuality: guard.quality,
        savedPick: null,
        meta: {
          model: result.model,
          objective: analysisObjective.objective,
          betFocus: { requested: betDirective.betType, propsRequested: betDirective.propsRequested },
          oddsSource,
          propMarket: propsActive ? { meta: propMarket.meta } : null,
        },
      });
    }

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
        marketOdds: resolvedOdds,
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
      lineProvenance: guard.line_provenance,
      propMarket: propsActive
        ? { candidates: propMarket.ranked, meta: propMarket.meta }
        : null,
      betFocus: {
        requested: betDirective.betType,
        propsRequested: betDirective.propsRequested,
        unavailable: betDirective.unavailable,
      },
      objective: analysisObjective.objective,
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

    const { marketOdds: resolvedOdds, source: oddsSource, event: oddsEvent } = await resolveMarketOdds({
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

/** Identity of one prop row: kind + player + side + line. */
function propRowKey(o) {
  const name = String(o.playerName ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${o.propKind}|${name}|${o.side}|${o.line}`;
}

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

// ── POST /api/nfl/analyze/parlay ───────────────────────────────────────────────
// One leg per selected game, Oracle-style. This is the NFL twin of the frozen
// MLB /api/analyze/parlay and returns the same JSON shape, so the existing
// ResultCard renders it unchanged. The Parlay Synergy Architect lives at
// POST /api/nfl/parlay and is a different product: it composes from a scored
// candidate pool instead of honouring a one-leg-per-game selection.
router.post('/analyze/parlay', nflEnabled, verifyToken, requireSportAccess('nfl'), async (req, res) => {
  const {
    gameIds,
    season      = null,
    seasonType  = null,
    week        = null,
    date        = null,
    lang        = 'en',
    riskProfile = 'balanced',
    engine      = 'deep',
  } = req.body ?? {};

  if (!Array.isArray(gameIds) || gameIds.length < 2) {
    return res.status(400).json({ success: false, error: 'gameIds array with at least 2 games is required' });
  }
  if (gameIds.length > 8) {
    return res.status(400).json({ success: false, error: 'Maximum 8 games per NFL parlay' });
  }
  if (!['deep', 'premium'].includes(engine)) {
    return res.status(400).json({ success: false, error: 'Invalid engine (deep|premium)' });
  }

  try {
    const lookup = {
      season: season != null ? Number(season) : null,
      seasonType: seasonType != null ? Number(seasonType) : null,
      week: week != null ? Number(week) : null,
      date,
    };

    const games = await Promise.all(gameIds.map(id => findNflGame({ gameId: id, ...lookup })));
    const missing = gameIds.filter((id, i) => !games[i]);
    if (missing.length) {
      return res.status(404).json({ success: false, error: `NFL game(s) not found: ${missing.join(', ')}` });
    }

    // Each leg carries its own context and its own market block. A game whose
    // odds never resolve still becomes a leg — the prompt forbids inventing a
    // line, so the model must say so in that leg's reasoning instead.
    const legs = await Promise.all(games.map(async (game) => {
      const matchup = `${game.away_team_abbr ?? game.away_team_name ?? 'AWAY'} @ ${game.home_team_abbr ?? game.home_team_name ?? 'HOME'}`;
      const gameDate = game.game_date ?? date ?? new Date().toISOString().split('T')[0];

      const { marketOdds, event } = await resolveMarketOdds({ clientMarketOdds: null, game });

      const context = await buildNflGameContext({
        homeTeamId: game.home_team_id,
        awayTeamId: game.away_team_id,
        homeTeamAbbr: game.home_team_abbr ?? null,
        awayTeamAbbr: game.away_team_abbr ?? null,
        gameDate,
        gameTime: game.game_datetime ?? null,
        season: game.season,
        seasonType: game.season_type ?? seasonType ?? null,
        marketOdds,
        oddsEventId: event?.eventId ?? null,
      });

      return { context, marketOdds, gameDescription: `${matchup} — ${gameDate}`, legOdds: marketOdds ?? null };
    }));

    const result = await analyzeNflParlay({
      legs: legs.map(({ context, marketOdds, gameDescription }) => ({ context, marketOdds, gameDescription })),
      lang,
      riskProfile,
      engine,
    });

    const legOdds = legs.map(l => l.legOdds);
    const data = result.data
      ? { ...result.data, legOdds: legOdds.some(Boolean) ? legOdds : undefined }
      : null;

    return res.json({
      success: true,
      sport: 'nfl',
      data,
      parseError: result.parseError,
      rawText: result.rawText,
      engine,
      meta: {
        model: result.model,
        legCount: legs.length,
        oddsResolved: legOdds.filter(Boolean).length,
      },
    });
  } catch (err) {
    console.error(`[nfl-route] analyze/parlay error: ${err.message}`);
    return res.status(500).json({ success: false, error: safeErr(err) });
  }
});

router.get('/props/board', nflPropsEnabled, verifyToken, requireAdmin, async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date ?? '')) ? req.query.date : todayEt();
  const propKindFilter = req.query.propKind ? String(req.query.propKind) : null;
  // The per-event odds endpoint bills a credit per market, so the extra markets
  // (kicking, defense, longest play) are opt-in: ?markets=extended|all.
  const marketScope = ['core', 'extended', 'all'].includes(String(req.query.markets))
    ? String(req.query.markets) : 'core';

  try {
    const games = await resolveNflSlate({ date });
    const oddsEvents = await getNflGameOdds({ date: games[0]?.game_date ?? date, seasonType: games[0]?.season_type ?? null });
    // Availability rides along: an OUT receiver's over is not a bet, it's a void.
    const injuryFeed = await getNflLeagueInjuries().catch(() => null);

    const boardGames = [];
    let oddsAvailable = false;
    let projectionAvailable = false;

    for (const game of games) {
      const event = matchNflOddsToGame(oddsEvents, game.home_team_name, game.away_team_name);
      const availability = buildNflAvailabilityIndex(injuryFeed, [
        { teamId: game.home_team_id, teamAbbr: game.home_team_abbr },
        { teamId: game.away_team_id, teamAbbr: game.away_team_abbr },
      ]);
      let props = [];
      if (event?.eventId) {
        const offers = await getNflPlayerPropOdds({ eventId: event.eventId, sportKey: event.sportKey, markets: marketScope });
        if (offers.length) oddsAvailable = true;

        // Projection engine: the board's primary model signal. Unlike the pooled
        // nfl_prop XGBoost — which needs live resolved picks before it exists —
        // this produces a probability from the first week of the season.
        const candidates = await buildNflPropCandidates({
          game,
          marketOdds: buildMarketOddsForGame(event),
          availability,
          offers,
          findAvailability: findNflPlayerAvailability,
          limit: Number.MAX_SAFE_INTEGER,
        });
        projectionAvailable = projectionAvailable || candidates.meta.projectedCount > 0;

        const byKey = new Map(candidates.projections.map(pr => [propRowKey(pr), pr]));

        props = candidates.enriched
          .filter(o => !propKindFilter || o.propKind === propKindFilter)
          .map(o => {
            const pr = byKey.get(propRowKey(o));
            return {
              propKind: o.propKind,
              playerName: o.playerName,
              side: o.side,
              line: o.line,
              oddsAmerican: o.oddsAmerican,
              impliedProb: o.impliedProb,
              fairProb: o.fairProb,
              vig: o.vig,
              modelProb: pr?.modelProb ?? null,
              edge: pr?.edge ?? null,
              projection: pr
                ? {
                    mean: pr.projectedMean,
                    sd: pr.projectedSd,
                    confidence: pr.confidence,
                    distribution: pr.distribution,
                    scriptFactor: pr.factors?.script ?? null,
                    defenseFactor: pr.factors?.defense ?? null,
                    sampleGames: pr.sampleGames,
                    kellyStake: pr.kellyStake,
                    rationale: pr.rationale,
                  }
                : null,
              mlProb: null,  // pooled nfl_prop model, filled below when trained
              mlEdge: null,
              availability: findNflPlayerAvailability(availability, o.playerName),
            };
          })
          .sort((a, b) => {
            // Lead with the biggest modelled edges; unprojected rows sink.
            const ea = a.edge ?? -Infinity;
            const eb = b.edge ?? -Infinity;
            if (ea !== eb) return eb - ea;
            return a.propKind.localeCompare(b.propKind) ||
              String(a.playerName).localeCompare(String(b.playerName));
          });

        // The pooled nfl_prop model rides alongside as a second opinion once it
        // has been trained. Null (circuit open / disabled / no artifact) is the
        // normal state until enough live props resolve.
        const top = props.slice(0, MAX_MODEL_PREDICTIONS);
        // Current season only, deliberately: the pooled nfl_prop model is trained
        // on current-season averages, so feeding it last season's would predict
        // off a different distribution. The projection engine's own prior-season
        // fallback lives in buildNflPropCandidates and stays out of training.
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
            p.mlProb = Math.round(pred.probability * 1e4) / 1e4;
            if (p.impliedProb != null) p.mlEdge = Math.round((p.mlProb - p.impliedProb) * 1e4) / 1e4;
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
        unavailable: summarizeNflUnavailable(availability),
      });
    }

    const oraclePropPicks = await fetchOraclePropPicks(req.user.id, date);

    return res.json({
      success: true,
      date,
      sport: 'nfl',
      markets: marketScope,
      mlPublic: false,
      mlEnabled: boardGames.some(g => g.props.some(p => p.mlProb != null)),
      projectionEnabled: projectionAvailable,
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
    requestedLegs = 3, mode = 'safe', lang = 'en', gameIds = null,
    // Props are the softest part of the board, so they belong in the parlay —
    // but the per-event odds endpoint bills per market per game, so a whole
    // slate is the expensive call. Opt out when the quota matters.
    includeProps = true,
  } = req.body ?? {};

  try {
    const games = await resolveNflSlate({
      season: season != null ? Number(season) : null,
      seasonType: seasonType != null ? Number(seasonType) : null,
      week: week != null ? Number(week) : null,
      date,
    });
    if (!games?.length) {
      return res.json({ success: true, sport: 'nfl', mode, data: null, candidateCount: 0, note: 'no NFL games for the requested window' });
    }

    // Honour an explicit selection: the user picked these games, so the parlay is
    // built from them and not from the whole week's slate.
    const wanted = Array.isArray(gameIds) && gameIds.length
      ? new Set(gameIds.map(String))
      : null;
    const slate = wanted ? games.filter(g => wanted.has(String(g.game_id))) : games;
    if (!slate.length) {
      return res.json({ success: true, sport: 'nfl', mode, data: null, candidateCount: 0, note: 'none of the selected games are in the NFL slate' });
    }

    const oddsEvents = await getNflGameOdds({ date: slate[0]?.game_date, seasonType: slate[0]?.season_type ?? null });
    const entries = (await Promise.all(slate.map(async (g) => {
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
          oddsEventId: ev?.eventId ?? null,
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

      const entry = {
        gameId: String(g.game_id),
        matchup: `${g.away_team_abbr ?? 'AWAY'} @ ${g.home_team_abbr ?? 'HOME'}`,
        gameDate: g.game_date,
        homeAbbr: g.home_team_abbr,
        awayAbbr: g.away_team_abbr,
        odds,
        model, // { moneyline, spread, total } in [0,1], or null → de-vig fallback
        dataQuality: Math.round((context?.context_meta?.overallCompleteness ?? 0.7) * 100),
      };

      // Player props as legs. Never fatal: a game whose props fail to load still
      // contributes its team markets.
      entry.propLegs = [];
      if (includeProps && process.env.NFL_PROPS_ENABLED === 'true' && ev?.eventId) {
        try {
          const propCandidates = await buildNflPropCandidates({
            game: g,
            event: ev,
            marketOdds: odds,
            markets: 'core',
            limit: 8,
          });
          entry.propLegs = buildNflPropLegCandidates(entry, propCandidates.ranked);
        } catch (err) {
          console.warn(`[nfl-route] parlay prop legs failed for ${g.game_id}: ${err.message}`);
        }
      }

      return entry;
    }))).filter(Boolean);

    const modelEnriched = entries.some(e => e.model != null);
    const propLegs = entries.flatMap(e => e.propLegs ?? []);
    const candidates = [...buildNflParlayCandidates(entries), ...propLegs];
    if (candidates.length < 2) {
      return res.json({ success: true, sport: 'nfl', mode, data: null, candidateCount: candidates.length, modelEnriched, note: 'not enough priced NFL candidates' });
    }

    const correlationMatrix = buildCorrelationMatrix(candidates);
    const composerStart = Date.now();
    const { parlays, meta: composerMeta } = composeParlays({
      candidates, correlationMatrix, N: Number(requestedLegs) || 3, mode,
    });
    const composerMs = Date.now() - composerStart;

    if (!parlays.length) {
      return res.json({
        success: true, sport: 'nfl', mode,
        data: null, candidateCount: candidates.length, propLegCount: propLegs.length,
        note: 'composer produced no parlay for this mode',
      });
    }

    // The LLM architect audits the composer's shortlist and picks the final
    // combination — it is sport-agnostic, so NFL gets the same second opinion
    // MLB has had, and the response takes the MLB shape so one UI renders both.
    const llmStart = Date.now();
    const architectDecision = await askArchitect({
      candidatePool: candidates,
      composedParlays: parlays,
      mode,
      N: Number(requestedLegs) || 3,
      lang,
    });
    const llmMs = Date.now() - llmStart;

    const finalLegs = resolveLegs(architectDecision.final_legs, candidates);
    const hitDistribution = computeHitDistribution(finalLegs.map(l => l.modelProbability / 100));
    const legSummary = legs => legs.map(l => ({
      candidateId: l.candidateId,
      gamePk: l.gamePk,
      matchup: l.matchup,
      pick: l.pick,
      type: l.type,
      marketType: l.marketType,
      propKind: l.propKind,
      odds: l.odds,
      decimalOdds: l.decimalOdds,
      modelProbability: l.modelProbability,
      edge: l.edge,
      reasoning: (l.reasoning ?? '').slice(0, 200),
      riskVector: l.riskVector,
      gameScript: l.gameScript,
    }));

    return res.json({
      success: true,
      sport: 'nfl',
      data: {
        run_id: null,
        chosen_parlay: {
          legs:                  legSummary(finalLegs),
          actual_legs:           finalLegs.length,
          requested_legs:        Number(requestedLegs) || 3,
          combined_probability:  architectDecision.combined_probability,
          combined_decimal_odds: architectDecision.combined_decimal_odds,
          combined_edge_score:   finalLegs.reduce((sum, l) => sum + (l.edge ?? 0), 0),
          hit_distribution:      hitDistribution,
          synergy_type:          architectDecision.synergy_type,
          synergy_thesis:        architectDecision.synergy_thesis,
          warnings:              architectDecision.warnings ?? [],
        },
        alternatives: parlays.slice(1).map((alt, i) => ({
          index:                 i + 1,
          legs:                  legSummary(alt.legs),
          combined_probability:  alt.combinedMarginalProbability,
          combined_decimal_odds: alt.combinedDecimalOdds,
          combined_edge_score:   alt.legs.reduce((sum, l) => sum + (l.edge ?? 0), 0),
          score:                 alt.score,
        })),
        composer_meta: {
          mode,
          sport:                'nfl',
          candidate_pool_size:  candidates.length,
          prop_leg_count:       propLegs.length,
          model_enriched:       modelEnriched,
          eligible_count:       composerMeta?.eligibleCount ?? null,
          requested_legs:       Number(requestedLegs) || 3,
          built_legs:           finalLegs.length,
        },
        architect_meta: {
          validated:                    !architectDecision._fallback,
          overrode_composer:            architectDecision.decision === 'modify',
          hidden_correlations_detected: architectDecision.hidden_correlations_detected ?? [],
          timings: { composer_ms: composerMs, llm_ms: llmMs, total_ms: composerMs + llmMs },
        },
      },
    });
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
