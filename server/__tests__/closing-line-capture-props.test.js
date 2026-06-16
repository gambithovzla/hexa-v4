import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePick } from '../parsers/pickParser.js';
import { matchPropOdds } from '../closing-line-capture-props.js';

test('matchPropOdds resolves total_bases over at exact line', () => {
  const parsed = parsePick('Jose Ramirez Total Bases Over 1.5');
  const playerProps = {
    batter_total_bases: [
      { normalizedPlayerName: 'jose ramirez', direction: 'over', line: 1.5, price: -120 },
      { normalizedPlayerName: 'jose ramirez', direction: 'under', line: 1.5, price: 100 },
    ],
  };
  assert.equal(matchPropOdds(parsed, playerProps), -120);
});

test('matchPropOdds resolves strikeouts under', () => {
  const parsed = parsePick('Gerrit Cole Strikeouts Under 6.5');
  const playerProps = {
    pitcher_strikeouts: [
      { normalizedPlayerName: 'gerrit cole', direction: 'under', line: 6.5, price: -110 },
      { normalizedPlayerName: 'gerrit cole', direction: 'over', line: 6.5, price: -110 },
    ],
  };
  assert.equal(matchPropOdds(parsed, playerProps), -110);
});

test('matchPropOdds falls back to closest line when exact line absent', () => {
  const parsed = parsePick('Aaron Judge Hits Over 1.5');
  const playerProps = {
    batter_hits: [
      { normalizedPlayerName: 'aaron judge', direction: 'over', line: 0.5, price: -200 },
      { normalizedPlayerName: 'aaron judge', direction: 'over', line: 1.5, price: 140 },
    ],
  };
  assert.equal(matchPropOdds(parsed, playerProps), 140);
});

test('matchPropOdds returns null when player does not match', () => {
  const parsed = parsePick('Mike Trout Hits Over 1.5');
  const playerProps = {
    batter_hits: [{ normalizedPlayerName: 'aaron judge', direction: 'over', line: 1.5, price: 140 }],
  };
  assert.equal(matchPropOdds(parsed, playerProps), null);
});

test('matchPropOdds is accent-insensitive on player name', () => {
  const parsed = parsePick('Jose Altuve Home Runs Over 0.5');
  const playerProps = {
    batter_home_runs: [
      { playerName: 'José Altuve', normalizedPlayerName: 'jose altuve', direction: 'over', line: 0.5, price: 320 },
    ],
  };
  assert.equal(matchPropOdds(parsed, playerProps), 320);
});

test('matchPropOdds returns null for non-prop picks', () => {
  const parsed = parsePick('NYY ML');
  assert.equal(matchPropOdds(parsed, { batter_hits: [] }), null);
});
