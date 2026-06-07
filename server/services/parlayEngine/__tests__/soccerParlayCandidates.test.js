import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSoccerGameCandidates, buildSoccerParlayCandidates } from '../soccerParlayCandidates.js';
import { buildCorrelationMatrix } from '../correl.js';
import { composeParlays } from '../composer.js';
import { computeHitDistribution } from '../hitMath.js';

const GAME = {
  gameId: '704321',
  matchup: 'CHE @ ARS',
  gameDate: '2026-09-13',
  homeAbbr: 'ARS',
  awayAbbr: 'CHE',
  odds: {
    threeWay: { home: -120, draw: 260, away: 320 }, // home favored
    total: { line: 2.5, overPrice: -130, underPrice: 105 },
    btts: { yes: -110, no: -110 },
  },
};

test('buildSoccerGameCandidates: emits 1X2 + total + btts in engine shape', () => {
  const cands = buildSoccerGameCandidates(GAME);
  assert.equal(cands.length, 3);
  const markets = cands.map(c => c.marketType).sort();
  assert.deepEqual(markets, ['btts', 'moneyline', 'overunder']);
  for (const c of cands) {
    assert.ok(c.candidateId.startsWith('soccer_704321::'));
    assert.equal(c.gamePk, '704321');
    assert.ok(c.modelProbability > 0 && c.modelProbability <= 100);
    assert.ok(typeof c.decimalOdds === 'number');
  }
});

test('buildSoccerGameCandidates: 1X2 picks the most likely outcome (home favored)', () => {
  const ml = buildSoccerGameCandidates(GAME).find(c => c.marketType === 'moneyline');
  assert.equal(ml.side, 'home');
  assert.equal(ml.pick, 'ARS Win');
});

test('buildSoccerGameCandidates: model overrides 1X2 → draw can win the leg', () => {
  // Model says home only 20% → with de-vig draw/away rescaled, away/draw may top home.
  const withModel = { ...GAME, model: { moneyline: 0.20, total: 0.70, btts: 0.66 } };
  const cands = buildSoccerGameCandidates(withModel);
  const ml = cands.find(c => c.marketType === 'moneyline');
  assert.notEqual(ml.side, 'home'); // home no longer the favorite at 20%
  const tot = cands.find(c => c.marketType === 'overunder');
  assert.equal(tot.side, 'over');
  assert.ok(tot.modelProbability >= 69 && tot.modelProbability <= 71);
  const bt = cands.find(c => c.marketType === 'btts');
  assert.equal(bt.side, 'yes');
  assert.ok(bt.modelProbability >= 65 && bt.modelProbability <= 67);
});

test('buildSoccerGameCandidates: de-vig fallback when no model', () => {
  const tot = buildSoccerGameCandidates(GAME).find(c => c.marketType === 'overunder');
  assert.equal(tot.side, 'over'); // -130 over is the favorite
  // Fallback uses the DE-VIGGED over prob (~53.7%), strictly below the raw vig'd
  // implied (~56.5%) → small negative edge, never positive.
  assert.ok(tot.modelProbability >= 52 && tot.modelProbability <= 55, `de-vig over ${tot.modelProbability}`);
  assert.ok(tot.edge < 0);
});

test('buildSoccerGameCandidates: no candidates without odds', () => {
  assert.deepEqual(buildSoccerGameCandidates({ gameId: 'x', odds: {} }), []);
});

test('buildSoccerGameCandidates: under chosen when over priced as dog', () => {
  const g = { ...GAME, odds: { ...GAME.odds, total: { line: 2.5, overPrice: 140, underPrice: -170 } } };
  const tot = buildSoccerGameCandidates(g).find(c => c.marketType === 'overunder');
  assert.equal(tot.side, 'under');
  assert.equal(tot.pick, 'Under 2.5');
});

test('integration: candidates feed the frozen engine end-to-end', () => {
  const g2 = {
    ...GAME, gameId: '999', matchup: 'BAR @ RMA', homeAbbr: 'RMA', awayAbbr: 'BAR',
    odds: {
      threeWay: { home: 150, draw: 230, away: 160 },
      total: { line: 2.5, overPrice: -115, underPrice: -105 },
      btts: { yes: -140, no: 110 },
    },
  };
  const candidates = buildSoccerParlayCandidates([GAME, g2]);
  assert.ok(candidates.length >= 4);

  const correlationMatrix = buildCorrelationMatrix(candidates);
  const { parlays } = composeParlays({ candidates, correlationMatrix, N: 3, mode: 'safe' });
  assert.ok(Array.isArray(parlays));
  if (parlays.length) {
    const p = parlays[0];
    const hd = computeHitDistribution(p.legs.map(l => l.modelProbability / 100));
    assert.ok(hd && typeof hd === 'object');
    // legs reference real candidate ids from our pool
    for (const leg of p.legs) {
      assert.ok(leg.candidateId.startsWith('soccer_'));
    }
  }
});
