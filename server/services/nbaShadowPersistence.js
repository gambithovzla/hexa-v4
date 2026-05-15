/**
 * server/services/nbaShadowPersistence.js
 *
 * Persists per-pick NBA features into `pick_features` (with sport='nba')
 * and records a deterministic NBA shadow-validator run into
 * `shadow_model_runs` (with sport='nba'). Both are fire-and-forget — a
 * failure here must never break the pick flow.
 *
 * Mirrors what shadow-model.js does for MLB but stays in its own module so
 * we don't touch the frozen MLB code paths.
 */

import pool from '../db.js';
import {
  calculateNbaShadowScore,
  NBA_SHADOW_MODEL_KEY,
  NBA_SHADOW_MODEL_VERSION,
} from './nbaShadowValidator.js';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseLast10WinsLocal(recentForm) {
  if (!recentForm?.record) return null;
  const match = String(recentForm.record).match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return null;
  const wins = Number(match[1]);
  return Number.isFinite(wins) ? wins : null;
}

function normalizeMarketType(rawPick) {
  if (!rawPick) return null;
  const text = String(rawPick).toLowerCase();
  if (/\bml\b|moneyline/.test(text)) return 'moneyline';
  if (/\bspread\b|-\d|\+\d/.test(text)) return 'spread';
  if (/\bover\b|\bunder\b|\bo\b|\bu\b|total/.test(text)) return 'total';
  return null;
}

/**
 * Insert pick_features row for an NBA pick. Returns the new row id.
 *
 * @param {object} args
 * @param {number} args.pickId       — picks.id (from persistNbaPick)
 * @param {number|null} args.gamePk  — parseInt(NBA gameId)
 * @param {string} args.gameDate     — YYYY-MM-DD
 * @param {object} args.context      — buildNbaGameContext() output
 * @param {object} args.gameMeta     — { homeTeamId, awayTeamId, homeAbbr, awayAbbr }
 * @param {object|null} args.marketOdds
 * @param {string|null} args.pickText
 * @param {number|null} args.oracleConfidence
 * @param {string|null} args.userEmail
 */
