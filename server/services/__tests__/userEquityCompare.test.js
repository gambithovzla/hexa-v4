import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildUserVsHexaComparison } from '../userEquityCompare.js';

describe('buildUserVsHexaComparison', () => {
  it('computes user metrics and hexa baseline deltas', () => {
    const rows = [
      { created_at: '2026-05-01T10:00:00Z', source: 'manual', result: 'won', odds: -110, stake: 100 },
      { created_at: '2026-05-02T10:00:00Z', source: 'hexa', result: 'lost', odds: +120, stake: 50 },
      { created_at: '2026-05-03T10:00:00Z', source: 'hexa', result: 'won', odds: +100, stake: 50 },
      { created_at: '2026-05-04T10:00:00Z', source: 'manual', result: 'push', odds: -105, stake: 25 },
    ];

    const out = buildUserVsHexaComparison(rows);
    assert.equal(out.your_strategy.sample_size, 4);
    assert.equal(out.hexa_baseline.sample_size, 2);
    assert.equal(out.hexa_baseline.wins, 1);
    assert.equal(out.hexa_baseline.losses, 1);
    assert.equal(out.hexa_baseline.win_rate, 50);
  });
});
