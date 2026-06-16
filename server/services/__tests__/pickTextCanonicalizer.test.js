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

test('canonicalizePickTextForResolver backfills bare Over with market total', () => {
  const out = canonicalizePickTextForResolver('Over', { marketTotal: 8.5 });
  assert.equal(out, 'Over 8.5');
  assert.ok(parseResolverPick(out));
});

test('canonicalizePickTextForResolver backfills bare Spanish Under with market total', () => {
  const out = canonicalizePickTextForResolver('Bajo', { marketTotal: 9 });
  assert.equal(out, 'Under 9');
  assert.ok(parseResolverPick(out));
});

test('canonicalizePickTextForResolver prefers explicit line over market total', () => {
  const out = canonicalizePickTextForResolver('Over 7.5', { marketTotal: 8.5 });
  assert.equal(out, 'Over 7.5');
});

test('bare Over without a market total is left untouched', () => {
  const out = canonicalizePickTextForResolver('Over');
  assert.equal(out, 'Over');
  assert.equal(parseResolverPick(out), null);
});

test('canonicalizeAnalysisDataPicks backfills bare Over/Under from extraCtx total', () => {
  const data = {
    master_prediction: { pick: 'Over', oracle_confidence: 56 },
    best_pick: { type: 'Over-Under', detail: 'Over' },
  };
  const out = canonicalizeAnalysisDataPicks(data, null, { marketTotal: 8.5 });
  assert.equal(out.master_prediction.pick, 'Over 8.5');
  assert.equal(out.best_pick.detail, 'Over 8.5');
});

test('canonicalizeAnalysisDataPicks backfills line from best_pick.detail when mp.pick is bare Over/Under with description', () => {
  const data = {
    master_prediction: { pick: 'Under (Total de Carreras)', oracle_confidence: 60 },
    best_pick: { type: 'Over-Under', detail: 'Under 8.5 (-110)' },
  };
  const out = canonicalizeAnalysisDataPicks(data);
  assert.equal(out.master_prediction.pick, 'Under 8.5 (Total de Carreras)');
  assert.equal(out.best_pick.detail, 'Under 8.5 (-110)');
});

test('canonicalizeAnalysisDataPicks does not modify mp.pick when line already present', () => {
  const data = {
    master_prediction: { pick: 'Under 8.5 Total de Carreras', oracle_confidence: 60 },
    best_pick: { type: 'Over-Under', detail: 'Under 8.5' },
  };
  const out = canonicalizeAnalysisDataPicks(data);
  assert.equal(out.master_prediction.pick, 'Under 8.5');
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
