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

test('Spanish prop pick uses strikeouts market not moneyline labels', async () => {
  const { mlOpinion } = await buildPickAlignedMlOpinion({
    analysisData: {
      master_prediction: { pick: 'Drew Rasmussen Bajo 4.5 Ponches', oracle_confidence: 58 },
    },
    gameData,
    xgboostResult: { score: 57, predicted_winner: 139 },
    statcastData: {},
    features: {},
  });

  assert.equal(mlOpinion.market_type, 'prop');
  assert.equal(mlOpinion.prop_kind, 'strikeouts');
  assert.equal(mlOpinion.side, 'under');
  assert.equal(mlOpinion.legacy.available, false);
  assert.match(mlOpinion.oracle.label, /Under|under/i);
  assert.doesNotMatch(mlOpinion.oracle.label, /Home ML/i);
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

test('full city name in pick resolves side via team name word matching', async () => {
  const gameDataTB = {
    gamePk: 456,
    teams: {
      home: { id: 139, abbreviation: 'TB', name: 'Tampa Bay Rays' },
      away: { id: 146, abbreviation: 'MIA', name: 'Miami Marlins' },
    },
  };
  const { mlOpinion } = await buildPickAlignedMlOpinion({
    analysisData: {
      master_prediction: { pick: 'Tampa Bay Moneyline', oracle_confidence: 63 },
    },
    gameData: gameDataTB,
    xgboostResult: { score: 58, predicted_winner: 139, predicted_winner_abbr: 'TB' },
    statcastData: {},
    features: {},
  });

  assert.equal(mlOpinion.market_type, 'moneyline');
  assert.equal(mlOpinion.side, 'home');
  assert.equal(mlOpinion.agree.legacy, true);
});

test('ambiguous city name shared by both teams does not set side', async () => {
  const gameDataNY = {
    gamePk: 789,
    teams: {
      home: { id: 147, abbreviation: 'NYY', name: 'New York Yankees' },
      away: { id: 121, abbreviation: 'NYM', name: 'New York Mets' },
    },
  };
  const { mlOpinion } = await buildPickAlignedMlOpinion({
    analysisData: {
      master_prediction: { pick: 'New York Moneyline', oracle_confidence: 55 },
    },
    gameData: gameDataNY,
    xgboostResult: { score: 53, predicted_winner: 147 },
    statcastData: {},
    features: {},
  });

  assert.equal(mlOpinion.market_type, 'moneyline');
  assert.equal(mlOpinion.side, null);
  assert.equal(mlOpinion.agree.legacy, null);
});
