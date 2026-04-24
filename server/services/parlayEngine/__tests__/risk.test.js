// Tests for risk.js — uses Node built-in test runner (node:test).
// Run: node --test server/services/parlayEngine/__tests__/risk.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enrichWithRiskVector } from '../risk.js';

// ── Fixture builders ──────────────────────────────────────────────────────

/** Base features with neutral conditions. */
function neutralFeatures(overrides = {}) {
  return {
    homePitcherSavant: { xwOBA_against: 0.315, k_pct: 0.22 },
    awayPitcherSavant: { xwOBA_against: 0.315, k_pct: 0.22 },
    homePitcherStats: { era: 4.00, whip: 1.30, inningsPerStart: 5.8 },
    awayPitcherStats: { era: 4.00, whip: 1.30, inningsPerStart: 5.8 },
    parkFactorData: { park_factor_overall: 100 },
    weatherData: { temperature: 72, windSpeed: 5, wind_speed: 5 },
    dataQuality: { score: 75 },
    ...overrides,
  };
}

/** Base moneyline home candidate. */
function mlHomeCandidate(overrides = {}) {
  return {
    candidateId: '778001::moneyline::home::bos_ml',
    gamePk: 778001,
    marketType: 'moneyline',
    side: 'home',
    propKind: null,
    modelProbability: 62,
    edge: 3.7,
    dataQualityScore: 75,
    riskVector: null,
    gameScript: null,
    failureMode: null,
    ...overrides,
  };
}

// ── pitching_dominance ────────────────────────────────────────────────────

describe('riskVector.pitching_dominance', () => {
  it('is high for elite home starter (xwOBA = 0.260) on ML home', () => {
    const features = neutralFeatures({
      homePitcherSavant: { xwOBA_against: 0.260 }, // élite
    });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);

    // 1 - (0.260 - 0.250) / 0.150 = 1 - 0.0667 = 0.933
    assert.ok(result.riskVector.pitching_dominance > 0.90,
      `expected > 0.90, got ${result.riskVector.pitching_dominance}`);
  });

  it('is low for weak home starter (xwOBA = 0.380) on ML home', () => {
    const features = neutralFeatures({
      homePitcherSavant: { xwOBA_against: 0.380 }, // poor
    });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);

    // 1 - (0.380 - 0.250) / 0.150 = 1 - 0.867 = 0.133
    assert.ok(result.riskVector.pitching_dominance < 0.20,
      `expected < 0.20, got ${result.riskVector.pitching_dominance}`);
  });

  it('clamps to 0 for very poor pitcher (xwOBA >= 0.400)', () => {
    const features = neutralFeatures({
      homePitcherSavant: { xwOBA_against: 0.420 },
    });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);
    assert.strictEqual(result.riskVector.pitching_dominance, 0);
  });

  it('clamps to 1 for historic pitcher (xwOBA <= 0.250)', () => {
    const features = neutralFeatures({
      homePitcherSavant: { xwOBA_against: 0.210 },
    });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);
    assert.strictEqual(result.riskVector.pitching_dominance, 1);
  });

  it('is 0.9 for strikeout prop (propKind = k)', () => {
    const candidate = mlHomeCandidate({ marketType: 'playerprop', propKind: 'k', side: 'over' });
    const result = enrichWithRiskVector(candidate, neutralFeatures(), null);
    assert.strictEqual(result.riskVector.pitching_dominance, 0.9);
  });

  it('uses average of both pitchers for Under', () => {
    const features = neutralFeatures({
      homePitcherSavant: { xwOBA_against: 0.260 }, // élite
      awayPitcherSavant: { xwOBA_against: 0.370 }, // poor
    });
    const candidate = mlHomeCandidate({ marketType: 'overunder', side: 'under' });
    const result = enrichWithRiskVector(candidate, features, null);

    // avg = (0.260 + 0.370) / 2 = 0.315
    // 1 - (0.315 - 0.250) / 0.150 = 1 - 0.4333 ≈ 0.567
    const pd = result.riskVector.pitching_dominance;
    assert.ok(Math.abs(pd - 0.567) < 0.01, `expected ~0.567, got ${pd}`);
  });
});

// ── bullpen_exposure ──────────────────────────────────────────────────────

describe('riskVector.bullpen_exposure', () => {
  it('is 0 for full-inning starter (IPG = 6.2)', () => {
    const features = neutralFeatures({
      homePitcherStats: { inningsPerStart: 6.2 },
    });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);
    assert.strictEqual(result.riskVector.bullpen_exposure, 0);
  });

  it('is 0.3 for short starter (IPG = 5.1)', () => {
    const features = neutralFeatures({
      homePitcherStats: { inningsPerStart: 5.1 },
    });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);
    assert.strictEqual(result.riskVector.bullpen_exposure, 0.3);
  });

  it('is 0.55 for very short starter (IPG = 4.2)', () => {
    const features = neutralFeatures({
      homePitcherStats: { inningsPerStart: 4.2 },
    });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);
    assert.strictEqual(result.riskVector.bullpen_exposure, 0.55);
  });
});

