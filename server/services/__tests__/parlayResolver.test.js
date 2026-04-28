// Tests for parlayResolver.aggregateParlay — uses node:test.
// Run: node --test server/services/__tests__/parlayResolver.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateParlay, hydrateLegsFromPool } from '../parlayResolver.js';

describe('aggregateParlay', () => {
  it('returns win when every leg is a win', () => {
    const out = aggregateParlay([
      { result: 'win' },
      { result: 'win' },
      { result: 'win' },
    ]);
    assert.equal(out.status, 'win');
    assert.equal(out.legsHit, 3);
    assert.equal(out.legsResolved, 3);
  });

  it('returns loss as soon as any leg is a loss, even with pending legs', () => {
    const out = aggregateParlay([
      { result: 'win' },
      { result: 'loss' },
      { result: null, status: 'pending' },
    ]);
    assert.equal(out.status, 'loss');
    assert.equal(out.legsHit, 1);
    assert.equal(out.legsResolved, 2);
  });

  it('stays pending when at least one leg is unresolved and no losses', () => {
    const out = aggregateParlay([
      { result: 'win' },
      { result: 'win' },
      { result: null, status: 'pending' },
    ]);
    assert.equal(out.status, 'pending');
    assert.equal(out.legsHit, 2);
    assert.equal(out.legsResolved, 2);
  });

  it('treats push as neutral: wins+pushes resolve as win', () => {
    const out = aggregateParlay([
      { result: 'win' },
      { result: 'push' },
      { result: 'win' },
    ]);
    assert.equal(out.status, 'win');
    assert.equal(out.legsHit, 2);
    assert.equal(out.legsResolved, 3);
  });

  it('returns push when every resolved leg is a push', () => {
    const out = aggregateParlay([
      { result: 'push' },
      { result: 'push' },
    ]);
    assert.equal(out.status, 'push');
    assert.equal(out.legsHit, 0);
    assert.equal(out.legsResolved, 2);
  });

  it('handles empty leg list as push (nothing to grade)', () => {
    const out = aggregateParlay([]);
    assert.equal(out.status, 'push');
    assert.equal(out.legsHit, 0);
    assert.equal(out.legsResolved, 0);
  });

  it('treats unparseable / error legs as pending (no false win)', () => {
    const out = aggregateParlay([
      { result: 'win' },
      { result: null, status: 'unparseable' },
    ]);
    assert.equal(out.status, 'pending');
    assert.equal(out.legsHit, 1);
  });
});

describe('hydrateLegsFromPool', () => {
  const POOL = [
    { candidateId: 'cand_A', gamePk: 100, pick: 'BOS ML', matchup: 'BOS @ TOR', type: 'ml' },
    { candidateId: 'cand_B', gamePk: 200, pick: 'Over 8.5', matchup: 'NYY @ BAL', type: 'total' },
  ];

  it('hydrates legacy [id, id, ...] rows from candidate_pool', () => {
    const legs = hydrateLegsFromPool(['cand_A', 'cand_B'], POOL);
    assert.equal(legs.length, 2);
    assert.equal(legs[0].gamePk, 100);
    assert.equal(legs[0].pick, 'BOS ML');
    assert.equal(legs[1].gamePk, 200);
  });

  it('hydrates legacy [{candidateId}] objects without gamePk/pick', () => {
    const legs = hydrateLegsFromPool([{ candidateId: 'cand_A' }], POOL);
    assert.equal(legs[0].gamePk, 100);
    assert.equal(legs[0].pick, 'BOS ML');
  });

  it('passes through new-format legs untouched', () => {
    const input = [{ candidateId: 'cand_X', gamePk: 999, pick: 'NYM ML', gameDate: '2026-04-25' }];
    const legs = hydrateLegsFromPool(input, POOL);
    assert.equal(legs[0].gamePk, 999);
    assert.equal(legs[0].pick, 'NYM ML');
    assert.equal(legs[0].gameDate, '2026-04-25');
  });

  it('returns minimal stub when candidateId is missing from the pool', () => {
    const legs = hydrateLegsFromPool(['unknown_id'], POOL);
    assert.equal(legs.length, 1);
    assert.equal(legs[0].candidateId, 'unknown_id');
    assert.equal(legs[0].gamePk, undefined);
  });

  it('returns [] for non-array input', () => {
    assert.deepEqual(hydrateLegsFromPool(null, POOL), []);
    assert.deepEqual(hydrateLegsFromPool(undefined, POOL), []);
  });
});
