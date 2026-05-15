import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveParlayOutcome } from '../parlayRunOutcome.js';

describe('deriveParlayOutcome', () => {
  it('returns pending when unresolved', () => {
    assert.equal(deriveParlayOutcome({ resolved: false, hit: null }), 'pending');
  });

  it('returns win when hit=true', () => {
    assert.equal(deriveParlayOutcome({ resolved: true, hit: true }), 'win');
  });

  it('returns push when hit is null', () => {
    assert.equal(deriveParlayOutcome({ resolved: true, hit: null }), 'push');
  });

  it('detects legacy push rows encoded as hit=false', () => {
    const out = deriveParlayOutcome({
      resolved: true,
      hit: false,
      leg_results: [{ result: 'push' }, { result: 'push' }],
    });
    assert.equal(out, 'push');
  });

  it('returns loss for hit=false rows with at least one losing leg', () => {
    const out = deriveParlayOutcome({
      resolved: true,
      hit: false,
      leg_results: [{ result: 'push' }, { result: 'loss' }],
    });
    assert.equal(out, 'loss');
  });
});
