import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchNflWeather } from '../nfl-context-builder.js';

test('weather uses kickoff date and UTC hour across days and offsets', async t => {
  let requestedUrl;
  t.mock.method(global, 'fetch', async url => {
    requestedUrl = new URL(url);
    return { ok: true, json: async () => ({ hourly: {
      time: ['2026-09-10T17:00:00Z', '2026-09-13T17:00:00Z'].map(s => Date.parse(s) / 1000),
      temperature_2m: [80, 51], windspeed_10m: [2, 24], precipitation_probability: [0, 70],
    } }) };
  });
  const weather = await fetchNflWeather({ lat: 40, lon: -74, gameTime: '2026-09-13T13:25:00-04:00' });
  assert.equal(weather.temperature, 51);
  assert.equal(weather.windSpeed, 24);
  assert.equal(weather.validAt, '2026-09-13T17:00:00.000Z');
  assert.equal(requestedUrl.searchParams.get('timezone'), 'UTC');
  assert.equal(requestedUrl.searchParams.get('timeformat'), 'unixtime');
});

test('kickoff outside forecast coverage leaves weather unavailable', async t => {
  t.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ hourly: {
    time: [Date.parse('2026-09-10T17:00:00Z') / 1000], temperature_2m: [80],
  } }) }));
  assert.equal(await fetchNflWeather({ lat: 40, lon: -74, gameTime: '2026-10-13T17:00:00Z' }), null);
});

test('missing kickoff does not silently select today weather', async t => {
  const mock = t.mock.method(global, 'fetch', async () => { throw new Error('must not fetch'); });
  assert.equal(await fetchNflWeather({ lat: 40, lon: -74 }), null);
  assert.equal(mock.mock.callCount(), 0);
});
