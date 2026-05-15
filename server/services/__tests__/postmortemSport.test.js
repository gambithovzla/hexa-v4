import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPostmortemFeatureSnapshot } from '../postmortemContext.js';

test('buildPostmortemFeatureSnapshot includes NBA ratings for nba sport', () => {
  const snap = buildPostmortemFeatureSnapshot({
    game_pk: 401,
    home_net_rating: 5.2,
    away_net_rating: -1.1,
    home_pace: 99.5,
  }, 'nba');
  assert.equal(snap.sport, 'nba');
  assert.equal(snap.home_net_rating, 5.2);
  assert.equal(snap.home_pitcher_xwoba, undefined);
});

test('buildPostmortemFeatureSnapshot keeps MLB pitcher fields', () => {
  const snap = buildPostmortemFeatureSnapshot({
    home_pitcher_xwoba: 0.31,
  }, 'mlb');
  assert.equal(snap.sport, 'mlb');
  assert.equal(snap.home_pitcher_xwoba, 0.31);
});
