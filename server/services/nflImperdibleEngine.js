/**
 * server/services/nflImperdibleEngine.js — orchestrator for the NFL Pick
 * Imperdible mode (admin-only). The lock-of-the-slate for NFL.
 *
 * Mirrors imperdibleEngine.js (MLB) but is NFL-native and touches NO frozen file:
 *   1. Resolve the requested NFL games (by week, or by date).
 *   2. For each: build context + market odds, query the pre-trained sidecar
 *      models (nfl_moneyline/spread/total) for side-aligned probabilities, run
 *      the independent deterministic shadow validator, and assess the starting-QB
 *      picture (the NFL availability gate).
 *   3. Build spread/total/moneyline candidates (the parlay candidate builder) and
 *      score conviction (model + market + validator + variance + data quality),
 *      gated on QB-confirmed AND model-certified (no sidecar model → no lock).
 *   4. Apply the hard gate. If none pass → PASS (no lock today).
 *   5. LLM arbiter (Opus) audits the survivors and confirms one or vetoes.
 *   6. Persist the single lock to `picks` (source='imperdible', sport='nfl') —
 *      resolved automatically by the NFL pick resolver — plus a full
 *      `imperdible_runs` row (sport='nfl') as the slate dataset.
 *
 * NOTE: unlike MLB, the NFL imperdible does not write pick_features here — the
 * NFL pick_features writer hardcodes source='live' and would pollute training.
 * The picks row (resolved by the NFL resolver) + the imperdible_runs row are the
 * dataset for the future NFL lock model.
 */

import pool from '../db.js';
import { getNflGamesForWeek, getNflGamesForDate } from '../nfl-api.js';
import { getNflGameOdds, matchNflOddsToGame, buildMarketOddsForGame } from '../nfl-odds.js';
import { buildNflGameContext } from '../nfl-context-builder.js';
import { buildNflGameCandidates } from './parlayEngine/nflParlayCandidates.js';
import { predictNflGameModel } from './nflMlClient.js';
import { calculateNflShadowScore } from './nflShadowValidator.js';
import { serializeNflContext } from './oracleNfl.js';
import {
  computeNflConviction,
  evaluateNflGate,
  rankNflCandidates,
} from './nflImperdibleSelector.js';
import { arbitrateNflImperdible } from './nflImperdibleArbiter.js';

const TOP_K = Number(process.env.IMPERDIBLE_TOP_K) || 5;
const SOURCE = 'imperdible';

// A QB ruled fully OUT is *known* information (the backup is the starter); only
// these statuses are the genuine uncertainty that voids a lock.
const UNCERTAIN_QB = new Set(['questionable', 'doubtful', 'game_time_decision']);

