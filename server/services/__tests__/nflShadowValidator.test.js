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

test('absent situational/trenches signals are re-weighted out, not diluted to 0.5', () => {
  // With only strength carrying a strong edge and the rest neutral/absent, the
  // re-normalization should let strength express its full discrimination instead
  // of being dragged toward 0.5 by 24% of dead (situational+trenches) weight.
  const r = calculateNflShadowScore(ctx({ home: { pointDiff: 100 }, away: { pointDiff: -40 } }), meta);
  // signalCoverage = sum of present weights (strength+qb+injuries+form = 0.72),
  // situational/trenches/rest absent.
  assert.equal(r.breakdown.signalCoverage, 0.72);
  assert.equal(r.breakdown.sitAdv, null);
  assert.equal(r.breakdown.trAdv, null);
  // The renormalized score is more decisive than the diluted version would be.
  assert.ok(r.score > 75, `expected decisive score, got ${r.score}`);
});

test('EPA + situational + trenches present raises signal coverage to full', () => {
  const r = calculateNflShadowScore(ctx({
    home: { epaOff: 0.12, epaDef: -0.05, redZoneTdPctOff: 0.65, redZoneTdPctDef: 0.50, thirdDownConvOff: 0.45, thirdDownConvDef: 0.35, sackRateOff: 0.05, sackRateDef: 0.09, isOffBye: true },
    away: { epaOff: -0.03, epaDef: 0.04, redZoneTdPctOff: 0.52, redZoneTdPctDef: 0.62, thirdDownConvOff: 0.36, thirdDownConvDef: 0.42, sackRateOff: 0.08, sackRateDef: 0.06, isShortWeek: true },
  }), meta);
  // strength+qb+situational+trenches+injuries+form+rest all present = 1.00
  assert.equal(r.breakdown.signalCoverage, 1);
  assert.ok(r.breakdown.sitAdv != null && r.breakdown.trAdv != null);
  assert.equal(r.predicted_winner_abbr, 'KC');
});

test('all signals absent falls back to a coin flip plus home boost', () => {
  const bare = {
    home: { teamId: 12, teamAbbr: 'KC' },
    away: { teamId: 2, teamAbbr: 'BUF' },
    context_meta: { overallCompleteness: 0.2 },
  };
  const r = calculateNflShadowScore(bare, meta);
  assert.ok(r.score >= 50 && r.score <= 55, `near coin-flip, got ${r.score}`);
  assert.equal(r.predicted_winner_abbr, 'KC'); // home boost breaks the tie
});

test('exposes a stable model key', () => {
  assert.equal(NFL_SHADOW_MODEL_KEY, 'nfl_shadow_validator_v1');
});
