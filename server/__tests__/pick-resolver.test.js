import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenMatchesTeam, parsePick, resolvePickFromFinalState } from '../pick-resolver.js';

function makeFinalGame({ homeAbbr, awayAbbr, homeScore, awayScore }) {
  return {
    gamePk: 123456,
    status: { simplified: 'final' },
    teams: {
      home: { name: homeAbbr, abbreviation: homeAbbr, score: homeScore },
      away: { name: awayAbbr, abbreviation: awayAbbr, score: awayScore },
    },
  };
}

test('tokenMatchesTeam matches abbreviations and nicknames', () => {
  assert.equal(tokenMatchesTeam('NYY', 'New York Yankees', 'NYY'), true);
  assert.equal(tokenMatchesTeam('Yankees', 'New York Yankees', 'NYY'), true);
  assert.equal(tokenMatchesTeam('Boston', 'New York Yankees', 'NYY'), false);
});

test('parsePick parses totals and moneyline', () => {
  assert.deepEqual(parsePick('Over 8.5'), { type: 'over', team: null, line: 8.5 });
  assert.deepEqual(parsePick('NYY ML'), { type: 'moneyline', team: 'NYY', line: null });
});

test('resolvePickFromFinalState resolves moneyline correctly', () => {
  const game = makeFinalGame({ homeAbbr: 'BOS', awayAbbr: 'NYY', homeScore: 3, awayScore: 5 });
  const resolved = resolvePickFromFinalState('NYY ML', game);
  assert.equal(resolved.result, 'win');
});

test('resolvePickFromFinalState resolves totals correctly', () => {
  const game = makeFinalGame({ homeAbbr: 'BOS', awayAbbr: 'NYY', homeScore: 4, awayScore: 2 });
  const over = resolvePickFromFinalState('Over 5.5', game);
  const under = resolvePickFromFinalState('Under 5.5', game);
  assert.equal(over.result, 'win');
  assert.equal(under.result, 'loss');
});

test('parsePick parses Spanish Bajo totals and line-last props', () => {
  assert.deepEqual(parsePick('Bajo 8.5'), { type: 'under', team: null, line: 8.5 });
  const prop = parsePick('Drew Rasmussen Bajo 4.5 Ponches');
  assert.equal(prop?.type, 'player_prop');
  assert.equal(prop?.direction, 'under');
  assert.equal(prop?.line, 4.5);
  assert.equal(prop?.stat, 'strikeOuts');
  assert.equal(prop?.player, 'Drew Rasmussen');
});

test('resolvePickFromFinalState: "Pitcher Moneyline (ABBR)" resolves via parenthetical abbr', () => {
  // Oracle sometimes emits "Reid Detmers Moneyline (LAA)" — pitcher name as subject,
  // team abbreviation inside parens. The resolver must extract LAA from the paren.
  const game = makeFinalGame({ homeAbbr: 'AZ', awayAbbr: 'LAA', homeScore: 2, awayScore: 5 });
  const win = resolvePickFromFinalState('Reid Detmers Moneyline (LAA)', game);
  assert.equal(win.result, 'win', 'LAA wins 5-2 → pick should resolve win');

  const lossGame = makeFinalGame({ homeAbbr: 'AZ', awayAbbr: 'LAA', homeScore: 6, awayScore: 1 });
  const loss = resolvePickFromFinalState('Reid Detmers Moneyline (LAA)', lossGame);
  assert.equal(loss.result, 'loss', 'LAA loses 1-6 → pick should resolve loss');
});

