import pool from './db.js';

const DISABLED_VALUES = new Set(['0', 'false', 'off', 'no']);
const SHADOW_MODE_ENABLED = !DISABLED_VALUES.has(String(process.env.SHADOW_MODE_ENABLED ?? 'true').toLowerCase());
const SHADOW_MODE_MODEL_KEY = String(process.env.SHADOW_MODE_MODEL_KEY ?? 'xgboost_validator_v1');
const SHADOW_MODE_MODEL_VERSION = String(process.env.SHADOW_MODE_MODEL_VERSION ?? '1');

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAbbr(value, fallback = null) {
  const text = String(value ?? '').trim().toUpperCase();
  return text || fallback;
}

function normalizeOutcomeStatus(status) {
  const value = String(status ?? '').trim().toLowerCase();
  if (!value) return 'pending';
  if (value === 'final' || value === 'resolved') return 'resolved';
  return value;
}

function deriveOracleHomeWinProb(analysisData) {
  const homeWins = toNumber(analysisData?.probability_model?.home_wins);
  const awayWins = toNumber(analysisData?.probability_model?.away_wins);
  if (homeWins == null || awayWins == null) return null;
  const total = homeWins + awayWins;
  if (total <= 0) return null;
  return homeWins / total;
}

function deriveOraclePrediction(analysisData, gameData) {
  const homeWinProb = deriveOracleHomeWinProb(analysisData);
  if (homeWinProb == null) {
    return {
      homeWinProb: null,
      predictedWinnerId: null,
      predictedWinnerAbbr: null,
    };
  }

  const homeTeamId = String(gameData?.teams?.home?.id ?? '');
  const awayTeamId = String(gameData?.teams?.away?.id ?? '');
  const homeAbbr = normalizeAbbr(gameData?.teams?.home?.abbreviation, 'HOME');
  const awayAbbr = normalizeAbbr(gameData?.teams?.away?.abbreviation, 'AWAY');
  const homeWins = homeWinProb >= 0.5;

  return {
    homeWinProb,
    predictedWinnerId: homeWins ? homeTeamId : awayTeamId,
    predictedWinnerAbbr: homeWins ? homeAbbr : awayAbbr,
  };
}

function buildFeatureSnapshot(statcastData, features = {}) {
  return {
    home_pitcher_xwoba: toNumber(statcastData?.homePitcher?.xwOBA_against ?? features?.homePitcherSavant?.xwOBA_against),
    away_pitcher_xwoba: toNumber(statcastData?.awayPitcher?.xwOBA_against ?? features?.awayPitcherSavant?.xwOBA_against),
    home_pitcher_whiff: toNumber(statcastData?.homePitcher?.whiff_percent ?? features?.homePitcherSavant?.whiff_percent),
    away_pitcher_whiff: toNumber(statcastData?.awayPitcher?.whiff_percent ?? features?.awayPitcherSavant?.whiff_percent),
    home_lineup_avg_xwoba: toNumber(statcastData?.homeLineup?.avg_xwOBA),
    away_lineup_avg_xwoba: toNumber(statcastData?.awayLineup?.avg_xwOBA),
    home_lineup_avg_woba_7d: toNumber(statcastData?.homeLineup?.avg_woba_7d),
    away_lineup_avg_woba_7d: toNumber(statcastData?.awayLineup?.avg_woba_7d),
    data_quality_score: toNumber(features?.dataQuality?.score),
    signal_coherence_score: toNumber(features?.signalCoherence?.coherenceScore),
  };
}

function buildActualOutcome({ gameData, actualResult, homeScore, awayScore }) {
  const home = gameData?.teams?.home ?? {};
  const away = gameData?.teams?.away ?? {};
  const parsedHomeScore = toNumber(homeScore ?? home?.score);
  const parsedAwayScore = toNumber(awayScore ?? away?.score);

  if (parsedHomeScore == null || parsedAwayScore == null) {
    return {
      actualWinnerId: null,
      actualWinnerAbbr: null,
      actualHomeScore: null,
      actualAwayScore: null,
      actualStatus: normalizeOutcomeStatus(actualResult),
    };
  }

  if (parsedHomeScore === parsedAwayScore) {
    return {
      actualWinnerId: null,
      actualWinnerAbbr: null,
      actualHomeScore: parsedHomeScore,
      actualAwayScore: parsedAwayScore,
      actualStatus: 'push',
    };
  }

  const homeWins = parsedHomeScore > parsedAwayScore;
  return {
    actualWinnerId: String(homeWins ? home?.id ?? '' : away?.id ?? ''),
    actualWinnerAbbr: normalizeAbbr(homeWins ? home?.abbreviation : away?.abbreviation),
    actualHomeScore: parsedHomeScore,
    actualAwayScore: parsedAwayScore,
    actualStatus: 'resolved',
  };
}

