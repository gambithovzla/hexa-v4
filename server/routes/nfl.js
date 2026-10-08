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
import { getNflGameOdds, getNflOddsStatus, matchNflOddsToGame, buildMarketOddsForGame } from '../nfl-odds.js';
import { getNflPlayerPropOdds } from '../nfl-props-odds.js';
import { enrichNflPropOffers } from '../services/nflPropFeatureEnricher.js';
import { parseNflProp } from '../nfl-props-resolver.js';
import {
  buildNflFeaturePayload, buildNflPropFeaturePayload, predictNflProp, predictNflGameModel,
  predictNflMoneyline, predictNflSpread, predictNflTotal,
  getNflModelHealth, certifyNflPrediction,
} from '../services/nflMlClient.js';
import { buildNflPropCandidates, propOffersFromRanked, appendPropPrice } from '../services/nflPropCandidates.js';
import { buildNflPropLegCandidates } from '../services/nflParlayPropLegs.js';
import { resolveNflBetTypeDirective } from '../services/nflBetTypeDirective.js';
import { resolveNflObjective } from '../services/nflObjectiveDirective.js';
import { enrichAndPersistNflPropPick } from '../services/nflPropFeaturePersistence.js';
import { getNflPlayerStats, findNflPlayerPropStat } from '../nfl-player-fetcher.js';
import { buildNflPlayerForm } from '../services/nflPlayerForm.js';
import { getNflLeagueInjuries } from '../nfl-api.js';
import { buildNflAvailabilityIndex, findNflPlayerAvailability, summarizeNflUnavailable } from '../services/nflAvailability.js';
import { buildHexaNflBoard } from '../services/hexaNflBoardService.js';
import { buildNflParlayCandidates } from '../services/parlayEngine/nflParlayCandidates.js';
import { composeParlays } from '../services/parlayEngine/composer.js';
import { buildCorrelationMatrix } from '../services/parlayEngine/correl.js';
import { computeHitDistribution } from '../services/parlayEngine/hitMath.js';
import { askArchitect, resolveLegs } from '../services/parlayEngine/architect.js';
import { validateNflAnalysisOutput } from '../services/nflOutputGuard.js';
import { evaluateNflDecision } from '../services/nflDecisionEngine.js';
import { settleNflBetFromGame } from '../services/nflBetSettlement.js';
import { summarizeNflQuoteDecisions } from '../services/nflProspectiveReport.js';
import { nflMarketPriceReference } from '../services/nflMarketPriceReference.js';
import { getOddsApiIoNflBoard } from '../services/nflBet365OddsApiIo.js';
import { assessQbConfirmation } from '../services/nflImperdibleEngine.js';
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

router.get('/bet365-odds', nflEnabled, verifyToken, requireSportAccess('nfl'), async (req, res) => {
  const gameId = req.query?.gameId;
  if (!gameId) return res.status(400).json({ success: false, error: 'gameId is required' });
  try {
    const game = await findNflGame({ gameId });
    if (!game) return res.status(404).json({ success: false, error: 'NFL game not found' });
    const board = await getOddsApiIoNflBoard(game);
    if (board.status === 'missing_key') return res.status(503).json({ success: false,
      error: 'ODDS_API_IO_KEY is not configured', provider: 'odds_api_io' });
    return res.json({ success: true, provider: 'odds_api_io', ...board });
  } catch (err) {
    return res.status(503).json({ success: false, error: safeErr(err) });
  }
});

