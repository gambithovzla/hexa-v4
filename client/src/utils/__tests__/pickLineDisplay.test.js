import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyProjectedLine, pickLabelWithProjection } from '../pickLineDisplay.js';

test('injects projected total into a bare over/under, dropping the descriptor', () => {
  assert.equal(applyProjectedLine('Under (Total de Carreras)', 8.7, { lang: 'es' }), 'Under 8.7 (proy.)');
  assert.equal(applyProjectedLine('Over (Total de Carreras)', 9.5, { lang: 'en' }), 'Over 9.5 (proj.)');
});

test('handles Spanish side tokens', () => {
  assert.equal(applyProjectedLine('Bajo (Total de Carreras)', 7, { lang: 'es' }), 'Under 7 (proy.)');
  assert.equal(applyProjectedLine('Alto (Total de Carreras)', 10, { lang: 'es' }), 'Over 10 (proy.)');
});

test('leaves a pick with an existing numeric line untouched', () => {
  assert.equal(applyProjectedLine('Under 8.5', 8.7), 'Under 8.5');
  assert.equal(applyProjectedLine('Over 9.5 (-110)', 7), 'Over 9.5 (-110)');
});

test('leaves non over/under picks untouched', () => {
  assert.equal(applyProjectedLine('NYY ML', 8.7), 'NYY ML');
  assert.equal(applyProjectedLine('Home -1.5', 8.7), 'Home -1.5');
});

test('does not fabricate a number when projection is missing or invalid', () => {
  assert.equal(applyProjectedLine('Under (Total de Carreras)', null), 'Under (Total de Carreras)');
  assert.equal(applyProjectedLine('Under (Total de Carreras)', undefined), 'Under (Total de Carreras)');
  assert.equal(applyProjectedLine('Under (Total de Carreras)', 0), 'Under (Total de Carreras)');
  assert.equal(applyProjectedLine('Under (Total de Carreras)', NaN), 'Under (Total de Carreras)');
});

test('pickLabelWithProjection reads value_breakdown.projected_total', () => {
  assert.equal(
    pickLabelWithProjection('Under (Total de Carreras)', { value_breakdown: { projected_total: 7.5 } }, { lang: 'es' }),
    'Under 7.5 (proy.)',
  );
  assert.equal(pickLabelWithProjection('Under (Total de Carreras)', {}, { lang: 'es' }), 'Under (Total de Carreras)');
});
