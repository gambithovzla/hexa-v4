/**
 * server/services/soccerImperdibleEngine.js — orchestrator for the Soccer Pick
 * Imperdible mode (admin-only). The lock-of-the-slate for soccer.
 *
 * Mirrors nflImperdibleEngine.js but soccer-native (league-aware, date-based) and
 * touches NO frozen file:
 *   1. Resolve the requested matches for a league + date.
 *   2. For each: build context + 3-way market odds, query the pre-trained sidecar
 *      models (soccer_moneyline/total/btts) for side-aligned probabilities, run the
 *      independent deterministic shadow validator, and assess the lineup picture.
 *   3. Build 1X2 / total / BTTS candidates (the parlay candidate builder) and score
 *      conviction (model + market + validator + variance + data quality), gated on
 *      model-certified (no sidecar model → no lock). Lineup-confirmed is a soft gate
 *      (off until Sprint 11.3 wires API-Football).
 *   4. Apply the hard gate. If none pass → PASS (no lock today).
 *   5. LLM arbiter (Opus) audits the survivors and confirms one or vetoes.
 *   6. Persist the single lock to `picks` (source='imperdible', sport='soccer',
 *      league=…) — resolved automatically by the soccer pick resolver — plus a full
 *      `imperdible_runs` row (sport='soccer') as the slate dataset.
 *
 * NOTE: like NFL, this does not write pick_features here — the soccer pick_features
 * writer hardcodes source='live' and would pollute training. The picks row +
 * imperdible_runs row are the dataset for the future soccer lock model.
 */

import pool from '../db.js';
import { getSoccerGamesForDate } from '../soccer-api.js';
import { getSoccerGameOdds, matchSoccerOddsToGame, buildMarketOddsForGame } from '../soccer-odds.js';
import { buildSoccerGameContext } from '../soccer-context-builder.js';
import { buildSoccerGameCandidates } from './parlayEngine/soccerParlayCandidates.js';
import { predictSoccerGameModel } from './soccerMlClient.js';
import { calculateSoccerShadowScore } from './soccerShadowValidator.js';
import { serializeSoccerContext } from './oracleSoccer.js';
import {
  computeSoccerConviction,
  evaluateSoccerGate,
  rankSoccerCandidates,
} from './soccerImperdibleSelector.js';
import { arbitrateSoccerImperdible } from './soccerImperdibleArbiter.js';

const TOP_K = Number(process.env.IMPERDIBLE_TOP_K) || 5;

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
 * Half-Kelly stake (fraction of bankroll), capped at 3% — tighter than NFL (4%)
 * because soccer is the most efficient, lowest-edge market.
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
  return Math.round(Math.min(0.03, 0.5 * kelly) * 1000) / 1000;
}

/** Assess the lineup picture. Soccer lineups confirm only ~1h pre-kick; until
 * Sprint 11.3 (API-Football) there is no confirmed-lineup source, so this is
 * informational and the gate keeps requireLineupConfirmed=false by default. */
function assessLineupConfirmation(context) {
  const homeStatus = context?.home?.lineupStatus ?? 'unknown';
  const awayStatus = context?.away?.lineupStatus ?? 'unknown';
  const confirmed = homeStatus === 'confirmed' && awayStatus === 'confirmed';
  return {
    confirmed,
    detail: confirmed ? 'both lineups confirmed' : 'lineups confirm ~1h pre-kick (unconfirmed)',
    reason: confirmed ? null : 'lineup_unconfirmed',
  };
}

/** Side-aligned shadow-validator probability — moneyline only (where comparable).
 * Soccer shadow `score` is the home-win share (0-100); draw has no validator prob. */
function shadowProbForCandidate(candidate, shadow) {
  if (candidate.marketType !== 'moneyline') return null;
  if (candidate.side === 'draw') return null;
  const homeProb = shadow?.score;
  if (homeProb == null || !Number.isFinite(homeProb)) return null;
  return candidate.side === 'home' ? homeProb : 100 - homeProb;
}

/** Resolver-compatible pick text. The parlay builder emits "ARS Win" for a 1X2
 * home pick, which the soccer resolver doesn't parse; it expects
 * "<TeamName> Home/Away Win". Over/Under and BTTS labels are already fine. */
function lockPickText(candidate, bundle) {
  if (candidate.marketType === 'moneyline') {
    if (candidate.side === 'home') return `${bundle.homeName} Home Win`;
    if (candidate.side === 'away') return `${bundle.awayName} Away Win`;
    return 'Draw';
  }
  return candidate.pick;
}

