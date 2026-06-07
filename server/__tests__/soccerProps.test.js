import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseSoccerProp,
  resolveSoccerPropKind,
  parseSoccerBoxscorePlayers,
  resolveSoccerPlayerProp,
  resolveSoccerPropFromActual,
  SOCCER_PROP_KINDS,
} from '../soccer-props-resolver.js';

// ── resolveSoccerPropKind ─────────────────────────────────────────────────────

test('resolveSoccerPropKind maps en/es keywords, longest-first', () => {
  assert.equal(resolveSoccerPropKind('Shots On Target'), 'shots_on_target');
  assert.equal(resolveSoccerPropKind('tiros a puerta'), 'shots_on_target');
  assert.equal(resolveSoccerPropKind('total shots'), 'shots');
  assert.equal(resolveSoccerPropKind('goles'), 'goals');
  assert.equal(resolveSoccerPropKind('asistencias'), 'assists');
  assert.equal(resolveSoccerPropKind('to score'), 'anytime_goal');
  assert.equal(resolveSoccerPropKind('anytime goalscorer'), 'anytime_goal');
  assert.equal(resolveSoccerPropKind('moneyline'), null);
});

// ── parseSoccerProp ────────────────────────────────────────────────────────────

test('parseSoccerProp handles both word orders', () => {
  // playerName keeps original case (findPlayer normalizes at resolution time).
  const a = parseSoccerProp('Bukayo Saka Over 2.5 Shots On Target');
  assert.deepEqual(a, { playerName: 'Bukayo Saka', side: 'over', line: 2.5, propKind: 'shots_on_target' });
  const b = parseSoccerProp('Bukayo Saka Shots On Target Over 2.5');
  assert.deepEqual(b, { playerName: 'Bukayo Saka', side: 'over', line: 2.5, propKind: 'shots_on_target' });
});

test('parseSoccerProp line-less anytime goal → over 0.5', () => {
  assert.deepEqual(parseSoccerProp('Erling Haaland Anytime Goalscorer'),
    { playerName: 'Erling Haaland', side: 'over', line: 0.5, propKind: 'anytime_goal' });
  assert.deepEqual(parseSoccerProp('Lautaro Martinez Marcar Gol'),
    { playerName: 'Lautaro Martinez', side: 'over', line: 0.5, propKind: 'anytime_goal' });
});

test('parseSoccerProp strips trailing odds', () => {
  const p = parseSoccerProp('Cole Palmer Under 1.5 Goals (-115)');
  assert.equal(p.playerName, 'Cole Palmer');
  assert.equal(p.side, 'under');
  assert.equal(p.line, 1.5);
  assert.equal(p.propKind, 'goals');
});

test('parseSoccerProp rejects team 1X2 / total / BTTS picks', () => {
  assert.equal(parseSoccerProp('Arsenal Home Win'), null);
  assert.equal(parseSoccerProp('Draw'), null);
  assert.equal(parseSoccerProp('Over 2.5'), null);   // team total — no player, no kind keyword
  assert.equal(parseSoccerProp('BTTS Yes'), null);
});

// ── parseSoccerBoxscorePlayers ─────────────────────────────────────────────────

function fixtureBoxscore() {
  return [
    {
      team: { abbreviation: 'ARS' },
      statistics: [{
        keys: ['goals', 'assists', 'shotsOnGoal', 'totalShots', 'foulsCommitted', 'totalTackles', 'saves'],
        athletes: [{ athlete: { displayName: 'Bukayo Saka', id: '1' }, stats: ['1', '2', '3', '5', '1', '2', '0'] }],
      }],
    },
    {
      team: { abbreviation: 'CHE' },
      // No 'saves' key → saves stays null for outfield players.
      statistics: [{
        keys: ['goals', 'assists', 'shotsOnGoal', 'totalShots'],
        athletes: [{ athlete: { displayName: 'Cole Palmer', id: '2' }, stats: ['0', '1', '2', '3'] }],
      }],
    },
  ];
}

test('parseSoccerBoxscorePlayers reads keys + derives anytime_goal', () => {
  const players = parseSoccerBoxscorePlayers(fixtureBoxscore());
  const saka = players['bukayo saka'];
  assert.equal(saka.goals, 1);
  assert.equal(saka.assists, 2);
  assert.equal(saka.shots_on_target, 3);
  assert.equal(saka.shots, 5);
  assert.equal(saka.fouls, 1);
  assert.equal(saka.tackles, 2);
  assert.equal(saka.saves, 0);
  assert.equal(saka.anytime_goal, 1);   // scored ≥1
  const palmer = players['cole palmer'];
  assert.equal(palmer.goals, 0);
  assert.equal(palmer.anytime_goal, 0); // did not score
  assert.equal(palmer.saves, null);     // key absent
});

// ── resolveSoccerPropFromActual (pure) ─────────────────────────────────────────

test('resolveSoccerPropFromActual over/under/push', () => {
  assert.equal(resolveSoccerPropFromActual({ side: 'over', line: 2.5 }, 3), 'win');
  assert.equal(resolveSoccerPropFromActual({ side: 'over', line: 2.5 }, 2), 'loss');
  assert.equal(resolveSoccerPropFromActual({ side: 'under', line: 1.5 }, 1), 'win');
  assert.equal(resolveSoccerPropFromActual({ side: 'over', line: 3 }, 3), 'push');
  assert.equal(resolveSoccerPropFromActual(null, 3), null);
});

// ── resolveSoccerPlayerProp (end-to-end against fixture) ───────────────────────

test('resolveSoccerPlayerProp resolves win/loss/push', () => {
  const players = parseSoccerBoxscorePlayers(fixtureBoxscore());
  assert.equal(resolveSoccerPlayerProp('Bukayo Saka Over 2.5 Shots On Target', players).result, 'win');
  assert.equal(resolveSoccerPlayerProp('Bukayo Saka Over 5.5 Shots', players).result, 'loss');
  assert.equal(resolveSoccerPlayerProp('Bukayo Saka Shots On Target Over 3', players).result, 'push');
  assert.equal(resolveSoccerPlayerProp('Bukayo Saka Under 1.5 Goals', players).result, 'win');
});

test('resolveSoccerPlayerProp anytime goal yes-market', () => {
  const players = parseSoccerBoxscorePlayers(fixtureBoxscore());
  assert.equal(resolveSoccerPlayerProp('Bukayo Saka Anytime Goalscorer', players).result, 'win');
  assert.equal(resolveSoccerPlayerProp('Cole Palmer Anytime Goal', players).result, 'loss');
});

test('resolveSoccerPlayerProp surfaces player/stat not found', () => {
  const players = parseSoccerBoxscorePlayers(fixtureBoxscore());
  assert.equal(resolveSoccerPlayerProp('Lionel Messi Over 1.5 Shots', players).error, 'player_not_found');
  assert.equal(resolveSoccerPlayerProp('Cole Palmer Over 1.5 Saves', players).error, 'stat_not_found');
});

test('SOCCER_PROP_KINDS is the canonical set', () => {
  assert.ok(SOCCER_PROP_KINDS.has('shots_on_target'));
  assert.ok(SOCCER_PROP_KINDS.has('anytime_goal'));
  assert.equal(SOCCER_PROP_KINDS.has('passing_yards'), false);
});
