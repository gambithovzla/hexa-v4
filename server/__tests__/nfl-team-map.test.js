import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveNflTeamId,
  isNflTeamId,
  getNflTeam,
  getNflStadium,
  enrichGameTeamIds,
  TEAM_BY_ID,
} from '../nfl-team-map.js';

test('map has all 32 active franchises', () => {
  assert.equal(Object.keys(TEAM_BY_ID).length, 32);
});

test('resolveNflTeamId resolves by abbreviation', () => {
  assert.equal(resolveNflTeamId({ teamAbbr: 'KC' }), 12);
  assert.equal(resolveNflTeamId({ teamAbbr: 'BUF' }), 2);
  assert.equal(resolveNflTeamId({ teamAbbr: 'BAL' }), 33);
});

test('resolveNflTeamId passes through a valid numeric id', () => {
  assert.equal(resolveNflTeamId({ teamId: 34 }), 34); // HOU
  assert.equal(resolveNflTeamId({ teamId: '12' }), 12);
});

test('abbreviation aliases normalize to canonical', () => {
  assert.equal(getNflTeam({ teamAbbr: 'WAS' })?.abbr, 'WSH');
  assert.equal(getNflTeam({ teamAbbr: 'JAC' })?.abbr, 'JAX');
  assert.equal(getNflTeam({ teamAbbr: 'OAK' })?.abbr, 'LV');
  assert.equal(getNflTeam({ teamAbbr: 'SD' })?.abbr, 'LAC');
});

test('isNflTeamId rejects gaps and out-of-range ids', () => {
  assert.equal(isNflTeamId(12), true);
  assert.equal(isNflTeamId(31), false); // historical gap
  assert.equal(isNflTeamId(99), false);
  assert.equal(isNflTeamId(null), false);
});

test('getNflStadium reports dome flag correctly', () => {
  assert.equal(getNflStadium({ teamAbbr: 'MIN' })?.dome, true);  // U.S. Bank
  assert.equal(getNflStadium({ teamAbbr: 'NO' })?.dome, true);   // Superdome
  assert.equal(getNflStadium({ teamAbbr: 'GB' })?.dome, false);  // Lambeau
  assert.equal(getNflStadium({ teamAbbr: 'BUF' })?.dome, false); // Highmark
});

test('dome venue count matches expected (11)', () => {
  const domes = Object.values(TEAM_BY_ID).filter(t => t.dome).length;
  assert.equal(domes, 11);
});

test('every team has stadium coords for weather', () => {
  for (const [id, t] of Object.entries(TEAM_BY_ID)) {
    assert.ok(Number.isFinite(t.lat), `team ${id} missing lat`);
    assert.ok(Number.isFinite(t.lon), `team ${id} missing lon`);
    assert.ok(t.conference === 'AFC' || t.conference === 'NFC', `team ${id} bad conference`);
  }
});

test('enrichGameTeamIds fills abbr/name/venue from ids', () => {
  const g = enrichGameTeamIds({ home_team_id: 12, away_team_id: 2 });
  assert.equal(g.home_team_abbr, 'KC');
  assert.equal(g.away_team_abbr, 'BUF');
  assert.equal(g.home_team_name, 'Kansas City Chiefs');
  assert.equal(g.dome, false);
  assert.equal(g.stadium, 'GEHA Field at Arrowhead');
  assert.equal(g.team_id_mapped, true);
});

test('enrichGameTeamIds resolves ids from abbreviations', () => {
  const g = enrichGameTeamIds({ home_team_abbr: 'DET', away_team_abbr: 'CHI' });
  assert.equal(g.home_team_id, 8);
  assert.equal(g.away_team_id, 3);
  assert.equal(g.dome, true); // Ford Field
});
