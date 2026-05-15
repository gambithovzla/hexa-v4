import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePickSport, validatePickSavePayload } from '../services/picksPayloadGuardrails.js';

test('validatePickSavePayload rejects missing required fields', () => {
  assert.equal(validatePickSavePayload({ matchup: 'NYY @ BOS', pick: 'NYY ML' }), 'type, matchup, and pick are required');
  assert.equal(validatePickSavePayload({ type: 'Moneyline', pick: 'NYY ML' }), 'type, matchup, and pick are required');
  assert.equal(validatePickSavePayload({ type: 'Moneyline', matchup: 'NYY @ BOS' }), 'type, matchup, and pick are required');
});

test('validatePickSavePayload accepts a complete payload', () => {
  const err = validatePickSavePayload({
    type: 'Moneyline',
    matchup: 'NYY @ BOS',
    pick: 'NYY ML',
  });
  assert.equal(err, null);
});

test('normalizePickSport defaults to mlb and allows nba', () => {
  assert.equal(normalizePickSport(undefined), 'mlb');
  assert.equal(normalizePickSport(''), 'mlb');
  assert.equal(normalizePickSport('mlb'), 'mlb');
  assert.equal(normalizePickSport('nba'), 'nba');
  assert.equal(normalizePickSport('NBA'), 'nba');
  assert.equal(normalizePickSport('soccer'), 'mlb');
});

