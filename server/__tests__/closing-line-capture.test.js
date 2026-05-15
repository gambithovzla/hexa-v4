import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPickOdds, findGameForMatchup } from '../closing-line-capture.js';

test('extractPickOdds resolves moneyline side from matchup away token', () => {
  const matchedOdds = {
    awayTeam: 'New York Yankees',
    odds: {
      moneyline: { away: -135, home: 120 },
      overUnder: { overPrice: -110, underPrice: -110 },
      runLine: { away: { price: -105 }, home: { price: -115 } },
    },
  };
  const awayPrice = extractPickOdds('NYY ML', matchedOdds, 'NYY @ BOS');
  const homePrice = extractPickOdds('BOS ML', matchedOdds, 'NYY @ BOS');
  assert.equal(awayPrice, -135);
  assert.equal(homePrice, 120);
});

test('extractPickOdds resolves total and runline prices', () => {
  const matchedOdds = {
    awayTeam: 'New York Yankees',
    odds: {
      overUnder: { overPrice: -108, underPrice: -112 },
      runLine: { away: { price: -101 }, home: { price: -119 } },
    },
  };
  assert.equal(extractPickOdds('Over 8.5', matchedOdds, 'NYY @ BOS'), -108);
  assert.equal(extractPickOdds('Under 8.5', matchedOdds, 'NYY @ BOS'), -112);
  assert.equal(extractPickOdds('NYY -1.5 Run Line', matchedOdds, 'NYY @ BOS'), -101);
});

test('findGameForMatchup matches both @ and reversed token order', () => {
  const games = [
    {
      teams: {
        away: { name: 'New York Yankees', abbreviation: 'NYY' },
        home: { name: 'Boston Red Sox', abbreviation: 'BOS' },
      },
    },
  ];
  assert.ok(findGameForMatchup('NYY @ BOS', games));
  assert.ok(findGameForMatchup('BOS vs NYY', games));
  assert.equal(findGameForMatchup('ATL @ LAD', games), null);
});

