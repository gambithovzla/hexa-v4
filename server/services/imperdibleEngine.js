/**
 * server/services/imperdibleEngine.js — orchestrator for the Pick Imperdible
 * mode (admin-only, MLB).
 *
 * Flow:
 *   1. Resolve the requested games; keep only those with CONFIRMED lineups.
 *   2. For each kept game: build context + features (reusing the existing,
 *      frozen Oracle/market pipeline by import, never mutation), generate every
 *      supported-market candidate via buildDeterministicSafePayload.
 *   3. Stage-1 conviction (model + market + variance + data quality) over all
 *      candidates; keep the top K across the whole slate.
 *   4. Stage-2: for those K, query the ML sidecar aligned to each pick and
 *      recompute conviction with the ML-agreement signal.
 *   5. Apply the hard gate. If none pass → PASS (no lock today).
 *   6. LLM arbiter audits the survivors and confirms one or vetoes.
 *   7. Persist the single lock to `picks` (source='imperdible') + a full
 *      `imperdible_runs` row (the slate dataset for the future model).
 *
 * Does NOT modify any frozen file — only imports from them.
 */

import pool from '../db.js';
import { getTodayGames } from '../mlb-api.js';
import { getGameOdds, matchOddsToGame, calculateImpliedProbability, getEventAlternates } from '../odds-api.js';
import { buildContext } from '../context-builder.js';
import { calculateParallelScore } from './xgboostValidator.js';
import { buildDeterministicSafePayload } from '../market-intelligence.js';
import { buildExtendedCandidates } from './extendedMarketCandidates.js';
import { buildPickAlignedMlOpinion } from './pickAlignedMl.js';
import { savePickFeatures } from '../feature-store.js';
import { arbitrateImperdible } from './imperdibleArbiter.js';
import {
  computeConviction,
  evaluateGate,
  rankCandidates,
  mlProbForPick,
  DEFAULT_THRESHOLDS,
} from './imperdibleSelector.js';

const TOP_K = Number(process.env.IMPERDIBLE_TOP_K) || 5;
const ML_TIMEOUT_MS = Number(process.env.ML_ADMIN_TIMEOUT_MS) || 2500;
const SOURCE = 'imperdible';

function buildShadowStatcastData(features = {}) {
  const savantBatters = features.savantBatters ?? { home: [], away: [] };
  const summarizeLineup = (batters) => {
    const withData = (batters ?? []).filter((b) => b?.savant?.xwOBA != null);
    if (!withData.length) return { avg_xwOBA: null, avg_woba_7d: null };
    const avg_xwOBA = withData.reduce((s, b) => s + Number(b.savant.xwOBA ?? 0), 0) / withData.length;
    const avg_woba_7d = withData.reduce((s, b) => {
      const rolling = b?.savant?.rolling_woba_7d ?? b?.savant?.rolling_windows?.woba_7d ?? b?.savant?.xwOBA ?? 0;
      return s + Number(rolling);
    }, 0) / withData.length;
    return { avg_xwOBA, avg_woba_7d };
  };
  return {
    homePitcher: features.homePitcherSavant ?? null,
    awayPitcher: features.awayPitcherSavant ?? null,
    homeLineup: summarizeLineup(savantBatters.home),
    awayLineup: summarizeLineup(savantBatters.away),
  };
}

function candidateId(gamePk, c) {
  const teamPart = c.team_side ? `:${c.team_side}` : '';
  return `${gamePk}:${c.market_type}${teamPart}:${c.side ?? 'na'}:${c.line ?? 'na'}`;
}

