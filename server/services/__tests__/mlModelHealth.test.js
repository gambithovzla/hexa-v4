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
