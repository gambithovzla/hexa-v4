import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveSoccerHandicap, resolveSoccerPick } from '../pick-resolver-soccer.js';
import { normalizeSoccerAlternates } from '../soccer-alt-markets.js';
import { buildMarketOddsForGame } from '../soccer-odds.js';

function game(homeScore, awayScore, { home = 'Brazil', ha = 'BRA', away = 'South Korea', aa = 'KOR' } = {}) {
  return {
    teams: {
      home: { name: home, abbreviation: ha, score: homeScore },
      away: { name: away, abbreviation: aa, score: awayScore },
    },
  };
}

// ── resolveSoccerHandicap ─────────────────────────────────────────────────────

test('handicap: favorite -1.5 covers when winning by 2+', () => {
  assert.equal(resolveSoccerHandicap('Brazil -1.5', game(3, 1)), 'win');
  assert.equal(resolveSoccerHandicap('Brazil -1.5', game(2, 1)), 'loss'); // wins by 1
  assert.equal(resolveSoccerHandicap('Brazil -2.5', game(3, 1)), 'loss'); // wins by 2, needs 3
});

test('handicap: underdog +1.5 covers unless losing by 2+', () => {
  assert.equal(resolveSoccerHandicap('South Korea +1.5', game(3, 1)), 'loss'); // loses by 2
  assert.equal(resolveSoccerHandicap('South Korea +2.5', game(3, 1)), 'win');  // loses by 2, cushion 2.5
  assert.equal(resolveSoccerHandicap('South Korea +1.5', game(1, 1)), 'win');  // draw
});

test('handicap: whole line is a push when the adjusted margin is exactly zero', () => {
  assert.equal(resolveSoccerHandicap('Brazil -1', game(1, 0)), 'push');  // wins by exactly 1
  assert.equal(resolveSoccerHandicap('Brazil -1', game(2, 0)), 'win');
  assert.equal(resolveSoccerHandicap('South Korea +1', game(1, 0)), 'push'); // loses by exactly 1
});

test('handicap: strips trailing price and (Handicap)/(AH) tags', () => {
  assert.equal(resolveSoccerHandicap('Brazil -1.5 (Handicap) (-110)', game(3, 1)), 'win');
  assert.equal(resolveSoccerHandicap('Brazil -1.5 AH', game(3, 1)), 'win');
});

test('handicap: returns null for non-handicap or unknown team', () => {
  assert.equal(resolveSoccerHandicap('Over 2.5', game(3, 1)), null);
  assert.equal(resolveSoccerHandicap('Draw', game(1, 1)), null);
  assert.equal(resolveSoccerHandicap('Brazil Home Win', game(3, 1)), null); // no signed number
  assert.equal(resolveSoccerHandicap('Atlantis -1.5', game(3, 1)), null);   // team not in game
});

test('resolveSoccerPick routes handicap picks through the handicap resolver', () => {
  assert.equal(resolveSoccerPick('Brazil -1.5', game(3, 1)), 'win');
  assert.equal(resolveSoccerPick('South Korea +2.5', game(3, 1)), 'win');
  // existing markets still work
  assert.equal(resolveSoccerPick('Over 2.5', game(3, 1)), 'win');
  assert.equal(resolveSoccerPick('Draw', game(1, 1)), 'win');
});

// ── normalizeSoccerAlternates ─────────────────────────────────────────────────

test('normalizeSoccerAlternates builds consensus ladders for totals and spreads', () => {
  const event = {
    home_team: 'Brazil',
    away_team: 'South Korea',
    bookmakers: [
      {
        markets: [
          { key: 'alternate_totals', outcomes: [
            { name: 'Over', point: 1.5, price: -200 }, { name: 'Under', point: 1.5, price: 160 },
            { name: 'Over', point: 3.5, price: 150 },  { name: 'Under', point: 3.5, price: -180 },
          ]},
          { key: 'alternate_spreads', outcomes: [
            { name: 'Brazil', point: -2.5, price: 120 }, { name: 'South Korea', point: 2.5, price: -150 },
          ]},
        ],
      },
      {
        markets: [
          { key: 'alternate_totals', outcomes: [
            { name: 'Over', point: 1.5, price: -210 }, { name: 'Under', point: 1.5, price: 170 },
          ]},
        ],
      },
    ],
  };
  const out = normalizeSoccerAlternates(event, 'Brazil', 'South Korea');
  assert.equal(out.altTotals.length, 2);
  assert.deepEqual(out.altTotals.map(t => t.line), [1.5, 3.5]); // sorted
  assert.ok(out.altTotals[0].over != null && out.altTotals[0].under != null);
  assert.equal(out.altSpreads.length, 1);
  assert.equal(out.altSpreads[0].homePoint, -2.5);
  assert.ok(out.altSpreads[0].homePrice != null && out.altSpreads[0].awayPrice != null);
});

test('normalizeSoccerAlternates is safe on empty input', () => {
  assert.deepEqual(normalizeSoccerAlternates(null), { altTotals: [], altSpreads: [] });
  assert.deepEqual(normalizeSoccerAlternates({ bookmakers: [] }), { altTotals: [], altSpreads: [] });
});

// ── buildMarketOddsForGame handicap passthrough ───────────────────────────────

test('buildMarketOddsForGame surfaces the main handicap block', () => {
  const event = {
    eventId: 'e1',
    homeTeam: 'Brazil', awayTeam: 'South Korea',
    threeWay: { home: -180, draw: 320, away: 450 },
    handicap: { homePoint: -1.5, awayPoint: 1.5, homePrice: 120, awayPrice: -140 },
    total: { line: 2.5, overPrice: -110, underPrice: -110 },
    btts: { yes: 120, no: -150 },
  };
  const odds = buildMarketOddsForGame(event);
  assert.ok(odds.handicap);
  assert.equal(odds.handicap.homePoint, -1.5);
  assert.equal(odds.handicap.awayPrice, -140);
});