function americanToDecimal(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

/**
 * Half-Kelly stake (fraction of bankroll), capped at 5%. Conservative because
 * a lock is meant to be staked heavily but never recklessly.
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
  return Math.round(Math.min(0.05, 0.5 * kelly) * 1000) / 1000;
}

async function buildGameCandidates({ gameData, date, allOdds, lang }) {
  let matchedOdds = null;
  try {
    matchedOdds = matchOddsToGame(allOdds, gameData.teams?.home?.name, gameData.teams?.away?.name);
  } catch { /* optional */ }

  const contextResult = await buildContext(gameData, matchedOdds);
  const context = contextResult.context ?? contextResult;
  const features = contextResult._features ?? {};
  const statcast = buildShadowStatcastData(features);
  const xgboostResult = calculateParallelScore(statcast, gameData);

  const safePayload = buildDeterministicSafePayload({
    gameData,
    features,
    oddsData: matchedOdds ?? features?.oddsData ?? null,
    xgboostResult,
    lang,
    llmData: null,
    marketFocus: 'all',
  });

  // Fetch the alt-line + team-totals menu for this event (Postgres-cached,
  // 6h TTL). Failure is non-fatal — extended candidates still get generated
  // with model-only probabilities and no market price attached.
  let alternates = null;
  if (matchedOdds?.eventId) {
    try {
      alternates = await getEventAlternates(matchedOdds.eventId);
    } catch (err) {
      console.warn(`[imperdible] getEventAlternates failed for ${matchedOdds.eventId}: ${err.message}`);
    }
  }

  const extended = buildExtendedCandidates({
    gameData,
    features,
    mainCandidates: safePayload.safe_candidates ?? [],
    alternates,
    extendedProps: null,
    lang,
  });

  const homeAbbr = gameData.teams?.home?.abbreviation ?? 'HOME';
  const awayAbbr = gameData.teams?.away?.abbreviation ?? 'AWAY';
  const matchup = `${awayAbbr} @ ${homeAbbr}`;
  const lineupConfirmed = gameData.lineupStatus === 'confirmed';
  const dataQuality = features?.dataQuality?.score ?? null;

  // Combine main candidates (with market_source='main') and extended ones.
  const allRaw = [
    ...(safePayload.safe_candidates ?? []).map((c) => ({ ...c, market_source: c.market_source ?? 'main' })),
    ...extended,
  ];

  const candidates = allRaw.map((c) => ({
    candidateId: candidateId(gameData.gamePk, c),
    gamePk: gameData.gamePk,
    matchup,
    pick: c.pick,
    type: c.type,
    marketType: c.market_type,
    propKind: c.prop_kind ?? null,
    side: c.side ?? null,
    teamSide: c.team_side ?? null,
    line: c.line ?? null,
    odds: c.odds ?? null,
    modelProbability: c.hit_probability ?? c.model_probability ?? null,
    impliedProbability: c.implied_probability ?? null,
    marketSource: c.market_source ?? 'main',
    autoResolvable: c.auto_resolvable !== false,
    reasoning: c.reasoning ?? '',
    lineupConfirmed,
    dataQuality,
    raw: c,
  }));

  return {
    gamePk: gameData.gamePk,
    matchup,
    context,
    features,
    statcast,
    xgboostResult,
    safePayload,
    extended,
    alternates,
    gameData,
    lineupConfirmed,
    candidates,
  };
}

function scoreStage1(candidate) {
  const score = computeConviction({
    modelProb: candidate.modelProbability,
    impliedProb: candidate.impliedProbability,
    mlProb: null,
    dataQuality: candidate.dataQuality,
    marketType: candidate.marketType,
    propKind: candidate.propKind,
    lineupConfirmed: candidate.lineupConfirmed,
    marketSource: candidate.marketSource,
  });
  return { ...candidate, ...score };
}

async function attachMlSignal(candidate, gameBundle) {
  const synthAnalysis = {
    safe_pick: { pick: candidate.pick, hit_probability: candidate.modelProbability },
    best_pick: { type: candidate.type, detail: candidate.pick, confidence: (candidate.modelProbability ?? 0) / 100 },
  };
  try {
    const { mlOpinion } = await buildPickAlignedMlOpinion({
      analysisData: synthAnalysis,
      gameData: gameBundle.gameData,
      statcastData: gameBundle.statcast,
      features: gameBundle.features,
      xgboostResult: gameBundle.xgboostResult,
      admin: true,
    });
    const ml = mlProbForPick({ prob: mlOpinion?.python?.prob, agree: mlOpinion?.agree?.python });
    return { mlProb: ml, mlOpinion };
  } catch (err) {
    console.warn(`[imperdible] ML alignment failed for ${candidate.candidateId}: ${err.message}`);
    return { mlProb: null, mlOpinion: null };
  }
}

function scoreStage2(candidate, mlProb) {
  const score = computeConviction({
    modelProb: candidate.modelProbability,
    impliedProb: candidate.impliedProbability,
    mlProb,
    dataQuality: candidate.dataQuality,
    marketType: candidate.marketType,
    propKind: candidate.propKind,
    lineupConfirmed: candidate.lineupConfirmed,
    marketSource: candidate.marketSource,
  });
  return { ...candidate, ...score };
}

/**
 * Main entry. Returns the full analysis result (does not require persistence).
 */
