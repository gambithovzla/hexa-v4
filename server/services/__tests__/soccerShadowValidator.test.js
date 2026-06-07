import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSoccerShadowScore, SOCCER_SHADOW_MODEL_KEY } from '../soccerShadowValidator.js';

const meta = { homeTeamId: 100, awayTeamId: 200, homeAbbr: 'ARS', awayAbbr: 'CHE' };

function ctx({ home = {}, away = {}, completeness = 1 } = {}) {
  return {
    home: { teamId: 100, teamAbbr: 'ARS', goalDiff: 0, points: 30, recentForm: { record: '2W-2D-2L' }, ...home },
    away: { teamId: 200, teamAbbr: 'CHE', goalDiff: 0, points: 30, recentForm: { record: '2W-2D-2L' }, ...away },
    context_meta: { overallCompleteness: completeness },
  };
}

// Home heavily favored 3-way market (American): -250 / +320 / +650.
const oddsHomeFav = { threeWay: { home: -250, draw: 320, away: 650 } };

test('returns a bounded score and confidence capped at 62', () => {
  const r = calculateSoccerShadowScore(ctx(), meta);
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.ok(r.confidence >= 50 && r.confidence <= 62, `conf ${r.confidence} in 50-62`);
  assert.equal(r.predicted_winner, '100'); // home-field nudge on a coin flip
});

test('stronger goal differential favors that team', () => {
  const r = calculateSoccerShadowScore(ctx({ home: { goalDiff: 30 }, away: { goalDiff: -20 } }), meta);
  assert.equal(r.predicted_winner_abbr, 'ARS');
  assert.ok(r.score > 55, `score ${r.score} > 55`);
});

test('xG tilts the score when goal diff and form are even (no odds)', () => {
  // Even strength/form, no market odds → xG carries real weight.
  const high = { xG: 42, xGA: 20 };  // net +22
  const low  = { xG: 18, xGA: 40 };  // net -22
  const r = calculateSoccerShadowScore(ctx({ home: high, away: low }), meta);
  assert.equal(r.predicted_winner_abbr, 'ARS');
  assert.ok(r.score > 60, `xG-driven score ${r.score} > 60`);
  assert.ok(r.breakdown.xgAdv > 0.5);
  assert.equal(r.breakdown.signalCoverage, 1); // strength+form+xg all present (no-odds weights)
});

test('xG absent (MLS) drops the signal and redistributes weight — no crash', () => {
  // No xG fields, no odds → only strength + form present.
  const r = calculateSoccerShadowScore(ctx({ home: { goalDiff: 25 }, away: { goalDiff: -15 } }), meta);
  assert.equal(r.predicted_winner_abbr, 'ARS');
  assert.equal(r.breakdown.xgAdv, null);
  assert.ok(r.breakdown.signalCoverage < 1, `coverage ${r.breakdown.signalCoverage} < 1`);
  assert.ok(r.breakdown.signalCoverage > 0.6); // strength+form = 0.65 of the no-odds model
});

test('market odds dominate when present', () => {
  // Underdog-by-stats home, but the book makes them a big favorite → market wins.
  const r = calculateSoccerShadowScore(
    ctx({ home: { goalDiff: -10 }, away: { goalDiff: 10 } }),
    meta,
    oddsHomeFav,
  );
  assert.equal(r.predicted_winner_abbr, 'ARS');
  assert.equal(r.breakdown.oddsPresent, true);
  assert.ok(r.breakdown.oddsAdv > 0.5); // de-vigged market favors home
});

test('odds-present coverage drops when xG is missing', () => {
  // With odds present but no xG, the xg weight (0.10) is dropped → coverage 0.90.
  const r = calculateSoccerShadowScore(ctx(), meta, oddsHomeFav);
  assert.ok(Math.abs(r.breakdown.signalCoverage - 0.9) < 1e-9, `coverage ${r.breakdown.signalCoverage} ≈ 0.90`);
});

test('all signals absent → coin flip with home nudge, coverage 0', () => {
  const r = calculateSoccerShadowScore(
    { home: { teamId: 100, teamAbbr: 'ARS' }, away: { teamId: 200, teamAbbr: 'CHE' }, context_meta: {} },
    meta,
  );
  assert.equal(r.breakdown.signalCoverage, 0);
  assert.ok(r.score >= 50 && r.score <= 58, `score ${r.score} near 50`);
});

test('draw-heavy de-vig still resolves a winner id', () => {
  const r = calculateSoccerShadowScore(ctx(), meta, oddsHomeFav);
  assert.ok(r.predicted_winner === '100' || r.predicted_winner === '200');
  assert.ok(typeof SOCCER_SHADOW_MODEL_KEY === 'string');
});
