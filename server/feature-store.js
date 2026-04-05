/**
 * feature-store.js — Saves numerical features for each pick to enable future ML training
 */

import pool from './db.js';

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
      wind_speed: weatherData?.wind_speed ?? null,
      data_quality_score: dataQuality?.score ?? null,
      signal_coherence_score: signalCoherence?.coherenceScore ?? null,
      odds_ml_home: oddsData?.odds?.moneyline?.home ?? null,
      odds_ml_away: oddsData?.odds?.moneyline?.away ?? null,
      odds_ou_total: oddsData?.odds?.overUnder?.total ?? null,
    };

    await pool.query(`
      INSERT INTO pick_features (pick_id, backtest_id, game_pk, game_date,
        home_pitcher_xwoba, away_pitcher_xwoba, home_pitcher_whiff, away_pitcher_whiff,
        home_pitcher_k_pct, away_pitcher_k_pct, home_pitcher_era, away_pitcher_era,
        home_team_ops, away_team_ops, home_lineup_avg_xwoba, away_lineup_avg_xwoba,
        park_factor_overall, park_factor_hr, temperature, wind_speed,
        data_quality_score, signal_coherence_score,
        odds_ml_home, odds_ml_away, odds_ou_total, pick, result)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
    `, [
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
      pick, result,
    ]);

    console.log(`[feature-store] Saved features for game ${gamePk} (pick_id=${pickId}, bt_id=${backtestId})`);
  } catch (err) {
    console.warn(`[feature-store] Failed to save features: ${err.message}`);
  }
}
