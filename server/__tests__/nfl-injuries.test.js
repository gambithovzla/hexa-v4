import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { getNflLeagueInjuries, findTeamInjuries, _resetNflApiCache } = await import('../nfl-api.js');

let originalFetch;
let originalLog;
beforeEach(() => {
  originalFetch = global.fetch;
  originalLog = console.log;
  console.log = () => {};
  _resetNflApiCache();
});
afterEach(() => {
  global.fetch = originalFetch;
  console.log = originalLog;
  _resetNflApiCache();
});

// Shape of the real feed: {id, displayName, injuries} with no nested `team`
// and no abbreviation anywhere.
function feed() {
  return {
    injuries: [{
      id: '7',
      displayName: 'Denver Broncos',
      injuries: [{
        status: 'Questionable',
        athlete: { id: '1', displayName: 'Some Player', position: { abbreviation: 'RB' } },
        details: { type: 'Knee' },
        shortComment: 'Limited in practice.',
      }],
    }],
  };
}

test('the league feed indexes by both team id and abbreviation', async () => {
  global.fetch = async () => ({ ok: true, status: 200, json: async () => feed() });

  const payload = await getNflLeagueInjuries();
  assert.equal(Object.keys(payload.byTeamId).length, 1);
  assert.equal(Object.keys(payload.byAbbr).length, 1, 'the abbr index comes from the team map');
  assert.equal(payload.byAbbr.DEN.injuries.length, 1);
  assert.equal(payload.byTeamId['7'].displayName, 'Denver Broncos');
});

test('findTeamInjuries resolves a team by id and by abbr', async () => {
  global.fetch = async () => ({ ok: true, status: 200, json: async () => feed() });

  const payload = await getNflLeagueInjuries();
  assert.equal(findTeamInjuries(payload, { teamId: 7 })?.injuries.length, 1);
  assert.equal(findTeamInjuries(payload, { teamAbbr: 'DEN' })?.injuries.length, 1);
  assert.equal(findTeamInjuries(payload, { teamAbbr: 'ZZZ' }), null);
});

test('injury entries keep the normalized status key', async () => {
  global.fetch = async () => ({ ok: true, status: 200, json: async () => feed() });

  const payload = await getNflLeagueInjuries();
  const entry = payload.byAbbr.DEN.injuries[0];
  assert.equal(entry.statusKey, 'questionable');
  assert.equal(entry.position, 'RB');
  assert.equal(entry.type, 'Knee');
});