function americanToDecimal(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

function americanToImplied(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

/**
 * Half-Kelly stake (fraction of bankroll), capped at 4% — slightly tighter than
 * MLB (5%) because NFL is the higher-variance market.
 */
function recommendedStakeFraction(consensusProb, odds) {
  const dec = americanToDecimal(odds);
  const p = Number(consensusProb);
  if (!Number.isFinite(dec) || !Number.isFinite(p)) return null;
  const b = dec - 1;
  if (b <= 0) return null;
  const prob = p / 100;
  const kelly = (b * prob - (1 - prob)) / b;
  if (kelly <= 0) return 0;
  return Math.round(Math.min(0.04, 0.5 * kelly) * 1000) / 1000;
}

/** Assess the starting-QB picture for both teams. */
function assessQbConfirmation(context) {
  const homeQb = context?.home?.qbStatus ?? null;
  const awayQb = context?.away?.qbStatus ?? null;
  const homeUncertain = homeQb && UNCERTAIN_QB.has(homeQb.statusKey);
  const awayUncertain = awayQb && UNCERTAIN_QB.has(awayQb.statusKey);
  const parts = [];
  if (homeQb) parts.push(`home QB ${homeQb.playerName ?? '?'} ${homeQb.status ?? homeQb.statusKey}`);
  if (awayQb) parts.push(`away QB ${awayQb.playerName ?? '?'} ${awayQb.status ?? awayQb.statusKey}`);
  return {
    confirmed: !homeUncertain && !awayUncertain,
    detail: parts.length ? parts.join('; ') : 'both starters healthy',
    reason: homeUncertain ? 'home_qb_uncertain' : awayUncertain ? 'away_qb_uncertain' : null,
  };
}

/** Side-aligned shadow-validator probability — moneyline only (where comparable). */
function shadowProbForCandidate(candidate, shadow) {
  if (candidate.marketType !== 'moneyline') return null;
  const homeProb = shadow?.score;
  if (homeProb == null || !Number.isFinite(homeProb)) return null;
  return candidate.side === 'home' ? homeProb : 100 - homeProb;
}

async function buildGameBundle({ game, oddsEvents, lang }) {
  const ev = matchNflOddsToGame(oddsEvents, game.home_team_name, game.away_team_name);
  const odds = ev ? buildMarketOddsForGame(ev) : null;
  if (!odds) return null; // can't price a lock without a market

  const context = await buildNflGameContext({
    homeTeamId: game.home_team_id,
    awayTeamId: game.away_team_id,
    homeTeamAbbr: game.home_team_abbr,
    awayTeamAbbr: game.away_team_abbr,
    gameDate: game.game_date,
    gameTime: game.game_time ?? null,
    seasonType: game.season_type ?? null,
    season: game.season ?? null,
    marketOdds: odds,
  });

  const gameMeta = {
    homeTeamId: game.home_team_id, awayTeamId: game.away_team_id,
    homeAbbr: game.home_team_abbr, awayAbbr: game.away_team_abbr,
    homeRestDays: context.home?.restDays ?? null,
    awayRestDays: context.away?.restDays ?? null,
    homeIsShortWeek: context.home?.isShortWeek ?? null,
    awayIsShortWeek: context.away?.isShortWeek ?? null,
    homeIsOffBye: context.home?.isOffBye ?? null,
    awayIsOffBye: context.away?.isOffBye ?? null,
    isDome: context.weather?.dome ?? null,
  };

  const model = await predictNflGameModel(context, gameMeta, odds);
  const modelCertified = model != null;
  const shadow = calculateNflShadowScore(context, gameMeta);
  const qb = assessQbConfirmation(context);
  const isPreseason = context?.seasonPhase?.isPreseason === true;
  const dataQuality = Math.round((context?.context_meta?.overallCompleteness ?? 0.5) * 100);
  const matchup = `${game.away_team_abbr ?? 'AWAY'} @ ${game.home_team_abbr ?? 'HOME'}`;

  const rawCandidates = buildNflGameCandidates({
    gameId: String(game.game_id),
    matchup,
    gameDate: game.game_date,
    homeAbbr: game.home_team_abbr,
    awayAbbr: game.away_team_abbr,
    odds,
    model,
    dataQuality,
  });

  const candidates = rawCandidates.map((c) => ({
    ...c,
    qbConfirmed: qb.confirmed,
    qbDetail: qb.detail,
    modelCertified,
    isPreseason,
    mlProb: shadowProbForCandidate(c, shadow),
  }));

  return {
    gamePk: String(game.game_id),
    matchup,
    context,
    contextText: serializeNflContext({ context, marketOdds: odds }),
    odds,
    model,
    modelCertified,
    shadow,
    qb,
    dataQuality,
    candidates,
  };
}

function scoreCandidate(candidate) {
  const score = computeNflConviction({
    modelProb: candidate.modelProbability,
    impliedProb: candidate.impliedProbability,
    mlProb: candidate.mlProb,
    dataQuality: candidate.dataQualityScore ?? candidate.dataQuality,
    marketType: candidate.marketType,
    qbConfirmed: candidate.qbConfirmed,
  });
  return { ...candidate, ...score };
}

/**
 * Main entry. Returns the full analysis result (does not require persistence).
 * @param {object} p
 * @param {string[]} p.gameIds   ESPN game ids to consider
 * @param {number}  [p.season] [p.seasonType] [p.week]  week lookup
 * @param {string}  [p.date]    date lookup (YYYY-MM-DD) — overrides week
 * @param {string}  [p.lang]
 * @param {object}  [p.thresholds]  partial gate overrides
 */
export async function analyzeNflImperdible({ gameIds, season, seasonType, week, date, lang = 'en', thresholds = {} }) {
  const gateOverrides = thresholds && typeof thresholds === 'object' ? thresholds : {};

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

  const requested = (games ?? []).filter((g) => gameIds.map(String).includes(String(g.game_id)));
  if (requested.length === 0) {
    return { verdict: 'PASS', reason: 'no_games_found', imperdible: null, slate: [], excluded: [] };
  }

  const resolvedDate = requested[0]?.game_date ?? date ?? new Date().toISOString().split('T')[0];

  let oddsEvents = [];
  try { oddsEvents = await getNflGameOdds({ date: requested[0]?.game_date }); } catch { /* optional */ }

  const settled = await Promise.allSettled(
    requested.map((game) => buildGameBundle({ game, oddsEvents, lang })),
  );
  const gameBundles = settled
    .filter((s) => s.status === 'fulfilled' && s.value)
    .map((s) => s.value);
  const bundleByGamePk = new Map(gameBundles.map((b) => [String(b.gamePk), b]));

  // Games dropped for missing odds appear as excluded (observability).
  const pricedIds = new Set(gameBundles.map((b) => String(b.gamePk)));
  const excluded = requested
    .filter((g) => !pricedIds.has(String(g.game_id)))
    .map((g) => ({
      gamePk: String(g.game_id),
      matchup: `${g.away_team_abbr ?? '?'} @ ${g.home_team_abbr ?? '?'}`,
      reason: 'no_market_odds',
    }));

  const allCandidates = gameBundles.flatMap((b) => b.candidates);
  if (allCandidates.length === 0) {
    return { verdict: 'PASS', reason: 'no_candidates', imperdible: null, slate: [], excluded, slateSize: requested.length };
  }

  const ranked = rankNflCandidates(allCandidates.map(scoreCandidate));
  const topK = ranked.slice(0, TOP_K);

  const gated = topK.map((c) => ({ ...c, gate: evaluateNflGate(c, gateOverrides) }));
  const eligible = gated.filter((c) => c.gate.pass);

  // Full slate for the dataset: gated top-K plus the rest (ungated) for context.
  const restSlate = ranked.slice(TOP_K).map((c) => ({
    ...c,
    gate: { pass: false, failedReasons: ['below_top_k'] },
  }));
  const fullSlate = [...gated, ...restSlate];

  if (eligible.length === 0) {
    return {
      verdict: 'PASS',
      reason: 'gate_not_cleared',
      imperdible: null,
      slate: fullSlate,
      excluded,
      slateSize: requested.length,
      bestRejected: gated[0] ?? null,
    };
  }

  // LLM arbiter on the eligible survivors (cap to 3).
  const arbiterCandidates = eligible.slice(0, 3);
  const gameContexts = arbiterCandidates
    .map((c) => bundleByGamePk.get(String(c.gamePk)))
    .filter((b, i, arr) => b && arr.indexOf(b) === i)
    .map((b) => ({ gamePk: b.gamePk, matchup: b.matchup, context: b.contextText }));

  const verdict = await arbitrateNflImperdible({ candidates: arbiterCandidates, gameContexts, lang });

  if (verdict.verdict !== 'CONFIRM' || !verdict.selected_candidate_id) {
    return {
      verdict: 'PASS',
      reason: 'arbiter_veto',
      imperdible: null,
      slate: fullSlate,
      excluded,
      slateSize: requested.length,
      arbiter: verdict,
    };
  }

  const selected = eligible.find((c) => c.candidateId === verdict.selected_candidate_id) ?? eligible[0];
  const stakeFraction = recommendedStakeFraction(selected.consensusProb, selected.odds);

  return {
    verdict: 'CONFIRM',
    reason: 'confirmed',
    imperdible: {
      ...selected,
      arbiterConfidence: verdict.confidence,
      headline: verdict.headline,
      rationale: verdict.rationale,
      recommendedStakeFraction: stakeFraction,
    },
    arbiter: verdict,
    slate: fullSlate,
    excluded,
    slateSize: requested.length,
    resolvedDate,
  };
}

/**
 * Persist a confirmed NFL lock: one row in `picks` (source='imperdible',
 * sport='nfl') + one row in `imperdible_runs` (sport='nfl'). PASS runs are still
 * recorded for the dataset / audit trail.
 */
export async function persistNflImperdible({ result, userId, userEmail = null, lang = 'en' }) {
  if (!result || result.verdict !== 'CONFIRM' || !result.imperdible) {
    await recordRun({ result, userId, pickId: null, lang });
    return { savedPick: null };
  }

  const lock = result.imperdible;
  const oddsAtPick = lock.odds ?? null;
  const impliedAtPick = oddsAtPick != null ? americanToImplied(oddsAtPick) : null;
  const oracleConfidence = Math.round(lock.consensusProb ?? lock.modelProbability ?? 0);

  const bestPick = { type: lock.type, detail: lock.pick, confidence: (lock.consensusProb ?? 0) / 100 };
  const valueBreakdown = {
    market_type: lock.marketType,
    side: lock.side,
    line: lock.line,
    odds: oddsAtPick,
    model_probability: lock.components?.modelProb ?? null,
    implied_probability: lock.components?.impliedProb ?? null,
    validator_probability: lock.components?.mlProb ?? null,
    consensus_probability: lock.consensusProb,
    conviction: lock.conviction,
    variance_penalty: lock.variancePenalty,
    qb_detail: lock.qbDetail ?? null,
    recommended_stake_fraction: lock.recommendedStakeFraction,
  };

  const insertPick = await pool.query(
    `INSERT INTO picks (
       user_id, type, source, matchup, pick, oracle_confidence, bet_value, model_risk,
       oracle_report, alert_flags, best_pick, model, language,
       odds_at_pick, implied_prob_at_pick, odds_details, game_pk, game_date,
       value_breakdown, safe_candidates, selection_method, user_email, sport, pick_time_lima
     )
     VALUES ($1,'imperdible','imperdible',$2,$3,$4,$5,$6,$7,$8,$9,'deep',$10,$11,$12,$13,$14,$15,$16,$17,'nfl_imperdible_arbiter_v1',$18,'nfl',(NOW() AT TIME ZONE 'America/Lima')::TIMESTAMP)
     RETURNING *`,
    [
      userId,
      lock.matchup,
      lock.pick,
      oracleConfidence,
      'LOCK',
      'low',
      lock.rationale ?? null,
      JSON.stringify(result.arbiter?.disqualifiers_checked ?? []),
      JSON.stringify(bestPick),
      lang,
      oddsAtPick,
      impliedAtPick,
      null,
      Number(lock.gamePk),
      result.resolvedDate ?? null,
      JSON.stringify(valueBreakdown),
      JSON.stringify((result.slate ?? []).map((c) => ({
        candidateId: c.candidateId, pick: c.pick, marketType: c.marketType,
        conviction: c.conviction, consensusProb: c.consensusProb, gate: c.gate,
      }))),
      userEmail,
    ],
  );

  const savedPick = insertPick.rows[0] ?? null;
  await recordRun({ result, userId, pickId: savedPick?.id ?? null, lang });
  return { savedPick };
}

async function recordRun({ result, userId, pickId, lang }) {
  try {
    await pool.query(
      `INSERT INTO imperdible_runs (
         user_id, sport, lang, game_pks, slate_size, verdict, reason,
         selected_pick_id, selected_candidate_id, conviction, consensus_prob,
         arbiter_confidence, headline, rationale, candidates, arbiter, excluded
       )
       VALUES ($1,'nfl',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        userId,
        lang,
        (result.slate ?? [])
          .map((c) => Number(c.gamePk))
          .filter((v) => Number.isFinite(v))
          .filter((v, i, a) => a.indexOf(v) === i),
        result.slateSize ?? (result.slate ?? []).length,
        result.verdict,
        result.reason ?? null,
        pickId,
        result.imperdible?.candidateId ?? null,
        result.imperdible?.conviction ?? null,
        result.imperdible?.consensusProb ?? null,
        result.arbiter?.confidence ?? null,
        result.imperdible?.headline ?? result.arbiter?.headline ?? null,
        result.imperdible?.rationale ?? result.arbiter?.rationale ?? null,
        JSON.stringify((result.slate ?? []).map((c) => ({
          candidateId: c.candidateId, pick: c.pick, matchup: c.matchup, marketType: c.marketType,
          line: c.line, odds: c.odds, conviction: c.conviction, consensusProb: c.consensusProb,
          components: c.components, agreement: c.agreement, variancePenalty: c.variancePenalty,
          qbConfirmed: c.qbConfirmed, modelCertified: c.modelCertified, gate: c.gate,
        }))),
        result.arbiter ? JSON.stringify(result.arbiter) : null,
        JSON.stringify(result.excluded ?? []),
      ],
    );
  } catch (err) {
    console.warn(`[nfl-imperdible] recordRun failed: ${err.message}`);
  }
}

export async function getNflImperdibleHistory({ limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT r.id, r.created_at, r.lang, r.slate_size, r.verdict, r.reason,
            r.selected_candidate_id, r.conviction, r.consensus_prob,
            r.arbiter_confidence, r.headline, r.rationale, r.selected_pick_id,
            p.pick, p.matchup, p.result, p.odds_at_pick, p.game_date, p.oracle_confidence
     FROM   imperdible_runs r
     LEFT   JOIN picks p ON p.id = r.selected_pick_id
     WHERE  r.sport = 'nfl'
     ORDER  BY r.created_at DESC
     LIMIT  $1`,
    [limit],
  );
  return rows;
}
