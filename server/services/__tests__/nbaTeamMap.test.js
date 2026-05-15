import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveNbaStatsTeamId, enrichGameTeamIds, isNbaStatsTeamId } from '../../nba-team-map.js';

test('resolveNbaStatsTeamId maps ESPN Lakers id to stats id', () => {
  const id = resolveNbaStatsTeamId({ teamId: 14, teamAbbr: 'LAL' });
  assert.equal(id, 1610612747);
  assert.equal(isNbaStatsTeamId(id), true);
});

test('resolveNbaStatsTeamId maps by abbreviation when id is unknown', () => {
  const id = resolveNbaStatsTeamId({ teamId: 99999, teamAbbr: 'BOS' });
  assert.equal(id, 1610612738);
});

test('enrichGameTeamIds normalizes ESPN game row', () => {
  const enriched = enrichGameTeamIds({
    game_id: '401585601',
    home_team_id: 14,
    home_team_abbr: 'LAL',
    away_team_id: 2,
    away_team_abbr: 'BOS',
  });
  assert.equal(enriched.home_team_id, 1610612747);
  assert.equal(enriched.away_team_id, 1610612738);
  assert.equal(enriched.espn_home_team_id, 14);
  assert.equal(enriched.team_id_mapped, true);
});
