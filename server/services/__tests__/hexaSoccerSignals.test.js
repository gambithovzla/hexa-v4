import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectSoccerStreak,
  detectXgDivergence,
  detectStrengthMismatch,
  detectMarketSignals,
  detectLeagueLean,
  buildSoccerGameSignals,
  rankAndTrim,
} from '../hexaSoccerSignalsService.js';

const team = (over = {}) => ({ teamName: 'Arsenal', teamAbbr: 'ARS', ...over });

test('detectSoccerStreak: leading run of wins/losses', () => {
  assert.equal(detectSoccerStreak(team({ recentForm: { recent: 'WWWDL' } }))[0].type, 'team_streak_hot');
  assert.equal(detectSoccerStreak(team({ recentForm: { recent: 'LLLDW' } }))[0].type, 'team_streak_cold');
  assert.deepEqual(detectSoccerStreak(team({ recentForm: { recent: 'WWDLL' } })), []); // only 2 leading W
  assert.deepEqual(detectSoccerStreak(team({ recentForm: { recent: '' } })), []);
  assert.deepEqual(detectSoccerStreak({}), []);
});

test('detectXgDivergence: over/under performance vs xG', () => {
  assert.equal(detectXgDivergence(team({ goalsFor: 30, xG: 24 }))[0].type, 'xg_overperforming');
  assert.equal(detectXgDivergence(team({ goalsFor: 18, xG: 25 }))[0].type, 'xg_underperforming');
  assert.deepEqual(detectXgDivergence(team({ goalsFor: 20, xG: 22 })), []); // within threshold
  assert.deepEqual(detectXgDivergence(team({ goalsFor: 20, xG: null })), []); // MLS / no xG
});

test('detectStrengthMismatch: points / goal-diff gap', () => {
  const home = team({ points: 45, goalDiff: 22 });
  const away = { teamName: 'Luton', teamAbbr: 'LUT', points: 18, goalDiff: -20 };
  const sig = detectStrengthMismatch(home, away);
  assert.equal(sig[0].type, 'strength_mismatch');
  assert.equal(sig[0].meta.strongerAbbr, 'ARS');
  assert.deepEqual(detectStrengthMismatch(team({ points: 30 }), { points: 28 }), []);
});

test('detectMarketSignals: heavy favorite', () => {
  const sigs = detectMarketSignals({ threeWay: { home: -300, draw: 280, away: 700 } },
    { homeName: 'City', awayName: 'Burnley', homeAbbr: 'MCI', awayAbbr: 'BUR' });
  assert.ok(sigs.some(s => s.type === 'heavy_favorite'));
  assert.ok(!sigs.some(s => s.type === 'tight_three_way'));
  assert.equal(sigs.find(s => s.type === 'heavy_favorite').meta.teamAbbr, 'MCI');
});

test('detectMarketSignals: tight three-way + draw risk', () => {
  const sigs = detectMarketSignals({ threeWay: { home: 160, draw: 175, away: 190 } }, {});
  assert.ok(sigs.some(s => s.type === 'draw_risk'));
  assert.ok(sigs.some(s => s.type === 'tight_three_way'));
  assert.deepEqual(detectMarketSignals({ threeWay: { home: -120 } }), []); // incomplete → null
});

test('detectLeagueLean: scoring profile', () => {
  const hi = detectLeagueLean({ avgGoals: 3.1, drawPct: 0.22 }, { total: { overPrice: -130, underPrice: 105 } });
  assert.ok(hi.some(s => s.type === 'high_scoring_lean'));
  assert.equal(hi.find(s => s.type === 'high_scoring_lean').meta.overFavored, true);
  const def = detectLeagueLean({ avgGoals: 2.4, drawPct: 0.29 }, null);
  assert.ok(def.some(s => s.type === 'low_scoring_lean'));
  assert.deepEqual(detectLeagueLean(null), []);
});

test('rankAndTrim: sorts by priority desc and dedupes', () => {
  const ranked = rankAndTrim([
    { type: 'a', priority: 50, meta: { teamAbbr: 'X' } },
    { type: 'b', priority: 90, meta: {} },
    { type: 'a', priority: 50, meta: { teamAbbr: 'X' } }, // dup
    null,
  ]);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].type, 'b'); // highest priority first
});

test('buildSoccerGameSignals: aggregates from full context', () => {
  const context = {
    leagueMeta: { avgGoals: 3.1, drawPct: 0.22 },
    home: { teamName: 'Bayern', teamAbbr: 'BAY', points: 50, goalDiff: 40, recentForm: { recent: 'WWWWL' }, goalsFor: 60, xG: 50 },
    away: { teamName: 'Bochum', teamAbbr: 'BOC', points: 18, goalDiff: -25, recentForm: { recent: 'LLLDW' }, goalsFor: 22, xG: 28 },
  };
  const odds = { threeWay: { home: -400, draw: 450, away: 900 }, total: { overPrice: -140, underPrice: 110 } };
  const signals = buildSoccerGameSignals(context, odds);
  assert.ok(signals.length >= 4);
  const types = signals.map(s => s.type);
  assert.ok(types.includes('team_streak_hot'));      // Bayern WWWW
  assert.ok(types.includes('xg_overperforming'));     // Bayern 60 vs 50
  assert.ok(types.includes('strength_mismatch'));     // big table gap
  assert.ok(types.includes('high_scoring_lean'));     // Bundesliga 3.1
  // ranked by priority descending
  for (let i = 1; i < signals.length; i++) {
    assert.ok(signals[i - 1].priority >= signals[i].priority);
  }
});
