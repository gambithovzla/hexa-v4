import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSportFilter } from '../../sports.js';
import { resolvePublicStatsSportFilter } from '../public-stats.js';
import { getSportCapability } from '../../../client/src/config/sportCapabilities.js';

test('normalizeSportFilter accepts known sports and all', () => {
  assert.equal(normalizeSportFilter('mlb', { allowAll: true, fallback: '' }), 'mlb');
  assert.equal(normalizeSportFilter('NBA', { allowAll: true, fallback: '' }), 'nba');
  assert.equal(normalizeSportFilter('nfl', { allowAll: true, fallback: '' }), 'nfl');
  assert.equal(normalizeSportFilter('all', { allowAll: true, fallback: '' }), 'all');
});

test('resolvePublicStatsSportFilter rejects unknown sports', () => {
  assert.equal(resolvePublicStatsSportFilter('all'), 'all');
  assert.equal(resolvePublicStatsSportFilter('soccer'), 'soccer');
  assert.equal(resolvePublicStatsSportFilter(''), '');
  assert.throws(() => resolvePublicStatsSportFilter('unknown'), /sport must be one of/i);
});

test('capabilities prevent MLB/NBA module mixing', () => {
  const nbaBoard = getSportCapability('board', 'nba', 'en');
  const mlbBoard = getSportCapability('board', 'mlb', 'en');
  const nbaParlayArchitect = getSportCapability('parlayArchitect', 'nba', 'en');
  const mlbHistory = getSportCapability('history', 'mlb', 'en');
  const nbaHistory = getSportCapability('history', 'nba', 'en');

  assert.equal(mlbBoard.enabled, true);
  assert.equal(nbaBoard.enabled, false);
  assert.equal(nbaParlayArchitect.enabled, false);
  assert.equal(mlbHistory.enabled, true);
  assert.equal(nbaHistory.enabled, true);
});
