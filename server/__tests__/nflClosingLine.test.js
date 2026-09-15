import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  impliedProbPct,
  extractSignedNflPickLine,
  resolveNflPickSide,
  nflSideOdds,
  lineClvPct,
  priceClvPct,
  computeNflClv,
  NFL_MARGIN_SD,
  NFL_TOTAL_SD,
} from '../closing-line-capture-nfl.js';

// ── the sign convention: the whole point of the module ────────────────────────

test('a favorite whose spread grows beat the number', () => {
  // Took KC -3.5, closes KC -6.5: three free points.
  const clv = lineClvPct({ market: 'spread', side: 'home', openLine: -3.5, closeLine: -6.5 });
  assert.ok(clv > 0, `expected positive CLV, got ${clv}`);
  assert.equal(clv, 8.8);
});

test('a favorite whose spread shrinks lost the number', () => {
  const clv = lineClvPct({ market: 'spread', side: 'home', openLine: -6.5, closeLine: -3.5 });
  assert.equal(clv, -8.8);
});

test('an underdog getting fewer points is negative, even though the magnitude grew', () => {
  // +3.5 → +6.5 grows in magnitude but the bettor holds the worse number.
  // A magnitude-only reading would call this positive; it is not.
  const clv = lineClvPct({ market: 'spread', side: 'away', openLine: 3.5, closeLine: 6.5 });
  assert.equal(clv, -8.8);
});

test('an underdog whose line shortens beat the number', () => {
  const clv = lineClvPct({ market: 'spread', side: 'away', openLine: 6.5, closeLine: 3.5 });
  assert.equal(clv, 8.8);
});

test('a line that never moved is exactly zero CLV', () => {
  assert.equal(lineClvPct({ market: 'spread', side: 'home', openLine: -3.5, closeLine: -3.5 }), 0);
});

test('Over and Under of the same move are mirror images', () => {
  const over = lineClvPct({ market: 'total', side: 'over', openLine: 44.5, closeLine: 48.5 });
  const under = lineClvPct({ market: 'total', side: 'under', openLine: 44.5, closeLine: 48.5 });
  assert.ok(over > 0);
  assert.equal(over, -under);
});

test('totals move more per point than spreads, because their sd is tighter', () => {
  const spread = lineClvPct({ market: 'spread', side: 'home', openLine: -3, closeLine: -7 });
  const total = lineClvPct({ market: 'total', side: 'over', openLine: 44, closeLine: 48 });
  assert.ok(NFL_TOTAL_SD < NFL_MARGIN_SD);
  assert.ok(total > spread, `${total} should exceed ${spread}`);
});

test('moneyline has no line, so the line term contributes nothing', () => {
  assert.equal(lineClvPct({ market: 'moneyline', side: 'home', openLine: null, closeLine: null }), 0);
});

test('a missing line yields null rather than a fabricated zero', () => {
  assert.equal(lineClvPct({ market: 'spread', side: 'home', openLine: null, closeLine: -3 }), null);
  assert.equal(lineClvPct({ market: 'total', side: 'over', openLine: 44, closeLine: null }), null);
});

// ── price term ────────────────────────────────────────────────────────────────

test('implied probability matches the standard conversions', () => {
  assert.equal(impliedProbPct(-110), 52.4);
  assert.equal(impliedProbPct(100), 50);
  assert.equal(impliedProbPct(150), 40);
  assert.equal(impliedProbPct(null), null);
  assert.equal(impliedProbPct(0), null);
});

test('a shortening price is positive CLV', () => {
  assert.equal(priceClvPct(-130, -160), 5);
});

test('a lengthening price is negative CLV', () => {
  assert.ok(priceClvPct(-160, -130) < 0);
});

// ── combination ───────────────────────────────────────────────────────────────

test('line and price terms both land in the total, and stay separately visible', () => {
  const out = computeNflClv({
    market: 'spread', side: 'home',
    openLine: -3.5, closeLine: -6.5,
    openAmerican: -105, closeAmerican: -115,
  });
  assert.equal(out.lineClv, 8.8);
  assert.equal(out.priceClv, 2.3);
  assert.equal(out.clv, 11.1);
});

