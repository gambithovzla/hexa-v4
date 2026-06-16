import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineShop } from '../odds-api.js';

const EVENT = {
  home_team: 'Yankees',
  away_team: 'Red Sox',
  bookmakers: [
    { title: 'DraftKings', markets: [
      { key: 'h2h',     outcomes: [{ name: 'Yankees', price: -150 }, { name: 'Red Sox', price: 130 }] },
      { key: 'totals',  outcomes: [{ name: 'Over', price: -110 }, { name: 'Under', price: -110 }] },
    ] },
    { title: 'FanDuel', markets: [
      { key: 'h2h',     outcomes: [{ name: 'Yankees', price: -145 }, { name: 'Red Sox', price: 125 }] },
      { key: 'totals',  outcomes: [{ name: 'Over', price: -105 }, { name: 'Under', price: -115 }] },
    ] },
    { title: 'BetMGM', markets: [
      { key: 'h2h',     outcomes: [{ name: 'Yankees', price: -160 }, { name: 'Red Sox', price: 140 }] },
    ] },
  ],
};

const CONSENSUS = { mlHome: -152, mlAway: 132, ouOver: -108, ouUnder: -112, rlHome: null, rlAway: null };

test('buildLineShop picks the least-negative moneyline favorite price', () => {
  const ls = buildLineShop(EVENT, CONSENSUS);
  assert.equal(ls.moneyline.home.price, -145);
  assert.equal(ls.moneyline.home.book, 'FanDuel');
  assert.equal(ls.moneyline.home.bookCount, 3);
});

test('buildLineShop picks the highest-payout underdog price', () => {
  const ls = buildLineShop(EVENT, CONSENSUS);
  assert.equal(ls.moneyline.away.price, 140);
  assert.equal(ls.moneyline.away.book, 'BetMGM');
});

test('buildLineShop quantifies positive EV vs consensus', () => {
  const ls = buildLineShop(EVENT, CONSENSUS);
  // Best favorite price is cheaper than consensus → positive edge points.
  assert.ok(ls.moneyline.home.edgeVsConsensusPts > 0);
  assert.ok(ls.moneyline.away.edgeVsConsensusPts > 0);
});

test('buildLineShop finds best total over across books', () => {
  const ls = buildLineShop(EVENT, CONSENSUS);
  // FanDuel -105 beats DraftKings -110 for the Over bettor.
  assert.equal(ls.overUnder.over.price, -105);
  assert.equal(ls.overUnder.over.book, 'FanDuel');
});

test('buildLineShop returns null outcomes when no book offers a market', () => {
  const ls = buildLineShop(EVENT, CONSENSUS);
  assert.equal(ls.runLine.home, null);
  assert.equal(ls.runLine.away, null);
});
