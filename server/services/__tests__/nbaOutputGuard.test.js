import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNbaAnalysisOutput } from '../nbaOutputGuard.js';

const VALID = {
  master_prediction: { pick: 'LAL ML', oracle_confidence: 63, bet_value: 'MODERATE VALUE' },
  oracle_report: 'A'.repeat(120),
  hexa_hunch: 'Rest edge',
  alert_flags: [],
  probability_model: { home_wins: 5200, away_wins: 4800 },
  best_pick: { type: 'Moneyline', detail: 'LAL ML', confidence: 0.63 },
  model_risk: 'medium',
};

test('validateNbaAnalysisOutput accepts valid payload', () => {
  const out = validateNbaAnalysisOutput(VALID);
  assert.equal(out.ok, true);
  assert.equal(out.quality, 'ok');
  assert.equal(out.data.master_prediction.oracle_confidence, 63);
});

test('validateNbaAnalysisOutput rejects player props', () => {
  const out = validateNbaAnalysisOutput({
    ...VALID,
    best_pick: { type: 'PlayerProp', detail: 'LeBron 25+ pts', confidence: 0.6 },
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.includes('player_prop_blocked'));
});

test('validateNbaAnalysisOutput degrades on short report', () => {
  const out = validateNbaAnalysisOutput({
    ...VALID,
    oracle_report: 'too short',
  });
  assert.equal(out.ok, true);
  assert.equal(out.quality, 'degraded');
  assert.ok(out.data.alert_flags.some((f) => String(f).includes('OUTPUT_GUARD')));
});