function buildPayload({
  userId = null,
  pickId = null,
  backtestId = null,
  sourceType = 'analysis',
  analysisMode = 'single',
  gameData,
  gameDate,
  analysisData,
  xgboostResult,
  statcastData = null,
  features = {},
  actual = null,
}) {
  const home = gameData?.teams?.home ?? {};
  const away = gameData?.teams?.away ?? {};
  const oracle = deriveOraclePrediction(analysisData, gameData);
  const agreeWithOracle = oracle.predictedWinnerId && xgboostResult?.predicted_winner
    ? String(oracle.predictedWinnerId) === String(xgboostResult.predicted_winner)
    : null;
  const masterPrediction = analysisData?.master_prediction ?? {};

  return {
    user_id: userId,
    pick_id: pickId,
    backtest_id: backtestId,
    source_type: sourceType,
    analysis_mode: analysisMode,
    model_key: SHADOW_MODE_MODEL_KEY,
    model_version: SHADOW_MODE_MODEL_VERSION,
    game_pk: toNumber(gameData?.gamePk),
    game_date: gameDate ?? null,
    home_team_id: toNumber(home?.id),
    away_team_id: toNumber(away?.id),
    home_team_abbr: normalizeAbbr(home?.abbreviation, 'HOME'),
    away_team_abbr: normalizeAbbr(away?.abbreviation, 'AWAY'),
    oracle_pick: masterPrediction.pick ?? null,
    oracle_confidence: toNumber(masterPrediction.oracle_confidence),
    oracle_home_win_prob: oracle.homeWinProb,
    oracle_predicted_winner_id: oracle.predictedWinnerId,
    oracle_predicted_winner_abbr: oracle.predictedWinnerAbbr,
    shadow_score: toNumber(xgboostResult?.score),
    shadow_confidence: toNumber(xgboostResult?.confidence),
    shadow_home_win_prob: toNumber(xgboostResult?.score) != null ? toNumber(xgboostResult?.score) / 100 : null,
    shadow_predicted_winner_id: xgboostResult?.predicted_winner ? String(xgboostResult.predicted_winner) : null,
    shadow_predicted_winner_abbr: normalizeAbbr(xgboostResult?.predicted_winner_abbr),
    agree_with_oracle: agreeWithOracle,
    actual_winner_id: actual?.actualWinnerId ?? null,
    actual_winner_abbr: actual?.actualWinnerAbbr ?? null,
    actual_home_score: actual?.actualHomeScore ?? null,
    actual_away_score: actual?.actualAwayScore ?? null,
    actual_status: normalizeOutcomeStatus(actual?.actualStatus),
    feature_snapshot: buildFeatureSnapshot(statcastData, features),
  };
}

async function findExistingShadowRun({ pickId, backtestId }) {
  if (pickId != null) {
    const result = await pool.query(
      'SELECT id FROM shadow_model_runs WHERE pick_id = $1 AND model_key = $2 LIMIT 1',
      [pickId, SHADOW_MODE_MODEL_KEY]
    );
    return result.rows[0]?.id ?? null;
  }

  if (backtestId != null) {
    const result = await pool.query(
      'SELECT id FROM shadow_model_runs WHERE backtest_id = $1 AND model_key = $2 LIMIT 1',
      [backtestId, SHADOW_MODE_MODEL_KEY]
    );
    return result.rows[0]?.id ?? null;
  }

  return null;
}

export function isShadowModeEnabled() {
  return SHADOW_MODE_ENABLED;
}

export function getShadowModeConfig() {
  return {
    enabled: SHADOW_MODE_ENABLED,
    modelKey: SHADOW_MODE_MODEL_KEY,
    modelVersion: SHADOW_MODE_MODEL_VERSION,
  };
}