// Compare a price seen in the user's Bet365 account with independent books.
// This is diagnostic only: it does not create a decision or authorize a bet.
router.get('/market-reference', nflEnabled, verifyToken, requireSportAccess('nfl'), async (req, res) => {
  const gameId = req.query?.gameId;
  const market = String(req.query?.market ?? '').toLowerCase();
  const side = String(req.query?.side ?? '').toLowerCase();
  const line = market === 'moneyline' ? null : Number(req.query?.line);
  const decimalOdds = Number(req.query?.decimalOdds);
  if (!gameId || !['moneyline', 'spread', 'total'].includes(market)
      || (market === 'total' ? !['over', 'under'].includes(side) : !['home', 'away'].includes(side))
      || (market !== 'moneyline' && (req.query?.line == null || req.query.line === '' || !Number.isFinite(line)))
      || !Number.isFinite(decimalOdds) || decimalOdds <= 1 || decimalOdds > 1000) {
    return res.status(400).json({ success: false, error: 'Valid gameId, market, side, line and decimalOdds are required' });
  }
  try {
    const game = await findNflGame({ gameId });
    if (!game) return res.status(404).json({ success: false, error: 'NFL game not found' });
    const { marketOdds } = await resolveMarketOdds({ clientMarketOdds: null, game });
    const checkedAt = new Date().toISOString();
    const reference = nflMarketPriceReference(marketOdds?.quotes, {
      market, side, line, decimalOdds,
    }, checkedAt);
    const oddsStatus = getNflOddsStatus();
    const status = reference ? 'comparable' : !marketOdds
      ? oddsStatus.ok === false ? 'odds_unavailable' : 'game_unmatched'
      : 'insufficient_same_line_books';
    return res.json({ success: true, status,
      checkedAt, reference });
  } catch (err) {
    return res.status(503).json({ success: false, error: safeErr(err) });
  }
});

