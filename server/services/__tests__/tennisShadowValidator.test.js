import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateTennisShadowScore, TENNIS_SHADOW_MODEL_KEY } from '../tennisShadowValidator.js';

function ctx(overrides = {}) {
  return {
    surface: 'clay',
    bestOf: 5,
    playerA: { playerName: 'Player A', playerId: 1, eloSurface: 2100, eloOverall: 2080, rank: 3, recentForm: { record: '8-2' } },
    playerB: { playerName: 'Player B', playerId: 2, eloSurface: 1950, eloOverall: 1990, rank: 9, recentForm: { record: '5-5' } },
    h2h: { aWins: 3, bWins: 1, aWinsSurface: 2, bWinsSurface: 0 },
    context_meta: { overallCompleteness: 1 },
    ...overrides,
  };
}

test('surface-ELO edge makes player A the predicted winner', () => {
  const r = calculateTennisShadowScore(ctx(), { surface: 'clay' });
  assert.equal(r.predicted_winner, 'player_a');
  assert.ok(r.score > 50);
  assert.equal(r.breakdown.baseSource, 'elo_surface');
});

test('confidence is bounded to the 72 tennis cap', () => {
  const r = calculateTennisShadowScore(ctx({
    playerA: { playerName: 'A', eloSurface: 2400, recentForm: { record: '10-0' } },
    playerB: { playerName: 'B', eloSurface: 1500, recentForm: { record: '0-10' } },
    h2h: { aWins: 10, bWins: 0, aWinsSurface: 6, bWinsSurface: 0 },
  }), { surface: 'hard' });
  assert.ok(r.confidence <= 72);
  assert.equal(r.predicted_winner, 'player_a');
});

test('falls back to overall ELO when surface ELO missing', () => {
  const r = calculateTennisShadowScore(ctx({
    playerA: { playerName: 'A', eloSurface: null, eloOverall: 2100, rank: 3 },
    playerB: { playerName: 'B', eloSurface: null, eloOverall: 1950, rank: 9 },
    h2h: null,
  }), {});
  assert.equal(r.breakdown.baseSource, 'elo_overall');
  assert.equal(r.predicted_winner, 'player_a');
});

test('falls back to rank when no ELO at all', () => {
  const r = calculateTennisShadowScore(ctx({
    playerA: { playerName: 'A', eloSurface: null, eloOverall: null, rank: 2 },
    playerB: { playerName: 'B', eloSurface: null, eloOverall: null, rank: 40 },
    h2h: null,
    recentForm: null,
  }), {});
  assert.equal(r.breakdown.baseSource, 'rank');
  assert.equal(r.predicted_winner, 'player_a');
});

test('neutral (no data) yields a coin-flip at floor confidence', () => {
  const r = calculateTennisShadowScore({
    surface: null,
    playerA: { playerName: 'A' },
    playerB: { playerName: 'B' },
    h2h: null,
    context_meta: { overallCompleteness: 0.2 },
  }, {});
  assert.equal(r.breakdown.baseSource, 'neutral');
  assert.equal(r.score, 50);
  assert.ok(r.confidence >= 30); // floor 50 scaled down by completeness
});

test('H2H surface dominance shifts probability toward A', () => {
  const withH2H = calculateTennisShadowScore(ctx(), { surface: 'clay' });
  const noH2H = calculateTennisShadowScore(ctx({ h2h: null }), { surface: 'clay' });
  assert.ok(withH2H.breakdown.h2hShift > 0);
  assert.ok(withH2H.score >= noH2H.score);
});

test('exposes a stable model key', () => {
  assert.equal(TENNIS_SHADOW_MODEL_KEY, 'tennis_shadow_validator_v1');
});
