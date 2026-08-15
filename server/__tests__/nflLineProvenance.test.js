import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyNflMarket,
  extractNflPickLine,
  marketLineFor,
  evaluateNflLineProvenance,
} from '../services/nflLineProvenance.js';
import { validateNflAnalysisOutput } from '../services/nflOutputGuard.js';
import { nflSportKeysFor, NFL_SPORT_KEYS } from '../nfl-odds.js';

// ── market classification ────────────────────────────────────────────────────

test('classifyNflMarket reads the declared bet type first', () => {
  assert.equal(classifyNflMarket('Spread', 'ATL -1.5'), 'spread');
  assert.equal(classifyNflMarket('Total', 'Under 38.5'), 'total');
  assert.equal(classifyNflMarket('Moneyline', 'ATL ML'), 'moneyline');
});

test('classifyNflMarket falls back to the pick text when the type is missing', () => {
  assert.equal(classifyNflMarket(null, 'Under 38.5'), 'total');
  assert.equal(classifyNflMarket(null, 'ATL -1.5'), 'spread');
  assert.equal(classifyNflMarket(null, 'ATL ML'), 'moneyline');
  assert.equal(classifyNflMarket(null, 'no numbers here'), null);
});

// ── line extraction ──────────────────────────────────────────────────────────

test('extractNflPickLine returns the spread magnitude, ignoring the side', () => {
  assert.equal(extractNflPickLine('ATL -1.5', 'spread'), 1.5);
  assert.equal(extractNflPickLine('NYJ +3', 'spread'), 3);
});

test('extractNflPickLine does not mistake the American price for the line', () => {
  assert.equal(extractNflPickLine('ATL -1.5 (-110)', 'spread'), 1.5);
  assert.equal(extractNflPickLine('KC -2.5 (-115)', 'spread'), 2.5);
});

test('extractNflPickLine reads totals off the over/under word', () => {
  assert.equal(extractNflPickLine('Under 38.5 (-105)', 'total'), 38.5);
  assert.equal(extractNflPickLine('Over 47', 'total'), 47);
});

// ── market line lookup ───────────────────────────────────────────────────────

test('marketLineFor mirrors the away spread when only that side is present', () => {
  assert.equal(marketLineFor({ spread: { home: -3 } }, 'spread'), 3);
  assert.equal(marketLineFor({ spread: { home: null, away: 3 } }, 'spread'), 3);
  assert.equal(marketLineFor({ total: { line: 41.5 } }, 'total'), 41.5);
});

test('marketLineFor returns null when the market block is absent', () => {
  assert.equal(marketLineFor(null, 'spread'), null);
  assert.equal(marketLineFor({}, 'spread'), null);
  assert.equal(marketLineFor({ spread: {} }, 'spread'), null);
});

// ── provenance verdicts ──────────────────────────────────────────────────────

test('a spread with no market odds is flagged as the model own number', () => {
  const r = evaluateNflLineProvenance({
    betType: 'Spread',
    pickText: 'ATL -1.5',
    detail: 'ATL -1.5',
    marketOdds: null,
  });
  assert.equal(r.status, 'unverified');
  assert.equal(r.pickLine, 1.5);
  assert.equal(r.marketLine, null);
  assert.match(r.flag, /UNVERIFIED_LINE/);
});

test('a spread matching the market is verified with no flag', () => {
  const r = evaluateNflLineProvenance({
    betType: 'Spread',
    detail: 'ATL -3 (-110)',
    marketOdds: { spread: { home: -3, away: 3 } },
  });
  assert.equal(r.status, 'verified');
  assert.equal(r.flag, null);
});

test('half a point of book drift is tolerated', () => {
  const r = evaluateNflLineProvenance({
    betType: 'Spread',
    detail: 'ATL -2.5',
    marketOdds: { spread: { home: -3, away: 3 } },
  });
  assert.equal(r.status, 'verified');
});

test('a full point off the market is a mismatch', () => {
  const r = evaluateNflLineProvenance({
    betType: 'Spread',
    detail: 'ATL -1.5',
    marketOdds: { spread: { home: -3, away: 3 } },
  });
  assert.equal(r.status, 'mismatch');
  assert.equal(r.marketLine, 3);
  assert.match(r.flag, /LINE_MISMATCH/);
});

test('moneyline picks carry no line to verify', () => {
  const r = evaluateNflLineProvenance({ betType: 'Moneyline', detail: 'ATL ML', marketOdds: null });
  assert.equal(r.status, 'not_applicable');
  assert.equal(r.flag, null);
});

test('totals are checked against the market total', () => {
  const unverified = evaluateNflLineProvenance({ betType: 'Total', detail: 'Under 38.5', marketOdds: null });
  assert.equal(unverified.status, 'unverified');

  const mismatch = evaluateNflLineProvenance({
    betType: 'Total',
    detail: 'Under 38.5',
    marketOdds: { total: { line: 41.5 } },
  });
  assert.equal(mismatch.status, 'mismatch');
});

// ── guard wiring ─────────────────────────────────────────────────────────────

function validData(overrides = {}) {
  return {
    master_prediction: { pick: 'ATL -1.5', oracle_confidence: 62, bet_value: 'MODERATE' },
    best_pick: { type: 'spread', detail: 'ATL -1.5', confidence: 0.62 },
    oracle_report: 'x'.repeat(120),
    alert_flags: [],
    ...overrides,
  };
}

test('the guard labels an unverified line in alert_flags without rejecting', () => {
  const r = validateNflAnalysisOutput(validData(), { marketOdds: null });
  assert.equal(r.ok, true);
  assert.equal(r.line_provenance.status, 'unverified');
  assert.ok(r.data.alert_flags.some(f => /UNVERIFIED_LINE/.test(f)));
});

test('the guard stays silent when the pick quotes the real line', () => {
  const r = validateNflAnalysisOutput(validData({
    master_prediction: { pick: 'ATL -3', oracle_confidence: 62 },
    best_pick: { type: 'spread', detail: 'ATL -3 (-110)' },
  }), { marketOdds: { spread: { home: -3, away: 3 } } });
  assert.equal(r.line_provenance.status, 'verified');
  assert.equal(r.data.alert_flags.length, 0);
});

test('preseason and line provenance flags stack', () => {
  const r = validateNflAnalysisOutput(validData(), { marketOdds: null, isPreseason: true });
  assert.ok(r.data.alert_flags.some(f => /PRESEASON/.test(f)));
  assert.ok(r.data.alert_flags.some(f => /UNVERIFIED_LINE/.test(f)));
});

// ── sport key selection ──────────────────────────────────────────────────────

test('preseason tries the preseason sport key first', () => {
  assert.deepEqual(nflSportKeysFor(1), [NFL_SPORT_KEYS.PRESEASON, NFL_SPORT_KEYS.REGULAR]);
});

test('regular season and unknown keep the regular key first', () => {
  assert.deepEqual(nflSportKeysFor(2), [NFL_SPORT_KEYS.REGULAR, NFL_SPORT_KEYS.PRESEASON]);
  assert.deepEqual(nflSportKeysFor(null), [NFL_SPORT_KEYS.REGULAR, NFL_SPORT_KEYS.PRESEASON]);
});
