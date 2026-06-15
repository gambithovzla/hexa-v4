/**
 * feature-store.js — Saves numerical features for each pick to enable future ML training
 */

import pool from './db.js';
import { parsePick as parseStructuredPick } from './parsers/pickParser.js';
import { enrichPropFeatures } from './services/propFeatureEnricher.js';
import { scorePropPickFeatures } from './services/mlbPropShadow.js';
import { getTeamFormForGame } from './mlb-api.js';

const PROPS_SAVANT_ENRICH_ENABLED = (process.env.MLB_PROPS_SAVANT_ENRICH_ENABLED ?? '1') !== '0';

function normalizeMarketType(value) {
  const key = String(value ?? '').toLowerCase().trim();
  if (!key) return null;
  if (key === 'playerprop') return 'prop';
  if (key === 'spread') return 'runline';
  return key;
}

function normalizeResult(result) {
  if (result === 'won') return 'win';
  if (result === 'lost') return 'loss';
  if (result === 'pending' || result == null) return null;
  return result;
}

/**
 * Extracts and saves key features from the context data used for a pick.
 * Call this after a successful analysis.
 */
export async function savePickFeatures({
  pickId = null,
  backtestId = null,
  gamePk,
  gameDate,
  homePitcherSavant,
  awayPitcherSavant,
  homePitcherStats,
  awayPitcherStats,
  homeHitting,
  awayHitting,
  savantBatters,
  parkFactorData,
  weatherData,
  dataQuality,
  signalCoherence,
  oddsData,
  pick,
  result,
  userEmail = null,
  // Sprint 1 — structured pick fields
  marketType = null,
  side = null,
  line = null,
  propKind = null,
  propPlayerId = null,
  propPlayerName = null,
  propOddsAmerican = null,
  // Sprint 1 — pitcher fatigue / game context
  homePitcherDaysRest = null,
  awayPitcherDaysRest = null,
  homePitcherPitchesLastStart = null,
  awayPitcherPitchesLastStart = null,
  homeBullpenPitchesLast3d = null,
  awayBullpenPitchesLast3d = null,
  isDayGame = null,
  isDome = null,
  gameNumberInSeries = null,
  umpireId = null,
  // Sprint 1 — oracle metadata
  promptVersion = null,
  oracleModel = null,
  oracleConfidence = null,
  kellyFraction = null,
  sport = 'mlb',
  source = 'live',
}) {
  try {
    // Calculate average lineup xwOBA
    const calcAvgXwoba = (batters) => {
      const withData = (batters ?? []).filter(b => b.savant?.xwOBA != null);
      if (withData.length === 0) return null;
      return withData.reduce((sum, b) => sum + b.savant.xwOBA, 0) / withData.length;
    };

    const features = {
      home_pitcher_xwoba: homePitcherSavant?.xwOBA_against ?? null,
      away_pitcher_xwoba: awayPitcherSavant?.xwOBA_against ?? null,
      home_pitcher_whiff: homePitcherSavant?.whiff_percent ?? null,
      away_pitcher_whiff: awayPitcherSavant?.whiff_percent ?? null,
      home_pitcher_k_pct: homePitcherSavant?.k_percent ?? null,
      away_pitcher_k_pct: awayPitcherSavant?.k_percent ?? null,
      home_pitcher_era: homePitcherStats?.stats?.era ? parseFloat(homePitcherStats.stats.era) : null,
      away_pitcher_era: awayPitcherStats?.stats?.era ? parseFloat(awayPitcherStats.stats.era) : null,
      home_team_ops: homeHitting?.ops ? parseFloat(homeHitting.ops) : null,
      away_team_ops: awayHitting?.ops ? parseFloat(awayHitting.ops) : null,
      home_lineup_avg_xwoba: calcAvgXwoba(savantBatters?.home),
      away_lineup_avg_xwoba: calcAvgXwoba(savantBatters?.away),
      park_factor_overall: parkFactorData?.park_factor_overall ?? null,
      park_factor_hr: parkFactorData?.park_factor_HR ?? null,
      temperature: weatherData?.temperature ?? null,
      wind_speed: weatherData?.wind_speed ?? weatherData?.windSpeed ?? null,
      data_quality_score: dataQuality?.score ?? null,
      signal_coherence_score: signalCoherence?.coherenceScore ?? null,
      odds_ml_home: oddsData?.odds?.moneyline?.home ?? null,
      odds_ml_away: oddsData?.odds?.moneyline?.away ?? null,
      odds_ou_total: oddsData?.odds?.overUnder?.total ?? null,
    };

    const parsedStructured = parseStructuredPick(pick ?? '');
    const resolvedMarketType = normalizeMarketType(marketType ?? parsedStructured.market_type);
    const resolvedSide = side ?? parsedStructured.side ?? null;
    let resolvedLine = line ?? parsedStructured.line ?? null;
    // A bare "Over"/"Under" pick (no number) leaves the line null, which drops
    // the row from over/under training. The line is the market total at pick
    // time — already on hand as odds_ou_total — so backfill it.
    if (resolvedLine == null && resolvedMarketType === 'overunder') {
      const marketTotal = oddsData?.odds?.overUnder?.total ?? features.odds_ou_total ?? null;
      if (marketTotal != null) resolvedLine = Number(marketTotal);
    }
    const resolvedPropKind = propKind ?? parsedStructured.prop_kind ?? null;
    const resolvedPropPlayerName = propPlayerName ?? parsedStructured.prop_player_name ?? null;

    let propEnriched = {};
    const isMlbProp = String(sport ?? 'mlb').toLowerCase() === 'mlb'
      && resolvedMarketType === 'prop'
      && resolvedPropPlayerName;
    if (PROPS_SAVANT_ENRICH_ENABLED && isMlbProp) {
      propEnriched = await enrichPropFeatures({
        propKind: resolvedPropKind,
        propPlayerName: resolvedPropPlayerName,
        propPlayerId,
        gamePk,
        propOddsAmerican,
      });
    }

    const resolvedPropPlayerId = propEnriched.prop_player_id ?? propPlayerId ?? null;
    const propPlayerXwoba = propEnriched.prop_player_xwoba ?? null;
    const propPlayerXba = propEnriched.prop_player_xba ?? null;
    const propPlayerXslg = propEnriched.prop_player_xslg ?? null;
    const propPlayerKPct = propEnriched.prop_player_k_pct ?? null;
    const propPlayerBBPct = propEnriched.prop_player_bb_pct ?? null;
    const propPlayerAvgEv = propEnriched.prop_player_avg_exit_velocity ?? null;
    const propPlayerBarrelPct = propEnriched.prop_player_barrel_pct ?? null;
    const propPlayerHardHitPct = propEnriched.prop_player_hard_hit_pct ?? null;
    const propPlayerRollingWoba7d = propEnriched.prop_player_rolling_woba_7d ?? null;
    const propPlayerRollingWoba14d = propEnriched.prop_player_rolling_woba_14d ?? null;
    const propPlayerRollingWoba21d = propEnriched.prop_player_rolling_woba_21d ?? null;
    const propPlayerOpsVsLhp = propEnriched.prop_player_ops_vs_lhp ?? null;
    const propPlayerOpsVsRhp = propEnriched.prop_player_ops_vs_rhp ?? null;
    const propOpponentPitcherHand = propEnriched.prop_opponent_pitcher_hand ?? null;
    const propOpponentPitcherXwoba = propEnriched.prop_opponent_pitcher_xwoba_against ?? null;
    const propOpponentPitcherKPct = propEnriched.prop_opponent_pitcher_k_pct ?? null;
    const propOddsAmericanVal = propEnriched.prop_odds_american ?? propOddsAmerican ?? null;
    const propImpliedProb = propEnriched.prop_implied_prob ?? null;

    // Team-strength features — live from standings; the Python history loader
    // computes the same fields from schedule scores so the schemas line up.
    // Keyed by gamePk; getTeamFormForGame never throws, so persistence is safe.
    let teamForm = { home: null, away: null };
    if (String(sport ?? 'mlb').toLowerCase() === 'mlb' && gamePk != null) {
      teamForm = await getTeamFormForGame(Number(gamePk));
    }

    const normalizedResult = normalizeResult(result);
    const values = [
      pickId, backtestId, gamePk, gameDate,
      features.home_pitcher_xwoba, features.away_pitcher_xwoba,
      features.home_pitcher_whiff, features.away_pitcher_whiff,
      features.home_pitcher_k_pct, features.away_pitcher_k_pct,
      features.home_pitcher_era, features.away_pitcher_era,
      features.home_team_ops, features.away_team_ops,
      features.home_lineup_avg_xwoba, features.away_lineup_avg_xwoba,
      features.park_factor_overall, features.park_factor_hr,
      features.temperature, features.wind_speed,
      features.data_quality_score, features.signal_coherence_score,
      features.odds_ml_home, features.odds_ml_away, features.odds_ou_total,
      pick, normalizedResult, userEmail ?? null,
      // Sprint 1 new fields
      resolvedMarketType, resolvedSide, resolvedLine, resolvedPropKind, resolvedPropPlayerId,
      resolvedPropPlayerName,
      propPlayerXwoba, propPlayerXba, propPlayerXslg,
      propPlayerKPct, propPlayerBBPct, propPlayerAvgEv,
      propPlayerBarrelPct, propPlayerHardHitPct,
      propPlayerRollingWoba7d, propPlayerRollingWoba14d, propPlayerRollingWoba21d,
      propPlayerOpsVsLhp, propPlayerOpsVsRhp,
      propOpponentPitcherHand, propOpponentPitcherXwoba, propOpponentPitcherKPct,
      propOddsAmericanVal, propImpliedProb,
      null, null,
      homePitcherDaysRest, awayPitcherDaysRest,
      homePitcherPitchesLastStart, awayPitcherPitchesLastStart,
      homeBullpenPitchesLast3d, awayBullpenPitchesLast3d,
      isDayGame, isDome, gameNumberInSeries, umpireId,
      promptVersion, oracleModel, oracleConfidence, kellyFraction, source, sport,
      // Team-strength features ($71–$82) — home team uses its home split, away
      // team uses its road split (matches the history loader's as-of venue logic).
      teamForm.home?.runsForAvg ?? null, teamForm.away?.runsForAvg ?? null,
      teamForm.home?.runsAgainstAvg ?? null, teamForm.away?.runsAgainstAvg ?? null,
      teamForm.home?.runDiffAvg ?? null, teamForm.away?.runDiffAvg ?? null,
      teamForm.home?.winPct ?? null, teamForm.away?.winPct ?? null,
      teamForm.home?.homeWinPct ?? null, teamForm.away?.awayWinPct ?? null,
      teamForm.home?.last10Wins ?? null, teamForm.away?.last10Wins ?? null,
    ];

    const existing = pickId != null
      ? await pool.query('SELECT id FROM pick_features WHERE pick_id = $1 LIMIT 1', [pickId])
      : backtestId != null
        ? await pool.query('SELECT id FROM pick_features WHERE backtest_id = $1 LIMIT 1', [backtestId])
        : { rows: [] };

    if (existing.rows.length > 0) {
      await pool.query(`
        UPDATE pick_features SET
          pick_id = $1, backtest_id = $2, game_pk = $3, game_date = $4,
          home_pitcher_xwoba = $5, away_pitcher_xwoba = $6,
          home_pitcher_whiff = $7, away_pitcher_whiff = $8,
          home_pitcher_k_pct = $9, away_pitcher_k_pct = $10,
          home_pitcher_era = $11, away_pitcher_era = $12,
          home_team_ops = $13, away_team_ops = $14,
          home_lineup_avg_xwoba = $15, away_lineup_avg_xwoba = $16,
          park_factor_overall = $17, park_factor_hr = $18,
          temperature = $19, wind_speed = $20,
          data_quality_score = $21, signal_coherence_score = $22,
          odds_ml_home = $23, odds_ml_away = $24, odds_ou_total = $25,
          pick = $26, result = $27, user_email = $28,
          market_type = $29, side = $30, line = $31, prop_kind = $32, prop_player_id = $33,
          prop_player_name = $34,
          prop_player_xwoba = $35, prop_player_xba = $36, prop_player_xslg = $37,
          prop_player_k_pct = $38, prop_player_bb_pct = $39, prop_player_avg_exit_velocity = $40,
          prop_player_barrel_pct = $41, prop_player_hard_hit_pct = $42,
          prop_player_rolling_woba_7d = $43, prop_player_rolling_woba_14d = $44, prop_player_rolling_woba_21d = $45,
          prop_player_ops_vs_lhp = $46, prop_player_ops_vs_rhp = $47,
          prop_opponent_pitcher_hand = $48, prop_opponent_pitcher_xwoba_against = $49, prop_opponent_pitcher_k_pct = $50,
          prop_odds_american = $51, prop_implied_prob = $52,
          python_prop_prob = $53, python_prop_market = $54,
          home_pitcher_days_rest = $55, away_pitcher_days_rest = $56,
          home_pitcher_pitches_last_start = $57, away_pitcher_pitches_last_start = $58,
          home_bullpen_pitches_last_3d = $59, away_bullpen_pitches_last_3d = $60,
          is_day_game = $61, is_dome = $62, game_number_in_series = $63, umpire_id = $64,
          prompt_version = $65, oracle_model = $66, oracle_confidence = $67,
          kelly_fraction = $68, source = $69, sport = $70,
          home_runs_for_avg = $71, away_runs_for_avg = $72,
          home_runs_against_avg = $73, away_runs_against_avg = $74,
          home_run_diff_avg = $75, away_run_diff_avg = $76,
          home_win_pct = $77, away_win_pct = $78,
          home_venue_win_pct = $79, away_venue_win_pct = $80,
          home_last10_wins = $81, away_last10_wins = $82,
          pick_time_lima = COALESCE(pick_time_lima, (NOW() AT TIME ZONE 'America/Lima')::TIMESTAMP)
        WHERE id = $83
      `, [...values, existing.rows[0].id]);
    } else {
      await pool.query(`
        INSERT INTO pick_features (pick_id, backtest_id, game_pk, game_date,
          home_pitcher_xwoba, away_pitcher_xwoba, home_pitcher_whiff, away_pitcher_whiff,
          home_pitcher_k_pct, away_pitcher_k_pct, home_pitcher_era, away_pitcher_era,
          home_team_ops, away_team_ops, home_lineup_avg_xwoba, away_lineup_avg_xwoba,
          park_factor_overall, park_factor_hr, temperature, wind_speed,
          data_quality_score, signal_coherence_score,
          odds_ml_home, odds_ml_away, odds_ou_total, pick, result, user_email,
          market_type, side, line, prop_kind, prop_player_id,
          prop_player_name,
          prop_player_xwoba, prop_player_xba, prop_player_xslg,
          prop_player_k_pct, prop_player_bb_pct, prop_player_avg_exit_velocity,
          prop_player_barrel_pct, prop_player_hard_hit_pct,
          prop_player_rolling_woba_7d, prop_player_rolling_woba_14d, prop_player_rolling_woba_21d,
          prop_player_ops_vs_lhp, prop_player_ops_vs_rhp,
          prop_opponent_pitcher_hand, prop_opponent_pitcher_xwoba_against, prop_opponent_pitcher_k_pct,
          prop_odds_american, prop_implied_prob, python_prop_prob, python_prop_market,
          home_pitcher_days_rest, away_pitcher_days_rest,
          home_pitcher_pitches_last_start, away_pitcher_pitches_last_start,
          home_bullpen_pitches_last_3d, away_bullpen_pitches_last_3d,
          is_day_game, is_dome, game_number_in_series, umpire_id,
          prompt_version, oracle_model, oracle_confidence, kelly_fraction, source, sport,
          home_runs_for_avg, away_runs_for_avg,
          home_runs_against_avg, away_runs_against_avg,
          home_run_diff_avg, away_run_diff_avg,
          home_win_pct, away_win_pct,
          home_venue_win_pct, away_venue_win_pct,
          home_last10_wins, away_last10_wins,
          pick_time_lima)
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26,$27,$28,
          $29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$60,$61,$62,$63,$64,$65,$66,$67,$68,$69,$70,
          $71,$72,$73,$74,$75,$76,$77,$78,$79,$80,$81,$82,
          (NOW() AT TIME ZONE 'America/Lima')::TIMESTAMP
        )
      `, values);
    }

    if (isMlbProp && pickId != null) {
      const featureRowId = existing.rows.length > 0
        ? existing.rows[0].id
        : (await pool.query(
          'SELECT id FROM pick_features WHERE pick_id = $1 ORDER BY id DESC LIMIT 1',
          [pickId],
        )).rows[0]?.id;
      if (featureRowId) {
        scorePropPickFeatures({
          featureRowId,
          propKind: resolvedPropKind,
          gameFeatures: features,
          propFeatures: {
            ...propEnriched,
            market_type: resolvedMarketType,
            side: resolvedSide,
            line: resolvedLine,
            prop_kind: resolvedPropKind,
            prop_player_name: resolvedPropPlayerName,
            home_pitcher_xwoba: features.home_pitcher_xwoba,
            away_pitcher_xwoba: features.away_pitcher_xwoba,
            home_pitcher_whiff: features.home_pitcher_whiff,
            away_pitcher_whiff: features.away_pitcher_whiff,
            home_pitcher_k_pct: features.home_pitcher_k_pct,
            away_pitcher_k_pct: features.away_pitcher_k_pct,
            home_pitcher_era: features.home_pitcher_era,
            away_pitcher_era: features.away_pitcher_era,
            home_team_ops: features.home_team_ops,
            away_team_ops: features.away_team_ops,
            home_lineup_avg_xwoba: features.home_lineup_avg_xwoba,
            away_lineup_avg_xwoba: features.away_lineup_avg_xwoba,
            park_factor_overall: features.park_factor_overall,
            park_factor_hr: features.park_factor_hr,
            temperature: features.temperature,
            wind_speed: features.wind_speed,
            odds_ml_home: features.odds_ml_home,
            odds_ml_away: features.odds_ml_away,
            odds_ou_total: features.odds_ou_total,
            is_day_game: isDayGame,
            is_dome: isDome,
            game_number_in_series: gameNumberInSeries,
          },
        }).catch((err) => {
          console.warn(`[feature-store] prop shadow score failed: ${err.message}`);
        });
      }
    }

    console.log(`[feature-store] Saved features for game ${gamePk} (pick_id=${pickId}, bt_id=${backtestId})`);
  } catch (err) {
    console.warn(`[feature-store] Failed to save features: ${err.message}`);
  }
}

export async function updatePickFeatureResult({ pickId = null, backtestId = null, result }) {
  const normalizedResult = normalizeResult(result);

  try {
    if (pickId != null) {
      await pool.query('UPDATE pick_features SET result = $1 WHERE pick_id = $2', [normalizedResult, pickId]);
      return;
    }
    if (backtestId != null) {
      await pool.query('UPDATE pick_features SET result = $1 WHERE backtest_id = $2', [normalizedResult, backtestId]);
    }
  } catch (err) {
    console.warn(`[feature-store] Failed to update feature result: ${err.message}`);
  }
}
