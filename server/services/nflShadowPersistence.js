/**
 * server/services/nflShadowPersistence.js
 *
 * Persists per-pick NFL features into `pick_features` (sport='nfl') and records
 * a deterministic NFL shadow-validator run into `shadow_model_runs` (sport='nfl').
 * Both are fire-and-forget — a failure here must never break the pick flow.
 *
 * Mirrors nbaShadowPersistence.js; uses the NFL pick_features columns added in
 * runNflDatasetMigrations() (epa, rest, short-week/off-bye, qb active, weather,
 * spread/total close, severe injuries).
 */

import pool from '../db.js';
import {
  calculateNflShadowScore,
  NFL_SHADOW_MODEL_KEY,
  NFL_SHADOW_MODEL_VERSION,
} from './nflShadowValidator.js';
import {
  buildNflFeaturePayload,
  predictNflMoneyline,
  predictNflSpread,
} from './nflMlClient.js';

const SEVERE_QB = new Set(['out', 'out_for_season', 'doubtful']);

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeMarketType(rawPick) {
  if (!rawPick) return null;
  const text = String(rawPick).toLowerCase();
  if (/\bml\b|moneyline/.test(text)) return 'moneyline';
  if (/\bspread\b|-\d|\+\d/.test(text)) return 'spread';
  if (/\bover\b|\bunder\b|total/.test(text)) return 'total';
  return null;
}

// A starting QB is "active" unless flagged out/doubtful; null status = assume active.
function qbActive(side) {
  const key = side?.qbStatus?.statusKey;
  if (!key) return true;
  return !SEVERE_QB.has(key);
}

/**
 * Insert a pick_features row for an NFL pick. Returns the new row id or null.
 */
