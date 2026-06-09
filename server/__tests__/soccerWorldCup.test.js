/**
 * server/__tests__/soccerWorldCup.test.js
 *
 * Unit tests for FIFA World Cup 2026 support in the soccer pipeline.
 * Covers registry entry, tournament flags, reverse lookup, national-team
 * name normalization and league scoping.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  getSoccerLeague,
  isSupportedLeague,
  getSoccerLeagueByOddsSlug,
  isInternationalLeague,
} from '../soccer-league-map.js';

import { findSoccerTeam } from '../soccer-team-map.js';

// ── Registry ───────────────────────────────────────────────────────────────

describe('World Cup league registry', () => {
  test('fifa.world is registered and supported', () => {
    assert.ok(isSupportedLeague('fifa.world'));
  });

  test('entry has correct ESPN slug, Odds API slug, and tournament flags', () => {
    const league = getSoccerLeague('fifa.world');
    assert.equal(league.slug,        'fifa.world');
    assert.equal(league.oddsApiSlug, 'soccer_fifa_world_cup');
    assert.equal(league.international,  true);
    assert.equal(league.neutralVenues,  true);
    assert.ok(typeof league.avgGoals === 'number');
    assert.ok(typeof league.drawPct  === 'number');
  });

  test('reverse lookup by Odds API slug resolves to the World Cup', () => {
    const league = getSoccerLeagueByOddsSlug('soccer_fifa_world_cup');
    assert.ok(league, 'should resolve');
    assert.equal(league.slug, 'fifa.world');
  });

  test('isInternationalLeague distinguishes the World Cup from domestic leagues', () => {
    assert.equal(isInternationalLeague('fifa.world'), true);
    assert.equal(isInternationalLeague('eng.1'),      false);
    assert.equal(isInternationalLeague('usa.1'),      false);
    assert.equal(isInternationalLeague(null),         false);
  });
});

// ── National-team name normalization ──────────────────────────────────────

describe('National-team name normalization', () => {
  test('resolves by canonical name scoped to the tournament', () => {
    const team = findSoccerTeam('Argentina', 'fifa.world');
    assert.ok(team, 'should find Argentina');
    assert.equal(team.short, 'ARG');
  });

  test('resolves by FIFA short code (case-insensitive)', () => {
    const team = findSoccerTeam('BRA', 'fifa.world');
    assert.ok(team, 'should find Brazil via short code');
    assert.equal(team.name, 'Brazil');
  });

  test('resolves ESPN ↔ Odds API alias mismatches', () => {
    // ESPN uses "Korea Republic"; Odds API may use "South Korea"
    const byAlias   = findSoccerTeam('Korea Republic', 'fifa.world');
    const byCanon   = findSoccerTeam('South Korea',    'fifa.world');
    assert.ok(byAlias,  'should resolve Korea Republic alias');
    assert.ok(byCanon,  'should resolve South Korea canonical');
    assert.equal(byAlias.name,  byCanon.name);
    assert.equal(byAlias.short, 'KOR');

    // USMNT → United States
    const usmnt = findSoccerTeam('USMNT', 'fifa.world');
    assert.ok(usmnt, 'should resolve USMNT alias');
    assert.equal(usmnt.name, 'United States');
  });

  test('unseeded nation falls back gracefully (returns null, not an error)', () => {
    const team = findSoccerTeam('Ruritania FC', 'fifa.world');
    assert.equal(team, null);
  });

  test('league scoping prevents cross-contamination with clubs', () => {
    // "France" should be the national team when scoped to fifa.world
    const national = findSoccerTeam('France', 'fifa.world');
    assert.ok(national, 'national team France found');
    assert.equal(national.league, 'fifa.world');

    // PSG (Paris Saint-Germain) should NOT match "France"
    const psg = findSoccerTeam('Paris Saint-Germain', 'fifa.world');
    assert.equal(psg, null, 'PSG should not match in fifa.world scope');
  });
});
