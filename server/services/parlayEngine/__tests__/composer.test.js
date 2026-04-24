// Tests for composer.js — uses Node built-in test runner (node:test).
// Run: node --test server/services/parlayEngine/__tests__/composer.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { composeParlays, isParlayValid } from '../composer.js';
import { buildCorrelationMatrix, pairKey } from '../correl.js';

// ── Fixture factory ───────────────────────────────────────────────────────

let _seq = 0;

function baseRV(overrides = {}) {
  return {
    pitching_dominance: 0.5,
    bullpen_exposure:   0.2,
    weather_exposure:   0.1,
    lineup_variance:    0.35,
    umpire_sensitivity: 0.2,
    ballpark_bias:      0.0,
    ...overrides,
  };
}

/**
 * Build a ParlayCandidate fixture.
 * Each call with no explicit id gets a fresh unique id.
 */
function cand({
  id,
  gamePk = 1,
  marketType = 'moneyline',
  side = 'home',
  propKind = null,
  odds = -130,
  decimalOdds = 1.77,
  modelProbability = 62,
  edge = 4,
  dataQualityScore = 75,
  xgbAgreement = true,
  modelRisk = 'medium',
  riskVector = baseRV(),
  gameScript = 'neutral',
} = {}) {
  const seq = ++_seq;
  return {
    candidateId: id ?? `c${seq}_${gamePk}_${marketType}_${side}`,
    gamePk,
    matchup: 'NYY @ BOS',
    gameDate: '2026-04-23',
    marketType,
    side,
    propKind,
    odds,
    decimalOdds,
    modelProbability,
    edge,
    impliedProbability: 50,
    dataQualityScore,
    xgbAgreement,
    modelRisk,
    riskVector,
    gameScript,
    reasoning: 'Test candidate',
  };
}

/**
 * Build a pool of N distinct-game candidates all with solid edges.
 * Games are gamePk 100, 101, 102, ...
 */
function solidPool(count = 15) {
  return Array.from({ length: count }, (_, i) => cand({
    id: `solid_${i}`,
    gamePk: 100 + i,
    edge: 5 + (i % 4),          // 5–8
    modelProbability: 64 + (i % 8),
    dataQualityScore: 72 + (i % 10),
    riskVector: baseRV({ pitching_dominance: 0.3 + (i % 5) * 0.1 }),
    gameScript: ['neutral', 'pitchers_duel', 'bullpen_fade', 'slugfest', 'neutral'][i % 5],
  }));
}

// ── isParlayValid ─────────────────────────────────────────────────────────

