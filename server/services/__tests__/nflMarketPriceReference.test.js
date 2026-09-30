import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nflMarketPriceReference } from '../nflMarketPriceReference.js';

const at = '2026-10-01T18:00:00Z';
const fresh = '2026-10-01T17:59:00Z';
const quote = (bookmaker, side, line, price, lastUpdate = fresh) => ({
  bookmaker, market: 'spread', side, line, price, lastUpdate,
});

test('compares the exact opposite spread line from two fresh independent books', () => {
  const quotes = [
    quote('a', 'home', -3.5, -110), quote('a', 'away', 3.5, -110),
    quote('b', 'home', -3.5, -105), quote('b', 'away', 3.5, -115),
    quote('c', 'home', -3, -110), quote('c', 'away', 3, -110),
    quote('bet365', 'home', -3.5, -200), quote('bet365', 'away', 3.5, 150),
  ];
  const reference = nflMarketPriceReference(quotes,
    { market: 'spread', side: 'home', line: -3.5, decimalOdds: 2.1 }, at);
  assert.equal(reference.bookmakerCount, 2);
  assert.deepEqual(reference.bookmakers.sort(), ['a', 'b']);
  assert.ok(reference.probability > 0.49 && reference.probability < 0.51);
  assert.ok(reference.impliedEdgeAtQuotedPrice > 0);
  assert.equal(reference.diagnosticOnly, true);
});

test('rejects mismatched, stale, future, and single-book references', () => {
  const base = [quote('a', 'home', -3.5, -110), quote('a', 'away', 3.5, -110)];
  const selection = { market: 'spread', side: 'home', line: -3.5, decimalOdds: 1.91 };
  assert.equal(nflMarketPriceReference(base, selection, at), null);
  assert.equal(nflMarketPriceReference([...base,
    quote('b', 'home', -3.5, -110), quote('b', 'away', 3, -110)], selection, at), null);
  assert.equal(nflMarketPriceReference([...base,
    quote('b', 'home', -3.5, -110, '2026-10-01T17:50:00Z'),
    quote('b', 'away', 3.5, -110, '2026-10-01T17:50:00Z')], selection, at), null);
  assert.equal(nflMarketPriceReference([...base,
    quote('b', 'home', -3.5, -110, '2026-10-01T18:01:00Z'),
    quote('b', 'away', 3.5, -110, '2026-10-01T18:01:00Z')], selection, at), null);
  assert.equal(nflMarketPriceReference(base, { ...selection, line: null }, at), null);
});

test('moneyline needs both teams and total needs the same number on both sides', () => {
  const moneyline = ['a', 'b'].flatMap(bookmaker => [
    { bookmaker, market: 'moneyline', side: 'home', line: null, price: -120, lastUpdate: fresh },
    { bookmaker, market: 'moneyline', side: 'away', line: null, price: 110, lastUpdate: fresh },
  ]);
  assert.equal(nflMarketPriceReference(moneyline,
    { market: 'moneyline', side: 'away', decimalOdds: 2.2 }, at).bookmakerCount, 2);
  const totals = ['a', 'b'].flatMap(bookmaker => [
    { bookmaker, market: 'total', side: 'over', line: 45.5, price: -110, lastUpdate: fresh },
    { bookmaker, market: 'total', side: 'under', line: 46.5, price: -110, lastUpdate: fresh },
  ]);
  assert.equal(nflMarketPriceReference(totals,
    { market: 'total', side: 'over', line: 45.5, decimalOdds: 1.91 }, at), null);
});
