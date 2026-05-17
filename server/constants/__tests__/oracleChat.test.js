import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ORACLE_CHAT_USER_LABEL, resolveDatasetUserEmail } from '../oracleChat.js';

test('resolveDatasetUserEmail returns Oraclechat for chat source', () => {
  assert.equal(
    resolveDatasetUserEmail({ pfSource: 'oracle_chat', pfUserEmail: null }),
    ORACLE_CHAT_USER_LABEL,
  );
  assert.equal(
    resolveDatasetUserEmail({ pickSource: 'oracle_chat', pickUserEmail: 'a@b.com' }),
    ORACLE_CHAT_USER_LABEL,
  );
});

test('resolveDatasetUserEmail keeps real email for live picks', () => {
  assert.equal(
    resolveDatasetUserEmail({ pfSource: 'live', pfUserEmail: 'user@test.com' }),
    'user@test.com',
  );
});
