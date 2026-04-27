// Run: node --test server/services/parlayEngine/__tests__/market-focus.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterCandidatesByMarketFocus,
  marketFocusInstruction,
  normalizeMarketFocus,
} from '../../../market-focus.js';

const CANDIDATES = [
  { pick: 'BOS ML', marketType: 'moneyline' },
  { pick: 'Over 8.5', marketType: 'overunder' },
  { pick: 'Aaron Judge Over 0.5 Hits', marketType: 'playerprop', propKind: 'hits', propMarketKey: 'batter_hits' },
  { pick: 'Gerrit Cole Over 6.5 Strikeouts', marketType: 'playerprop', propKind: 'k', propMarketKey: 'pitcher_strikeouts' },
];

describe('market focus helpers', () => {
  it('normalizes generic player prop aliases to playerprops', () => {
    assert.strictEqual(normalizeMarketFocus('props'), 'playerprops');
    assert.strictEqual(normalizeMarketFocus('Player Props'), 'playerprops');
    assert.strictEqual(normalizeMarketFocus('playerprops'), 'playerprops');
  });

  it('filters generic player props without splitting pitcher and batter props', () => {
    const result = filterCandidatesByMarketFocus(CANDIDATES, 'props');
    assert.deepStrictEqual(
      result.map(candidate => candidate.pick),
      ['Aaron Judge Over 0.5 Hits', 'Gerrit Cole Over 6.5 Strikeouts'],
    );
  });

  it('keeps the specific pitcher and batter prop filters available', () => {
    assert.deepStrictEqual(
      filterCandidatesByMarketFocus(CANDIDATES, 'Pitcher Props').map(candidate => candidate.pick),
      ['Gerrit Cole Over 6.5 Strikeouts'],
    );
    assert.deepStrictEqual(
      filterCandidatesByMarketFocus(CANDIDATES, 'Batter Props').map(candidate => candidate.pick),
      ['Aaron Judge Over 0.5 Hits'],
    );
  });

  it('builds an instruction that allows any player prop family', () => {
    const instruction = marketFocusInstruction('props');
    assert.match(instruction, /pitcher strikeouts/i);
    assert.match(instruction, /batter props/i);
  });
});
