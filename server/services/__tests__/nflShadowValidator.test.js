import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateNflShadowScore, NFL_SHADOW_MODEL_KEY } from '../nflShadowValidator.js';

const meta = { homeTeamId: 12, awayTeamId: 2, homeAbbr: 'KC', awayAbbr: 'BUF' };

function ctx({ home = {}, away = {}, completeness = 1 } = {}) {
  return {
    home: { teamId: 12, teamAbbr: 'KC', pointDiff: 0, injuries: { severeCount: 0 }, recentForm: { record: '3-3' }, ...home },
    away: { teamId: 2, teamAbbr: 'BUF', pointDiff: 0, injuries: { severeCount: 0 }, recentForm: { record: '3-3' }, ...away },
    context_meta: { overallCompleteness: completeness },
  };
}

test('returns a bounded score and confidence', () => {
  const r = calculateNflShadowScore(ctx(), meta);
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.ok(r.confidence >= 50 && r.confidence <= 72, `conf ${r.confidence} in 50-72`);
});

test('even teams → ~50 with home-field nudge to home', () => {
  const r = calculateNflShadowScore(ctx(), meta);
  assert.ok(r.score >= 50, 'home-field boost keeps home at/above 50 on a coin flip');
  assert.equal(r.predicted_winner_abbr, 'KC');
});

test('stronger point differential favors that team', () => {
  const r = calculateNflShadowScore(ctx({ home: { pointDiff: 100 }, away: { pointDiff: -40 } }), meta);
  assert.equal(r.predicted_winner_abbr, 'KC');
  assert.ok(r.score > 60);
});

test('away point-diff edge flips the predicted winner', () => {
  const r = calculateNflShadowScore(ctx({ home: { pointDiff: -60 }, away: { pointDiff: 120 } }), meta);
  assert.equal(r.predicted_winner_abbr, 'BUF');
  assert.ok(r.score < 45);
});

test('home QB OUT swings toward the away team', () => {
  const healthy = calculateNflShadowScore(ctx(), meta).score;
  const qbOut = calculateNflShadowScore(ctx({ home: { qbStatus: { statusKey: 'out' } } }), meta).score;
  assert.ok(qbOut < healthy, 'home QB out lowers home score');
});

test('EPA matchup takes precedence over point-diff when present', () => {
  const r = calculateNflShadowScore(ctx({
    home: { epaOff: 0.15, epaDef: -0.10, pointDiff: -100 },
    away: { epaOff: -0.05, epaDef: 0.05, pointDiff: 100 },
  }), meta);
  // EPA strongly favors home despite an opposite point-diff
  assert.equal(r.predicted_winner_abbr, 'KC');
});

test('off-bye rest edge nudges toward the rested team', () => {
  const base = calculateNflShadowScore(ctx(), meta).score;
  const offBye = calculateNflShadowScore(ctx({ home: { isOffBye: true }, away: { isShortWeek: true } }), meta).score;
  assert.ok(offBye > base);
});

test('low data completeness reduces confidence', () => {
  const full = calculateNflShadowScore(ctx({ home: { pointDiff: 100 }, away: { pointDiff: -40 }, completeness: 1 }), meta).confidence;
  const poor = calculateNflShadowScore(ctx({ home: { pointDiff: 100 }, away: { pointDiff: -40 }, completeness: 0.3 }), meta).confidence;
  assert.ok(poor < full);
});

test('exposes a stable model key', () => {
  assert.equal(NFL_SHADOW_MODEL_KEY, 'nfl_shadow_validator_v1');
});