describe('isParlayValid', () => {
  it('accepts a clean N=3 set with no issues', () => {
    const legs = [
      cand({ id: 'v1', gamePk: 1, edge: 4, modelRisk: 'medium' }),
      cand({ id: 'v2', gamePk: 2, edge: 3, modelRisk: 'low' }),
      cand({ id: 'v3', gamePk: 3, edge: 5, modelRisk: 'medium' }),
    ];
    const { correlations } = buildCorrelationMatrix(legs);
    const result = isParlayValid(legs, correlations, 'balanced');
    assert.ok(result.valid, `expected valid, got: ${result.reason}`);
  });

  it('rejects a pair with strong negative correlation (ML home vs ML away)', () => {
    const home = cand({ id: 'neg_home', gamePk: 10, marketType: 'moneyline', side: 'home', odds: -150, edge: 4 });
    const away = cand({ id: 'neg_away', gamePk: 10, marketType: 'moneyline', side: 'away', odds: 130, edge: 4 });
    const filler = cand({ id: 'neg_fill', gamePk: 11, edge: 4 });
    const { correlations } = buildCorrelationMatrix([home, away, filler]);
    const result = isParlayValid([home, away, filler], correlations, 'balanced');
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, 'strong_negative_correlation');
  });

  it('rejects more same-game legs than the mode allows', () => {
    const a = cand({ id: 'sgp3a', gamePk: 20, marketType: 'moneyline', side: 'home', odds: -130, edge: 4 });
    const b = cand({ id: 'sgp3b', gamePk: 20, marketType: 'overunder', side: 'under', odds: -110, edge: 3 });
    const c2 = cand({ id: 'sgp3c', gamePk: 20, marketType: 'playerprop', side: 'over', propKind: 'k', odds: -115, edge: 3 });
    const { correlations } = buildCorrelationMatrix([a, b, c2]);
    const result = isParlayValid([a, b, c2], correlations, 'conservative');
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, 'too_many_same_game');
  });

  it('rejects SGP pair without positive correlation in conservative mode', () => {
    // Two different market types from same game with no positive correlation rule
    const ml = cand({ id: 'sgp_ml', gamePk: 30, marketType: 'moneyline', side: 'away', odds: 120, edge: 4 });
    const rl = cand({ id: 'sgp_rl', gamePk: 30, marketType: 'runline', side: 'home', odds: 105, edge: 4 });
    const { correlations } = buildCorrelationMatrix([ml, rl]);
    // corr(ml away, rl home) = 0 by default → < 0.15 → invalid SGP
    const result = isParlayValid([ml, rl], correlations, 'conservative');
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, 'sgp_without_positive_correlation');
  });

  it('accepts a valid SGP pair with positive correlation', () => {
    const under = cand({ id: 'sgp_under', gamePk: 40, marketType: 'overunder', side: 'under', odds: -110, edge: 4 });
    const ks = cand({ id: 'sgp_ks', gamePk: 40, marketType: 'playerprop', side: 'over', propKind: 'k', odds: -115, edge: 4 });
    const { correlations } = buildCorrelationMatrix([under, ks]);
    // corr = 0.45 → valid SGP
    const result = isParlayValid([under, ks], correlations, 'balanced');
    assert.ok(result.valid, `expected valid SGP, got: ${result.reason}`);
  });

  it('rejects high-risk leg in conservative mode', () => {
    const legs = [
      cand({ id: 'cr1', gamePk: 50, edge: 4, modelRisk: 'low' }),
      cand({ id: 'cr2', gamePk: 51, edge: 4, modelRisk: 'high' }), // high risk
      cand({ id: 'cr3', gamePk: 52, edge: 4, modelRisk: 'medium' }),
    ];
    const { correlations } = buildCorrelationMatrix(legs);
    const result = isParlayValid(legs, correlations, 'conservative');
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, 'high_risk_leg_in_conservative_mode');
  });

  it('rejects leg with edge below mode minimum', () => {
    const legs = [
      cand({ id: 'edge1', gamePk: 60, edge: 5 }),
      cand({ id: 'edge2', gamePk: 61, edge: 2.5 }), // < 3 (conservative min)
      cand({ id: 'edge3', gamePk: 62, edge: 4 }),
    ];
    const { correlations } = buildCorrelationMatrix(legs);
    const result = isParlayValid(legs, correlations, 'conservative');
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, 'edge_below_minimum');
  });

  it('allows null-edge player props outside conservative mode', () => {
    const legs = [
      cand({ id: 'null_edge1', gamePk: 63, marketType: 'playerprop', propKind: 'hits', odds: null, decimalOdds: null, edge: null, modelProbability: 72 }),
      cand({ id: 'null_edge2', gamePk: 64, marketType: 'playerprop', propKind: 'k', odds: null, decimalOdds: null, edge: null, modelProbability: 68 }),
      cand({ id: 'null_edge3', gamePk: 65, edge: 4 }),
    ];
    const { correlations } = buildCorrelationMatrix(legs);
    const result = isParlayValid(legs, correlations, 'dreamer');
    assert.ok(result.valid, `expected null-edge props to be valid in dreamer, got: ${result.reason}`);
  });

  it('rejects null-edge player props in conservative mode', () => {
    const legs = [
      cand({ id: 'cons_null1', gamePk: 66, marketType: 'playerprop', propKind: 'hits', odds: null, decimalOdds: null, edge: null, modelProbability: 72 }),
      cand({ id: 'cons_null2', gamePk: 67, edge: 4 }),
    ];
    const { correlations } = buildCorrelationMatrix(legs);
    const result = isParlayValid(legs, correlations, 'conservative');
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, 'edge_below_minimum');
  });

  it('rejects SGP when allowSGP=false', () => {
    const a = cand({ id: 'nosgp_a', gamePk: 70, marketType: 'overunder', side: 'under', edge: 4 });
    const b = cand({ id: 'nosgp_b', gamePk: 70, marketType: 'playerprop', propKind: 'k', edge: 4 });
    const { correlations } = buildCorrelationMatrix([a, b]);
    const result = isParlayValid([a, b], correlations, 'balanced', { allowSGP: false });
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, 'sgp_not_allowed');
  });
});

// ── composeParlays ────────────────────────────────────────────────────────