async function buildGameBundle({ game, leagueSlug, oddsEvents }) {
  const homeName = game.teams?.home?.name;
  const awayName = game.teams?.away?.name;
  const ev = matchSoccerOddsToGame(oddsEvents, homeName, awayName);
  const odds = ev ? buildMarketOddsForGame(ev) : null;
  if (!odds) return null; // can't price a lock without a market

  const context = await buildSoccerGameContext({
    leagueSlug,
    homeTeamName: homeName,
    awayTeamName: awayName,
    homeTeamId: game.teams?.home?.id ?? null,
    awayTeamId: game.teams?.away?.id ?? null,
    gameDate: game.gameDate,
    marketOdds: odds,
  });

  const gameMeta = {
    homeTeamId: game.teams?.home?.id ?? null,
    awayTeamId: game.teams?.away?.id ?? null,
    homeAbbr: game.teams?.home?.abbreviation ?? null,
    awayAbbr: game.teams?.away?.abbreviation ?? null,
  };

  const model = await predictSoccerGameModel(context, gameMeta, odds);
  const modelCertified = model != null;
  const shadow = calculateSoccerShadowScore(context, gameMeta, odds);
  const lineup = assessLineupConfirmation(context);
  const dataQuality = Math.round((context?.context_meta?.overallCompleteness ?? 0.5) * 100);
  const matchup = `${gameMeta.awayAbbr ?? 'AWAY'} @ ${gameMeta.homeAbbr ?? 'HOME'}`;

  const rawCandidates = buildSoccerGameCandidates({
    gameId: String(game.gameId ?? game.gamePk),
    matchup,
    gameDate: game.gameDate,
    homeAbbr: gameMeta.homeAbbr,
    awayAbbr: gameMeta.awayAbbr,
    odds,
    model,
    dataQuality,
  });

  const candidates = rawCandidates.map((c) => ({
    ...c,
    lineupConfirmed: lineup.confirmed,
    lineupDetail: lineup.detail,
    modelCertified,
    mlProb: shadowProbForCandidate(c, shadow),
  }));

  return {
    gamePk: String(game.gameId ?? game.gamePk),
    matchup,
    homeName,
    awayName,
    leagueSlug,
    context,
    contextText: serializeSoccerContext({ context, marketOdds: odds }),
    odds,
    model,
    modelCertified,
    shadow,
    lineup,
    dataQuality,
    candidates,
  };
}

function scoreCandidate(candidate) {
  const score = computeSoccerConviction({
    modelProb: candidate.modelProbability,
    impliedProb: candidate.impliedProbability,
    mlProb: candidate.mlProb,
    dataQuality: candidate.dataQualityScore ?? candidate.dataQuality,
    marketType: candidate.marketType,
    lineupConfirmed: candidate.lineupConfirmed,
  });
  return { ...candidate, ...score };
}

/**
 * Main entry. Returns the full analysis result (does not require persistence).
 * @param {object} p
 * @param {string}   p.leagueSlug
 * @param {string}   p.date         YYYY-MM-DD
 * @param {string[]} p.gameIds      ESPN game ids to consider
 * @param {string}   [p.lang]
 * @param {object}   [p.thresholds] partial gate overrides
 */
export async function analyzeSoccerImperdible({ leagueSlug, date, gameIds, lang = 'en', thresholds = {} }) {
  const gateOverrides = thresholds && typeof thresholds === 'object' ? thresholds : {};
  const lookupDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const games = await getSoccerGamesForDate(leagueSlug, lookupDate);
  const requested = (games ?? []).filter((g) => gameIds.map(String).includes(String(g.gameId ?? g.gamePk)));
  if (requested.length === 0) {
    return { verdict: 'PASS', reason: 'no_games_found', imperdible: null, slate: [], excluded: [] };
  }

  let oddsEvents = [];
  try { oddsEvents = await getSoccerGameOdds({ leagueSlug, date: lookupDate }); } catch { /* optional */ }

  const settled = await Promise.allSettled(
    requested.map((game) => buildGameBundle({ game, leagueSlug, oddsEvents })),
  );
  const gameBundles = settled
    .filter((s) => s.status === 'fulfilled' && s.value)
    .map((s) => s.value);
  const bundleByGamePk = new Map(gameBundles.map((b) => [String(b.gamePk), b]));

  const pricedIds = new Set(gameBundles.map((b) => String(b.gamePk)));
  const excluded = requested
    .filter((g) => !pricedIds.has(String(g.gameId ?? g.gamePk)))
    .map((g) => ({
      gamePk: String(g.gameId ?? g.gamePk),
      matchup: `${g.teams?.away?.abbreviation ?? '?'} @ ${g.teams?.home?.abbreviation ?? '?'}`,
      reason: 'no_market_odds',
    }));

  const allCandidates = gameBundles.flatMap((b) => b.candidates);
  if (allCandidates.length === 0) {
    return { verdict: 'PASS', reason: 'no_candidates', imperdible: null, slate: [], excluded, slateSize: requested.length };
  }

  const ranked = rankSoccerCandidates(allCandidates.map(scoreCandidate));
  const topK = ranked.slice(0, TOP_K);

  const gated = topK.map((c) => ({ ...c, gate: evaluateSoccerGate(c, gateOverrides) }));
  const eligible = gated.filter((c) => c.gate.pass);

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
      resolvedDate: lookupDate,
    };
  }

  const arbiterCandidates = eligible.slice(0, 3);
  const gameContexts = arbiterCandidates
    .map((c) => bundleByGamePk.get(String(c.gamePk)))
    .filter((b, i, arr) => b && arr.indexOf(b) === i)
    .map((b) => ({ gamePk: b.gamePk, matchup: b.matchup, context: b.contextText }));

  const verdict = await arbitrateSoccerImperdible({ candidates: arbiterCandidates, gameContexts, lang });

  if (verdict.verdict !== 'CONFIRM' || !verdict.selected_candidate_id) {
    return {
      verdict: 'PASS',
      reason: 'arbiter_veto',
      imperdible: null,
      slate: fullSlate,
      excluded,
      slateSize: requested.length,
      arbiter: verdict,
      resolvedDate: lookupDate,
    };
  }

  const selected = eligible.find((c) => c.candidateId === verdict.selected_candidate_id) ?? eligible[0];
  const bundle = bundleByGamePk.get(String(selected.gamePk));
  const stakeFraction = recommendedStakeFraction(selected.consensusProb, selected.odds);

  return {
    verdict: 'CONFIRM',
    reason: 'confirmed',
    imperdible: {
      ...selected,
      pickText: lockPickText(selected, bundle ?? {}),
      leagueSlug,
      oddsDetails: bundle?.odds ?? null,
      arbiterConfidence: verdict.confidence,
      headline: verdict.headline,
      rationale: verdict.rationale,
      recommendedStakeFraction: stakeFraction,
    },
    arbiter: verdict,
    slate: fullSlate,
    excluded,
    slateSize: requested.length,
    resolvedDate: lookupDate,
  };
}

