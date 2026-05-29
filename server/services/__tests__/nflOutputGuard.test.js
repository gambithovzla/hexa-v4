import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNflAnalysisOutput } from '../nflOutputGuard.js';

const validReport = 'PRIMARY EDGE: KC point differential +7 vs BUF +3, QB healthy, sits below the 3 at -2.5. CONFIRMING SIGNALS: off bye rest edge, home field. KEY RISK: divisional-style shootout. EDGE MATH: 50 base +8 strength +4 rest = 62.';

function validData(overrides = {}) {
  return {
    master_prediction: { pick: 'KC -2.5 Spread', oracle_confidence: 62, bet_value: 'MODERATE VALUE' },
    oracle_report: validReport,
    hexa_hunch: 'No significant contextual signal detected',
    alert_flags: ['Key number 3 in play — margin sensitivity'],
    probability_model: { home_wins: 6200, away_wins: 3800 },
    best_pick: { type: 'Spread', detail: 'KC -2.5 (-110)', confidence: 0.62 },
    model_risk: 'medium',
    ...overrides,
  };
}

test('accepts a well-formed NFL pick', () => {
  const r = validateNflAnalysisOutput(validData());
  assert.equal(r.ok, true);
  assert.equal(r.quality, 'ok');
  assert.equal(r.data.master_prediction.oracle_confidence, 62);
});

test('rejects parse failure', () => {
  const r = validateNflAnalysisOutput(null, { parseError: true });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ['json_parse_failed']);
});

test('rejects empty output', () => {
  const r = validateNflAnalysisOutput(null);
  assert.equal(r.ok, false);
  assert.equal(r.quality, 'reject');
});

test('rejects parlay shape on a single game', () => {
  const r = validateNflAnalysisOutput({ parlay: { legs: [] } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('parlay_shape_on_single_game'));
});

test('rejects ABSTAIN / PASS picks', () => {
  const r = validateNflAnalysisOutput(validData({ master_prediction: { pick: 'PASS', oracle_confidence: 55 } }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('abstain_pick'));
});

test('rejects player props (disabled this phase)', () => {
  const r = validateNflAnalysisOutput(validData({ best_pick: { type: 'PlayerProp', detail: 'Mahomes Over 275.5 pass yds', confidence: 0.6 } }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('player_prop_blocked'));
});

test('degrades (non-fatal) on confidence above the NFL cap of 72', () => {
  // Mirrors nbaOutputGuard: out-of-range confidence is flagged, not fatal.
  const r = validateNflAnalysisOutput(validData({ master_prediction: { pick: 'KC -2.5', oracle_confidence: 78, bet_value: 'HIGH VALUE' } }));
  assert.equal(r.ok, true);
  assert.equal(r.quality, 'degraded');
  assert.ok(r.errors.includes('confidence_out_of_range'));
  assert.ok(r.data.alert_flags.some(f => f.startsWith('OUTPUT_GUARD:')));
});

test('accepts confidence exactly at the 72 cap', () => {
  const r = validateNflAnalysisOutput(validData({ master_prediction: { pick: 'KC -2.5', oracle_confidence: 72, bet_value: 'HIGH VALUE' } }));
  assert.equal(r.ok, true);
});

test('normalizes fractional confidence (0.62 → 62)', () => {
  const r = validateNflAnalysisOutput(validData({ master_prediction: { pick: 'KC -2.5', oracle_confidence: 0.62 } }));
  assert.equal(r.ok, true);
  assert.equal(r.data.master_prediction.oracle_confidence, 62);
});

test('accepts spread, total, and moneyline bet types', () => {
  for (const type of ['Spread', 'Total', 'Moneyline']) {
    const r = validateNflAnalysisOutput(validData({ best_pick: { type, detail: 'x', confidence: 0.6 } }));
    assert.equal(r.ok, true, `${type} should be allowed`);
  }
});

test('degrades (non-fatal) on a too-short report and surfaces it in alert_flags', () => {
  const r = validateNflAnalysisOutput(validData({ oracle_report: 'too short' }));
  assert.equal(r.ok, true);
  assert.equal(r.quality, 'degraded');
  assert.ok(r.errors.includes('oracle_report_too_short'));
  assert.ok(r.data.alert_flags.some(f => f.startsWith('OUTPUT_GUARD:')));
});