export async function analyzeImperdible({ gameIds, date, lang = 'en', thresholds = {} }) {
  const resolvedDate = date || new Date().toISOString().split('T')[0];
  // Caller-supplied thresholds are partial overrides — evaluateGate auto-
  // selects the right profile per candidate (main vs extended) and merges
  // these on top. So we pass `thresholds` as-is rather than pre-merging
  // with DEFAULT_THRESHOLDS (which would clobber the extended profile).
  const gateOverrides = thresholds && typeof thresholds === 'object' ? thresholds : {};

  let games = await getTodayGames(resolvedDate);
  if (!games.length) {
    const today = new Date().toISOString().split('T')[0];
    if (today !== resolvedDate) games = await getTodayGames(today);
  }

  const requested = games.filter((g) => gameIds.map(String).includes(String(g.gamePk)));
  if (requested.length === 0) {
    return { verdict: 'PASS', reason: 'no_games_found', imperdible: null, slate: [], excluded: [] };
  }

  const confirmed = requested.filter((g) => g.lineupStatus === 'confirmed');
  const excluded = requested
    .filter((g) => g.lineupStatus !== 'confirmed')
    .map((g) => ({
      gamePk: g.gamePk,
      matchup: `${g.teams?.away?.abbreviation ?? '?'} @ ${g.teams?.home?.abbreviation ?? '?'}`,
      lineupStatus: g.lineupStatus ?? 'unavailable',
    }));

  if (confirmed.length === 0) {
    return {
      verdict: 'PASS',
      reason: 'no_confirmed_lineups',
      imperdible: null,
      slate: [],
      excluded,
      slateSize: requested.length,
    };
  }

  let allOdds = [];
  try { allOdds = await getGameOdds({ date: resolvedDate }); } catch { /* optional */ }

  const settled = await Promise.allSettled(
    confirmed.map((gameData) => buildGameCandidates({ gameData, date: resolvedDate, allOdds, lang })),
  );
  const gameBundles = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
  const bundleByGamePk = new Map(gameBundles.map((b) => [String(b.gamePk), b]));

  const allCandidates = gameBundles.flatMap((b) => b.candidates);
  if (allCandidates.length === 0) {
    return { verdict: 'PASS', reason: 'no_candidates', imperdible: null, slate: [], excluded, slateSize: confirmed.length };
  }

  // Stage 1: deterministic conviction without ML.
  const stage1 = rankCandidates(allCandidates.map(scoreStage1));
  const topK = stage1.slice(0, TOP_K);

  // Stage 2: ML-aligned conviction for the survivors only. Skip for
  // extended candidates — the Python sidecar was trained on main markets,
  // so applying its prob to ATL +5.5 or Under 13.5 produces noise that
  // gets mis-read as model/market disagreement.
  const stage2 = [];
  for (const candidate of topK) {
    if (candidate.marketSource === 'extended') {
      stage2.push({ ...scoreStage2(candidate, null), mlOpinion: null });
      continue;
    }
    const bundle = bundleByGamePk.get(String(candidate.gamePk));
    const { mlProb, mlOpinion } = await attachMlSignal(candidate, bundle);
    stage2.push({ ...scoreStage2(candidate, mlProb), mlOpinion });
  }
  const ranked = rankCandidates(stage2);

  // Hard gate. Filter out candidates whose market type cannot be resolved
  // automatically yet (e.g. team_total) — they remain in the slate dataset
  // for the future model but cannot become the final lock.
  const gated = ranked.map((c) => {
    const baseGate = evaluateGate(c, gateOverrides);
    const failed = [...baseGate.failedReasons];
    if (c.autoResolvable === false) failed.push('market_not_auto_resolvable');
    return { ...c, gate: { pass: failed.length === 0, failedReasons: failed } };
  });
  const eligible = gated.filter((c) => c.gate.pass);

  if (eligible.length === 0) {
    return {
      verdict: 'PASS',
      reason: 'gate_not_cleared',
      imperdible: null,
      slate: gated,
      excluded,
      slateSize: confirmed.length,
      bestRejected: gated[0] ?? null,
    };
  }

  // LLM arbiter on the eligible survivors (cap to 3).
  const arbiterCandidates = eligible.slice(0, 3);
  const gameContexts = arbiterCandidates
    .map((c) => bundleByGamePk.get(String(c.gamePk)))
    .filter((b, i, arr) => b && arr.indexOf(b) === i)
    .map((b) => ({ gamePk: b.gamePk, matchup: b.matchup, context: b.context }));

  const verdict = await arbitrateImperdible({ candidates: arbiterCandidates, gameContexts, lang });

  if (verdict.verdict !== 'CONFIRM' || !verdict.selected_candidate_id) {
    return {
      verdict: 'PASS',
      reason: 'arbiter_veto',
      imperdible: null,
      slate: gated,
      excluded,
      slateSize: confirmed.length,
      arbiter: verdict,
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
      arbiterConfidence: verdict.confidence,
      headline: verdict.headline,
      rationale: verdict.rationale,
      recommendedStakeFraction: stakeFraction,
    },
    arbiter: verdict,
    slate: gated,
    excluded,
    slateSize: confirmed.length,
    bundle,
    resolvedDate,
  };
}

