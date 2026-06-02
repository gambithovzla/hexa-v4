/**
 * server/services/tennisShadowPersistence.js
 *
 * Persists per-pick Tennis features into `pick_features` (sport='tennis',
 * league=tour) and records a deterministic Tennis shadow-validator run into
 * `shadow_model_runs` (sport='tennis'). Both are fire-and-forget — a failure
 * here must never break the pick flow.
 *
 * Mirrors nhlShadowPersistence.js (no Python ML client — the Tennis ML sidecar
 * is Sprint 12e). Individual sport: player A → "home" slot, player B → "away"
 * slot, reusing the home/away columns added in runTennisDatasetMigrations()
 * (ELO surface/overall, rank, H2H total/surface, surface, round, best-of, rest,
 * sets played, set-handicap/total-games close lines).
 */

import pool from '../db.js';
import {
  calculateTennisShadowScore,
  TENNIS_SHADOW_MODEL_KEY,
  TENNIS_SHADOW_MODEL_VERSION,
} from './tennisShadowValidator.js';

function toNumber(value) {
  if (value == null || value === '') return null; // Number(null) === 0 — guard it
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

/** Tennis market types: match winner (moneyline), set handicap, total games. */
function normalizeMarketType(rawPick) {
  if (!rawPick) return null;
  const text = String(rawPick).toLowerCase();
  if (/\bset\b|[-+]\s?\d+(?:\.\d+)?\s*set|set handicap/.test(text)) return 'set_handicap';
  if (/\bover\b|\bunder\b|total\s*games?/.test(text)) return 'total_games';
  if (/\bml\b|to win|moneyline|match winner/.test(text)) return 'moneyline';
  return 'moneyline'; // default — match winner is the primary tennis market
}

/**
 * Insert a pick_features row for a tennis pick. Returns the new row id or null.
 * Player A → home slot, player B → away slot.
 */
export async function saveTennisPickFeatures({
  pickId,
  gamePk,
  gameDate,
  tour,
  context,
  marketOdds,
  pickText,
  pickSide,
  oracleConfidence,
  userEmail,
}) {
  if (pickId == null) return null;

  const a = context?.playerA ?? {};
  const b = context?.playerB ?? {};
  const h2h = context?.h2h ?? null;

  const marketType = normalizeMarketType(pickText);
  const overallCompleteness = toNumber(context?.context_meta?.overallCompleteness);

  const setHandicapClose = toNumber(marketOdds?.setHandicap?.line);
  const totalGamesClose  = toNumber(marketOdds?.totalGames?.line);

  try {
    const { rows } = await pool.query(
      `INSERT INTO pick_features (
         pick_id, game_pk, game_date,
         home_team_id, away_team_id,
         home_elo_surface, away_elo_surface,
         home_elo_overall, away_elo_overall,
         home_rank, away_rank,
         h2h_total_wins_home, h2h_total_wins_away,
         h2h_surface_wins_home, h2h_surface_wins_away,
         surface, tournament_round, best_of,
         home_rest_days, away_rest_days,
         home_sets_played_tourney, away_sets_played_tourney,
         set_handicap_close, total_games_close,
         context_completeness,
         oracle_confidence, market_type,
         pick, pick_side, source, sport, league, user_email
       )
       VALUES (
         $1,$2,$3,
         $4,$5,
         $6,$7,
         $8,$9,
         $10,$11,
         $12,$13,
         $14,$15,
         $16,$17,$18,
         $19,$20,
         $21,$22,
         $23,$24,
         $25,
         $26,$27,
         $28,$29,'live','tennis',$30,$31
       )
       RETURNING id`,
      [
        pickId,
        toNumber(gamePk),
        gameDate ?? null,
        toNumber(a.playerId), toNumber(b.playerId),
        toNumber(a.eloSurface), toNumber(b.eloSurface),
        toNumber(a.eloOverall), toNumber(b.eloOverall),
        toNumber(a.rank), toNumber(b.rank),
        toNumber(h2h?.aWins), toNumber(h2h?.bWins),
        toNumber(h2h?.aWinsSurface), toNumber(h2h?.bWinsSurface),
        context?.surface ?? null, toNumber(context?.roundDepth), toNumber(context?.bestOf),
        toNumber(a.restDays), toNumber(b.restDays),
        toNumber(a.setsPlayedTourney), toNumber(b.setsPlayedTourney),
        setHandicapClose, totalGamesClose,
        overallCompleteness,
        toNumber(oracleConfidence),
        marketType,
        pickText ?? null,
        pickSide ?? null,
        tour ?? null,
        userEmail ?? null,
      ]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.warn(`[tennisShadowPersistence] saveTennisPickFeatures failed: ${err.message}`);
    return null;
  }
}

/**
 * Run the deterministic Tennis shadow validator and persist the comparison vs
 * the Oracle pick to shadow_model_runs (sport='tennis'). Returns the row id or null.
 */
export async function recordTennisShadowRun({
  userId,
  userEmail,
  pickId,
  gamePk,
  gameDate,
  tour,
  context,
  analysisData,
}) {
  if (pickId == null || gamePk == null) return null;

  let shadow;
  try {
    shadow = calculateTennisShadowScore(context, { surface: context?.surface ?? null });
  } catch (err) {
    console.warn(`[tennisShadowPersistence] validator failed: ${err.message}`);
    return null;
  }

  const a  = context?.playerA ?? {};
  const b  = context?.playerB ?? {};
  const mp = analysisData?.master_prediction ?? {};
  const bp = analysisData?.best_pick ?? {};

  // Oracle P(player A wins) from the two-way probability_model.
  const aWins = toNumber(analysisData?.probability_model?.player_a_wins);
  const bWins = toNumber(analysisData?.probability_model?.player_b_wins);
  const totalWins = (aWins ?? 0) + (bWins ?? 0);
  let oracleAProb = totalWins > 0 ? aWins / totalWins : null;

  // The Oracle's explicit pick_side wins ties / missing probability_model.
  const pickSide = String(mp.pick_side ?? '').toLowerCase();
  let oraclePredicted = oracleAProb != null ? (oracleAProb >= 0.5 ? 'player_a' : 'player_b') : null;
  if (!oraclePredicted && (pickSide === 'player_a' || pickSide === 'player_b')) {
    oraclePredicted = pickSide;
  }

  const truncName = (s) => (s ? String(s).slice(0, 10) : null);
  const oraclePredictedName = oraclePredicted === 'player_a' ? a.playerName
    : oraclePredicted === 'player_b' ? b.playerName : null;

  const agree = oraclePredicted && shadow.predicted_winner
    ? oraclePredicted === shadow.predicted_winner
    : null;

  const marketType = normalizeMarketType(mp.pick ?? bp.detail);

  const featureSnapshot = {
    surface:           context?.surface ?? null,
    tournament_round:  toNumber(context?.roundDepth),
    best_of:           toNumber(context?.bestOf),
    home_elo_surface:  toNumber(a.eloSurface),
    away_elo_surface:  toNumber(b.eloSurface),
    home_elo_overall:  toNumber(a.eloOverall),
    away_elo_overall:  toNumber(b.eloOverall),
    home_rank:         toNumber(a.rank),
    away_rank:         toNumber(b.rank),
    h2h:               context?.h2h ?? null,
    home_form_wins:    parseWinsLocal(a.recentForm),
    away_form_wins:    parseWinsLocal(b.recentForm),
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
         sport, league, pick_market_type, user_email, pick_time_lima
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
         'tennis',$23,$24,$25,(NOW() AT TIME ZONE 'America/Lima')::TIMESTAMP
       )
       RETURNING id`,
      [
        userId ?? null,
        pickId,
        TENNIS_SHADOW_MODEL_KEY,
        TENNIS_SHADOW_MODEL_VERSION,
        toNumber(gamePk),
        gameDate ?? null,
        toNumber(a.playerId),
        toNumber(b.playerId),
        truncName(a.playerName),
        truncName(b.playerName),
        mp.pick ?? bp.detail ?? null,
        toNumber(mp.oracle_confidence),
        oracleAProb,
        oraclePredicted,
        truncName(oraclePredictedName),
        toNumber(shadow.score),
        toNumber(shadow.confidence),
        toNumber(shadow.score) != null ? toNumber(shadow.score) / 100 : null,
        shadow.predicted_winner ?? null,
        truncName(shadow.predicted_winner_name),
        agree,
        JSON.stringify(featureSnapshot),
        tour ?? null,
        marketType,
        userEmail ?? null,
      ]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.warn(`[tennisShadowPersistence] recordTennisShadowRun failed: ${err.message}`);
    return null;
  }
}
