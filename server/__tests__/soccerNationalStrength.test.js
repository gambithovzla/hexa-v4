import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getNationalTeamStrength,
  buildNationalStrengthComparison,
  strengthTier,
  strengthGapBand,
  parseNationalTeamForm,
} from '../soccer-national-strength.js';

test('getNationalTeamStrength resolves a seeded nation with rank + tier', () => {
  const arg = getNationalTeamStrength('Argentina');
  assert.ok(arg);
  assert.equal(arg.name, 'Argentina');
  assert.equal(arg.rank, 1);            // top of the seed by points
  assert.ok(arg.points >= 1850);
  assert.equal(arg.tier, 'elite contender');
  assert.equal(arg.confederation, 'CONMEBOL');
});

test('getNationalTeamStrength canonicalises aliases', () => {
  const byAlias = getNationalTeamStrength('Korea Republic');
  const byCanon = getNationalTeamStrength('South Korea');
  assert.ok(byAlias && byCanon);
  assert.equal(byAlias.name, 'South Korea');
  assert.equal(byAlias.points, byCanon.points);

  const usmnt = getNationalTeamStrength('USMNT');
  assert.ok(usmnt);
  assert.equal(usmnt.name, 'United States');
});

test('getNationalTeamStrength returns null for an unseeded nation', () => {
  assert.equal(getNationalTeamStrength('Ruritania'), null);
  assert.equal(getNationalTeamStrength(null), null);
});

test('strengthTier thresholds', () => {
  assert.equal(strengthTier(1800), 'elite contender');
  assert.equal(strengthTier(1700), 'strong');
  assert.equal(strengthTier(1560), 'solid');
  assert.equal(strengthTier(1450), 'mid-tier');
  assert.equal(strengthTier(1200), 'developing');
  assert.equal(strengthTier(null), null);
});

test('strengthGapBand classifies gaps', () => {
  assert.equal(strengthGapBand(300), 'large');
  assert.equal(strengthGapBand(-160), 'large');
  assert.equal(strengthGapBand(100), 'moderate');
  assert.equal(strengthGapBand(50), 'slight');
  assert.equal(strengthGapBand(10), 'even');
  assert.equal(strengthGapBand(0), 'even');
});

test('buildNationalStrengthComparison flags a clear favorite (large gap)', () => {
  // Brazil (~1778) vs Indonesia (~1145): a blowout gap, NOT a coin flip.
  const cmp = buildNationalStrengthComparison('Brazil', 'Indonesia');
  assert.ok(cmp);
  assert.equal(cmp.band, 'large');
  assert.equal(cmp.favored, 'home');
  assert.equal(cmp.favoredName, 'Brazil');
  assert.ok(cmp.pointsGap > 150);
});

test('buildNationalStrengthComparison favors the away side when stronger', () => {
  const cmp = buildNationalStrengthComparison('Indonesia', 'France');
  assert.ok(cmp);
  assert.equal(cmp.favored, 'away');
  assert.equal(cmp.favoredName, 'France');
  assert.ok(cmp.pointsGap < 0);
});

test('buildNationalStrengthComparison marks evenly-ranked sides as even (draw live)', () => {
  // Italy (~1718) vs Germany (~1716): a 2-pt gap → genuinely even.
  const cmp = buildNationalStrengthComparison('Italy', 'Germany');
  assert.ok(cmp);
  assert.equal(cmp.band, 'even');
  assert.equal(cmp.favored, 'even');
  assert.equal(cmp.favoredName, null);
});

test('buildNationalStrengthComparison returns null when a side is unseeded', () => {
  assert.equal(buildNationalStrengthComparison('Brazil', 'Ruritania'), null);
});

test('parseNationalTeamForm computes W-D-L from completed ESPN fixtures', () => {
  const schedule = {
    events: [
      // oldest first; team id 1 is our team
      mkEvent('1', 2, '2', 0, true),   // W
      mkEvent('1', 1, '3', 1, true),   // D
      mkEvent('1', 0, '4', 2, true),   // L
      mkEvent('1', 3, '5', 1, false),  // not completed → ignored
    ],
  };
  const form = parseNationalTeamForm(schedule, '1');
  assert.ok(form);
  assert.equal(form.played, 3);
  assert.equal(form.record, '1W-1D-1L');
  assert.equal(form.recent, 'LDW');     // newest-first
  assert.equal(form.avgGoalsFor, 1);    // (2+1+0)/3
  assert.equal(form.avgGoalsAgainst, 1);// (0+1+2)/3
});

test('parseNationalTeamForm returns null with no completed games', () => {
  assert.equal(parseNationalTeamForm({ events: [] }, '1'), null);
  assert.equal(parseNationalTeamForm(null, '1'), null);
  assert.equal(parseNationalTeamForm({ events: [mkEvent('1', 1, '2', 0, false)] }, '1'), null);
});

function mkEvent(homeId, homeScore, awayId, awayScore, completed) {
  return {
    competitions: [{
      status: { type: { completed, state: completed ? 'post' : 'pre' } },
      competitors: [
        { team: { id: homeId }, score: { value: homeScore } },
        { team: { id: awayId }, score: { value: awayScore } },
      ],
    }],
  };
}