export async function recordShadowModelRun(params) {
  if (!SHADOW_MODE_ENABLED) return null;
  if (!params?.analysisData || !params?.xgboostResult || !params?.gameData?.gamePk) return null;

  const payload = buildPayload(params);
  const existingId = await findExistingShadowRun({
    pickId: payload.pick_id,
    backtestId: payload.backtest_id,
  });

  if (existingId) {
    await pool.query(
      `UPDATE shadow_model_runs
       SET user_id = $1,
           source_type = $2,
           analysis_mode = $3,
           model_version = $4,
           game_pk = $5,
           game_date = $6,
           home_team_id = $7,
           away_team_id = $8,
           home_team_abbr = $9,
           away_team_abbr = $10,
           oracle_pick = $11,
           oracle_confidence = $12,
           oracle_home_win_prob = $13,
           oracle_predicted_winner_id = $14,
           oracle_predicted_winner_abbr = $15,
           shadow_score = $16,
           shadow_confidence = $17,
           shadow_home_win_prob = $18,
           shadow_predicted_winner_id = $19,
           shadow_predicted_winner_abbr = $20,
           agree_with_oracle = $21,
           actual_winner_id = $22,
           actual_winner_abbr = $23,
           actual_home_score = $24,
           actual_away_score = $25,
           actual_status = $26,
           feature_snapshot = $27,
           updated_at = NOW()
       WHERE id = $28`,
      [
        payload.user_id,
        payload.source_type,
        payload.analysis_mode,
        payload.model_version,
        payload.game_pk,
        payload.game_date,
        payload.home_team_id,
        payload.away_team_id,
        payload.home_team_abbr,
        payload.away_team_abbr,
        payload.oracle_pick,
        payload.oracle_confidence,
        payload.oracle_home_win_prob,
        payload.oracle_predicted_winner_id,
        payload.oracle_predicted_winner_abbr,
        payload.shadow_score,
        payload.shadow_confidence,
        payload.shadow_home_win_prob,
        payload.shadow_predicted_winner_id,
        payload.shadow_predicted_winner_abbr,
        payload.agree_with_oracle,
        payload.actual_winner_id,
        payload.actual_winner_abbr,
        payload.actual_home_score,
        payload.actual_away_score,
        payload.actual_status,
        JSON.stringify(payload.feature_snapshot),
        existingId,
      ]
    );

    return { id: existingId, ...payload };
  }

  const insert = await pool.query(
    `INSERT INTO shadow_model_runs (
       user_id, pick_id, backtest_id, source_type, analysis_mode, model_key, model_version,
       game_pk, game_date, home_team_id, away_team_id, home_team_abbr, away_team_abbr,
       oracle_pick, oracle_confidence, oracle_home_win_prob, oracle_predicted_winner_id, oracle_predicted_winner_abbr,
       shadow_score, shadow_confidence, shadow_home_win_prob, shadow_predicted_winner_id, shadow_predicted_winner_abbr,
       agree_with_oracle, actual_winner_id, actual_winner_abbr, actual_home_score, actual_away_score,
       actual_status, feature_snapshot
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
     RETURNING id`,
    [
      payload.user_id,
      payload.pick_id,
      payload.backtest_id,
      payload.source_type,
      payload.analysis_mode,
      payload.model_key,
      payload.model_version,
      payload.game_pk,
      payload.game_date,
      payload.home_team_id,
      payload.away_team_id,
      payload.home_team_abbr,
      payload.away_team_abbr,
      payload.oracle_pick,
      payload.oracle_confidence,
      payload.oracle_home_win_prob,
      payload.oracle_predicted_winner_id,
      payload.oracle_predicted_winner_abbr,
      payload.shadow_score,
      payload.shadow_confidence,
      payload.shadow_home_win_prob,
      payload.shadow_predicted_winner_id,
      payload.shadow_predicted_winner_abbr,
      payload.agree_with_oracle,
      payload.actual_winner_id,
      payload.actual_winner_abbr,
      payload.actual_home_score,
      payload.actual_away_score,
      payload.actual_status,
      JSON.stringify(payload.feature_snapshot),
    ]
  );

  return { id: insert.rows[0]?.id ?? null, ...payload };
}