// ── weather_exposure ──────────────────────────────────────────────────────

describe('riskVector.weather_exposure', () => {
  it('is 0 for calm weather (wind = 5 mph, temp = 72°F)', () => {
    const features = neutralFeatures({
      weatherData: { temperature: 72, windSpeed: 5, wind_speed: 5 },
    });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);
    assert.strictEqual(result.riskVector.weather_exposure, 0);
  });

  it('is 0.6 for moderate wind (wind = 15 mph)', () => {
    const features = neutralFeatures({
      weatherData: { temperature: 72, windSpeed: 15, wind_speed: 15 },
    });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);
    assert.strictEqual(result.riskVector.weather_exposure, 0.6);
  });

  it('is 0.85 for strong wind (wind = 20 mph)', () => {
    const features = neutralFeatures({
      weatherData: { temperature: 72, windSpeed: 20, wind_speed: 20 },
    });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);
    assert.strictEqual(result.riskVector.weather_exposure, 0.85);
  });

  it('adds 0.15 for extreme cold (temp = 44°F)', () => {
    const features = neutralFeatures({
      weatherData: { temperature: 44, windSpeed: 5, wind_speed: 5 },
    });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);
    assert.strictEqual(result.riskVector.weather_exposure, 0.15);
  });

  it('multiplies by 1.3 for OverUnder market (clamped to 1)', () => {
    const features = neutralFeatures({
      weatherData: { temperature: 72, windSpeed: 20, wind_speed: 20 },
    });
    const candidate = mlHomeCandidate({ marketType: 'overunder', side: 'over' });
    const result = enrichWithRiskVector(candidate, features, null);
    // 0.85 * 1.3 = 1.105 → clamped to 1
    assert.strictEqual(result.riskVector.weather_exposure, 1);
  });
});

// ── ballpark_bias ─────────────────────────────────────────────────────────

describe('riskVector.ballpark_bias', () => {
  it('is 0 for neutral park (factor = 100)', () => {
    const features = neutralFeatures({ parkFactorData: { park_factor_overall: 100 } });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);
    assert.strictEqual(result.riskVector.ballpark_bias, 0);
  });

  it('is 1 for Coors (factor = 120)', () => {
    const features = neutralFeatures({ parkFactorData: { park_factor_overall: 120 } });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);
    // |120 - 100| / 20 = 1.0
    assert.strictEqual(result.riskVector.ballpark_bias, 1);
  });

  it('is 1 for extreme pitcher park (factor = 80)', () => {
    const features = neutralFeatures({ parkFactorData: { park_factor_overall: 80 } });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);
    assert.strictEqual(result.riskVector.ballpark_bias, 1);
  });

  it('is 0.75 for GABP-like park (factor = 115)', () => {
    const features = neutralFeatures({ parkFactorData: { park_factor_overall: 115 } });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);
    // |115 - 100| / 20 = 0.75
    assert.strictEqual(result.riskVector.ballpark_bias, 0.75);
  });
});

// ── gameScript ────────────────────────────────────────────────────────────

describe('gameScript derivation', () => {
  it('returns pitchers_duel for two elite starters and calm weather', () => {
    const features = neutralFeatures({
      homePitcherSavant: { xwOBA_against: 0.270 },
      awayPitcherSavant: { xwOBA_against: 0.280 },
      homePitcherStats: { inningsPerStart: 6.3 },
      awayPitcherStats: { inningsPerStart: 6.1 },
      weatherData: { temperature: 70, windSpeed: 6, wind_speed: 6 },
    });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);
    assert.strictEqual(result.gameScript, 'pitchers_duel');
  });

  it('returns slugfest for hitter-friendly park and weak pitching', () => {
    const features = neutralFeatures({
      homePitcherSavant: { xwOBA_against: 0.340 },
      awayPitcherSavant: { xwOBA_against: 0.335 },
      parkFactorData: { park_factor_overall: 115 },
      weatherData: { temperature: 80, windSpeed: 4, wind_speed: 4 },
    });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);
    assert.strictEqual(result.gameScript, 'slugfest');
  });

  it('returns wind_out for high wind + favorable park factor', () => {
    const features = neutralFeatures({
      weatherData: { temperature: 75, windSpeed: 18, wind_speed: 18 },
      parkFactorData: { park_factor_overall: 108 },
    });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);
    assert.strictEqual(result.gameScript, 'wind_out');
  });

  it('returns wind_in for high wind + pitcher park', () => {
    const features = neutralFeatures({
      weatherData: { temperature: 65, windSpeed: 18, wind_speed: 18 },
      parkFactorData: { park_factor_overall: 96 },
    });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);
    assert.strictEqual(result.gameScript, 'wind_in');
  });

  it('returns bullpen_fade for short starters', () => {
    const features = neutralFeatures({
      homePitcherStats: { inningsPerStart: 4.8 },
      awayPitcherStats: { inningsPerStart: 4.6 },
    });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);
    assert.strictEqual(result.gameScript, 'bullpen_fade');
  });

  it('returns neutral for average conditions', () => {
    const result = enrichWithRiskVector(mlHomeCandidate(), neutralFeatures(), null);
    assert.strictEqual(result.gameScript, 'neutral');
  });
});

