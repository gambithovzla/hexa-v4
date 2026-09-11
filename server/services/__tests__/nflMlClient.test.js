import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildNflFeaturePayload, predictNflGameModel } from '../nflMlClient.js';

test('buildNflFeaturePayload: reads qbStatus.statusKey (out QB → inactive)', () => {
  const ctx = {
    home: { qbStatus: { playerName: 'X', status: 'Out', statusKey: 'out' } },
    away: { qbStatus: { statusKey: 'questionable' } },
  };
  const f = buildNflFeaturePayload(ctx, {}, {});
  assert.equal(f.qb_home_active, 0); // out → inactive
  assert.equal(f.qb_away_active, 1); // questionable → still active
});

test('buildNflFeaturePayload: no QB injury → null (matches training convention)', () => {
  const f = buildNflFeaturePayload({ home: {}, away: {} }, {}, {});
  assert.equal(f.qb_home_active, null);
  assert.equal(f.qb_away_active, null);
});

test('buildNflFeaturePayload: maps EPA/odds/rest fields into the sidecar shape', () => {
  const ctx = { home: { epaOff: 0.12, successRate: 0.48 }, away: { epaDef: -0.05 } };
  const meta = { homeRestDays: 7, homeIsOffBye: true, isDome: false };
  const f = buildNflFeaturePayload(ctx, meta, { spread: -3, total: 47.5 });
  assert.equal(f.home_epa_off, 0.12);
  assert.equal(f.home_success_rate, 0.48);
  assert.equal(f.away_epa_def, -0.05);
  assert.equal(f.home_rest_days, 7);
  assert.equal(f.home_is_off_bye, 1);
  assert.equal(f.is_dome, 0);
  assert.equal(f.spread_close, -3);
  assert.equal(f.total_close, 47.5);
});

test('predictNflGameModel: returns null when the sidecar is disabled (de-vig fallback)', async () => {
  // ML_SIDECAR_ENABLED / HEXA_ML_API_URL are unset in the test env → circuit guard
  // short-circuits, so the parlay route falls back to de-vigged market odds.
  const model = await predictNflGameModel({ home: {}, away: {} }, {}, {});
  assert.equal(model, null);
});

test('context builder fields reach ML without duplicating them in game metadata', () => {
  const features = buildNflFeaturePayload({
    home: { restDays: 4, isShortWeek: true, isOffBye: false, injuries: { ok: true, severeCount: 2 } },
    away: { restDays: 14, isShortWeek: false, isOffBye: true, injuries: { ok: false, severeCount: 0 } },
    weather: { dome: false, windSpeed: 17 },
    context_meta: { overallCompleteness: 0.82 },
  });
  assert.equal(features.home_rest_days, 4);
  assert.equal(features.away_rest_days, 14);
  assert.equal(features.home_is_short_week, 1);
  assert.equal(features.away_is_short_week, 0);
  assert.equal(features.home_is_off_bye, 0);
  assert.equal(features.away_is_off_bye, 1);
  assert.equal(features.injuries_home_severe, 2);
  assert.equal(features.injuries_away_severe, null);
  assert.equal(features.wind_mph, 17);
  assert.equal(features.is_dome, 0);
  assert.equal(features.data_quality_score, 0.82);
});

test('nested Oracle market odds reach the sidecar as numeric lines', () => {
  const f = buildNflFeaturePayload({}, {}, { spread: { home: -3.5, away: 3.5 }, total: { line: 47.5 } });
  assert.equal(f.spread_close, -3.5);
  assert.equal(f.total_close, 47.5);
  const missing = buildNflFeaturePayload({}, {}, { spread: { home: null }, total: { line: null } });
  assert.equal(missing.spread_close, null);
  assert.equal(missing.total_close, null);
});
