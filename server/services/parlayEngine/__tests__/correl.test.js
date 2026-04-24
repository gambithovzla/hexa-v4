// Tests for correl.js — uses Node built-in test runner (node:test).
// Run: node --test server/services/parlayEngine/__tests__/correl.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCorrelationMatrix,
  getCorrelation,
  getRiskDistance,
  pairKey,
} from '../correl.js';

// ── Fixture builders ──────────────────────────────────────────────────────

let _seq = 0;
function uid(tag) { return `${tag}_${++_seq}`; }

function baseRiskVector(overrides = {}) {
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

function candidate({
  id,
  gamePk = 100,
  matchup = 'NYY @ BOS',
  marketType = 'moneyline',
  side = 'home',
  propKind = null,
  odds = -130,
  riskVector = baseRiskVector(),
  gameScript = 'neutral',
} = {}) {
  return {
    candidateId: id ?? uid(`${gamePk}_${marketType}_${side}`),
    gamePk,
    matchup,
    marketType,
    side,
    propKind,
    odds,
    riskVector,
    gameScript,
  };
}

// ── pairKey symmetry ──────────────────────────────────────────────────────

describe('pairKey', () => {
  it('is symmetric: pairKey(A,B) === pairKey(B,A)', () => {
    const A = candidate({ id: 'aaa' });
    const B = candidate({ id: 'bbb' });
    assert.strictEqual(pairKey(A, B), pairKey(B, A));
  });
});

// ── Same-game correlations ────────────────────────────────────────────────

describe('same-game correlations', () => {
  it('ML home vs ML away → -0.95 (direct contradiction)', () => {
    const home = candidate({ gamePk: 1, marketType: 'moneyline', side: 'home', odds: -150 });
    const away = candidate({ gamePk: 1, marketType: 'moneyline', side: 'away', odds: 130 });
    const { correlations } = buildCorrelationMatrix([home, away]);
    assert.strictEqual(getCorrelation(correlations, home, away), -0.95);
  });

  it('RL home vs RL away → -0.95 (direct contradiction)', () => {
    const rl_h = candidate({ gamePk: 1, marketType: 'runline', side: 'home', odds: 110 });
    const rl_a = candidate({ gamePk: 1, marketType: 'runline', side: 'away', odds: -130 });
    const { correlations } = buildCorrelationMatrix([rl_h, rl_a]);
    assert.strictEqual(getCorrelation(correlations, rl_h, rl_a), -0.95);
  });

  it('pitcher Ks over + total Under → +0.45 (positive synergy)', () => {
    const under = candidate({ gamePk: 2, marketType: 'overunder', side: 'under', odds: -110 });
    const ks = candidate({ gamePk: 2, marketType: 'playerprop', side: 'over', propKind: 'k', odds: -115 });
    const { correlations } = buildCorrelationMatrix([under, ks]);
    assert.strictEqual(getCorrelation(correlations, under, ks), 0.45);
  });

  it('total Over + batter hits over → +0.35 (positive synergy)', () => {
    const over = candidate({ gamePk: 3, marketType: 'overunder', side: 'over', odds: -110 });
    const hits = candidate({ gamePk: 3, marketType: 'playerprop', side: 'over', propKind: 'hits', odds: -145 });
    const { correlations } = buildCorrelationMatrix([over, hits]);
    assert.strictEqual(getCorrelation(correlations, over, hits), 0.35);
  });

  it('ML home favorite (odds < 0) + Under → -0.30', () => {
    const mlFav = candidate({ gamePk: 4, marketType: 'moneyline', side: 'home', odds: -160 });
    const under = candidate({ gamePk: 4, marketType: 'overunder', side: 'under', odds: -110 });
    const { correlations } = buildCorrelationMatrix([mlFav, under]);
    assert.strictEqual(getCorrelation(correlations, mlFav, under), -0.30);
  });

  it('ML home underdog (odds > 0) + Under → 0 (no rule fires)', () => {
    const mlDog = candidate({ gamePk: 5, marketType: 'moneyline', side: 'home', odds: 120 });
    const under = candidate({ gamePk: 5, marketType: 'overunder', side: 'under', odds: -110 });
    const { correlations } = buildCorrelationMatrix([mlDog, under]);
    assert.strictEqual(getCorrelation(correlations, mlDog, under), 0);
  });

  it('ML home + Over → 0 (ambiguous, no rule)', () => {
    const ml = candidate({ gamePk: 6, marketType: 'moneyline', side: 'home', odds: -130 });
    const over = candidate({ gamePk: 6, marketType: 'overunder', side: 'over', odds: -110 });
    const { correlations } = buildCorrelationMatrix([ml, over]);
    assert.strictEqual(getCorrelation(correlations, ml, over), 0);
  });

  it('order-independent: corr(under, ks) === corr(ks, under)', () => {
    const under = candidate({ gamePk: 7, marketType: 'overunder', side: 'under', odds: -110 });
    const ks = candidate({ gamePk: 7, marketType: 'playerprop', side: 'over', propKind: 'k', odds: -115 });
    const { correlations } = buildCorrelationMatrix([under, ks]);
    assert.strictEqual(getCorrelation(correlations, under, ks), getCorrelation(correlations, ks, under));
  });
});

// ── Cross-game correlations ───────────────────────────────────────────────

describe('cross-game correlations', () => {
  it('same non-neutral gameScript → +0.15', () => {
    const A = candidate({ gamePk: 10, gameScript: 'pitchers_duel' });
    const B = candidate({ gamePk: 11, gameScript: 'pitchers_duel' });
    const { correlations } = buildCorrelationMatrix([A, B]);
    assert.strictEqual(getCorrelation(correlations, A, B), 0.15);
  });

  it('pitchers_duel vs slugfest → -0.10', () => {
    const A = candidate({ gamePk: 12, gameScript: 'pitchers_duel' });
    const B = candidate({ gamePk: 13, gameScript: 'slugfest' });
    const { correlations } = buildCorrelationMatrix([A, B]);
    assert.strictEqual(getCorrelation(correlations, A, B), -0.10);
  });

  it('both neutral scripts → 0', () => {
    const A = candidate({ gamePk: 14, gameScript: 'neutral' });
    const B = candidate({ gamePk: 15, gameScript: 'neutral' });
    const { correlations } = buildCorrelationMatrix([A, B]);
    assert.strictEqual(getCorrelation(correlations, A, B), 0);
  });

  it('same region + both high weather exposure → +0.20', () => {
    const A = candidate({
      gamePk: 16,
      matchup: 'TOR @ BOS', // BOS → ne
      gameScript: 'neutral',
      riskVector: baseRiskVector({ weather_exposure: 0.8 }),
    });
    const B = candidate({
      gamePk: 17,
      matchup: 'TB @ NYY',  // NYY → ne
      gameScript: 'neutral',
      riskVector: baseRiskVector({ weather_exposure: 0.75 }),
    });
    const { correlations } = buildCorrelationMatrix([A, B]);
    assert.strictEqual(getCorrelation(correlations, A, B), 0.20);
  });

  it('different regions with high weather exposure → 0 (no regional overlap)', () => {
    const A = candidate({
      gamePk: 18,
      matchup: 'NYM @ NYY', // NYY → ne
      gameScript: 'neutral',
      riskVector: baseRiskVector({ weather_exposure: 0.8 }),
    });
    const B = candidate({
      gamePk: 19,
      matchup: 'ARI @ LAD', // LAD → pac
      gameScript: 'neutral',
      riskVector: baseRiskVector({ weather_exposure: 0.8 }),
    });
    const { correlations } = buildCorrelationMatrix([A, B]);
    assert.strictEqual(getCorrelation(correlations, A, B), 0);
  });

  it('same region but low weather exposure → 0', () => {
    const A = candidate({
      gamePk: 20,
      matchup: 'TOR @ BOS',
      gameScript: 'neutral',
      riskVector: baseRiskVector({ weather_exposure: 0.3 }),
    });
    const B = candidate({
      gamePk: 21,
      matchup: 'TB @ NYY',
      gameScript: 'neutral',
      riskVector: baseRiskVector({ weather_exposure: 0.3 }),
    });
    const { correlations } = buildCorrelationMatrix([A, B]);
    assert.strictEqual(getCorrelation(correlations, A, B), 0);
  });

  it('same region + high weather + same script → max(0.20, 0.15) = 0.20', () => {
    const A = candidate({
      gamePk: 22,
      matchup: 'TOR @ BOS',
      gameScript: 'wind_out',
      riskVector: baseRiskVector({ weather_exposure: 0.85 }),
    });
    const B = candidate({
      gamePk: 23,
      matchup: 'TB @ NYY',
      gameScript: 'wind_out',
      riskVector: baseRiskVector({ weather_exposure: 0.80 }),
    });
    const { correlations } = buildCorrelationMatrix([A, B]);
    assert.strictEqual(getCorrelation(correlations, A, B), 0.20);
  });
});

// ── Risk distance ─────────────────────────────────────────────────────────

describe('riskDistance', () => {
  it('is 0 for identical risk vectors', () => {
    const rv = baseRiskVector({ pitching_dominance: 0.8, weather_exposure: 0.6 });
    const A = candidate({ gamePk: 30, riskVector: rv });
    const B = candidate({ gamePk: 31, riskVector: { ...rv } });
    const { riskDistances } = buildCorrelationMatrix([A, B]);
    assert.ok(Math.abs(getRiskDistance(riskDistances, A, B)) < 0.0001);
  });

  it('is √6 ≈ 2.449 for fully opposite vectors (0 vs 1 in all 6 dims)', () => {
    const A = candidate({
      gamePk: 32,
      riskVector: { pitching_dominance: 0, bullpen_exposure: 0, weather_exposure: 0, lineup_variance: 0, umpire_sensitivity: 0, ballpark_bias: 0 },
    });
    const B = candidate({
      gamePk: 33,
      riskVector: { pitching_dominance: 1, bullpen_exposure: 1, weather_exposure: 1, lineup_variance: 1, umpire_sensitivity: 1, ballpark_bias: 1 },
    });
    const { riskDistances } = buildCorrelationMatrix([A, B]);
    const d = getRiskDistance(riskDistances, A, B);
    assert.ok(Math.abs(d - Math.sqrt(6)) < 0.0001, `expected √6 ≈ 2.449, got ${d}`);
  });

  it('is symmetric: dist(A,B) === dist(B,A)', () => {
    const A = candidate({ gamePk: 34, riskVector: baseRiskVector({ pitching_dominance: 0.9 }) });
    const B = candidate({ gamePk: 35, riskVector: baseRiskVector({ pitching_dominance: 0.1 }) });
    const { riskDistances } = buildCorrelationMatrix([A, B]);
    assert.strictEqual(getRiskDistance(riskDistances, A, B), getRiskDistance(riskDistances, B, A));
  });

  it('is 0 if riskVectors are missing (graceful fallback)', () => {
    const A = candidate({ gamePk: 36, riskVector: null });
    const B = candidate({ gamePk: 37, riskVector: null });
    const { riskDistances } = buildCorrelationMatrix([A, B]);
    assert.strictEqual(getRiskDistance(riskDistances, A, B), 0);
  });
});

// ── Matrix invariants ─────────────────────────────────────────────────────

describe('matrix invariants', () => {
  it('all correlation values are in [-1, 1]', () => {
    const pool = [
      candidate({ id: 'inv_1', gamePk: 40, marketType: 'moneyline', side: 'home', odds: -150, gameScript: 'pitchers_duel', riskVector: baseRiskVector({ weather_exposure: 0.9 }) }),
      candidate({ id: 'inv_2', gamePk: 40, marketType: 'moneyline', side: 'away', odds: 130, gameScript: 'pitchers_duel' }),
      candidate({ id: 'inv_3', gamePk: 41, marketType: 'overunder', side: 'under', odds: -110, gameScript: 'slugfest' }),
      candidate({ id: 'inv_4', gamePk: 41, marketType: 'playerprop', side: 'over', propKind: 'k', odds: -115, gameScript: 'slugfest', riskVector: baseRiskVector({ weather_exposure: 0.85 }) }),
      candidate({ id: 'inv_5', gamePk: 42, marketType: 'moneyline', side: 'home', odds: -120, gameScript: 'neutral' }),
    ];
    const { correlations } = buildCorrelationMatrix(pool);
    for (const [key, val] of Object.entries(correlations)) {
      assert.ok(val >= -1 && val <= 1, `${key}: ${val} out of [-1,1]`);
    }
  });

  it('matrix has N*(N-1)/2 entries for N candidates', () => {
    const N = 5;
    const pool = Array.from({ length: N }, (_, i) =>
      candidate({ id: `sym_${i}`, gamePk: 50 + i }),
    );
    const { correlations } = buildCorrelationMatrix(pool);
    assert.strictEqual(Object.keys(correlations).length, N * (N - 1) / 2);
  });

  it('missing pair defaults to 0 via getCorrelation', () => {
    const A = candidate({ id: 'missing_a', gamePk: 60 });
    const B = candidate({ id: 'missing_b', gamePk: 61 });
    assert.strictEqual(getCorrelation({}, A, B), 0);
  });

  it('missing pair defaults to 0 via getRiskDistance', () => {
    const A = candidate({ id: 'dist_missing_a', gamePk: 70 });
    const B = candidate({ id: 'dist_missing_b', gamePk: 71 });
    assert.strictEqual(getRiskDistance({}, A, B), 0);
  });
});