// ── failureMode ───────────────────────────────────────────────────────────

describe('failureMode derivation', () => {
  it('returns pitcher-related failure for strikeout prop', () => {
    const candidate = mlHomeCandidate({ marketType: 'playerprop', propKind: 'k', side: 'over' });
    const result = enrichWithRiskVector(candidate, neutralFeatures(), null);
    assert.strictEqual(result.failureMode, 'pitcher_loses_command_or_scratched');
  });

  it('returns batter failure for hits prop', () => {
    const candidate = mlHomeCandidate({ marketType: 'playerprop', propKind: 'hits', side: 'over' });
    const result = enrichWithRiskVector(candidate, neutralFeatures(), null);
    assert.strictEqual(result.failureMode, 'batter_scratched_or_cold_streak');
  });

  it('returns bullpen failure for bullpen_fade moneyline', () => {
    const features = neutralFeatures({
      homePitcherStats: { inningsPerStart: 4.5 },
      awayPitcherStats: { inningsPerStart: 4.3 },
    });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);
    assert.strictEqual(result.failureMode, 'bullpen_blows_late_lead');
  });

  it('under in pitchers_duel fails on single big inning', () => {
    const features = neutralFeatures({
      homePitcherSavant: { xwOBA_against: 0.270 },
      awayPitcherSavant: { xwOBA_against: 0.280 },
      homePitcherStats: { inningsPerStart: 6.2 },
      awayPitcherStats: { inningsPerStart: 6.0 },
    });
    const candidate = mlHomeCandidate({ marketType: 'overunder', side: 'under' });
    const result = enrichWithRiskVector(candidate, features, null);
    assert.strictEqual(result.failureMode, 'single_big_inning_breaks_under');
  });
});

// ── Determinism (idempotency) ─────────────────────────────────────────────

describe('determinism', () => {
  it('returns identical output on repeated calls with same input', () => {
    const features = neutralFeatures({
      homePitcherSavant: { xwOBA_against: 0.285 },
      weatherData: { temperature: 55, windSpeed: 14, wind_speed: 14 },
      parkFactorData: { park_factor_overall: 112 },
    });
    const candidate = mlHomeCandidate();

    const r1 = enrichWithRiskVector(candidate, features, null);
    const r2 = enrichWithRiskVector(candidate, features, null);

    assert.deepStrictEqual(r1.riskVector, r2.riskVector, 'riskVector must be identical');
    assert.strictEqual(r1.gameScript, r2.gameScript, 'gameScript must be identical');
    assert.strictEqual(r1.failureMode, r2.failureMode, 'failureMode must be identical');
  });

  it('all riskVector dimensions are numbers in [0, 1]', () => {
    const features = neutralFeatures({
      homePitcherSavant: { xwOBA_against: 0.260 },
      weatherData: { temperature: 90, windSpeed: 22, wind_speed: 22 },
      parkFactorData: { park_factor_overall: 125 },
      homePitcherStats: { inningsPerStart: 4.2 },
      dataQuality: { score: 45 },
    });
    const result = enrichWithRiskVector(mlHomeCandidate(), features, null);
    const rv = result.riskVector;

    for (const [key, val] of Object.entries(rv)) {
      assert.ok(typeof val === 'number' && !isNaN(val), `${key} must be a number`);
      assert.ok(val >= 0 && val <= 1, `${key} must be in [0,1], got ${val}`);
    }
  });

  it('original candidate object is not mutated', () => {
    const original = mlHomeCandidate();
    const originalCopy = { ...original };
    enrichWithRiskVector(original, neutralFeatures(), null);
    assert.deepStrictEqual(original, originalCopy, 'original candidate must not be mutated');
  });
});
