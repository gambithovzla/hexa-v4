import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySharpMoney } from '../services/sharpMoneyService.js';

test('classifySharpMoney returns NONE for null movement', () => {
  const r = classifySharpMoney(null);
  assert.equal(r.tier, 'none');
  assert.equal(r.score, 0);
});

test('classifySharpMoney flags reverse line movement as strong', () => {
  const r = classifySharpMoney({
    reverse_line_movement: 'against_home_favorite',
    sustained_move_pct: 80,
    movement_ml_home: 20,
    movement_ml_away: -18,
    book_count: 8,
  });
  assert.equal(r.tier, 'strong');
  assert.equal(r.side, 'away'); // sharps against the home favorite
  assert.ok(r.reasons.some(x => x.includes('reverse line movement')));
  assert.ok(r.reasons.some(x => x.includes('steam')));
});

test('classifySharpMoney treats one drifting jump as weak/moderate, not strong', () => {
  const r = classifySharpMoney({
    reverse_line_movement: null,
    sustained_move_pct: 30,       // mostly noise
    movement_ml_home: -16,        // notable but not large
    movement_ml_away: 14,
    direction: 'sharp on home',
    book_count: 6,
  });
  assert.notEqual(r.tier, 'strong');
  assert.equal(r.side, 'home');
});

test('classifySharpMoney halves score on thin book coverage', () => {
  const thick = classifySharpMoney({
    sustained_move_pct: 80, movement_ml_home: -26, movement_ml_away: 24, book_count: 8,
  });
  const thin = classifySharpMoney({
    sustained_move_pct: 80, movement_ml_home: -26, movement_ml_away: 24, book_count: 2,
  });
  assert.ok(thin.score < thick.score);
  assert.ok(thin.reasons.some(x => x.includes('thin book')));
});

test('classifySharpMoney returns NONE when no meaningful movement', () => {
  const r = classifySharpMoney({
    reverse_line_movement: null,
    sustained_move_pct: 20,
    movement_ml_home: 4,
    movement_ml_away: -3,
    book_count: 7,
  });
  assert.equal(r.tier, 'none');
});
