/**
 * feature-store.js — Saves numerical features for each pick to enable future ML training
 */

import pool from './db.js';

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
      pick, normalizedResult,
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
          pick = $26, result = $27
        WHERE id = $28
      `, [...values, existing.rows[0].id]);
    } else {
      await pool.query(`
        INSERT INTO pick_features (pick_id, backtest_id, game_pk, game_date,
          home_pitcher_xwoba, away_pitcher_xwoba, home_pitcher_whiff, away_pitcher_whiff,
          home_pitcher_k_pct, away_pitcher_k_pct, home_pitcher_era, away_pitcher_era,
          home_team_ops, away_team_ops, home_lineup_avg_xwoba, away_lineup_avg_xwoba,
          park_factor_overall, park_factor_hr, temperature, wind_speed,
          data_quality_score, signal_coherence_score,
          odds_ml_home, odds_ml_away, odds_ou_total, pick, result)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
      `, values);
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
