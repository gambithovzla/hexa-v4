import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateNflAnalysisOutput } from '../nflOutputGuard.js';
import { evaluateNflGate } from '../nflImperdibleSelector.js';
import { serializeNflContext } from '../oracleNfl.js';
import {
  buildSeasonPhase,
  isPreseason,
  PRESEASON_CONFIDENCE_CEIL,
} from '../nflSeasonPhase.js';

function validData(overrides = {}) {
  return {
    master_prediction: { pick: 'DEN -3.5', oracle_confidence: 68, bet_value: 'HIGH VALUE' },
    best_pick: { type: 'spread', detail: 'DEN -3.5', confidence: 0.68 },
    oracle_report: 'x'.repeat(120),
    alert_flags: [],
    ...overrides,
  };
}

test('buildSeasonPhase labels the three ESPN season types', () => {
  assert.deepEqual(buildSeasonPhase(1), { seasonType: 1, label: 'preseason', isPreseason: true });
  assert.equal(buildSeasonPhase(2).label, 'regular');
  assert.equal(buildSeasonPhase(3).label, 'postseason');
});

test('buildSeasonPhase does not invent a phase for an unknown seasontype', () => {
  const phase = buildSeasonPhase(4);
  assert.equal(phase.seasonType, null);
  assert.equal(phase.label, 'unknown');
  assert.equal(phase.isPreseason, false);
});

test('isPreseason tolerates a numeric string', () => {
  assert.equal(isPreseason('1'), true);
  assert.equal(isPreseason('2'), false);
  assert.equal(isPreseason(null), false);
});

test('preseason caps confidence and says it did', () => {
  const r = validateNflAnalysisOutput(validData(), { isPreseason: true });
  assert.equal(r.ok, true);
  assert.equal(r.data.master_prediction.oracle_confidence, PRESEASON_CONFIDENCE_CEIL);
  assert.ok(r.data.alert_flags.some(f => f.startsWith('PRESEASON:')));
  assert.ok(r.data.alert_flags.some(f => f.startsWith('PRESEASON_CONFIDENCE_CAPPED: 68 → 55')));
});

test('a confidence already under the preseason ceiling is left alone', () => {
  const data = validData({ master_prediction: { pick: 'DEN -3.5', oracle_confidence: 52 } });
  const r = validateNflAnalysisOutput(data, { isPreseason: true });
  assert.equal(r.data.master_prediction.oracle_confidence, 52);
  assert.ok(!r.data.alert_flags.some(f => f.startsWith('PRESEASON_CONFIDENCE_CAPPED')));
  // The phase itself is still disclosed even when no cap was needed.
  assert.ok(r.data.alert_flags.some(f => f.startsWith('PRESEASON:')));
});

test('an out-of-range confidence cannot survive as a preseason pick', () => {
  // 78 is above the regular-season ceiling too, so it is flagged AND capped.
  const data = validData({ master_prediction: { pick: 'DEN -3.5', oracle_confidence: 78 } });
  const r = validateNflAnalysisOutput(data, { isPreseason: true });
  assert.equal(r.data.master_prediction.oracle_confidence, PRESEASON_CONFIDENCE_CEIL);
  assert.ok(r.errors.includes('confidence_out_of_range'));
});

test('regular season keeps the 72 ceiling and gains no preseason flags', () => {
  const r = validateNflAnalysisOutput(validData(), { isPreseason: false });
  assert.equal(r.data.master_prediction.oracle_confidence, 68);
  assert.equal(r.data.alert_flags.length, 0);
});

test('the imperdible gate refuses to lock a preseason game', () => {
  // Every other signal is maxed out — only the phase should stop it.
  const scored = {
    isPreseason: true,
    qbConfirmed: true,
    modelCertified: true,
    conviction: 95,
    consensusProb: 90,
    components: { modelProb: 90, impliedProb: 85, mlProb: 80, dataQuality: 95 },
  };
  const gate = evaluateNflGate(scored);
  assert.equal(gate.pass, false);
  assert.ok(gate.failedReasons.includes('preseason_no_lock'));
});

test('the same candidate outside preseason passes the gate', () => {
  const scored = {
    isPreseason: false,
    qbConfirmed: true,
    modelCertified: true,
    conviction: 95,
    consensusProb: 90,
    components: { modelProb: 90, impliedProb: 85, mlProb: 80, dataQuality: 95 },
  };
  assert.equal(evaluateNflGate(scored).pass, true);
});

test('blockPreseason can be overridden explicitly', () => {
  const scored = {
    isPreseason: true,
    qbConfirmed: true,
    modelCertified: true,
    conviction: 95,
    consensusProb: 90,
    components: { modelProb: 90, impliedProb: 85, mlProb: 80, dataQuality: 95 },
  };
  assert.equal(evaluateNflGate(scored, { blockPreseason: false }).pass, true);
});

test('the serialized context warns before the numbers in preseason', () => {
  const context = {
    season: 2026,
    seasonPhase: buildSeasonPhase(1),
    gameDate: '2026-08-14',
    home: { abbr: 'DEN' },
    away: { abbr: 'ATL' },
    weather: null,
    context_meta: null,
  };
  const text = serializeNflContext({ context, marketOdds: null });
  assert.match(text, /PRESEASON GAME/);
  assert.match(text, /REGULAR-SEASON averages/);
  assert.match(text, /capped at 55%/);
  // The warning must precede the statistical blocks it qualifies.
  assert.ok(text.indexOf('PRESEASON GAME') < text.indexOf('HOME'));
});

test('no preseason block appears in a regular-season context', () => {
  const context = {
    season: 2026,
    seasonPhase: buildSeasonPhase(2),
    gameDate: '2026-11-14',
    home: { abbr: 'DEN' },
    away: { abbr: 'ATL' },
    weather: null,
    context_meta: null,
  };
  const text = serializeNflContext({ context, marketOdds: null });
  assert.ok(!text.includes('PRESEASON GAME'));
});