test('beating the number while paying more vig nets out honestly', () => {
  // Gained 3 points but the juice went from -105 to -130: still positive, less so.
  const out = computeNflClv({
    market: 'spread', side: 'home',
    openLine: -3.5, closeLine: -6.5,
    openAmerican: -105, closeAmerican: -130,
  });
  assert.ok(out.clv > 0);
  assert.ok(out.clv > out.lineClv, 'price term should add here');
});

test('a moneyline pick carries its whole CLV in the price', () => {
  const out = computeNflClv({ market: 'moneyline', side: 'home', openAmerican: -130, closeAmerican: -160 });
  assert.equal(out.lineClv, 0);
  assert.equal(out.clv, 5);
});

test('nothing scoreable gives a null CLV instead of 0', () => {
  const out = computeNflClv({ market: 'spread', side: 'home', openLine: null, closeLine: null });
  assert.equal(out.clv, null);
});

// ── pick-text parsing ─────────────────────────────────────────────────────────

test('the signed spread survives an attached price', () => {
  assert.equal(extractSignedNflPickLine('KC -3.5 (-110)', 'spread'), -3.5);
  assert.equal(extractSignedNflPickLine('NYJ +6.5 (-105)', 'spread'), 6.5);
});

test('totals parse in both languages and both orders', () => {
  assert.equal(extractSignedNflPickLine('Over 44.5 (-110)', 'total'), 44.5);
  assert.equal(extractSignedNflPickLine('Under 41', 'total'), 41);
});

// ── side resolution ───────────────────────────────────────────────────────────

const game = {
  homeAbbr: 'KC', homeName: 'Kansas City Chiefs',
  awayAbbr: 'BUF', awayName: 'Buffalo Bills',
};

test('the named team decides the side', () => {
  assert.equal(resolveNflPickSide({ pickText: 'KC -3.5 (-110)', market: 'spread', ...game }), 'home');
  assert.equal(resolveNflPickSide({ pickText: 'BUF +3.5 (-110)', market: 'spread', ...game }), 'away');
});

test('a full team name resolves as well as an abbreviation', () => {
  assert.equal(resolveNflPickSide({ pickText: 'Buffalo Bills ML', market: 'moneyline', ...game }), 'away');
});

test('a price in parentheses is never mistaken for a team', () => {
  assert.equal(resolveNflPickSide({ pickText: 'KC -3.5 (-110)', market: 'spread', ...game }), 'home');
});

test('totals resolve to over/under, not to a team', () => {
  assert.equal(resolveNflPickSide({ pickText: 'Over 44.5', market: 'total', ...game }), 'over');
  assert.equal(resolveNflPickSide({ pickText: 'Under 44.5', market: 'total', ...game }), 'under');
});

test('a pick naming no team returns null instead of guessing a side', () => {
  assert.equal(resolveNflPickSide({ pickText: '-3.5 (-110)', market: 'spread', ...game }), null);
});

// ── reading a marketOdds snapshot ─────────────────────────────────────────────

const odds = {
  spread: { home: -6.5, homePrice: -115, away: 6.5, awayPrice: -105 },
  total: { line: 48.5, overPrice: -110, underPrice: -110 },
  moneyline: { home: -280, away: 230 },
};

test('each side reads its own line and price', () => {
  assert.deepEqual(nflSideOdds(odds, 'spread', 'home'), { line: -6.5, price: -115 });
  assert.deepEqual(nflSideOdds(odds, 'spread', 'away'), { line: 6.5, price: -105 });
});

test('both total sides share the line but not the price', () => {
  assert.deepEqual(nflSideOdds(odds, 'total', 'over'), { line: 48.5, price: -110 });
  assert.deepEqual(nflSideOdds(odds, 'total', 'under'), { line: 48.5, price: -110 });
});

test('moneyline has a price and no line', () => {
  assert.deepEqual(nflSideOdds(odds, 'moneyline', 'home'), { line: null, price: -280 });
});

test('an absent snapshot yields nulls rather than throwing', () => {
  assert.deepEqual(nflSideOdds(null, 'spread', 'home'), { line: null, price: null });
  assert.deepEqual(nflSideOdds({}, 'spread', 'home'), { line: null, price: null });
});
