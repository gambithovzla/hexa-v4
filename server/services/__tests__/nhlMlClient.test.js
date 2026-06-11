import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNhlFeaturePayload } from '../nhlMlClient.js';

const context = {
  home: {
    goalDiff: 24,
    goalsForPerGame: 3.4,
    goalsAgainstPerGame: 2.7,
    pointsPct: 0.65,
    ppPct: null,
    pkPct: null,
    recentForm: { record: '7-3' },
    restDays: 2,
    isBackToBack: false,
    goalieStatus: null,
    injuries: { severeCount: 1 },
  },
  away: {
    goalDiff: -10,
    goalsForPerGame: 2.8,
    goalsAgainstPerGame: 3.2,
    pointsPct: 0.48,
    recentForm: { record: '4-6' },
    restDays: 1,
    isBackToBack: true,
    goalieStatus: { statusKey: 'out' },
    injuries: { severeCount: 3 },
  },
  context_meta: { overallCompleteness: 85 },
};

const marketOdds = {
  moneyline: { home: -145, away: 125 },
  puckLine: { home: 180, away: -210 },
  total: { line: 6.5, over: -110, under: -110 },
};

test('buildNhlFeaturePayload maps context + odds to training-frame columns', () => {
  const p = buildNhlFeaturePayload(context, { oracleConfidence: 62 }, marketOdds);
  assert.equal(p.home_goal_diff, 24);
  assert.equal(p.away_ga_per_game, 3.2);
  assert.equal(p.home_points_pct, 0.65);
  assert.equal(p.home_last10_wins, 7);
  assert.equal(p.away_last10_wins, 4);
  assert.equal(p.home_is_b2b, 0);
  assert.equal(p.away_is_b2b, 1);
  assert.equal(p.odds_ml_home, -145);
  assert.equal(p.odds_ou_total, 6.5);
  assert.equal(p.line, 6.5);
  assert.equal(p.puck_line_close, 1.5);
  assert.equal(p.context_completeness, 85);
  assert.equal(p.oracle_confidence, 62);
});

test('goalie out in injury feed marks starter unconfirmed; absent feed is null', () => {
  const p = buildNhlFeaturePayload(context, {}, marketOdds);
  assert.equal(p.goalie_home_confirmed, null);
  assert.equal(p.goalie_away_confirmed, 0);

  const healthy = buildNhlFeaturePayload(
    { ...context, away: { ...context.away, goalieStatus: { statusKey: 'day_to_day' } } },
    {},
    marketOdds,
  );
  assert.equal(healthy.goalie_away_confirmed, 1);
});

test('tolerates empty context and odds without throwing', () => {
  const p = buildNhlFeaturePayload({}, {}, {});
  assert.equal(p.home_goal_diff, null);
  assert.equal(p.home_last10_wins, null);
  assert.equal(p.odds_ml_home, null);
  assert.equal(p.oracle_confidence, null);
  assert.equal(p.puck_line_close, 1.5);
});