// A manual quote is stamped at receipt; an API quote is fetched again on the
// server before evaluation. Neither guarantees the account will accept it.
router.post('/decision', nflEnabled, verifyToken, requireSportAccess('nfl'), async (req, res) => {
  const { gameId, quote: incoming, bankroll, qbConfirmation } = req.body ?? {};
  const market = String(incoming?.market ?? '').toLowerCase();
  const side = String(incoming?.side ?? '').toLowerCase();
  const line = incoming?.line == null ? null : Number(incoming.line);
  const online = incoming?.source === 'odds_api_io';
  let decimalOdds = Number(incoming?.decimalOdds);
  if (!gameId || !['moneyline', 'spread', 'total'].includes(market)
      || !['home', 'away', 'over', 'under'].includes(side)
      || (!online && (!Number.isFinite(decimalOdds) || decimalOdds <= 1))
      || (market !== 'moneyline' && !Number.isFinite(line))) {
    return res.status(400).json({ success: false, error: 'Valid gameId, market, side, line and decimalOdds are required' });
  }
  if ((market === 'total' && !['over', 'under'].includes(side))
      || (market !== 'total' && !['home', 'away'].includes(side))) {
    return res.status(400).json({ success: false, error: 'Side does not match market' });
  }
  try {
    const game = await findNflGame({ gameId });
    if (!game) return res.status(404).json({ success: false, error: 'NFL game not found' });
    let providerQuote = null;
    if (online) {
      const board = await getOddsApiIoNflBoard(game);
      if (board.status !== 'ok') return res.status(503).json({ success: false,
        error: `Bet365 API quote unavailable: ${board.status}` });
      providerQuote = board.quotes.find(item => item.market === market && item.side === side
        && item.line === line) ?? null;
      if (!providerQuote) return res.status(409).json({ success: false,
        error: 'Requested Bet365 line is no longer available' });
      decimalOdds = providerQuote.decimalOdds;
    }
    const observedAt = providerQuote?.fetchedAt ?? new Date().toISOString();
    const quote = { bookmaker: 'bet365', market, side, line, decimalOdds, observedAt,
      source: online ? 'odds_api_io' : 'manual',
      providerEventId: providerQuote?.providerEventId ?? null,
      providerMarketUpdatedAt: providerQuote?.providerMarketUpdatedAt ?? null };
    const independentOddsPromise = resolveMarketOdds({ clientMarketOdds: null, game });
    const marketOdds = market === 'spread'
      ? { spread: { home: side === 'home' ? line : -line, away: side === 'away' ? line : -line } }
      : market === 'total' ? { total: { line } } : {};
    const context = await buildNflGameContext({
      homeTeamId: game.home_team_id, awayTeamId: game.away_team_id,
      homeTeamAbbr: game.home_team_abbr, awayTeamAbbr: game.away_team_abbr,
      gameDate: game.game_date, gameTime: game.game_datetime,
      season: game.season, seasonType: game.season_type,
      marketOdds,
    });
    if (qbConfirmation?.confirmed === true) {
      for (const sideKey of ['home', 'away']) {
        const playerName = String(qbConfirmation[sideKey] ?? '').trim().slice(0, 100);
        if (playerName.length >= 3) {
          context[sideKey].startingQb = { playerName, source: 'manual', observedAt, confirmed: true };
        }
      }
    }
    const features = buildNflFeaturePayload(context, {
      homeRestDays: context.home?.restDays, awayRestDays: context.away?.restDays,
      isDome: context.weather?.dome,
    }, marketOdds);
    const [prediction, health] = await Promise.all([
      market === 'spread' ? predictNflSpread(features)
        : market === 'total' ? predictNflTotal(features)
          : predictNflMoneyline(features),
      getNflModelHealth(),
    ]);
    const model = {
      probability: prediction?.probability,
      line,
      version: prediction?.model_version ?? null,
      certified: certifyNflPrediction(market, prediction, health),
    };
    let exposure = { game: NaN, slate: NaN };
    if (process.env.DATABASE_URL && game.season != null && game.season_type != null && game.week != null) {
      const { rows } = await pool.query(`
        SELECT COALESCE(SUM(stake) FILTER (WHERE game_pk = $2), 0) AS game,
               COALESCE(SUM(stake), 0) AS slate
        FROM nfl_bet_ledger
        WHERE user_id = $1 AND season = $3 AND season_type = $4 AND week = $5
      `, [req.user.id, Number(gameId), game.season, game.season_type, game.week]);
      exposure = { game: Number(rows[0]?.game ?? 0), slate: Number(rows[0]?.slate ?? 0) };
    }
    const decision = evaluateNflDecision({
      quote, model, kickoffAt: game.game_datetime, now: new Date().toISOString(),
      qbConfirmed: assessQbConfirmation(context).confirmed,
      dataQuality: context.context_meta?.overallCompleteness,
      isPreseason: context.seasonPhase?.isPreseason === true || String(game.season_type).toLowerCase().includes('pre'),
      bankroll, gameExposure: exposure.game, slateExposure: exposure.slate,
    });
    const { marketOdds: independentOdds } = await independentOddsPromise;
    const referenceCheckedAt = new Date().toISOString();
    const marketReference = Date.parse(referenceCheckedAt) - Date.parse(observedAt) <= 60_000
      ? nflMarketPriceReference(independentOdds?.quotes, quote, referenceCheckedAt)
      : null;
    if (marketReference) {
      marketReference.bet365ObservedAt = observedAt;
      marketReference.referenceCheckedAt = referenceCheckedAt;
    }
    let decisionId = null;
    if (process.env.DATABASE_URL) {
      const { rows } = await pool.query(`
        INSERT INTO nfl_quote_decisions
          (user_id, game_pk, season, season_type, week, bookmaker, market, side,
           line, decimal_odds, observed_at, kickoff_at, model_version,
           model_probability, expected_value, decision, reasons, snapshot)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        RETURNING id
      `, [
        req.user.id, Number(gameId), game.season, game.season_type, game.week,
        quote.bookmaker, market, side, line, decimalOdds, observedAt,
        game.game_datetime, model.version, decision.model.probability,
        decision.expectedValue, decision.decision, JSON.stringify(decision.reasons),
        JSON.stringify({ quote, decision, marketReference, exposure, bankroll: Number(bankroll),
          qbConfirmation: { home: context.home?.startingQb ?? null, away: context.away?.startingQb ?? null },
          context_meta: context.context_meta }),
      ]);
      decisionId = rows[0]?.id ?? null;
    }
    return res.json({ success: true, gameId: String(gameId), decisionId, decision,
      quote, marketReference });
  } catch (err) {
    return res.status(503).json({ success: false, error: safeErr(err) });
  }
});

