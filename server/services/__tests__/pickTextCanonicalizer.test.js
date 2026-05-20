import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePick as parseResolverPick } from '../../pick-resolver.js';
import {
  canonicalizePickTextForResolver,
  canonicalizeAnalysisDataPicks,
} from '../pickTextCanonicalizer.js';

test('canonicalizePickTextForResolver converts Spanish prop line-last', () => {
  const out = canonicalizePickTextForResolver('Drew Rasmussen Bajo 4.5 Ponches');
  assert.equal(out, 'Drew Rasmussen Under 4.5 Strikeouts');
  assert.ok(parseResolverPick(out));
});

test('canonicalizePickTextForResolver converts Spanish totals', () => {
  const out = canonicalizePickTextForResolver('Bajo 8.5');
  assert.equal(out, 'Under 8.5');
  assert.ok(parseResolverPick(out));
});

test('canonicalizePickTextForResolver preserves odds suffix', () => {
  const out = canonicalizePickTextForResolver('Drew Rasmussen Bajo 4.5 Ponches (-115)');
  assert.equal(out, 'Drew Rasmussen Under 4.5 Strikeouts (-115)');
});

test('canonicalizePickTextForResolver is idempotent for English picks', () => {
  const english = 'Aaron Judge Over 1.5 Hits';
  assert.equal(canonicalizePickTextForResolver(english), english);
});

test('canonicalizeAnalysisDataPicks updates master_prediction and best_pick', () => {
  const data = {
    master_prediction: { pick: 'Bajo 7.5', oracle_confidence: 58 },
    best_pick: { type: 'Over-Under', detail: 'Bajo 7.5' },
  };
  const out = canonicalizeAnalysisDataPicks(data);
  assert.equal(out.master_prediction.pick, 'Under 7.5');
  assert.equal(out.best_pick.detail, 'Under 7.5');
});
