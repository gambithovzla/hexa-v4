import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  nbaGameToLiveData,
  findNbaGameForPick,
} from '../../pick-tracker-nba.js';
import { parseLivePick, calculatePickProgress } from '../../pick-tracker.js';

const SAMPLE_GAME = {
  game_id: '401585601',
  game_date: '2026-05-15',
  game_status_id: 2,
  status: 'Q3 5:42',
  live_period: 3,
  live_clock: '5:42',
  home_team_abbr: 'CLE',
  home_team_name: 'Cleveland Cavaliers',
  home_score: 88,
  away_team_abbr: 'DET',
  away_team_name: 'Detroit Pistons',
  away_score: 91,
};

test('nbaGameToLiveData maps in-progress game to live status', () => {
  const live = nbaGameToLiveData(SAMPLE_GAME);
  assert.equal(live.status, 'live');
  assert.equal(live.home.score, 88);
  assert.equal(live.away.score, 91);
});

test('findNbaGameForPick matches by game_pk', () => {
  const pick = { game_pk: 401585601, matchup: 'DET @ CLE' };
  const found = findNbaGameForPick(pick, [SAMPLE_GAME]);
  assert.equal(found?.game_id, '401585601');
});

test('NBA moneyline progress reflects leading team', () => {
  const live = nbaGameToLiveData(SAMPLE_GAME);
  const parsed = parseLivePick('DET ML');
  const progress = calculatePickProgress(parsed, live);
  assert.equal(progress.status, 'winning');
  assert.equal(progress.current, 91);
});

test('NBA total over tracks combined points', () => {
  const live = nbaGameToLiveData({ ...SAMPLE_GAME, home_score: 50, away_score: 48 });
  const parsed = parseLivePick('Over 210.5');
  const progress = calculatePickProgress(parsed, live);
  assert.equal(progress.current, 98);
  assert.equal(progress.status, 'in_progress');
});

test('NBA spread uses runline parser', () => {
  const live = nbaGameToLiveData(SAMPLE_GAME);
  const parsed = parseLivePick('DET +6.5');
  assert.equal(parsed?.type, 'runline');
  const progress = calculatePickProgress(parsed, live);
  assert.ok(['covering', 'not_covering', 'won', 'lost', 'in_progress'].includes(progress.status));
});
