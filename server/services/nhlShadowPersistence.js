/**
 * server/services/nhlShadowPersistence.js
 *
 * Persists per-pick NHL features into `pick_features` (sport='nhl') and records
 * a deterministic NHL shadow-validator run into `shadow_model_runs` (sport='nhl').
 * Both are fire-and-forget — a failure here must never break the pick flow.
 *
 * Mirrors nbaShadowPersistence.js (no Python ML client — the NHL ML sidecar is a
 * later phase, like NBA 7e). Uses the NHL pick_features columns added in
 * runNhlDatasetMigrations() (goal diff, GF/GA per game, PP%/PK%, goalie
 * confirmed, back-to-back, puck-line close).
 */

import pool from '../db.js';
import {
  calculateNhlShadowScore,
  NHL_SHADOW_MODEL_KEY,
  NHL_SHADOW_MODEL_VERSION,
} from './nhlShadowValidator.js';

const SEVERE_GOALIE = new Set(['out', 'out_for_season', 'doubtful']);

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseWinsLocal(recentForm) {
  if (!recentForm?.record) return null;
  const match = String(recentForm.record).match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return null;
  const wins = Number(match[1]);
  return Number.isFinite(wins) ? wins : null;
}

function normalizeMarketType(rawPick) {
  if (!rawPick) return null;
  const text = String(rawPick).toLowerCase();
  if (/puck\s*line|\bpl\b/.test(text)) return 'puckline';
  if (/\bover\b|\bunder\b|total/.test(text)) return 'total';
  if (/\bml\b|moneyline/.test(text)) return 'moneyline';
  if (/[-+]\d/.test(text)) return 'puckline';
  return null;
}

// A starting goalie is "confirmed/active" unless flagged out/doubtful; null = assume active.
function goalieConfirmed(side) {
  const key = side?.goalieStatus?.statusKey;
  if (!key) return true;
  return !SEVERE_GOALIE.has(key);
}

/**
 * Insert a pick_features row for an NHL pick. Returns the new row id or null.
 */
export async function saveNhlPickFeatures({
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

  const marketType = normalizeMarketType(pickText);
  const overallCompleteness = toNumber(context?.context_meta?.overallCompleteness);

  const oddsMlHome  = toNumber(marketOdds?.moneyline?.home);
  const oddsMlAway  = toNumber(marketOdds?.moneyline?.away);
  const oddsOuTotal = toNumber(marketOdds?.total?.line);
  const puckLineClose = toNumber(marketOdds?.puckLine?.home);

  try {
    const { rows } = await pool.query(
      `INSERT INTO pick_features (
         pick_id, game_pk, game_date,
         home_team_id, away_team_id, home_team_abbr, away_team_abbr,
         home_goal_diff, away_goal_diff,
         home_gf_per_game, away_gf_per_game,
         home_ga_per_game, away_ga_per_game,
         home_pp_pct, away_pp_pct,
         home_pk_pct, away_pk_pct,
         home_points_pct, away_points_pct,
         home_rest_days, away_rest_days,
         home_is_b2b, away_is_b2b,
         goalie_home_confirmed, goalie_away_confirmed,
         home_injuries_severe, away_injuries_severe,
         home_last10_wins, away_last10_wins,
         context_completeness,
         odds_ml_home, odds_ml_away, odds_ou_total, puck_line_close,
         oracle_confidence, market_type,
         pick, source, sport, user_email
       )
       VALUES (
         $1,$2,$3,
         $4,$5,$6,$7,
         $8,$9,
         $10,$11,
         $12,$13,
         $14,$15,
         $16,$17,
         $18,$19,
         $20,$21,
         $22,$23,
         $24,$25,
         $26,$27,
         $28,$29,
         $30,
         $31,$32,$33,$34,
         $35,$36,
         $37,'live','nhl',$38
       )
       RETURNING id`,
      [
        pickId,
        toNumber(gamePk),
        gameDate ?? null,
        toNumber(gameMeta?.homeTeamId), toNumber(gameMeta?.awayTeamId),
        gameMeta?.homeAbbr ?? home.teamAbbr ?? null,
        gameMeta?.awayAbbr ?? away.teamAbbr ?? null,
        toNumber(home.goalDiff), toNumber(away.goalDiff),
        toNumber(home.goalsForPerGame), toNumber(away.goalsForPerGame),
        toNumber(home.goalsAgainstPerGame), toNumber(away.goalsAgainstPerGame),
        toNumber(home.ppPct), toNumber(away.ppPct),
        toNumber(home.pkPct), toNumber(away.pkPct),
        toNumber(home.pointsPct), toNumber(away.pointsPct),
        toNumber(home.restDays), toNumber(away.restDays),
        home.isBackToBack ?? null, away.isBackToBack ?? null,
        goalieConfirmed(home), goalieConfirmed(away),
        toNumber(home.injuries?.severeCount) ?? 0,
        toNumber(away.injuries?.severeCount) ?? 0,
        parseWinsLocal(home.recentForm),
        parseWinsLocal(away.recentForm),
        overallCompleteness,
        oddsMlHome, oddsMlAway, oddsOuTotal, puckLineClose,
        toNumber(oracleConfidence),
        marketType,
        pickText ?? null,
        userEmail ?? null,
      ]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.warn(`[nhlShadowPersistence] saveNhlPickFeatures failed: ${err.message}`);
    return null;
  }
}

/**
 * Run the deterministic NHL shadow validator and persist the comparison vs the
 * Oracle pick to shadow_model_runs (sport='nhl'). Returns the row id or null.
 */
export async function recordNhlShadowRun({
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
    shadow = calculateNhlShadowScore(context, gameMeta);
  } catch (err) {
    console.warn(`[nhlShadowPersistence] validator failed: ${err.message}`);
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

  const featureSnapshot = {
    home_goal_diff:  toNumber(home.goalDiff),
    away_goal_diff:  toNumber(away.goalDiff),
    home_gf_per_game: toNumber(home.goalsForPerGame),
    away_gf_per_game: toNumber(away.goalsForPerGame),
    home_ga_per_game: toNumber(home.goalsAgainstPerGame),
    away_ga_per_game: toNumber(away.goalsAgainstPerGame),
    home_pp_pct:     toNumber(home.ppPct),
    away_pp_pct:     toNumber(away.ppPct),
    home_pk_pct:     toNumber(home.pkPct),
    away_pk_pct:     toNumber(away.pkPct),
    home_rest_days:  toNumber(home.restDays),
    away_rest_days:  toNumber(away.restDays),
    home_is_b2b:     home.isBackToBack ?? null,
    away_is_b2b:     away.isBackToBack ?? null,
    home_goalie_status: home.goalieStatus?.statusKey ?? null,
    away_goalie_status: away.goalieStatus?.statusKey ?? null,
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
         sport, user_email, pick_time_lima
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
         'nhl',$23,(NOW() AT TIME ZONE 'America/Lima')::TIMESTAMP
       )
       RETURNING id`,
      [
        userId ?? null,
        pickId,
        NHL_SHADOW_MODEL_KEY,
        NHL_SHADOW_MODEL_VERSION,
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
      ]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.warn(`[nhlShadowPersistence] recordNhlShadowRun failed: ${err.message}`);
    return null;
  }
}