export async function saveNflPickFeatures({
  pickId,
  gamePk,
  gameDate,
  context,
  gameMeta,
  marketOdds,
  pickText,
  oracleConfidence,
  userEmail,
}) {
  if (pickId == null) return null;

  const home = context?.home ?? {};
  const away = context?.away ?? {};
  const weather = context?.weather ?? {};

  const marketType = normalizeMarketType(pickText);
  const overallCompleteness = toNumber(context?.context_meta?.overallCompleteness);

  const oddsMlHome  = toNumber(marketOdds?.moneyline?.home);
  const oddsMlAway  = toNumber(marketOdds?.moneyline?.away);
  const oddsOuTotal = toNumber(marketOdds?.total?.line);
  const spreadClose = toNumber(marketOdds?.spread?.home);
  const totalClose  = toNumber(marketOdds?.total?.line);
  const windMph     = weather?.dome ? null : toNumber(weather?.windSpeed);
  const isDome      = weather?.dome === true;

  try {
    const { rows } = await pool.query(
      `INSERT INTO pick_features (
         pick_id, game_pk, game_date,
         home_team_id, away_team_id, home_team_abbr, away_team_abbr,
         home_epa_off, away_epa_off, home_epa_def, away_epa_def,
         home_success_rate, away_success_rate, home_proe, away_proe,
         home_pace, away_pace,
         home_rest_days, away_rest_days,
         home_is_short_week, away_is_short_week,
         home_is_off_bye, away_is_off_bye,
         qb_home_active, qb_away_active,
         wind_mph, is_dome, spread_close, total_close,
         injuries_home_severe, injuries_away_severe,
         context_completeness,
         odds_ml_home, odds_ml_away, odds_ou_total,
         oracle_confidence, market_type,
         pick, source, sport, user_email
       )
       VALUES (
         $1,$2,$3,
         $4,$5,$6,$7,
         $8,$9,$10,$11,
         $12,$13,$14,$15,
         $16,$17,
         $18,$19,
         $20,$21,
         $22,$23,
         $24,$25,
         $26,$27,$28,$29,
         $30,$31,
         $32,
         $33,$34,$35,
         $36,$37,
         $38,'live','nfl',$39
       )
       RETURNING id`,
      [
        pickId,
        toNumber(gamePk),
        gameDate ?? null,
        toNumber(gameMeta?.homeTeamId), toNumber(gameMeta?.awayTeamId),
        gameMeta?.homeAbbr ?? home.teamAbbr ?? null,
        gameMeta?.awayAbbr ?? away.teamAbbr ?? null,
        toNumber(home.epaOff), toNumber(away.epaOff),
        toNumber(home.epaDef), toNumber(away.epaDef),
        toNumber(home.successRateOff), toNumber(away.successRateOff),
        toNumber(home.proe), toNumber(away.proe),
        toNumber(home.pace), toNumber(away.pace),
        toNumber(home.restDays), toNumber(away.restDays),
        home.isShortWeek ?? null, away.isShortWeek ?? null,
        home.isOffBye ?? null, away.isOffBye ?? null,
        qbActive(home), qbActive(away),
        windMph, isDome, spreadClose, totalClose,
        toNumber(home.injuries?.severeCount) ?? 0,
        toNumber(away.injuries?.severeCount) ?? 0,
        overallCompleteness,
        oddsMlHome, oddsMlAway, oddsOuTotal,
        toNumber(oracleConfidence),
        marketType,
        pickText ?? null,
        userEmail ?? null,
      ]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.warn(`[nflShadowPersistence] saveNflPickFeatures failed: ${err.message}`);
    return null;
  }
}

/**
 * Run the deterministic NFL shadow validator and persist the comparison vs the
 * Oracle pick to shadow_model_runs (sport='nfl'). Returns the row id or null.
 */
export async function recordNflShadowRun({
  userId,
  userEmail,
  pickId,
  gamePk,
  gameDate,
  context,
  gameMeta,
  analysisData,
}) {
  if (pickId == null || gamePk == null) return null;

  let shadow;
  try {
    shadow = calculateNflShadowScore(context, gameMeta);
  } catch (err) {
    console.warn(`[nflShadowPersistence] validator failed: ${err.message}`);
    return null;
  }

  const home = context?.home ?? {};
  const away = context?.away ?? {};
  const mp   = analysisData?.master_prediction ?? {};
  const bp   = analysisData?.best_pick ?? {};

  const homeWins = toNumber(analysisData?.probability_model?.home_wins);
  const awayWins = toNumber(analysisData?.probability_model?.away_wins);
  const totalWins = (homeWins ?? 0) + (awayWins ?? 0);
  const oracleHomeProb = totalWins > 0 ? homeWins / totalWins : null;

  const oraclePredictedHome = oracleHomeProb != null ? oracleHomeProb >= 0.5 : null;
  const oraclePredictedId = oraclePredictedHome == null
    ? null
    : (oraclePredictedHome ? String(gameMeta?.homeTeamId ?? '') : String(gameMeta?.awayTeamId ?? ''));
  const oraclePredictedAbbr = oraclePredictedHome == null
    ? null
    : (oraclePredictedHome ? (gameMeta?.homeAbbr ?? null) : (gameMeta?.awayAbbr ?? null));

  const agree = oraclePredictedId && shadow.predicted_winner
    ? String(oraclePredictedId) === String(shadow.predicted_winner)
    : null;

  // Best-effort ML sidecar call — never throws
  let pythonPickProb = null;
  let pythonPickMarket = null;
  try {
    const marketType = normalizeMarketType(mp.pick ?? bp.detail ?? '');
    const features = buildNflFeaturePayload(context, gameMeta, analysisData?.market_odds ?? {});
    const pred = marketType === 'spread'
      ? await predictNflSpread(features)
      : await predictNflMoneyline(features);
    if (pred?.probability != null) {
      pythonPickProb = pred.probability;
      pythonPickMarket = marketType === 'spread' ? 'nfl_spread' : 'nfl_moneyline';
    }
  } catch {
    // sidecar unavailable — leave null
  }

  const featureSnapshot = {
    home_point_diff: toNumber(home.pointDiff),
    away_point_diff: toNumber(away.pointDiff),
    home_epa_off:    toNumber(home.epaOff),
    away_epa_off:    toNumber(away.epaOff),
    home_rest_days:  toNumber(home.restDays),
    away_rest_days:  toNumber(away.restDays),
    home_is_short_week: home.isShortWeek ?? null,
    away_is_short_week: away.isShortWeek ?? null,
    home_qb_status:  home.qbStatus?.statusKey ?? null,
    away_qb_status:  away.qbStatus?.statusKey ?? null,
    home_injuries_severe: toNumber(home.injuries?.severeCount) ?? 0,
    away_injuries_severe: toNumber(away.injuries?.severeCount) ?? 0,
    completeness:    toNumber(context?.context_meta?.overallCompleteness),
    breakdown:       shadow.breakdown ?? null,
  };

  try {
    const { rows } = await pool.query(
      `INSERT INTO shadow_model_runs (
         user_id, pick_id, source_type, analysis_mode, model_key, model_version,
         game_pk, game_date,
         home_team_id, away_team_id, home_team_abbr, away_team_abbr,
         oracle_pick, oracle_confidence, oracle_home_win_prob,
         oracle_predicted_winner_id, oracle_predicted_winner_abbr,
         shadow_score, shadow_confidence, shadow_home_win_prob,
         shadow_predicted_winner_id, shadow_predicted_winner_abbr,
         agree_with_oracle, actual_status, feature_snapshot,
         sport, user_email, pick_time_lima,
         python_pick_prob, python_pick_market
       )
       VALUES (
         $1,$2,'analysis','single',$3,$4,
         $5,$6,
         $7,$8,$9,$10,
         $11,$12,$13,
         $14,$15,
         $16,$17,$18,
         $19,$20,
         $21,'pending',$22,
         'nfl',$23,(NOW() AT TIME ZONE 'America/Lima')::TIMESTAMP,
         $24,$25
       )
       RETURNING id`,
      [
        userId ?? null,
        pickId,
        NFL_SHADOW_MODEL_KEY,
        NFL_SHADOW_MODEL_VERSION,
        toNumber(gamePk),
        gameDate ?? null,
        toNumber(gameMeta?.homeTeamId),
        toNumber(gameMeta?.awayTeamId),
        gameMeta?.homeAbbr ?? home.teamAbbr ?? null,
        gameMeta?.awayAbbr ?? away.teamAbbr ?? null,
        mp.pick ?? bp.detail ?? null,
        toNumber(mp.oracle_confidence),
        oracleHomeProb,
        oraclePredictedId,
        oraclePredictedAbbr,
        toNumber(shadow.score),
        toNumber(shadow.confidence),
        toNumber(shadow.score) != null ? toNumber(shadow.score) / 100 : null,
        shadow.predicted_winner != null ? String(shadow.predicted_winner) : null,
        shadow.predicted_winner_abbr ?? null,
        agree,
        JSON.stringify(featureSnapshot),
        userEmail ?? null,
        pythonPickProb,
        pythonPickMarket,
      ]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.warn(`[nflShadowPersistence] recordNflShadowRun failed: ${err.message}`);
    return null;
  }
}
