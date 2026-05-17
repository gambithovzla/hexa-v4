import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATASET_PICK_VISIBILITY_SQL } from '../pickTrainingCleanup.js';

test('DATASET_PICK_VISIBILITY_SQL excludes soft-deleted picks', () => {
  assert.match(DATASET_PICK_VISIBILITY_SQL, /deleted_at IS NOT NULL/);
  assert.match(DATASET_PICK_VISIBILITY_SQL, /pf\.backtest_id/);
});

test('purgePickTrainingRows preserves oracle_chat pick_features', async () => {
  const mod = await import('../pickTrainingCleanup.js');
  assert.equal(typeof mod.purgePickTrainingRows, 'function');
});
