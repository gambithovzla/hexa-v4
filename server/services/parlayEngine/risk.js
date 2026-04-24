/** Clamp a number to [min, max]. */
function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// ── Risk vector computation ────────────────────────────────────────────────

/**
 * Compute pitching_dominance for a candidate.
 *
 * High value → the bet thesis heavily depends on the starter dominating.
 * Elite pitcher (low xwOBA against) → high exposure to that pitcher.
 */
function pitchingDominance(candidate, features) {
  const { marketType, side, propKind } = candidate;

  // Striker Ks prop = fully pitcher-dependent
  if (marketType === 'playerprop' && propKind === 'k') return 0.9;

  if (marketType === 'moneyline' || marketType === 'runline') {
    const savant = side === 'home'
      ? features.homePitcherSavant
      : features.awayPitcherSavant;
    const xwoba = savant?.xwOBA_against ?? 0.315;
    // xwOBA 0.250 → dominance 1.0 (élite), 0.400 → 0.0 (poor)
    return clamp(1 - (xwoba - 0.250) / 0.150, 0, 1);
  }

  if (marketType === 'overunder' && side === 'under') {
    // Under thesis requires BOTH pitchers to dominate
    const homeXwoba = features.homePitcherSavant?.xwOBA_against ?? 0.315;
    const awayXwoba = features.awayPitcherSavant?.xwOBA_against ?? 0.315;
    const avg = (homeXwoba + awayXwoba) / 2;
    return clamp(1 - (avg - 0.250) / 0.150, 0, 1);
  }

  // Over or player prop hits — not directly pitcher-dominance driven
  return 0.2;
}

/**
 * Compute bullpen_exposure for a candidate.
 *
 * Short starters → game reaches bullpen → higher variance on the outcome.
 */
function bullpenExposure(candidate, features) {
  const { marketType, side } = candidate;

  // Pick the relevant side's starter IPG
  let ipg;
  if (marketType === 'moneyline' || marketType === 'runline') {
    const stats = side === 'home'
      ? features.homePitcherStats
      : features.awayPitcherStats;
    ipg = stats?.inningsPerStart ?? 5.5;
  } else {
    // For totals / props, use the average of both starters
    const hIpg = features.homePitcherStats?.inningsPerStart ?? 5.5;
    const aIpg = features.awayPitcherStats?.inningsPerStart ?? 5.5;
    ipg = (hIpg + aIpg) / 2;
  }

  let exposure = 0;
  if (ipg < 5.5) exposure += 0.3;
  if (ipg < 4.5) exposure += 0.25; // double penalty for very short starters
  return clamp(exposure, 0, 1);
}

/**
 * Compute weather_exposure for a candidate.
 *
 * Wind and extreme temperature increase variance, especially for totals.
 */
function weatherExposure(candidate, features) {
  const { marketType } = candidate;
  const wind = features.weatherData?.windSpeed
    ?? features.weatherData?.wind_speed
    ?? 0;
  const temp = features.weatherData?.temperature ?? 70;

  let exposure = 0;
  if (wind > 12) exposure = 0.6;
  if (wind > 18) exposure = 0.85;
  if (temp > 88 || temp < 50) exposure += 0.15;

  // Totals are more weather-sensitive than sides
  if (marketType === 'overunder') exposure *= 1.3;

  return clamp(exposure, 0, 1);
}

/**
 * Compute lineup_variance for a candidate.
 *
 * Player props are 100% dependent on lineup confirmation.
 * Low data quality increases variance for all markets.
 */
function lineupVariance(candidate, features) {
  const { marketType } = candidate;
  const dataQualityScore = features.dataQuality?.score ?? 50;

  let variance = marketType === 'playerprop' ? 0.9 : 0.35;
  if (dataQualityScore < 60) variance += 0.2;

  return clamp(variance, 0, 1);
}

/**
 * Compute umpire_sensitivity for a candidate.
 *
 * Totals and strikeout props are most sensitive to umpire zone width.
 * Placeholder value until live umpire data is integrated.
 */
function umpireSensitivity(candidate) {
  const { marketType, propKind } = candidate;
  if (marketType === 'overunder' || propKind === 'k') return 0.4;
  return 0.2;
}

/**
 * Compute ballpark_bias for a candidate.
 *
 * Extreme parks (Coors ~130, GABP ~115) introduce systematic scoring bias.
 * Neutral park (100) = 0, extreme = up to 1.
 */
function ballparkBias(features) {
  const parkOverall = features.parkFactorData?.park_factor_overall ?? 100;
  return clamp(Math.abs(parkOverall - 100) / 20, 0, 1);
}

// ── Game script derivation ────────────────────────────────────────────────

/**
 * Classify the game-level narrative context.
 * All candidates from the same game share the same gameScript.
 *
 * Order of precedence: wind → bullpen_fade → pitchers_duel → slugfest → neutral
 */
