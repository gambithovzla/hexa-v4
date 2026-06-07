import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildNflGameCandidates, buildNflParlayCandidates } from '../nflParlayCandidates.js';
import { buildCorrelationMatrix } from '../correl.js';
import { composeParlays } from '../composer.js';
import { computeHitDistribution } from '../hitMath.js';

const GAME = {
  gameId: '401547417',
  matchup: 'KC @ BUF',
  gameDate: '2026-09-13',
  homeAbbr: 'BUF',
  awayAbbr: 'KC',
  odds: {
    moneyline: { home: -150, away: 130 },
    spread: { home: -3, homePrice: -110, away: 3, awayPrice: -110 },
    total: { line: 47.5, overPrice: -105, underPrice: -115 },
  },
};

test('buildNflGameCandidates: emits ML + spread + total in engine shape', () => {
  const cands = buildNflGameCandidates(GAME);
  assert.equal(cands.length, 3);
  const markets = cands.map(c => c.marketType).sort();
  assert.deepEqual(markets, ['moneyline', 'overunder', 'spread']);
  for (const c of cands) {
    assert.ok(c.candidateId.startsWith('nfl_401547417::'));
    assert.equal(c.gamePk, '401547417');
    assert.ok(c.modelProbability > 0 && c.modelProbability <= 100);
    assert.ok(typeof c.decimalOdds === 'number');
  }
});

test('buildNflGameCandidates: implied-only fallback picks the favorite (home -150)', () => {
  const ml = buildNflGameCandidates(GAME).find(c => c.marketType === 'moneyline');
  assert.equal(ml.side, 'home'); // -150 favorite
  assert.equal(ml.pick, 'BUF ML');
  // edge ~0 when model falls back to implied
  assert.ok(Math.abs(ml.edge) < 0.5);
});

test('buildNflGameCandidates: model probability overrides side + drives edge', () => {
  const withModel = { ...GAME, model: { moneyline: 0.30, spread: 0.40, total: 0.70 } };
  const cands = buildNflGameCandidates(withModel);
  const ml = cands.find(c => c.marketType === 'moneyline');
  // P(home)=0.30 → away is favored by the model
  assert.equal(ml.side, 'away');
  const tot = cands.find(c => c.marketType === 'overunder');
  assert.equal(tot.side, 'over'); // pOver=0.70
  assert.ok(tot.modelProbability >= 69 && tot.modelProbability <= 71);
});

test('buildNflGameCandidates: no candidates without odds', () => {
  assert.deepEqual(buildNflGameCandidates({ gameId: 'x', odds: {} }), []);
});

test('integration: candidates feed the frozen engine end-to-end', () => {
  const g2 = {
    ...GAME, gameId: '999', matchup: 'SF @ DAL', homeAbbr: 'DAL', awayAbbr: 'SF',
    model: { moneyline: 0.66, spread: 0.58, total: 0.40 },
  };
  const g1 = { ...GAME, model: { moneyline: 0.64, spread: 0.55, total: 0.62 } };
  const candidates = buildNflParlayCandidates([g1, g2]);
  assert.equal(candidates.length, 6);

  const correlationMatrix = buildCorrelationMatrix(candidates);
  const { parlays } = composeParlays({ candidates, correlationMatrix, N: 2, mode: 'safe' });
  assert.ok(Array.isArray(parlays));
  if (parlays.length) {
    const hd = computeHitDistribution(parlays[0].legs.map(l => l.modelProbability / 100));
    assert.equal(hd.n, parlays[0].legs.length);
    assert.ok(hd.p_all > 0 && hd.p_all <= 1);
  }
});
