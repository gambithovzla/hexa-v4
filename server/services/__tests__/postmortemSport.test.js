import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPostmortemFeatureSnapshot } from '../postmortemContext.js';
import { resolvePostmortemSport, getSystemPrompt } from '../../pick-postmortem.js';

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

test('buildPostmortemFeatureSnapshot includes soccer goals/xG for soccer sport', () => {
  const snap = buildPostmortemFeatureSnapshot({
    game_pk: 704, league: 'eng.1',
    home_goal_diff: 18, away_goal_diff: -5,
    home_xg: 42.1, away_xg: 30.4, draw_price: 240,
    home_pitcher_xwoba: 0.31, // should be ignored for soccer
  }, 'soccer');
  assert.equal(snap.sport, 'soccer');
  assert.equal(snap.league, 'eng.1');
  assert.equal(snap.home_goal_diff, 18);
  assert.equal(snap.home_xg, 42.1);
  assert.equal(snap.draw_price, 240);
  assert.equal(snap.home_pitcher_xwoba, undefined);
});

test('postmortem sport routing recognizes soccer', () => {
  assert.equal(resolvePostmortemSport('soccer'), 'soccer');
  assert.equal(resolvePostmortemSport('nba'), 'nba');
  assert.equal(resolvePostmortemSport('nfl'), 'mlb'); // unknown → mlb default
  assert.ok(getSystemPrompt('soccer').includes('three-way') || getSystemPrompt('soccer').includes('THREE-way'));
  assert.ok(getSystemPrompt('soccer').toLowerCase().includes('draw'));
  assert.notEqual(getSystemPrompt('soccer'), getSystemPrompt('mlb'));
});