router.post('/bets', nflEnabled, verifyToken, requireSportAccess('nfl'), async (req, res) => {
  const decisionId = Number(req.body?.decisionId);
  const acceptedDecimal = Number(req.body?.acceptedDecimal);
  const stake = Number(req.body?.stake);
  const overrideReason = String(req.body?.overrideReason ?? '').trim();
  if (!Number.isSafeInteger(decisionId) || decisionId <= 0
      || !Number.isFinite(acceptedDecimal) || acceptedDecimal <= 1 || acceptedDecimal > 1000
      || !Number.isFinite(stake) || stake <= 0 || stake > 1_000_000) {
    return res.status(400).json({ success: false, error: 'Valid decisionId, acceptedDecimal and stake are required' });
  }
  if (!process.env.DATABASE_URL) return res.status(503).json({ success: false, error: 'Bet ledger unavailable' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    const { rows } = await client.query(`
      SELECT * FROM nfl_quote_decisions WHERE id = $1 AND user_id = $2 FOR UPDATE
    `, [decisionId, req.user.id]);
    const d = rows[0];
    if (!d) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Decision not found' });
    }
    const { rows: exposures } = await client.query(`
      SELECT COALESCE(SUM(stake) FILTER (WHERE game_pk = $2), 0) AS game,
             COALESCE(SUM(stake), 0) AS slate
      FROM nfl_bet_ledger
      WHERE user_id = $1 AND season = $3 AND season_type = $4 AND week = $5
    `, [req.user.id, d.game_pk, d.season, d.season_type, d.week]);
    const prior = exposures[0] ?? {};
    const snapshot = d.snapshot ?? {};
    const p = snapshot.decision?.probability;
    const acceptedEv = p?.win != null && p?.loss != null
      ? Number(p.win) * (acceptedDecimal - 1) - Number(p.loss) : null;
    const policyIssues = [];
    if (d.decision !== 'BET') policyIssues.push('decision_not_bet');
    if (Date.now() - Date.parse(d.observed_at) > 5 * 60_000) policyIssues.push('quote_stale');
    if (Date.now() >= Date.parse(d.kickoff_at)) policyIssues.push('game_started');
    if (acceptedEv == null || acceptedEv < 0.03) policyIssues.push('accepted_price_below_edge');
    if (stake > Number(snapshot.decision?.stake ?? 0)) policyIssues.push('stake_above_decision');
    const bankroll = Number(snapshot.bankroll);
    if (bankroll && (Number(prior.game) + stake > bankroll * 0.005
        || Number(prior.slate) + stake > bankroll * 0.02)) policyIssues.push('exposure_limit');
    if (policyIssues.length && overrideReason.length < 10) {
      await client.query('ROLLBACK');
      return res.status(422).json({ success: false, error: 'Policy override reason required to record this bet', policyIssues });
    }
    const saved = await client.query(`
      INSERT INTO nfl_bet_ledger
        (decision_id, user_id, game_pk, season, season_type, week, bookmaker,
         market, side, line, accepted_decimal, stake, policy_override)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id, placed_at
    `, [decisionId, req.user.id, d.game_pk, d.season, d.season_type, d.week,
      d.bookmaker, d.market, d.side, d.line, acceptedDecimal, stake,
      policyIssues.length ? JSON.stringify({ reasons: policyIssues, note: overrideReason }) : null]);
    await client.query('COMMIT');
    return res.status(201).json({ success: true, betId: saved.rows[0].id, placedAt: saved.rows[0].placed_at, policyIssues });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(err.code === '23505' ? 409 : 503).json({ success: false, error: safeErr(err) });
  } finally {
    client.release();
  }
});

router.get('/bets', nflEnabled, verifyToken, requireSportAccess('nfl'), async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(503).json({ success: false, error: 'Bet ledger unavailable' });
  try {
    const { rows } = await pool.query(`
      SELECT b.*, d.kickoff_at, s.result, s.pnl, s.source AS settlement_source, s.created_at AS settled_at,
             q.line AS closing_line, q.decimal_odds AS closing_decimal, q.observed_at AS closing_observed_at
      FROM nfl_bet_ledger b
      JOIN nfl_quote_decisions d ON d.id = b.decision_id
      LEFT JOIN LATERAL (
        SELECT result, pnl, source, created_at FROM nfl_bet_settlements
        WHERE bet_id = b.id ORDER BY created_at DESC, id DESC LIMIT 1
      ) s ON TRUE
      LEFT JOIN LATERAL (
        SELECT line, decimal_odds, observed_at FROM nfl_closing_quotes
        WHERE bet_id = b.id ORDER BY observed_at DESC, id DESC LIMIT 1
      ) q ON TRUE
      WHERE b.user_id = $1 ORDER BY b.placed_at DESC
    `, [req.user.id]);
    const settled = rows.filter(r => r.result != null);
    const stake = settled.reduce((sum, r) => sum + Number(r.stake), 0);
    const pnl = settled.reduce((sum, r) => sum + Number(r.pnl), 0);
    const bets = rows.map(r => ({ ...r,
      clv: r.closing_decimal != null && (
        r.market === 'moneyline' || Number(r.line) === Number(r.closing_line)
      ) ? Math.round((1 / Number(r.closing_decimal) - 1 / Number(r.accepted_decimal)) * 10_000) / 10_000 : null,
      lineMovement: r.closing_line != null && r.line != null
        ? Number(r.closing_line) - Number(r.line) : null,
    }));
    return res.json({ success: true, bets: bets.slice(0, 200), truncated: bets.length > 200, summary: {
      settled: settled.length, pending: rows.length - settled.length,
      pnl: Math.round(pnl * 100) / 100,
      roi: stake > 0 ? Math.round(pnl / stake * 10_000) / 10_000 : null,
    } });
  } catch (err) {
    return res.status(503).json({ success: false, error: safeErr(err) });
  }
});

