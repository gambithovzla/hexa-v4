/**
 * server/services/soccerShadowPersistence.js
 *
 * Persists per-pick soccer features into `pick_features` (sport='soccer') and
 * records a deterministic soccer shadow-validator run into `shadow_model_runs`
 * (sport='soccer'). Both are fire-and-forget — a failure here must never break
 * the pick flow.
 *
 * Mirrors nhlShadowPersistence.js. No Python ML client (soccer ML sidecar is a
 * later phase, like NBA 7e / NHL 10e). Uses the soccer-specific pick_features
 * columns added in runSoccerDatasetMigrations() (goals for/against, goal diff,
 * points, xG/xGA from Understat, draw_price, btts_yes_price) plus the generic
 * columns common to all sports.
 */

import pool from '../db.js';
import {
  calculateSoccerShadowScore,
  SOCCER_SHADOW_MODEL_KEY,
  SOCCER_SHADOW_MODEL_VERSION,
} from './soccerShadowValidator.js';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseWinsFromForm(recentForm) {
  if (!recentForm?.record) return null;
  const m = String(recentForm.record).match(/(\d+)W-(\d+)D-(\d+)L/);
  if (!m) return null;
  const wins = Number(m[1]);
  return Number.isFinite(wins) ? wins : null;
}

function normalizeMarketType(rawPick) {
  if (!rawPick) return null;
  const text = String(rawPick).toLowerCase();
  if (/1x2|threeway|three.way|home win|away win|draw/.test(text)) return 'moneyline';
  if (/\bover\b|\bunder\b|total/.test(text))                       return 'total';
  if (/btts|both teams/.test(text))                                return 'btts';
  return null;
}

/**
 * Insert a pick_features row for a soccer pick. Returns the new row id or null.
 */
export async function saveSoccerPickFeatures({
  pickId,
  gamePk,
  gameDate,
  leagueSlug,
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

  // 3-way odds → use home/away as "moneyline equivalent" for the generic columns
  const oddsMlHome  = toNumber(marketOdds?.threeWay?.home);
  const oddsMlAway  = toNumber(marketOdds?.threeWay?.away);
  const oddsOuTotal = toNumber(marketOdds?.total?.line);
  const drawPrice   = toNumber(marketOdds?.threeWay?.draw);
  const bttsYes     = toNumber(marketOdds?.btts?.yes);

  try {
    const { rows } = await pool.query(
      `INSERT INTO pick_features (
         pick_id, game_pk, game_date,
         home_team_id, away_team_id, home_team_abbr, away_team_abbr,
         home_goals_for,    away_goals_for,
         home_goals_against, away_goals_against,
         home_goal_diff,    away_goal_diff,
         home_points,       away_points,
         home_xg,  away_xg,
         home_xga, away_xga,
         home_last10_wins,  away_last10_wins,
         context_completeness,
         odds_ml_home, odds_ml_away, odds_ou_total,
         draw_price, btts_yes_price,
         oracle_confidence, market_type,
         pick, source, sport, league, user_email
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
         $22,
         $23,$24,$25,
         $26,$27,
         $28,$29,
         $30,'live','soccer',$31,$32
       )
       RETURNING id`,
      [
        pickId,
        toNumber(gamePk),
        gameDate ?? null,
        toNumber(gameMeta?.homeTeamId), toNumber(gameMeta?.awayTeamId),
        gameMeta?.homeAbbr ?? home.teamAbbr ?? null,
        gameMeta?.awayAbbr ?? away.teamAbbr ?? null,
        toNumber(home.goalsFor),    toNumber(away.goalsFor),
        toNumber(home.goalsAgainst), toNumber(away.goalsAgainst),
        toNumber(home.goalDiff),    toNumber(away.goalDiff),
        toNumber(home.points),      toNumber(away.points),
        // xG/xGA from Understat (Big 5 leagues; null for MLS / fetch failure).
        // The context builder enriches home.xG/xGA — persisting them (not null)
        // is what feeds real xG into the training dataset (Sprint 11.4).
        toNumber(home.xG),  toNumber(away.xG),
        toNumber(home.xGA), toNumber(away.xGA),
        parseWinsFromForm(home.recentForm),
        parseWinsFromForm(away.recentForm),
        overallCompleteness,
        oddsMlHome, oddsMlAway, oddsOuTotal,
        drawPrice, bttsYes,
        toNumber(oracleConfidence),
        marketType,
        pickText ?? null,
        leagueSlug ?? null,
        userEmail ?? null,
      ]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.warn(`[soccerShadowPersistence] saveSoccerPickFeatures failed: ${err.message}`);
    return null;
  }
}

/**
 * Run the deterministic soccer shadow validator and persist the comparison vs
 * the Oracle pick to shadow_model_runs (sport='soccer'). Returns the row id or null.
 */
export async function recordSoccerShadowRun({
  userId,
  userEmail,
  pickId,
  gamePk,
  gameDate,
  leagueSlug,
  context,
  gameMeta,
  marketOdds,
  analysisData,
}) {
  if (pickId == null || gamePk == null) return null;

  let shadow;
  try {
    shadow = calculateSoccerShadowScore(context, gameMeta, marketOdds);
  } catch (err) {
    console.warn(`[soccerShadowPersistence] validator failed: ${err.message}`);
    return null;
  }

  const home = context?.home ?? {};
  const away = context?.away ?? {};
  const mp   = analysisData?.master_prediction ?? {};

  // Soccer probability model has THREE keys — home_wins, draws, away_wins.
  const homeWins = toNumber(analysisData?.probability_model?.home_wins);
  const awayWins = toNumber(analysisData?.probability_model?.away_wins);
  const draws    = toNumber(analysisData?.probability_model?.draws);
  const probTotal = (homeWins ?? 0) + (awayWins ?? 0) + (draws ?? 0);
  const oracleHomeProb = probTotal > 0 ? homeWins / probTotal : null;

  // Agree check: binary home vs away (draw picks will show agree=null)
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
    home_goals_for:    toNumber(home.goalsFor),
    away_goals_for:    toNumber(away.goalsFor),
    home_goals_against: toNumber(home.goalsAgainst),
    away_goals_against: toNumber(away.goalsAgainst),
    home_goal_diff:    toNumber(home.goalDiff),
    away_goal_diff:    toNumber(away.goalDiff),
    home_points:       toNumber(home.points),
    away_points:       toNumber(away.points),
    home_form:         home.recentForm?.record ?? null,
    away_form:         away.recentForm?.record ?? null,
    draw_price:        toNumber(marketOdds?.threeWay?.draw),
    btts_yes_price:    toNumber(marketOdds?.btts?.yes),
    league:            leagueSlug ?? null,
    completeness:      toNumber(context?.context_meta?.overallCompleteness),
    breakdown:         shadow.breakdown ?? null,
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
         'soccer',$23,(NOW() AT TIME ZONE 'America/Lima')::TIMESTAMP
       )
       RETURNING id`,
      [
        userId ?? null,
        pickId,
        SOCCER_SHADOW_MODEL_KEY,
        SOCCER_SHADOW_MODEL_VERSION,
        toNumber(gamePk),
        gameDate ?? null,
        toNumber(gameMeta?.homeTeamId),
        toNumber(gameMeta?.awayTeamId),
        gameMeta?.homeAbbr ?? home.teamAbbr ?? null,
        gameMeta?.awayAbbr ?? away.teamAbbr ?? null,
        mp.pick ?? null,
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
    console.warn(`[soccerShadowPersistence] recordSoccerShadowRun failed: ${err.message}`);
    return null;
  }
}
