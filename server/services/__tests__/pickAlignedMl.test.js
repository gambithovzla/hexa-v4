import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPickAlignedMlOpinion } from '../pickAlignedMl.js';

const gameData = {
  gamePk: 123,
  teams: {
    home: { id: 147, abbreviation: 'NYY' },
    away: { id: 111, abbreviation: 'BOS' },
  },
};

test('moneyline pick agrees when oracle and legacy favor same team', async () => {
  const { mlOpinion } = await buildPickAlignedMlOpinion({
    analysisData: {
      master_prediction: { pick: 'NYY ML', oracle_confidence: 62 },
    },
    gameData,
    xgboostResult: { score: 58, predicted_winner: 147, predicted_winner_abbr: 'NYY' },
    statcastData: {},
    features: {},
  });

  assert.equal(mlOpinion.market_type, 'moneyline');
  assert.equal(mlOpinion.side, 'home');
  assert.equal(mlOpinion.legacy.available, true);
  assert.equal(mlOpinion.agree.legacy, true);
});

test('overunder infers python side from probability', async () => {
  const { mlOpinion } = await buildPickAlignedMlOpinion({
    analysisData: {
      master_prediction: { pick: 'Over 8.5', oracle_confidence: 55 },
    },
    gameData,
    xgboostResult: null,
    statcastData: {},
    features: {},
  });

  assert.equal(mlOpinion.market_type, 'overunder');
  assert.equal(mlOpinion.side, 'over');
  assert.equal(mlOpinion.legacy.available, false);
  assert.equal(mlOpinion.agree.legacy, null);
});

test('prop legacy is not available', async () => {
  const { mlOpinion } = await buildPickAlignedMlOpinion({
    analysisData: {
      master_prediction: { pick: 'Aaron Judge Over 0.5 Hits', oracle_confidence: 60 },
    },
    gameData,
    xgboostResult: { score: 55, predicted_winner: 147 },
    statcastData: {},
    features: {},
  });

  assert.equal(mlOpinion.market_type, 'prop');
  assert.equal(mlOpinion.prop_kind, 'hits');
  assert.equal(mlOpinion.legacy.available, false);
});