/**
 * Persist a confirmed lock: one row in `picks` (source='imperdible') + one row
 * in `imperdible_runs` capturing the whole analyzed slate, plus pick_features
 * for the selected pick (isolated by source so it never pollutes MLB training).
 */
export async function persistImperdible({ result, userId, userEmail = null, lang = 'en' }) {
  if (!result || result.verdict !== 'CONFIRM' || !result.imperdible) {
    // Still record PASS runs for the dataset / audit trail.
    await recordRun({ result, userId, pickId: null, lang });
    return { savedPick: null };
  }

  const lock = result.imperdible;
  const bundle = result.bundle;
  const oddsAtPick = lock.odds ?? null;
  const impliedAtPick = oddsAtPick != null ? calculateImpliedProbability(oddsAtPick) : null;
  const oracleConfidence = Math.round(lock.consensusProb ?? lock.modelProbability ?? 0);

  const bestPick = { type: lock.type, detail: lock.pick, confidence: (lock.consensusProb ?? 0) / 100 };
  const valueBreakdown = {
    market_type: lock.marketType,
    odds: oddsAtPick,
    model_probability: lock.components?.modelProb ?? null,
    implied_probability: lock.components?.impliedProb ?? null,
    consensus_probability: lock.consensusProb,
    conviction: lock.conviction,
    ml_probability: lock.components?.mlProb ?? null,
    variance_penalty: lock.variancePenalty,
    recommended_stake_fraction: lock.recommendedStakeFraction,
  };

  const insertPick = await pool.query(
    `INSERT INTO picks (
       user_id, type, source, matchup, pick, oracle_confidence, bet_value, model_risk,
       oracle_report, alert_flags, best_pick, model, language,
       odds_at_pick, implied_prob_at_pick, odds_details, game_pk, game_date,
       value_breakdown, safe_candidates, selection_method, user_email, sport, pick_time_lima
     )
     VALUES ($1,'imperdible','imperdible',$2,$3,$4,$5,$6,$7,$8,$9,'deep',$10,$11,$12,$13,$14,$15,$16,$17,'imperdible_arbiter_v1',$18,'mlb',(NOW() AT TIME ZONE 'America/Lima')::TIMESTAMP)
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
      lock.gamePk,
      result.resolvedDate ?? null,
      JSON.stringify(valueBreakdown),
      JSON.stringify(result.slate?.map((c) => ({
        candidateId: c.candidateId, pick: c.pick, marketType: c.marketType,
        conviction: c.conviction, consensusProb: c.consensusProb, gate: c.gate,
      })) ?? []),
      userEmail,
    ],
  );

  const savedPick = insertPick.rows[0] ?? null;

  if (savedPick && bundle) {
    try {
      await savePickFeatures({
        pickId: savedPick.id,
        gamePk: Number(lock.gamePk),
        gameDate: result.resolvedDate ?? null,
        ...bundle.features,
        oddsData: bundle.features?.oddsData ?? null,
        pick: savedPick.pick,
        result: savedPick.result,
        userEmail,
        sport: 'mlb',
        source: SOURCE,
      });
    } catch (err) {
      console.warn(`[imperdible] savePickFeatures failed: ${err.message}`);
    }
  }

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
       VALUES ($1,'mlb',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        userId,
        lang,
        (result.slate ?? []).map((c) => c.gamePk).filter((v, i, a) => a.indexOf(v) === i),
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
          propKind: c.propKind, odds: c.odds, conviction: c.conviction, consensusProb: c.consensusProb,
          components: c.components, agreement: c.agreement, variancePenalty: c.variancePenalty,
          gate: c.gate,
        }))),
        result.arbiter ? JSON.stringify(result.arbiter) : null,
        JSON.stringify(result.excluded ?? []),
      ],
    );
  } catch (err) {
    console.warn(`[imperdible] recordRun failed: ${err.message}`);
  }
}

export async function getImperdibleHistory({ limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT r.id, r.created_at, r.lang, r.slate_size, r.verdict, r.reason,
            r.selected_candidate_id, r.conviction, r.consensus_prob,
            r.arbiter_confidence, r.headline, r.rationale, r.selected_pick_id,
            p.pick, p.matchup, p.result, p.odds_at_pick, p.game_date, p.oracle_confidence
     FROM   imperdible_runs r
     LEFT   JOIN picks p ON p.id = r.selected_pick_id
     ORDER  BY r.created_at DESC
     LIMIT  $1`,
    [limit],
  );
  return rows;
}
