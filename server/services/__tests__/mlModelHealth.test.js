import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMlObservability } from '../mlModelHealth.js';

test('buildMlObservability marks runline skipped and no artifact', () => {
  const obs = buildMlObservability({
    enabled: true,
    ensembleEnabled: true,
    circuit: { state: 'closed', failures: 0 },
    health: {
      status: 'ok',
      models_loaded: ['moneyline', 'overunder'],
      models_available: ['moneyline', 'overunder'],
      ensembles_loaded: [],
      ensembles_available: [],
      manifest: {
        markets: {
          runline: { skipped: true, min_train_size_used: 25 },
        },
      },
    },
  });

  const runline = obs.markets.find((m) => m.market === 'runline');
  assert.equal(runline.trained, false);
  assert.equal(runline.artifact, false);
  assert.equal(runline.inference, 'no_artifact');
  assert.equal(runline.runlineNote?.kind, 'skipped');
  assert.equal(obs.ensemble.inference, 'not_trained');
});

test('buildMlObservability live runline with early note', () => {
  const obs = buildMlObservability({
    enabled: true,
    ensembleEnabled: true,
    circuit: { state: 'closed', failures: 0 },
    health: {
      status: 'ok',
      models_loaded: ['moneyline', 'overunder', 'runline'],
      models_available: ['moneyline', 'overunder', 'runline'],
      ensembles_loaded: ['moneyline'],
      ensembles_available: ['moneyline'],
      manifest: {
        markets: {
          runline: { n_train: 32, brier_test: 0.24, trained_at: '2026-05-14T00:00:00Z' },
        },
      },
    },
  });

  const runline = obs.markets.find((m) => m.market === 'runline');
  assert.equal(runline.inference, 'live');
  assert.equal(runline.runlineNote?.kind, 'early');
  assert.equal(obs.ensemble.inference, 'live');
});

test('buildMlObservability surfaces soccer + NFL markets', () => {
  const obs = buildMlObservability({
    enabled: true,
    ensembleEnabled: false,
    circuit: { state: 'closed', failures: 0 },
    health: {
      status: 'ok',
      models_loaded: ['moneyline', 'soccer_moneyline', 'soccer_total', 'soccer_btts'],
      models_available: ['moneyline', 'soccer_moneyline', 'soccer_total', 'soccer_btts', 'nfl_moneyline'],
      ensembles_loaded: [],
      ensembles_available: [],
      manifest: { markets: { soccer_moneyline: { n_train: 2600, brier_test: 0.24, trained_at: '2026-06-07T00:00:00Z' } } },
    },
  });

  // MLB still leads the list (consumers reading markets[0] expect moneyline).
  assert.equal(obs.markets[0].market, 'moneyline');

  const soccerMl = obs.markets.find((m) => m.market === 'soccer_moneyline');
  assert.ok(soccerMl, 'soccer_moneyline present in HUD markets');
  assert.equal(soccerMl.sport, 'soccer');
  assert.equal(soccerMl.inference, 'live');   // loaded → LIVE
  assert.equal(soccerMl.trained, true);

  const soccerBtts = obs.markets.find((m) => m.market === 'soccer_btts');
  assert.equal(soccerBtts.loaded, true);

  const nflMl = obs.markets.find((m) => m.market === 'nfl_moneyline');
  assert.equal(nflMl.sport, 'nfl');
  assert.equal(nflMl.inference, 'lazy_load'); // available but not loaded → READY
});

test('buildMlObservability circuit open blocks inference', () => {
  const obs = buildMlObservability({
    enabled: true,
    ensembleEnabled: true,
    circuit: { state: 'open', failures: 3 },
    health: {
      status: 'ok',
      models_loaded: ['moneyline'],
      models_available: ['moneyline', 'overunder', 'runline'],
      ensembles_loaded: ['moneyline'],
      ensembles_available: ['moneyline'],
      manifest: { markets: {} },
    },
  });

  assert.equal(obs.markets[0].inference, 'circuit_open');
  assert.equal(obs.ensemble.inference, 'circuit_open');
});
