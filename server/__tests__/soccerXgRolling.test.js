/**
 * Tests for soccer xG rolling windows and PPDA (Sprint 11.3).
 * Tests the pure computeXgStats function directly — no network needed.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeXgStats } from '../soccer-xg-fetcher.js';

/** Build a minimal Understat match history entry. */
function entry(xG, xGA, scored, missed, ppda, ppdaAllowed) {
  return {
    xG: String(xG),
    xGA: String(xGA),
    npxG: String(xG * 0.9),
    npxGA: String(xGA * 0.9),
    scored: String(scored),
    missed: String(missed),
    ...(ppda != null ? { ppda: { att: Math.round(ppda * 10), def: 10 } } : {}),
    ...(ppdaAllowed != null ? { ppda_allowed: { att: Math.round(ppdaAllowed * 10), def: 10 } } : {}),
  };
}

describe('computeXgStats — rolling xG and PPDA', () => {
  test('returns null for empty history', () => {
    assert.equal(computeXgStats([]), null);
    assert.equal(computeXgStats(null), null);
    assert.equal(computeXgStats(undefined), null);
  });

  test('computes season xG totals correctly', () => {
    const history = [
      entry(1.2, 0.8, 2, 0),
      entry(2.1, 1.1, 3, 1),
      entry(0.5, 0.3, 0, 0),
    ];
    const result = computeXgStats(history);
    assert.ok(result, 'should return data');
    assert.equal(result.xG,  Math.round((1.2 + 2.1 + 0.5) * 10) / 10);
    assert.equal(result.xGA, Math.round((0.8 + 1.1 + 0.3) * 10) / 10);
    assert.equal(result.matches, 3);
  });

  test('counts wins, draws, losses correctly', () => {
    const history = [
      entry(2.0, 0.5, 2, 0),  // win
      entry(1.0, 1.0, 1, 1),  // draw
      entry(0.3, 1.8, 0, 2),  // loss
    ];
    const result = computeXgStats(history);
    assert.equal(result.wins, 1);
    assert.equal(result.draws, 1);
    assert.equal(result.losses, 1);
  });

  test('rolling-7 uses last 7 entries', () => {
    const history = Array.from({ length: 10 }, (_, i) => entry(i * 0.1, i * 0.05, 1, 0));
    const result = computeXgStats(history);
    const last7 = history.slice(-7);
    const expected7 = last7.reduce((s, m) => s + Number(m.xG), 0) / 7;
    assert.equal(result.xG_7, Math.round(expected7 * 100) / 100);
  });

  test('rolling-5 uses last 5 entries', () => {
    const history = Array.from({ length: 10 }, (_, i) => entry(i * 0.2, i * 0.1, 1, 0));
    const result = computeXgStats(history);
    const last5 = history.slice(-5);
    const expected5 = last5.reduce((s, m) => s + Number(m.xG), 0) / 5;
    assert.equal(result.xG_5, Math.round(expected5 * 100) / 100);
  });

  test('rolling-7 equals rolling-5 when only 5 matches total', () => {
    const history = Array.from({ length: 5 }, () => entry(1.0, 0.5, 1, 0));
    const result = computeXgStats(history);
    assert.equal(result.xG_7, 1.0);
    assert.equal(result.xG_5, 1.0);
  });

  test('PPDA computed from ppda.att/def', () => {
    const history = [
      { ...entry(1.0, 0.5, 1, 0), ppda: { att: 80, def: 10 }, ppda_allowed: { att: 120, def: 10 } },
      { ...entry(1.5, 0.8, 2, 1), ppda: { att: 90, def: 10 }, ppda_allowed: { att: 130, def: 10 } },
    ];
    const result = computeXgStats(history);
    assert.ok(result.ppda != null, 'ppda should be present');
    assert.ok(result.ppdaAllowed != null, 'ppdaAllowed should be present');
    // avg PPDA = (8.0 + 9.0) / 2 = 8.5
    assert.equal(result.ppda, 8.5);
    // avg ppdaAllowed = (12.0 + 13.0) / 2 = 12.5
    assert.equal(result.ppdaAllowed, 12.5);
  });

  test('PPDA is null when ppda field absent', () => {
    const history = [entry(1.0, 0.5, 1, 0)]; // no ppda field
    const result = computeXgStats(history);
    assert.equal(result.ppda, null);
    assert.equal(result.ppdaAllowed, null);
  });

  test('xGDiff positive when team outscores xG', () => {
    // Each entry: xG=1.0 but scored=2 → outperforming
    const history = Array.from({ length: 5 }, () => entry(1.0, 0.5, 2, 0));
    const result = computeXgStats(history);
    // actualGoals=10, xG=5.0 → xGDiff=+5.0
    assert.equal(result.actualGoals, 10);
    assert.equal(result.xGDiff, 5.0);
  });

  test('xGDiff negative when team underscores xG', () => {
    // xG=2.0 but scored=0
    const history = Array.from({ length: 4 }, () => entry(2.0, 1.0, 0, 1));
    const result = computeXgStats(history);
    // actualGoals=0, xG=8.0 → xGDiff=-8.0
    assert.equal(result.xGDiff, -8.0);
  });

  test('xGADiff reflects defensive over/underperformance', () => {
    // xGA=1.0, missed (conceded)=0 — conceding less than xGA
    const history = Array.from({ length: 5 }, () => entry(1.5, 1.0, 2, 0));
    const result = computeXgStats(history);
    // actualGoalsAgainst=0, xGA=5.0 → xGADiff=-5.0
    assert.equal(result.actualGoalsAgainst, 0);
    assert.equal(result.xGADiff, -5.0);
  });

  test('PPDA skips entries with zero def to avoid division by zero', () => {
    const history = [
      { ...entry(1.0, 0.5, 1, 0), ppda: { att: 80, def: 0 } },  // def=0, skip
      { ...entry(1.0, 0.5, 1, 0), ppda: { att: 80, def: 10 } }, // valid
    ];
    const result = computeXgStats(history);
    assert.equal(result.ppda, 8.0); // only the valid entry counted
  });
});