export async function updateShadowModelRunsForGame({
  gamePk,
  homeTeamId = null,
  awayTeamId = null,
  homeAbbr = null,
  awayAbbr = null,
  homeScore,
  awayScore,
}) {
  const parsedHomeScore = toNumber(homeScore);
  const parsedAwayScore = toNumber(awayScore);
  if (gamePk == null || parsedHomeScore == null || parsedAwayScore == null) return 0;

  let actualWinnerId = null;
  let actualWinnerAbbr = null;
  let actualStatus = 'push';
  if (parsedHomeScore !== parsedAwayScore) {
    const homeWins = parsedHomeScore > parsedAwayScore;
    actualWinnerId = String(homeWins ? homeTeamId ?? '' : awayTeamId ?? '');
    actualWinnerAbbr = normalizeAbbr(homeWins ? homeAbbr : awayAbbr);
    actualStatus = 'resolved';
  }

  const result = await pool.query(
    `UPDATE shadow_model_runs
     SET actual_winner_id = $1,
         actual_winner_abbr = $2,
         actual_home_score = $3,
         actual_away_score = $4,
         actual_status = $5,
         updated_at = NOW()
     WHERE game_pk = $6
       AND actual_status = 'pending'`,
    [actualWinnerId, actualWinnerAbbr, parsedHomeScore, parsedAwayScore, actualStatus, gamePk]
  );

  return result.rowCount ?? 0;
}

export async function getShadowModeDashboard(limit = 50) {
  const safeLimit = Math.max(10, Math.min(200, toNumber(limit) ?? 50));

  const [summaryRes, sourceRes, recentRes] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) AS total_runs,
        COUNT(*) FILTER (WHERE actual_status = 'pending') AS pending_runs,
        COUNT(*) FILTER (WHERE actual_status <> 'pending') AS resolved_runs,
        COUNT(*) FILTER (WHERE agree_with_oracle IS TRUE) AS agree_runs,
        COUNT(*) FILTER (WHERE agree_with_oracle IS FALSE) AS disagree_runs,
        COUNT(*) FILTER (WHERE actual_winner_id IS NOT NULL AND oracle_predicted_winner_id = actual_winner_id) AS oracle_correct,
        COUNT(*) FILTER (WHERE actual_winner_id IS NOT NULL AND shadow_predicted_winner_id = actual_winner_id) AS shadow_correct,
        COUNT(*) FILTER (WHERE actual_winner_id IS NOT NULL AND oracle_predicted_winner_id = actual_winner_id AND shadow_predicted_winner_id = actual_winner_id) AS both_correct,
        COUNT(*) FILTER (WHERE actual_winner_id IS NOT NULL AND oracle_predicted_winner_id = actual_winner_id AND shadow_predicted_winner_id <> actual_winner_id) AS oracle_only_correct,
        COUNT(*) FILTER (WHERE actual_winner_id IS NOT NULL AND shadow_predicted_winner_id = actual_winner_id AND oracle_predicted_winner_id <> actual_winner_id) AS shadow_only_correct
      FROM shadow_model_runs
    `),
    pool.query(`
      SELECT
        source_type,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE actual_status <> 'pending') AS resolved,
        COUNT(*) FILTER (WHERE agree_with_oracle IS FALSE) AS disagreements
      FROM shadow_model_runs
      GROUP BY source_type
      ORDER BY total DESC
    `),
    pool.query(
      `SELECT
         id, created_at, source_type, analysis_mode, game_pk, game_date,
         home_team_abbr, away_team_abbr,
         oracle_pick, oracle_confidence, oracle_predicted_winner_abbr,
         shadow_confidence, shadow_predicted_winner_abbr, agree_with_oracle,
         actual_winner_abbr, actual_home_score, actual_away_score, actual_status
       FROM shadow_model_runs
       ORDER BY created_at DESC
       LIMIT $1`,
      [safeLimit]
    ),
  ]);

  return {
    config: getShadowModeConfig(),
    summary: summaryRes.rows[0] ?? {},
    bySource: sourceRes.rows,
    recent: recentRes.rows,
  };
}

export function buildShadowActualOutcome(params) {
  return buildActualOutcome(params);
}
