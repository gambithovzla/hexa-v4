/**
 * Tests for Soccer motivation/stakes analysis (Sprint 11.3).
 * buildMotivationBlock is a pure function — no external I/O.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildMotivationBlock } from '../soccer-context-builder.js';

// Build a synthetic standings table of N teams with consistent point gaps (step=4).
// Using step=4 avoids borderline "exactly 3pts off" edge cases that would
// promote a lower place to a "contender" category unintentionally.
function syntheticTable(totalTeams, leaderPts = 90, step = 4) {
  return Array.from({ length: totalTeams }, (_, i) => ({
    position: i + 1,
    points: leaderPts - i * step,
  }));
}

// EPL table (20 teams), leader=90, step=4:
//   pos 1=90, pos 4=78 (UCL boundary), pos 5=74, pos 6=70 (UEL boundary),
//   pos 7=66, pos 17=26 (safety line), pos 18=22 (relegated)
const EPL_TABLE = syntheticTable(20);

describe('buildMotivationBlock — EPL (eng.1)', () => {
  test('position 1 → TITLE LEADERS', () => {
    const leaderPts = EPL_TABLE[0].points; // 90
    const m = buildMotivationBlock(leaderPts, 1, EPL_TABLE, 'eng.1');
    assert.ok(m, 'should return a block');
    assert.ok(m.tags.some(t => t === 'TITLE LEADERS'), `expected TITLE LEADERS, got ${m.tags}`);
    assert.equal(m.gapToTop, 0);
    assert.equal(m.position, 1);
  });

  test('position 2 (within 5pts of leader) → TITLE RACE', () => {
    const pts = EPL_TABLE[1].points; // 86, gap=4 ≤ 5
    const m = buildMotivationBlock(pts, 2, EPL_TABLE, 'eng.1');
    assert.ok(m.tags.some(t => t.startsWith('TITLE RACE')), `expected TITLE RACE, got ${m.tags}`);
  });

  test('position 3 → UCL PLACE', () => {
    const pts = EPL_TABLE[2].points; // 82
    const m = buildMotivationBlock(pts, 3, EPL_TABLE, 'eng.1');
    assert.ok(m.tags.some(t => t.startsWith('UCL PLACE')), `expected UCL PLACE, got ${m.tags}`);
  });

  test('position 5 → UEL PLACE (4pts off UCL boundary → not contender)', () => {
    const pts = EPL_TABLE[4].points; // 74; UCL boundary (pos 4) = 78; gap=4 > 3
    const m = buildMotivationBlock(pts, 5, EPL_TABLE, 'eng.1');
    assert.ok(m.tags.some(t => t.startsWith('UEL PLACE')), `expected UEL PLACE, got ${m.tags}`);
  });

  test('position 5 → UCL CONTENDER when within 3pts of UCL boundary', () => {
    const uclBoundaryPts = EPL_TABLE[3].points; // 78
    const m = buildMotivationBlock(uclBoundaryPts - 2, 5, EPL_TABLE, 'eng.1');
    assert.ok(m.tags.some(t => t.startsWith('UCL CONTENDER')), `expected UCL CONTENDER, got ${m.tags}`);
  });

  test('position 7 → UECL PLACE (4pts off UEL boundary → not contender)', () => {
    const pts = EPL_TABLE[6].points; // 66; UEL boundary (pos 6) = 70; gap=4 > 3
    const m = buildMotivationBlock(pts, 7, EPL_TABLE, 'eng.1');
    assert.ok(m.tags.some(t => t.startsWith('UECL PLACE')), `expected UECL PLACE, got ${m.tags}`);
  });

  test('position 18 → RELEGATION ZONE', () => {
    const pts = EPL_TABLE[17].points; // 22; EPL: 18-20 relegated
    const m = buildMotivationBlock(pts, 18, EPL_TABLE, 'eng.1');
    assert.ok(m.tags.some(t => t.startsWith('RELEGATION ZONE')), `expected RELEGATION ZONE, got ${m.tags}`);
  });

  test('position 15 within 3pts of safety line → RELEGATION BATTLE', () => {
    // Safety line = 17th place = EPL_TABLE[16].points
    const safetyPts = EPL_TABLE[16].points; // 26
    const m = buildMotivationBlock(safetyPts + 2, 15, EPL_TABLE, 'eng.1');
    assert.ok(m.tags.some(t => t.startsWith('RELEGATION BATTLE')), `expected RELEGATION BATTLE, got ${m.tags}`);
  });

  test('position 10 → MID-TABLE (dead rubber)', () => {
    const pts = EPL_TABLE[9].points; // 54; safe from drop, not near European spots
    const m = buildMotivationBlock(pts, 10, EPL_TABLE, 'eng.1');
    assert.ok(m.tags.some(t => t.startsWith('MID-TABLE')), `expected MID-TABLE, got ${m.tags}`);
  });

  test('result includes position, totalTeams, gapToTop', () => {
    const pts = EPL_TABLE[0].points; // leader
    const m = buildMotivationBlock(pts, 1, EPL_TABLE, 'eng.1');
    assert.equal(m.position, 1);
    assert.equal(m.totalTeams, 20);
    assert.equal(m.gapToTop, 0);
  });
});

describe('buildMotivationBlock — Bundesliga (ger.1)', () => {
  // 18 teams, step=4, leader=72
  const BL_TABLE = syntheticTable(18, 72);

  test('position 16 → RELEGATION PLAYOFF PLACE', () => {
    const pts = BL_TABLE[15].points;
    const m = buildMotivationBlock(pts, 16, BL_TABLE, 'ger.1');
    assert.ok(m.tags.some(t => t === 'RELEGATION PLAYOFF PLACE'), `expected RELEGATION PLAYOFF PLACE, got ${m.tags}`);
  });

  test('position 17 → RELEGATION ZONE', () => {
    const pts = BL_TABLE[16].points;
    const m = buildMotivationBlock(pts, 17, BL_TABLE, 'ger.1');
    assert.ok(m.tags.some(t => t.startsWith('RELEGATION ZONE')), `expected RELEGATION ZONE, got ${m.tags}`);
  });
});

describe('buildMotivationBlock — Ligue 1 (fra.1)', () => {
  // 18 teams, step=4, leader=70; UCL=3, so UCL boundary=pos 3 pts=62; pos 4 pts=58, gap=4>3
  const L1_TABLE = syntheticTable(18, 70);

  test('position 1 → TITLE LEADERS + UCL PLACE (1)', () => {
    const leaderPts = L1_TABLE[0].points;
    const m = buildMotivationBlock(leaderPts, 1, L1_TABLE, 'fra.1');
    assert.ok(m.tags.some(t => t === 'TITLE LEADERS'), `expected TITLE LEADERS, got ${m.tags}`);
    assert.ok(m.tags.some(t => t.startsWith('UCL PLACE')), `expected UCL PLACE, got ${m.tags}`);
  });

  test('position 4 (UEL in Ligue 1, 4pts off UCL boundary) → UEL PLACE', () => {
    // Ligue 1 ucl=3, uel=5; position 4 ≤ 5 = UEL PLACE, and gap to UCL (pos 3) = 4 > 3
    const pts = L1_TABLE[3].points; // 70 - 3*4 = 58
    const m = buildMotivationBlock(pts, 4, L1_TABLE, 'fra.1');
    assert.ok(m.tags.some(t => t.startsWith('UEL PLACE')), `expected UEL PLACE, got ${m.tags}`);
  });
});

describe('buildMotivationBlock — MLS (usa.1)', () => {
  // 14 teams, step=4, leader=55; playoff cutoff = top 9
  const MLS_TABLE = syntheticTable(14, 55);

  test('position 5 → PLAYOFF ZONE', () => {
    const pts = MLS_TABLE[4].points;
    const m = buildMotivationBlock(pts, 5, MLS_TABLE, 'usa.1');
    assert.ok(m.tags.some(t => t.startsWith('PLAYOFF ZONE')), `expected PLAYOFF ZONE, got ${m.tags}`);
  });

  test('position 12 → OUT OF PLAYOFFS', () => {
    const pts = MLS_TABLE[11].points;
    const m = buildMotivationBlock(pts, 12, MLS_TABLE, 'usa.1');
    assert.ok(m.tags.some(t => t.startsWith('OUT OF PLAYOFFS')), `expected OUT OF PLAYOFFS, got ${m.tags}`);
  });
});

describe('buildMotivationBlock — edge cases', () => {
  test('empty standings table → returns null', () => {
    assert.equal(buildMotivationBlock(60, 3, [], 'eng.1'), null);
  });

  test('null points → returns null', () => {
    assert.equal(buildMotivationBlock(null, 3, EPL_TABLE, 'eng.1'), null);
  });

  test('null position → returns null', () => {
    assert.equal(buildMotivationBlock(60, null, EPL_TABLE, 'eng.1'), null);
  });

  test('unknown league slug → returns null', () => {
    assert.equal(buildMotivationBlock(60, 3, EPL_TABLE, 'unknown.league'), null);
  });
});
