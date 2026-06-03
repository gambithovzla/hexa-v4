import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getTennisTour,
  isSupportedTour,
  getTennisTourByOddsSlug,
  normalizeSurface,
  inferSurfaceFromTournament,
  roundDepth,
  TENNIS_SURFACES,
  TENNIS_TOURS_LIST,
  TENNIS_TOUR_COUNT,
} from '../tennis-tour-map.js';

test('registry has exactly the two tours', () => {
  assert.equal(TENNIS_TOUR_COUNT, 2);
  assert.deepEqual([...TENNIS_TOURS_LIST].sort(), ['atp', 'wta']);
});

test('getTennisTour resolves atp/wta and is case-insensitive', () => {
  assert.equal(getTennisTour('atp')?.oddsApiSlug, 'tennis_atp');
  assert.equal(getTennisTour('WTA')?.oddsApiSlug, 'tennis_wta');
  assert.equal(getTennisTour('atp')?.bestOfMax, 5);
  assert.equal(getTennisTour('wta')?.bestOfMax, 3);
});

test('getTennisTour returns null for unknown / empty', () => {
  assert.equal(getTennisTour('itf'), null);
  assert.equal(getTennisTour(''), null);
  assert.equal(getTennisTour(null), null);
});

test('isSupportedTour gates correctly', () => {
  assert.equal(isSupportedTour('atp'), true);
  assert.equal(isSupportedTour('wta'), true);
  assert.equal(isSupportedTour('mlb'), false);
  assert.equal(isSupportedTour(undefined), false);
});

test('getTennisTourByOddsSlug round-trips', () => {
  assert.equal(getTennisTourByOddsSlug('tennis_atp')?.tour, 'atp');
  assert.equal(getTennisTourByOddsSlug('tennis_wta')?.tour, 'wta');
  assert.equal(getTennisTourByOddsSlug('soccer_epl'), null);
});

test('normalizeSurface maps common ESPN labels', () => {
  assert.equal(normalizeSurface('Clay'), 'clay');
  assert.equal(normalizeSurface('Red clay'), 'clay');
  assert.equal(normalizeSurface('Grass'), 'grass');
  assert.equal(normalizeSurface('Hardcourt'), 'hard');
  assert.equal(normalizeSurface('Hard (I)'), 'hard');
  assert.equal(normalizeSurface('Carpet'), 'carpet');
  assert.equal(normalizeSurface('unknown'), null);
  assert.equal(normalizeSurface(null), null);
});

test('inferSurfaceFromTournament places the Grand Slams', () => {
  assert.equal(inferSurfaceFromTournament('Roland Garros'), 'clay');
  assert.equal(inferSurfaceFromTournament('French Open'), 'clay');
  assert.equal(inferSurfaceFromTournament('Wimbledon'), 'grass');
  assert.equal(inferSurfaceFromTournament('US Open'), 'hard');
  assert.equal(inferSurfaceFromTournament('Australian Open'), 'hard');
});

test('inferSurfaceFromTournament places clay/grass swing events', () => {
  assert.equal(inferSurfaceFromTournament('Mutua Madrid Open'), 'clay');
  assert.equal(inferSurfaceFromTournament('Internazionali BNL d\'Italia'), 'clay');
  assert.equal(inferSurfaceFromTournament('Monte-Carlo Masters'), 'clay');
  assert.equal(inferSurfaceFromTournament('Halle Open'), 'grass');
  assert.equal(inferSurfaceFromTournament("Queen's Club"), 'grass');
});

test('inferSurfaceFromTournament returns null for unknown / ambiguous', () => {
  assert.equal(inferSurfaceFromTournament('Some Challenger 125'), null);
  assert.equal(inferSurfaceFromTournament('Stuttgart Open'), null); // ATP grass / WTA clay — ambiguous
  assert.equal(inferSurfaceFromTournament(''), null);
  assert.equal(inferSurfaceFromTournament(null), null);
});

test('TENNIS_SURFACES is the canonical vocabulary', () => {
  assert.deepEqual(TENNIS_SURFACES, ['hard', 'clay', 'grass', 'carpet']);
});

test('roundDepth maps labels to 1..7', () => {
  assert.equal(roundDepth('Round of 128'), 1);
  assert.equal(roundDepth('R64'), 2);
  assert.equal(roundDepth('Round of 32'), 3);
  assert.equal(roundDepth('Round of 16'), 4);
  assert.equal(roundDepth('Quarterfinals'), 5);
  assert.equal(roundDepth('Semifinals'), 6);
  assert.equal(roundDepth('Final'), 7);
});

test('roundDepth handles partial / decorated labels', () => {
  assert.equal(roundDepth("Men's Singles - Quarterfinals"), 5);
  assert.equal(roundDepth('Final'), 7);
  assert.equal(roundDepth('garbage'), null);
  assert.equal(roundDepth(null), null);
});