export async function saveNbaPickFeatures({
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

  // Pull ML/spread/total odds from buildMarketOddsForGame() shape
  const oddsMlHome  = toNumber(marketOdds?.moneyline?.home);
  const oddsMlAway  = toNumber(marketOdds?.moneyline?.away);
  const oddsOuTotal = toNumber(marketOdds?.total?.line);

  try {
    const { rows } = await pool.query(
      `INSERT INTO pick_features (
         pick_id, game_pk, game_date,
         home_team_id, away_team_id, home_team_abbr, away_team_abbr,
         home_off_rating, away_off_rating,
         home_def_rating, away_def_rating,
         home_net_rating, away_net_rating,
         home_pace, away_pace,
         home_ts_pct, away_ts_pct,
         home_rest_days, away_rest_days,
         home_is_b2b, away_is_b2b,
         home_injuries_severe, away_injuries_severe,
         home_last10_wins, away_last10_wins,
         context_completeness,
         odds_ml_home, odds_ml_away, odds_ou_total,
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
         $26,
         $27,$28,$29,
         $30,$31,
         $32,'live','nba',$33
       )
       RETURNING id`,
      [
        pickId,
        toNumber(gamePk),
        gameDate ?? null,
        toNumber(gameMeta?.homeTeamId),
        toNumber(gameMeta?.awayTeamId),
        gameMeta?.homeAbbr ?? home.teamAbbr ?? null,
        gameMeta?.awayAbbr ?? away.teamAbbr ?? null,
        toNumber(home.offRating), toNumber(away.offRating),
        toNumber(home.defRating), toNumber(away.defRating),
        toNumber(home.netRating), toNumber(away.netRating),
        toNumber(home.pace),      toNumber(away.pace),
        toNumber(home.tsPct),     toNumber(away.tsPct),
        toNumber(home.daysRest),  toNumber(away.daysRest),
        toNumber(home.daysRest) === 0, toNumber(away.daysRest) === 0,
        toNumber(home.injuries?.severeCount) ?? 0,
        toNumber(away.injuries?.severeCount) ?? 0,
        parseLast10WinsLocal(home.recentForm),
        parseLast10WinsLocal(away.recentForm),
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
    console.warn(`[nbaShadowPersistence] saveNbaPickFeatures failed: ${err.message}`);
    return null;
  }
}

/**
 * Run the deterministic NBA shadow validator on the context and persist the
 * comparison vs the Oracle pick to shadow_model_runs (sport='nba').
 *
 * Returns the created row id or null on failure. Never throws.
 *
 * @param {object} args
 * @param {string|null} args.userId
 * @param {string|null} args.userEmail
 * @param {number|null} args.pickId
 * @param {number|null} args.gamePk
 * @param {string} args.gameDate
 * @param {object} args.context        — buildNbaGameContext() output
 * @param {object} args.gameMeta       — { homeTeamId, awayTeamId, homeAbbr, awayAbbr }
 * @param {object} args.analysisData   — Oracle JSON (master_prediction + best_pick)
 */
export async function recordNbaShadowRun({
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
    shadow = calculateNbaShadowScore(context, gameMeta);
  } catch (err) {
    console.warn(`[nbaShadowPersistence] validator failed: ${err.message}`);
    return null;
  }

  const home = context?.home ?? {};
  const away = context?.away ?? {};
  const mp   = analysisData?.master_prediction ?? {};
  const bp   = analysisData?.best_pick ?? {};

  // Oracle home-win prob from probability_model if present
  const homeWins = toNumber(analysisData?.probability_model?.home_wins);
  const awayWins = toNumber(analysisData?.probability_model?.away_wins);
  const totalWins = (homeWins ?? 0) + (awayWins ?? 0);
  const oracleHomeProb = totalWins > 0 ? homeWins / totalWins : null;

  const oraclePredictedHome = oracleHomeProb != null ? oracleHomeProb >= 0.5 : null;
  const oraclePredictedId   = oraclePredictedHome == null
    ? null
    : (oraclePredictedHome ? String(gameMeta?.homeTeamId ?? '') : String(gameMeta?.awayTeamId ?? ''));
  const oraclePredictedAbbr = oraclePredictedHome == null
    ? null
    : (oraclePredictedHome ? (gameMeta?.homeAbbr ?? null) : (gameMeta?.awayAbbr ?? null));

  const agree = oraclePredictedId && shadow.predicted_winner
    ? String(oraclePredictedId) === String(shadow.predicted_winner)
    : null;

  const featureSnapshot = {
    home_net_rating:  toNumber(home.netRating),
    away_net_rating:  toNumber(away.netRating),
    home_off_rating:  toNumber(home.offRating),
    away_off_rating:  toNumber(away.offRating),
    home_def_rating:  toNumber(home.defRating),
    away_def_rating:  toNumber(away.defRating),
    home_pace:        toNumber(home.pace),
    away_pace:        toNumber(away.pace),
    home_ts_pct:      toNumber(home.tsPct),
    away_ts_pct:      toNumber(away.tsPct),
    home_rest_days:   toNumber(home.daysRest),
    away_rest_days:   toNumber(away.daysRest),
    home_injuries_severe: toNumber(home.injuries?.severeCount) ?? 0,
    away_injuries_severe: toNumber(away.injuries?.severeCount) ?? 0,
    completeness:     toNumber(context?.context_meta?.overallCompleteness),
    breakdown:        shadow.breakdown ?? null,
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
         'nba',$23,(NOW() AT TIME ZONE 'America/Lima')::TIMESTAMP
       )
       RETURNING id`,
      [
        userId ?? null,
        pickId,
        NBA_SHADOW_MODEL_KEY,
        NBA_SHADOW_MODEL_VERSION,
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
    console.warn(`[nbaShadowPersistence] recordNbaShadowRun failed: ${err.message}`);
    return null;
  }
}