router.get('/performance', nflEnabled, verifyToken, requireSportAccess('nfl'), async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(503).json({ success: false, error: 'Quote history unavailable' });
  try {
    const { rows } = await pool.query(`
      SELECT d.id, d.game_pk, d.market, d.side, d.line, d.decimal_odds,
             d.observed_at, d.decision, d.reasons, d.model_probability,
             d.expected_value, d.snapshot, o.result, o.created_at AS graded_at,
             b.id AS bet_id
      FROM nfl_quote_decisions d
      LEFT JOIN LATERAL (
        SELECT result, created_at FROM nfl_quote_outcomes
        WHERE decision_id = d.id ORDER BY created_at DESC, id DESC LIMIT 1
      ) o ON TRUE
      LEFT JOIN nfl_bet_ledger b ON b.decision_id = d.id
      WHERE d.user_id = $1 ORDER BY d.observed_at DESC, d.id DESC LIMIT 2001
    `, [req.user.id]);
    const truncated = rows.length > 2000;
    const decisions = rows.slice(0, 2000);
    return res.json({ success: true, summary: summarizeNflQuoteDecisions(decisions),
      truncated, recent: decisions.slice(0, 100).map(({ snapshot, ...row }) => row) });
  } catch (err) {
    return res.status(503).json({ success: false, error: safeErr(err) });
  }
});

router.post('/bets/:id/closing-quote', nflEnabled, verifyToken, requireSportAccess('nfl'), async (req, res) => {
  const betId = Number(req.params.id);
  const decimalOdds = Number(req.body?.decimalOdds);
  const line = req.body?.line == null ? null : Number(req.body.line);
  if (!Number.isSafeInteger(betId) || betId <= 0
      || !Number.isFinite(decimalOdds) || decimalOdds <= 1 || decimalOdds > 1000
      || (req.body?.line != null && !Number.isFinite(line))) {
    return res.status(400).json({ success: false, error: 'Valid bet id and decimalOdds are required' });
  }
  if (!process.env.DATABASE_URL) return res.status(503).json({ success: false, error: 'Bet ledger unavailable' });
  try {
    const { rows } = await pool.query(`SELECT b.*, d.kickoff_at FROM nfl_bet_ledger b
      JOIN nfl_quote_decisions d ON d.id = b.decision_id
      WHERE b.id = $1 AND b.user_id = $2`, [betId, req.user.id]);
    const bet = rows[0];
    if (!bet) return res.status(404).json({ success: false, error: 'Bet not found' });
    const minutesToKickoff = (Date.parse(bet.kickoff_at) - Date.now()) / 60_000;
    if (!(minutesToKickoff > 0 && minutesToKickoff <= 30)) {
      return res.status(409).json({ success: false, error: 'Closing snapshot requires the final 30 minutes before kickoff' });
    }
    if (bet.market !== 'moneyline' && line == null) {
      return res.status(400).json({ success: false, error: 'Line is required for spread or total' });
    }
    const { rows: saved } = await pool.query(`INSERT INTO nfl_closing_quotes
      (bet_id, bookmaker, side, line, decimal_odds, observed_at)
      VALUES ($1,'bet365',$2,$3,$4,NOW()) RETURNING id, observed_at`,
    [betId, bet.side, line, decimalOdds]);
    return res.status(201).json({ success: true, quoteId: saved[0].id, observedAt: saved[0].observed_at });
  } catch (err) {
    return res.status(503).json({ success: false, error: safeErr(err) });
  }
});

