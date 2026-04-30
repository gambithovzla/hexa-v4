// Tests for aggregateLearnings — pure function, no DB.
// Run: node --test server/services/__tests__/parlayLearnings.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateLearnings, countMissedLegs, getActualLegCount } from '../parlayLearnings.js';

function entry(overrides = {}) {
  return {
    id:                    'db_1',
    date:                  '2026-04-25',
    mode:                  'balanced',
    requested_legs:        3,
    engine:                'sonnet',
    model:                 'fast',
    bet_type:              'all',
    market_focus:          null,
    synergy_type:          'orthogonal_stability',
    combined_decimal_odds: 5.0,
    legs:                  [],
    leg_results:           null,
    result:                'win',
    legs_hit:              3,
    ...overrides,
  };
}

describe('aggregateLearnings', () => {
  it('counts overall summary correctly', () => {
    const out = aggregateLearnings([
      entry({ result: 'win'  }),
      entry({ result: 'win'  }),
      entry({ result: 'loss', legs_hit: 1 }),
      entry({ result: 'push' }),
      entry({ result: 'pending' }),
    ]);
    assert.equal(out.summary.totalRuns,     5);
    assert.equal(out.summary.totalResolved, 4);
    assert.equal(out.summary.wins,          2);
    assert.equal(out.summary.losses,        1);
    assert.equal(out.summary.pushes,        1);
    assert.equal(out.summary.pending,       1);
    // winRate is wins / (wins+losses) — pushes neutral
    assert.equal(out.summary.overallWinRate, 2 / 3);
  });

  it('aggregates by mode and computes winRate per bucket', () => {
    const out = aggregateLearnings([
      entry({ mode: 'dreamer',    result: 'loss', legs_hit: 14, requested_legs: 15 }),
      entry({ mode: 'dreamer',    result: 'loss', legs_hit: 12, requested_legs: 15 }),
      entry({ mode: 'dreamer',    result: 'win',  legs_hit: 15, requested_legs: 15 }),
      entry({ mode: 'conservative', result: 'win',  legs_hit: 3, requested_legs: 3 }),
    ]);
    const dreamer = out.byMode.find(b => b.key === 'dreamer');
    const cons    = out.byMode.find(b => b.key === 'conservative');
    assert.equal(dreamer.total, 3);
    assert.equal(dreamer.wins, 1);
    assert.equal(dreamer.losses, 2);
    assert.equal(dreamer.winRate, 1 / 3);
    assert.equal(dreamer.missBy1, 1, 'one dreamer missed by exactly 1 leg');
    assert.equal(cons.winRate, 1);
  });

  it('breakdowns losses by miss-by-1, miss-by-2, miss-by-3+', () => {
    const out = aggregateLearnings([
      entry({ result: 'loss', requested_legs: 3, legs_hit: 2 }),  // miss by 1
      entry({ result: 'loss', requested_legs: 4, legs_hit: 3 }),  // miss by 1
      entry({ result: 'loss', requested_legs: 5, legs_hit: 3 }),  // miss by 2
      entry({ result: 'loss', requested_legs: 6, legs_hit: 0 }),  // miss by 6 → 3+
      entry({ result: 'win',  requested_legs: 3, legs_hit: 3 }),  // ignored
    ]);
    assert.equal(out.missBreakdown.totalLosses, 4);
    assert.equal(out.missBreakdown.missBy1, 2);
    assert.equal(out.missBreakdown.missBy2, 1);
    assert.equal(out.missBreakdown.missBy3plus, 1);
  });

  it('uses actual built legs and per-leg losses for partial dreamers', () => {
    const partial = entry({
      mode: 'dreamer',
      result: 'loss',
      requested_legs: 20,
      legs_hit: 8,
      legs: Array.from({ length: 10 }, (_, i) => ({ candidateId: `L${i + 1}`, type: 'moneyline' })),
      leg_results: [
        { candidateId: 'L1', result: 'win' },
        { candidateId: 'L2', result: 'win' },
        { candidateId: 'L3', result: 'win' },
        { candidateId: 'L4', result: 'win' },
        { candidateId: 'L5', result: 'win' },
        { candidateId: 'L6', result: 'win' },
        { candidateId: 'L7', result: 'win' },
        { candidateId: 'L8', result: 'win' },
        { candidateId: 'L9', result: 'push' },
        { candidateId: 'L10', result: 'loss' },
      ],
    });

    assert.equal(getActualLegCount(partial), 10);
    assert.equal(countMissedLegs(partial), 1);

    const out = aggregateLearnings([partial]);
    assert.equal(out.missBreakdown.missBy1, 1);
    assert.equal(out.missBreakdown.missBy3plus, 0);
    assert.equal(out.byLegCount[0].key, '10');
  });

  it('aggregates per-leg-type from leg_results', () => {
    const out = aggregateLearnings([
      entry({
        result: 'loss',
        legs_hit: 1,
        legs: [
          { candidateId: 'A', type: 'player_prop' },
          { candidateId: 'B', type: 'player_prop' },
          { candidateId: 'C', type: 'moneyline'   },
        ],
        leg_results: [
          { candidateId: 'A', result: 'loss' },
          { candidateId: 'B', result: 'win'  },
          { candidateId: 'C', result: 'loss' },
        ],
      }),
      entry({
        result: 'win',
        legs_hit: 2,
        legs: [
          { candidateId: 'D', type: 'player_prop' },
          { candidateId: 'E', type: 'moneyline'   },
        ],
        leg_results: [
          { candidateId: 'D', result: 'win' },
          { candidateId: 'E', result: 'win' },
        ],
      }),
    ]);
    const props = out.byLegType.find(b => b.key === 'player_prop');
    const ml    = out.byLegType.find(b => b.key === 'moneyline');
    assert.equal(props.total, 3);
    assert.equal(props.wins, 2);
    assert.equal(props.losses, 1);
    assert.equal(props.winRate, 2 / 3);
    assert.equal(ml.total, 2);
    assert.equal(ml.wins, 1);
    assert.equal(ml.losses, 1);
  });

  it('matches leg_results to legs by candidateId, ignoring order', () => {
    const out = aggregateLearnings([
      entry({
        result: 'loss',
        legs_hit: 1,
        legs: [
          { candidateId: 'A', type: 'player_prop' },
          { candidateId: 'B', type: 'total'       },
        ],
        // results in opposite order
        leg_results: [
          { candidateId: 'B', result: 'loss' },
          { candidateId: 'A', result: 'win'  },
        ],
      }),
    ]);
    const props = out.byLegType.find(b => b.key === 'player_prop');
    const total = out.byLegType.find(b => b.key === 'total');
    assert.equal(props.wins, 1);
    assert.equal(total.losses, 1);
  });

  it('avgDecOdds is mean of combined_decimal_odds across the bucket', () => {
    const out = aggregateLearnings([
      entry({ mode: 'aggressive', combined_decimal_odds: 4 }),
      entry({ mode: 'aggressive', combined_decimal_odds: 6 }),
    ]);
    const agg = out.byMode.find(b => b.key === 'aggressive');
    assert.equal(agg.avgDecOdds, 5);
  });

  it('falls back to market_focus when bet_type is null', () => {
    const out = aggregateLearnings([
      entry({ bet_type: null, market_focus: 'player_prop' }),
      entry({ bet_type: 'moneyline' }),
    ]);
    const props = out.byBetType.find(b => b.key === 'player_prop');
    const ml    = out.byBetType.find(b => b.key === 'moneyline');
    assert.equal(props.total, 1);
    assert.equal(ml.total, 1);
  });

  it('returns empty buckets and null winRate for empty input', () => {
    const out = aggregateLearnings([]);
    assert.equal(out.summary.totalRuns, 0);
    assert.equal(out.summary.overallWinRate, null);
    assert.deepEqual(out.byMode, []);
    assert.deepEqual(out.byLegType, []);
  });

  it('skips pending runs by default but counts them in summary.pending', () => {
    const out = aggregateLearnings([
      entry({ result: 'pending', mode: 'dreamer' }),
      entry({ result: 'win', mode: 'dreamer' }),
    ]);
    const dreamer = out.byMode.find(b => b.key === 'dreamer');
    assert.equal(dreamer.total, 1);
    assert.equal(out.summary.pending, 1);
  });
});
