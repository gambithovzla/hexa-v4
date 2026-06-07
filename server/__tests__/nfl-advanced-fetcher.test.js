import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// The fetcher reads env vars at import time — set them before importing.
process.env.ML_SIDECAR_ENABLED = '1';
process.env.HEXA_ML_API_URL = 'http://sidecar.test';
process.env.HEXA_ML_INTERNAL_TOKEN = 'tok';

const { getNflAdvancedTeamStats, findAdvancedStats } = await import('../nfl-advanced-fetcher.js');

const SIDECAR_PAYLOAD = {
  season: 2023,
  fetched_at: '2026-01-01T00:00:00Z',
  teams: {
    // nflverse abbreviations that differ from ESPN canonical (WAS→WSH, LA→LAR)
    WAS: { team: 'WAS', epa_off: 0.05, epa_def: -0.02, success_rate_off: 0.46, proe: 1.1 },
    LA:  { team: 'LA',  epa_off: 0.11, epa_def: 0.01,  success_rate_off: 0.49, proe: 3.2 },
    KC:  { team: 'KC',  epa_off: 0.18, epa_def: -0.05, success_rate_off: 0.51, proe: -1.0 },
  },
};

let originalFetch;
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; });

test('getNflAdvancedTeamStats re-keys nflverse abbrs to canonical ESPN abbrs', async () => {
  let calledUrl = null;
  global.fetch = async (url) => {
    calledUrl = url;
    return { ok: true, json: async () => SIDECAR_PAYLOAD };
  };
  // unique season per test avoids the 6h module-level cache bleeding across cases
  const res = await getNflAdvancedTeamStats(20231);
  assert.match(calledUrl, /\/nfl\/team-stats\?season=20231/);
  // WAS→WSH, LA→LAR remapped; KC unchanged
  assert.equal(res.byAbbr.WSH?.epa_off, 0.05);
  assert.equal(res.byAbbr.LAR?.proe, 3.2);
  assert.equal(res.byAbbr.KC?.epa_off, 0.18);
  assert.equal(res.byAbbr.WAS, undefined);
});

test('findAdvancedStats resolves aliases (WAS finds WSH entry)', async () => {
  global.fetch = async () => ({ ok: true, json: async () => SIDECAR_PAYLOAD });
  const res = await getNflAdvancedTeamStats(20232);
  assert.equal(findAdvancedStats(res, 'WAS')?.epa_off, 0.05);
  assert.equal(findAdvancedStats(res, 'WSH')?.epa_off, 0.05);
  assert.equal(findAdvancedStats(res, 'LAR')?.proe, 3.2);
  assert.equal(findAdvancedStats(res, 'NONEXIST'), null);
  assert.equal(findAdvancedStats(null, 'KC'), null);
});

test('getNflAdvancedTeamStats returns null on HTTP 503 (no stale cache)', async () => {
  global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const res = await getNflAdvancedTeamStats(20239);
  assert.equal(res, null);
});

test('getNflAdvancedTeamStats never throws on network error', async () => {
  global.fetch = async () => { throw new Error('ECONNREFUSED'); };
  const res = await getNflAdvancedTeamStats(20238);
  assert.equal(res, null);
});

test('empty requested season falls back to the prior season', async () => {
  const seasons = [];
  global.fetch = async (url) => {
    const m = String(url).match(/season=(\d+)/);
    const s = m ? Number(m[1]) : null;
    seasons.push(s);
    // 30000 (the "current" season) is empty; 29999 (prior) has data.
    if (s === 30000) return { ok: true, json: async () => ({ season: 30000, teams: {} }) };
    return { ok: true, json: async () => ({ season: 29999, teams: { KC: { team: 'KC', epa_off: 0.2 } } }) };
  };
  const res = await getNflAdvancedTeamStats(30000);
  assert.equal(res.isFallback, true);
  assert.equal(res.requestedSeason, 30000);
  assert.equal(res.season, 29999);
  assert.equal(res.byAbbr.KC?.epa_off, 0.2);
  assert.deepEqual(seasons, [30000, 29999]); // tried current, then walked back one year
});

test('non-empty requested season does not fall back', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ season: 30001, teams: { KC: { team: 'KC', epa_off: 0.1 } } }) });
  const res = await getNflAdvancedTeamStats(30001);
  assert.equal(res.isFallback, false);
  assert.equal(res.requestedSeason, 30001);
  assert.equal(res.byAbbr.KC?.epa_off, 0.1);
});
