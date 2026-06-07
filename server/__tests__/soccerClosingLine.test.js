import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  impliedProbPct,
  extractSoccerPickOdds,
  computeSoccerClv,
} from '../closing-line-capture-soccer.js';

const ODDS = {
  threeWay: { home: -120, draw: 260, away: 320 },
  total: { line: 2.5, overPrice: -130, underPrice: 105 },
  btts: { yes: -110, no: -150 },
};

test('impliedProbPct converts American → 0-100 percent', () => {
  assert.equal(impliedProbPct(-110), 52.4);
  assert.equal(impliedProbPct(100), 50);
  assert.equal(impliedProbPct(150), 40);
  assert.equal(impliedProbPct(0), null);
  assert.equal(impliedProbPct('x'), null);
});

test('extractSoccerPickOdds: 1X2 home/draw/away', () => {
  assert.equal(extractSoccerPickOdds('Arsenal Home Win', ODDS), -120);
  assert.equal(extractSoccerPickOdds('Home Win', ODDS), -120);
  assert.equal(extractSoccerPickOdds('Draw', ODDS), 260);
  assert.equal(extractSoccerPickOdds('Real Madrid Away Win', ODDS), 320);
  assert.equal(extractSoccerPickOdds('Away Win', ODDS), 320);
});

test('extractSoccerPickOdds: total + bilingual', () => {
  assert.equal(extractSoccerPickOdds('Over 2.5', ODDS), -130);
  assert.equal(extractSoccerPickOdds('Under 2.5', ODDS), 105);
  assert.equal(extractSoccerPickOdds('Más de 2.5', ODDS), -130);
  assert.equal(extractSoccerPickOdds('Menos de 2.5', ODDS), 105);
});

test('extractSoccerPickOdds: BTTS yes/no', () => {
  assert.equal(extractSoccerPickOdds('BTTS Yes', ODDS), -110);
  assert.equal(extractSoccerPickOdds('BTTS No', ODDS), -150);
});

test('extractSoccerPickOdds: player props and unknown → null', () => {
  // A prop has the O/U token mid-string (not anchored) → not a team total.
  assert.equal(extractSoccerPickOdds('Bukayo Saka Over 2.5 Shots On Target', ODDS), null);
  assert.equal(extractSoccerPickOdds('', ODDS), null);
  assert.equal(extractSoccerPickOdds('Over 2.5', null), null);
});

test('computeSoccerClv: closing implied − opening implied', () => {
  // Open -120 (54.5%) → close -150 (60.0%) → CLV +5.5
  const a = computeSoccerClv(-120, -150);
  assert.equal(a.impliedOpen, 54.5);
  assert.equal(a.impliedClose, 60);
  assert.equal(a.clv, 5.5);
  // Line moved against the bettor → negative CLV
  const b = computeSoccerClv(-150, -120);
  assert.equal(b.clv, -5.5);
  // Missing price → null clv
  assert.equal(computeSoccerClv(-120, null).clv, null);
});
