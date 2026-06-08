import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getSoccerStadium,
  soccerWeatherFlags,
  getSoccerWeather,
} from '../soccer-weather-api.js';

test('getSoccerStadium resolves seeded clubs by canonical name', () => {
  const arsenal = getSoccerStadium('Arsenal', 'eng.1');
  assert.equal(arsenal?.name, 'Emirates Stadium');
  assert.ok(Math.abs(arsenal.lat - 51.5549) < 0.01);
  assert.ok(Math.abs(arsenal.lon - (-0.1084)) < 0.01);
});

test('getSoccerStadium resolves via alias (Spurs → Tottenham)', () => {
  const spurs = getSoccerStadium('Spurs', 'eng.1');
  assert.equal(spurs?.name, 'Tottenham Hotspur Stadium');
});

test('getSoccerStadium flags roofed / weather-neutral venues', () => {
  assert.equal(getSoccerStadium('Real Madrid', 'esp.1')?.roof, true);
  assert.equal(getSoccerStadium('Lille', 'fra.1')?.roof, true);
  assert.equal(getSoccerStadium('Atlanta United FC', 'usa.1')?.roof, true);
  // Open-air venue: no roof flag
  assert.equal(getSoccerStadium('Liverpool', 'eng.1')?.roof, undefined);
});

test('getSoccerStadium returns null for unmapped clubs', () => {
  assert.equal(getSoccerStadium('Some Unmapped FC', 'eng.1'), null);
  assert.equal(getSoccerStadium(null), null);
});

test('soccerWeatherFlags: high wind, heat, freeze, heavy rain', () => {
  const windy = soccerWeatherFlags(18, 52, 10);
  assert.ok(windy.some(f => /HIGH WIND/.test(f)));

  const hot = soccerWeatherFlags(33, 8, 5);
  assert.ok(hot.some(f => /HOT/.test(f) && /UNDER/.test(f)));

  const cold = soccerWeatherFlags(-3, 10, 5);
  assert.ok(cold.some(f => /FREEZING/.test(f)));

  const rain = soccerWeatherFlags(15, 10, 75);
  assert.ok(rain.some(f => /HEAVY RAIN/.test(f)));
});

test('soccerWeatherFlags: benign conditions produce no flags', () => {
  assert.deepEqual(soccerWeatherFlags(18, 12, 10), []);
});

test('soccerWeatherFlags: moderate wind & rain produce softer flags', () => {
  const flags = soccerWeatherFlags(18, 35, 50);
  assert.ok(flags.some(f => /^WIND/.test(f)));
  assert.ok(flags.some(f => /^RAIN/.test(f)));
  assert.ok(!flags.some(f => /HIGH WIND/.test(f)));
});

test('getSoccerWeather: roofed venue is weather-neutral (no network)', async () => {
  const w = await getSoccerWeather({ homeTeamName: 'Real Madrid', leagueSlug: 'esp.1' });
  assert.equal(w?.roof, true);
  assert.equal(w?.stadium, 'Santiago Bernabéu');
  assert.deepEqual(w?.analysis, []);
});

test('getSoccerWeather: unmapped venue returns null (no network)', async () => {
  const w = await getSoccerWeather({ homeTeamName: 'Some Unmapped FC', leagueSlug: 'eng.1' });
  assert.equal(w, null);
});