router.post('/bets/:id/settle', nflEnabled, verifyToken, requireSportAccess('nfl'), async (req, res) => {
  const betId = Number(req.params.id);
  if (!Number.isSafeInteger(betId) || betId <= 0) return res.status(400).json({ success: false, error: 'Invalid bet id' });
  if (!process.env.DATABASE_URL) return res.status(503).json({ success: false, error: 'Bet ledger unavailable' });
  try {
    const { rows } = await pool.query(`SELECT * FROM nfl_bet_ledger WHERE id = $1 AND user_id = $2`, [betId, req.user.id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Bet not found' });
    const bet = rows[0];
    const game = await findNflGame({ gameId: bet.game_pk, season: bet.season, seasonType: bet.season_type, week: bet.week });
    const settlement = settleNflBetFromGame(bet, game);
    if (!settlement.result) return res.status(409).json({ success: false, reason: settlement.reason });
    const latest = await pool.query(`SELECT result, pnl FROM nfl_bet_settlements
      WHERE bet_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`, [betId]);
    if (latest.rows[0]?.result === settlement.result && Number(latest.rows[0]?.pnl) === settlement.pnl) {
      return res.json({ success: true, changed: false, settlement });
    }
    await pool.query(`INSERT INTO nfl_bet_settlements (bet_id, result, pnl, source, evidence)
      VALUES ($1,$2,$3,'espn_final',$4)`, [betId, settlement.result, settlement.pnl, JSON.stringify(settlement.evidence)]);
    return res.json({ success: true, changed: true, settlement });
  } catch (err) {
    return res.status(503).json({ success: false, error: safeErr(err) });
  }
});

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
    const nickname = name => String(name ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).at(-1);
    const kickoff = Date.parse(game.game_datetime ?? '');
    const commence = Date.parse(match.commenceTime ?? '');
    if (!nickname(game.home_team_name) || !nickname(game.away_team_name)
        || nickname(game.home_team_name) !== nickname(match.homeTeam)
        || nickname(game.away_team_name) !== nickname(match.awayTeam)
        || !Number.isFinite(kickoff) || !Number.isFinite(commence)
        || Math.abs(kickoff - commence) > 12 * 60 * 60_000) {
      return { marketOdds: null, source: null, event: null };
    }
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
       user_id, type, source, matchup, pick, oracle_confidence, bet_value, model_risk,
       oracle_report, hexa_hunch, alert_flags, probability_model, best_pick,
       model, language, odds_at_pick, implied_prob_at_pick, odds_details,
       kelly_recommendation, game_pk, game_date, user_email, sport,
       pick_time_lima
     )
     VALUES (
       $1,$2,'nfl_analysis',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
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
      // Stake is a deterministic decision-engine output, never an LLM output.
      userBankroll: undefined,
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

    const savedPick = analysisData.decision === 'NO_BET' ? null : await persistNflPick({
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
        kickoffAt: game.game_datetime ?? null,
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

const NFL_CHAT_PROP_INTENT = /\bprops?\b|yard|yarda|recep|touchdown|\btds?\b|anota|pases?\b|passing|rushing|receiving|jugador|player/i;

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
      oddsEventId: oddsEvent?.eventId ?? null,
    });

    // The chat used to see team aggregates only, so every player/prop question
    // got "I don't have player data". Give it the same player-level nflverse
    // averages and posted prop menu the game analysis already uses.
    const propsRequested = NFL_CHAT_PROP_INTENT.test(question);
    const [playerStats, propMarket] = await Promise.all([
      getNflPlayerStats(game.season, { includePriorSeason: true }).catch(() => null),
      buildPropMarket({ game, oddsEvent, resolvedOdds, propsRequested }),
    ]);
    const playerForm = buildNflPlayerForm(playerStats, { home: context.home, away: context.away });
    if (playerForm) context.playerForm = playerForm;
    if (propMarket) context.propMarket = propMarket;

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
        playerForm:   Boolean(playerForm),
        propOffers:   propMarket?.ranked?.length ?? 0,
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
      filters: { allowSGP: false },
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
      actionable: false,
      priceSource: 'consensus',
      note: 'Research only: no bet365 parlay quote or validated NFL joint model',
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