/**
 * Persist a confirmed soccer lock: one row in `picks` (source='imperdible',
 * sport='soccer', league=…) + one row in `imperdible_runs` (sport='soccer').
 * PASS runs are still recorded for the dataset / audit trail.
 */
export async function persistSoccerImperdible({ result, userId, userEmail = null, lang = 'en' }) {
  if (!result || result.verdict !== 'CONFIRM' || !result.imperdible) {
    await recordRun({ result, userId, pickId: null, lang });
    return { savedPick: null };
  }

  const lock = result.imperdible;
  const oddsAtPick = lock.odds ?? null;
  const impliedAtPick = oddsAtPick != null ? americanToImplied(oddsAtPick) : null;
  const oracleConfidence = Math.round(lock.consensusProb ?? lock.modelProbability ?? 0);
  const pickText = lock.pickText ?? lock.pick;

  const bestPick = { type: lock.type, detail: pickText, confidence: (lock.consensusProb ?? 0) / 100 };
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
    lineup_detail: lock.lineupDetail ?? null,
    recommended_stake_fraction: lock.recommendedStakeFraction,
  };

  const insertPick = await pool.query(
    `INSERT INTO picks (
       user_id, type, source, matchup, pick, oracle_confidence, bet_value, model_risk,
       oracle_report, alert_flags, best_pick, model, language,
       odds_at_pick, implied_prob_at_pick, odds_details, game_pk, game_date,
       value_breakdown, safe_candidates, selection_method, user_email, sport, league, pick_time_lima
     )
     VALUES ($1,'imperdible','imperdible',$2,$3,$4,$5,$6,$7,$8,$9,'deep',$10,$11,$12,$13,$14,$15,$16,$17,'soccer_imperdible_arbiter_v1',$18,'soccer',$19,(NOW() AT TIME ZONE 'America/Lima')::TIMESTAMP)
     RETURNING *`,
    [
      userId,
      lock.matchup,
      pickText,
      oracleConfidence,
      'LOCK',
      'low',
      lock.rationale ?? null,
      JSON.stringify(result.arbiter?.disqualifiers_checked ?? []),
      JSON.stringify(bestPick),
      lang,
      oddsAtPick,
      impliedAtPick,
      lock.oddsDetails ? JSON.stringify(lock.oddsDetails) : null,
      Number(lock.gamePk),
      result.resolvedDate ?? null,
      JSON.stringify(valueBreakdown),
      JSON.stringify((result.slate ?? []).map((c) => ({
        candidateId: c.candidateId, pick: c.pick, marketType: c.marketType,
        conviction: c.conviction, consensusProb: c.consensusProb, gate: c.gate,
      }))),
      userEmail,
      lock.leagueSlug ?? result.imperdible?.leagueSlug ?? null,
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
       VALUES ($1,'soccer',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
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
          lineupConfirmed: c.lineupConfirmed, modelCertified: c.modelCertified, gate: c.gate,
        }))),
        result.arbiter ? JSON.stringify(result.arbiter) : null,
        JSON.stringify(result.excluded ?? []),
      ],
    );
  } catch (err) {
    console.warn(`[soccer-imperdible] recordRun failed: ${err.message}`);
  }
}

export async function getSoccerImperdibleHistory({ limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT r.id, r.created_at, r.lang, r.slate_size, r.verdict, r.reason,
            r.selected_candidate_id, r.conviction, r.consensus_prob,
            r.arbiter_confidence, r.headline, r.rationale, r.selected_pick_id,
            p.pick, p.matchup, p.result, p.odds_at_pick, p.game_date, p.oracle_confidence, p.league
     FROM   imperdible_runs r
     LEFT   JOIN picks p ON p.id = r.selected_pick_id
     WHERE  r.sport = 'soccer'
     ORDER  BY r.created_at DESC
     LIMIT  $1`,
    [limit],
  );
  return rows;
}