function deriveGameScript(features) {
  const homeXwoba = features.homePitcherSavant?.xwOBA_against ?? 0.315;
  const awayXwoba = features.awayPitcherSavant?.xwOBA_against ?? 0.315;
  const avgXwoba = (homeXwoba + awayXwoba) / 2;

  const wind = features.weatherData?.windSpeed
    ?? features.weatherData?.wind_speed
    ?? 0;
  const parkFactor = features.parkFactorData?.park_factor_overall ?? 100;

  const hIpg = features.homePitcherStats?.inningsPerStart ?? 5.5;
  const aIpg = features.awayPitcherStats?.inningsPerStart ?? 5.5;
  const avgIpg = (hIpg + aIpg) / 2;

  // Significant wind overrides everything else
  if (wind > 15) {
    // High park factor + wind = scoring conditions amplified
    return parkFactor >= 105 ? 'wind_out' : 'wind_in';
  }

  // Short starters mean the game is decided by the bullpen
  if (avgIpg < 5.0) return 'bullpen_fade';

  // Both starters elite: xwOBA well below average (league avg ~0.315)
  if (avgXwoba < 0.295 && avgIpg >= 5.8) return 'pitchers_duel';

  // Hitter-friendly park + mediocre pitching
  if (parkFactor > 108 && avgXwoba > 0.315) return 'slugfest';

  return 'neutral';
}

// ── Failure mode derivation ───────────────────────────────────────────────

/**
 * Return the most likely single-point-of-failure for this candidate.
 * Used by the composer and LLM architect to detect shared failure modes.
 */
function deriveFailureMode(candidate, gameScript) {
  const { marketType, side, propKind } = candidate;

  if (marketType === 'playerprop') {
    if (propKind === 'k') return 'pitcher_loses_command_or_scratched';
    if (propKind === 'hits') return 'batter_scratched_or_cold_streak';
    return 'prop_player_unavailable';
  }

  if (marketType === 'overunder') {
    if (side === 'under') {
      if (gameScript === 'pitchers_duel') return 'single_big_inning_breaks_under';
      if (gameScript === 'wind_out') return 'wind_amplifies_scoring_beyond_total';
      return 'pitchers_struggle_or_bullpen_implosion';
    }
    // over
    if (gameScript === 'pitchers_duel') return 'starters_dominate_all_nine_innings';
    if (gameScript === 'wind_in') return 'wind_suppresses_run_scoring';
    return 'pitchers_deal_low_scoring_game';
  }

  // moneyline / runline
  if (gameScript === 'bullpen_fade') return 'bullpen_blows_late_lead';
  if (gameScript === 'pitchers_duel') {
    return side === 'home'
      ? 'home_starter_loses_dominance_early'
      : 'away_starter_loses_dominance_early';
  }
  return side === 'home'
    ? 'home_team_offensive_collapse'
    : 'away_team_offensive_collapse';
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Enrich a ParlayCandidate with its risk vector, game script, and failure mode.
 * Pure function — deterministic given the same inputs.
 *
 * @param {object} candidate  ParlayCandidate (from pool.js)
 * @param {object} features   _features from buildContext
 * @param {object} _gameData  Reserved for future use (team-level enrichment)
 * @returns {object} Enriched ParlayCandidate
 */
export function enrichWithRiskVector(candidate, features, _gameData) {
  const riskVector = {
    pitching_dominance: pitchingDominance(candidate, features),
    bullpen_exposure: bullpenExposure(candidate, features),
    weather_exposure: weatherExposure(candidate, features),
    lineup_variance: lineupVariance(candidate, features),
    umpire_sensitivity: umpireSensitivity(candidate),
    ballpark_bias: ballparkBias(features),
  };

  const gameScript = deriveGameScript(features);
  const failureMode = deriveFailureMode(candidate, gameScript);

  return { ...candidate, riskVector, gameScript, failureMode };
}

/**
 * Enrich every candidate in a pool in-place (returns new array).
 * Calls buildContext-derived features are shared per game, so each
 * candidate must carry its own features reference.
 *
 * For use in the pipeline: candidates from buildCandidatePool don't carry
 * features; the caller must pass the per-game features map.
 *
 * @param {object[]} candidates  ParlayCandidate[]
 * @param {Map<number, object>}  featuresByGamePk  gamePk → _features
 * @param {Map<number, object>}  gameDataByGamePk  gamePk → gameData
 * @returns {object[]} Enriched ParlayCandidate[]
 */
export function enrichPoolWithRiskVectors(candidates, featuresByGamePk, gameDataByGamePk) {
  return candidates.map(c => {
    const features = featuresByGamePk.get(c.gamePk);
    const gameData = gameDataByGamePk.get(c.gamePk);
    if (!features) return c; // pass-through if no features available
    return enrichWithRiskVector(c, features, gameData ?? null);
  });
}