describe('composeParlays', () => {
  it('returns up to 3 combinations for a solid pool with N=3', () => {
    const pool = solidPool(15);
    const corrMatrix = buildCorrelationMatrix(pool);
    const { parlays } = composeParlays({ candidates: pool, correlationMatrix: corrMatrix, N: 3, mode: 'balanced' });

    assert.ok(parlays.length >= 1, `expected at least 1 parlay, got ${parlays.length}`);
    assert.ok(parlays.length <= 3, `expected at most 3 parlays, got ${parlays.length}`);
  });

  it('each combination has exactly N legs', () => {
    const N = 4;
    const pool = solidPool(18);
    const corrMatrix = buildCorrelationMatrix(pool);
    const { parlays } = composeParlays({ candidates: pool, correlationMatrix: corrMatrix, N, mode: 'balanced' });

    for (const parlay of parlays) {
      assert.strictEqual(parlay.legs.length, N, `parlay #${parlay.index} has ${parlay.legs.length} legs, expected ${N}`);
    }
  });

  it('all combinations pass isParlayValid', () => {
    const pool = solidPool(15);
    const corrMatrix = buildCorrelationMatrix(pool);
    const { parlays } = composeParlays({ candidates: pool, correlationMatrix: corrMatrix, N: 3, mode: 'balanced' });

    for (const parlay of parlays) {
      const v = isParlayValid(parlay.legs, corrMatrix.correlations, 'balanced');
      assert.ok(v.valid, `parlay #${parlay.index} failed validity: ${v.reason}`);
    }
  });

  it('all legs within a combination have unique candidateIds', () => {
    const pool = solidPool(18);
    const corrMatrix = buildCorrelationMatrix(pool);
    const { parlays } = composeParlays({ candidates: pool, correlationMatrix: corrMatrix, N: 4, mode: 'balanced' });

    for (const parlay of parlays) {
      const ids = parlay.legs.map(l => l.candidateId);
      assert.strictEqual(new Set(ids).size, ids.length, `parlay #${parlay.index} has duplicate legs`);
    }
  });

  it('combinations are ordered by score descending', () => {
    const pool = solidPool(18);
    const corrMatrix = buildCorrelationMatrix(pool);
    const { parlays } = composeParlays({ candidates: pool, correlationMatrix: corrMatrix, N: 3, mode: 'balanced' });

    for (let i = 1; i < parlays.length; i++) {
      assert.ok(
        parlays[i - 1].score >= parlays[i].score,
        `parlay #${i - 1} score ${parlays[i - 1].score} < parlay #${i} score ${parlays[i].score}`,
      );
    }
  });

  it('score breakdown has all required fields', () => {
    const pool = solidPool(15);
    const corrMatrix = buildCorrelationMatrix(pool);
    const { parlays } = composeParlays({ candidates: pool, correlationMatrix: corrMatrix, N: 3, mode: 'balanced' });

    assert.ok(parlays.length > 0, 'need at least one parlay to check breakdown');
    const bd = parlays[0].scoreBreakdown;
    const requiredFields = ['edge_sum', 'corr_bonus', 'risk_div_bonus', 'length_penalty', 'neg_corr_penalty', 'dq_penalty', 'script_bonus'];
    for (const f of requiredFields) {
      assert.ok(f in bd, `missing scoreBreakdown field: ${f}`);
      assert.ok(typeof bd[f] === 'number', `scoreBreakdown.${f} must be a number`);
    }
  });

  it('combinedMarginalProbability and combinedDecimalOdds are correct', () => {
    const legs = [
      cand({ id: 'prob1', gamePk: 200, modelProbability: 60, decimalOdds: 2.0, edge: 5 }),
      cand({ id: 'prob2', gamePk: 201, modelProbability: 70, decimalOdds: 1.5, edge: 5 }),
      cand({ id: 'prob3', gamePk: 202, modelProbability: 65, decimalOdds: 1.8, edge: 5 }),
    ];
    const corrMatrix = buildCorrelationMatrix(legs);
    const { parlays } = composeParlays({ candidates: legs, correlationMatrix: corrMatrix, N: 3, mode: 'balanced' });

    assert.ok(parlays.length > 0);
    const p = parlays[0];
    // Product of probs: 0.60 * 0.70 * 0.65 = 0.273
    assert.ok(Math.abs(p.combinedMarginalProbability - 0.273) < 0.001,
      `expected ~0.273, got ${p.combinedMarginalProbability}`);
    // Product of decimal odds: 2.0 * 1.5 * 1.8 = 5.4
    assert.ok(Math.abs(p.combinedDecimalOdds - 5.4) < 0.001,
      `expected ~5.4, got ${p.combinedDecimalOdds}`);
  });

  it('conservative mode excludes candidates below edge=3', () => {
    // Mix: half have edge=2 (below conservative min=3), half have edge=4
    const pool = Array.from({ length: 20 }, (_, i) => cand({
      id: `cons_${i}`,
      gamePk: 300 + i,
      edge: i < 10 ? 2 : 4,    // first 10 have edge=2
      modelRisk: 'medium',
    }));
    const corrMatrix = buildCorrelationMatrix(pool);
    const { parlays } = composeParlays({ candidates: pool, correlationMatrix: corrMatrix, N: 3, mode: 'conservative' });

    // All legs in all parlays must have edge >= 3
    for (const parlay of parlays) {
      for (const leg of parlay.legs) {
        assert.ok((leg.edge ?? 0) >= 3, `conservative parlay has leg with edge=${leg.edge}`);
      }
    }
  });

  it('returns a partial parlay when eligible pool is too small for requested N', () => {
    const pool = [
      cand({ id: 'small1', gamePk: 400, edge: 5 }),
      cand({ id: 'small2', gamePk: 401, edge: 5 }),
    ];
    const corrMatrix = buildCorrelationMatrix(pool);
    const { parlays } = composeParlays({ candidates: pool, correlationMatrix: corrMatrix, N: 5, mode: 'balanced' });
    assert.strictEqual(parlays.length, 1);
    assert.strictEqual(parlays[0].legs.length, 2);
    assert.match(parlays[0].partial_warning, /2 of 5 requested legs/);
  });

  it('builds dreamer parlays using null-edge player props', () => {
    const standards = Array.from({ length: 3 }, (_, i) => cand({
      id: `dream_standard_${i}`,
      gamePk: 700 + i,
      edge: 5,
      modelProbability: 62,
    }));
    const props = Array.from({ length: 17 }, (_, i) => cand({
      id: `dream_prop_${i}`,
      gamePk: 710 + i,
      marketType: 'playerprop',
      side: 'over',
      propKind: i % 2 === 0 ? 'hits' : 'k',
      odds: null,
      decimalOdds: null,
      edge: null,
      modelProbability: 64 + (i % 8),
      dataQualityScore: 74,
    }));
    const pool = [...standards, ...props];
    const corrMatrix = buildCorrelationMatrix(pool);

    const { parlays, meta } = composeParlays({
      candidates: pool,
      correlationMatrix: corrMatrix,
      N: 20,
      mode: 'dreamer',
    });

    assert.ok(parlays.length > 0, 'expected a dreamer parlay with null-edge props');
    assert.strictEqual(meta.eligibleCount, 20);
    assert.strictEqual(parlays[0].legs.length, 20);
  });

  it('meta.eligibleCount reflects filtered candidates', () => {
    const pool = [
      ...Array.from({ length: 10 }, (_, i) => cand({ id: `eli_ok_${i}`, gamePk: 500 + i, edge: 5 })),
      ...Array.from({ length: 5 }, (_, i) => cand({ id: `eli_bad_${i}`, gamePk: 510 + i, edge: 1 })), // below minEdge
    ];
    const corrMatrix = buildCorrelationMatrix(pool);
    const { meta } = composeParlays({ candidates: pool, correlationMatrix: corrMatrix, N: 3, mode: 'balanced', filters: { minEdge: 3 } });
    assert.strictEqual(meta.eligibleCount, 10);
  });

  it('allowSGP=false prevents same-game legs in result', () => {
    const under = cand({ id: 'nosgp_under', gamePk: 600, marketType: 'overunder', side: 'under', edge: 8 });
    const ks = cand({ id: 'nosgp_ks', gamePk: 600, marketType: 'playerprop', propKind: 'k', edge: 7 });
    const others = Array.from({ length: 8 }, (_, i) => cand({ id: `nosgp_other_${i}`, gamePk: 601 + i, edge: 5 }));
    const pool = [under, ks, ...others];
    const corrMatrix = buildCorrelationMatrix(pool);

    const { parlays } = composeParlays({
      candidates: pool, correlationMatrix: corrMatrix, N: 3, mode: 'balanced', filters: { allowSGP: false },
    });

    for (const parlay of parlays) {
      const gamePks = parlay.legs.map(l => l.gamePk);
      const uniqueGames = new Set(gamePks);
      assert.strictEqual(uniqueGames.size, gamePks.length, `parlay has same-game legs despite allowSGP=false`);
    }
  });
});
