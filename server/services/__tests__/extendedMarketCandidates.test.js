import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalCDF,
  expectedRunDifferential,
  runLineCoverProbability,
  totalsProbability,
  expectedTeamRuns,
  buildExtendedCandidates,
  formatExtendedMenuForLLM,
} from '../extendedMarketCandidates.js';

test('normalCDF: anchor values', () => {
  assert.ok(Math.abs(normalCDF(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normalCDF(1) - 0.8413) < 0.005);
  assert.ok(Math.abs(normalCDF(-1) - 0.1587) < 0.005);
  assert.ok(Math.abs(normalCDF(2) - 0.9772) < 0.005);
});

test('expectedRunDifferential: home favorite gets positive diff', () => {
  const diff = expectedRunDifferential({ homeMoneylineProb: 65, expectedTotal: 9 });
  assert.ok(diff > 0, 'home favorite should have positive differential');
  assert.ok(diff < 3, 'differential should be reasonable, not extreme');
});

test('expectedRunDifferential: even matchup near zero', () => {
  const diff = expectedRunDifferential({ homeMoneylineProb: 50, expectedTotal: 8.5 });
  assert.ok(Math.abs(diff) < 0.5, 'even ML should yield ~0 differential');
});

test('runLineCoverProbability: heavy favorite covers small spreads frequently', () => {
  const p = runLineCoverProbability({ meanDiff: 2, expectedTotal: 9, spread: 1.5 });
  assert.ok(p > 0.5, 'favorite with +2 mean diff should cover -1.5 over half the time');
});

test('runLineCoverProbability: spread further from mean → lower cover prob', () => {
  const close = runLineCoverProbability({ meanDiff: 1, expectedTotal: 9, spread: 1.5 });
  const far = runLineCoverProbability({ meanDiff: 1, expectedTotal: 9, spread: 5.5 });
  assert.ok(close > far, 'covering -5.5 should be harder than covering -1.5');
});

test('totalsProbability: line above expected → over prob below 50', () => {
  const { over, under } = totalsProbability({ expectedTotal: 8, line: 10.5 });
  assert.ok(over < 50, 'over an unlikely line should be < 50%');
  assert.ok(under > 50, 'under should be > 50%');
  assert.ok(Math.abs(over + under - 100) < 0.5, 'over + under should sum to ~100%');
});

test('totalsProbability: line well below expected → over prob very high', () => {
  const { over } = totalsProbability({ expectedTotal: 10, line: 6.5 });
  assert.ok(over > 80, 'over of an unusually low line should be > 80%');
});

test('expectedTeamRuns: favorite gets more runs but split is bounded', () => {
  const split = expectedTeamRuns({ homeMoneylineProb: 70, expectedTotal: 9 });
  assert.ok(split.home > split.away, 'home favorite gets more runs');
  assert.ok(split.home + split.away > 8.9 && split.home + split.away < 9.1, 'split sums to total');
  // Cap: even a heavy favorite should not get >65% of runs.
  assert.ok(split.home / 9 < 0.7, 'split is bounded');
});

const mockGameData = {
  gamePk: 12345,
  teams: {
    home: { abbreviation: 'NYY' },
    away: { abbreviation: 'BOS' },
  },
};

const mockMainCandidates = [
  { pick: 'BOS Moneyline', market_type: 'moneyline', side: 'away', model_probability: 35, hit_probability: 35, line: null },
  { pick: 'NYY Moneyline', market_type: 'moneyline', side: 'home', model_probability: 65, hit_probability: 65, line: null },
  { pick: 'Over 8.5', market_type: 'overunder', side: 'over', model_probability: 55, hit_probability: 55, line: 8.5 },
];

test('buildExtendedCandidates: emits underdog alt RLs (the safe side)', () => {
  const extended = buildExtendedCandidates({
    gameData: mockGameData,
    mainCandidates: mockMainCandidates,
    alternates: null,
    lang: 'en',
  });
  const altRls = extended.filter((c) => c.market_type === 'runline');
  // Underdog +k is the high-probability side; favorite -k for k=2.5..5.5 has
  // <35% probability with a 65/35 game and gets filtered out by design.
  const dogAltLines = altRls.filter((c) => c.side === 'away').map((c) => c.line).sort((a, b) => a - b);
  assert.deepEqual(dogAltLines, [2.5, 3.5], 'should emit two underdog alt RLs (capped at ±3.5 for mainstream-book compatibility)');
  // Underdog +3.5 should have high model probability
  const dogPlus35 = altRls.find((c) => c.side === 'away' && c.line === 3.5);
  assert.ok(dogPlus35 && dogPlus35.model_probability > 70, `underdog +3.5 should be >70%, got ${dogPlus35?.model_probability}`);
});

test('buildExtendedCandidates: emits alt totals around projected total', () => {
  const extended = buildExtendedCandidates({
    gameData: mockGameData,
    mainCandidates: mockMainCandidates,
    alternates: null,
    lang: 'en',
  });
  const altTotals = extended.filter((c) => c.market_type === 'overunder');
  // With ±2 offset and main line at 8.5 (expected ~8.5), we get lines 6.5..10.5 minus 8.5 → up to 4 lines per side
  assert.ok(altTotals.length >= 2, `should emit alt totals; got ${altTotals.length}`);
  // Alt under well above main line should have reasonably high probability
  const highUnder = altTotals.find((c) => c.side === 'under' && c.line > 9.5);
  assert.ok(!highUnder || highUnder.model_probability > 60, 'high-line under should have good prob if present');
});

test('buildExtendedCandidates: emits team totals (marked non-auto-resolvable)', () => {
  const extended = buildExtendedCandidates({
    gameData: mockGameData,
    mainCandidates: mockMainCandidates,
    alternates: null,
    lang: 'en',
  });
  const teamTotals = extended.filter((c) => c.market_type === 'team_total');
  assert.ok(teamTotals.length > 0, 'should emit team totals');
  assert.ok(teamTotals.every((c) => c.auto_resolvable === false), 'team totals are marked non-auto-resolvable');
});

test('buildExtendedCandidates: filters out very low probability candidates', () => {
  const extended = buildExtendedCandidates({
    gameData: mockGameData,
    mainCandidates: mockMainCandidates,
    alternates: null,
    lang: 'en',
  });
  assert.ok(extended.every((c) => (c.model_probability ?? 0) >= 35), 'all candidates should be ≥35% probability');
});

test('buildExtendedCandidates: attaches market price when alternates are provided', () => {
  const alternates = {
    altRunLines: [
      { side: 'away', line: 2.5, price: -150 },
      { side: 'home', line: -2.5, price: 140 },
    ],
    altTotals: [
      { direction: 'over', line: 7.5, price: -180 },
    ],
    teamTotals: [
      { teamSide: 'home', direction: 'over', line: 4.5, price: -120 },
    ],
  };
  const extended = buildExtendedCandidates({
    gameData: mockGameData,
    mainCandidates: mockMainCandidates,
    alternates,
    lang: 'en',
  });
  const priced = extended.find((c) => c.market_type === 'runline' && c.side === 'away' && c.line === 2.5);
  assert.ok(priced, 'should find the alt RL for BOS +2.5');
  assert.equal(priced.odds, -150);
  assert.ok(priced.implied_probability != null, 'should have implied probability');
  assert.ok(priced.edge != null, 'should compute edge');
});

test('formatExtendedMenuForLLM: includes top picks with prices', () => {
  const candidates = [
    { pick: 'BOS +5.5 Run Line', model_probability: 88, odds: -200 },
    { pick: 'Over 5.5', model_probability: 82, odds: null },
  ];
  const menu = formatExtendedMenuForLLM(candidates, 'en');
  assert.ok(menu.includes('EXTENDED MENU'), 'header present');
  assert.ok(menu.includes('BOS +5.5 Run Line'), 'first pick listed');
  assert.ok(menu.includes('88%'), 'probability shown');
  assert.ok(menu.includes('-200'), 'price shown when present');
  assert.ok(menu.includes('no market price'), 'shows no-price marker');
});

test('formatExtendedMenuForLLM: returns empty string for empty input', () => {
  assert.equal(formatExtendedMenuForLLM([], 'en'), '');
  assert.equal(formatExtendedMenuForLLM(null, 'en'), '');
});
