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
