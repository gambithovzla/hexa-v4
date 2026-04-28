// Tests for parlayResolver.aggregateParlay — uses node:test.
// Run: node --test server/services/__tests__/parlayResolver.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateParlay } from '../parlayResolver.js';

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
