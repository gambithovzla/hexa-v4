import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateSquadStrength,
  squadQualityTier,
  nationalTeamSeason,
} from '../soccer-squad-strength.js';

function player(name, rating, minutes, goals = 0, assists = 0, position = 'M') {
  return {
    player: { name, position },
    statistics: [{ games: { rating: rating == null ? null : String(rating), minutes, position }, goals: { total: goals, assists } }],
  };
}

test('squadQualityTier bands', () => {
  assert.equal(squadQualityTier(7.4), 'elite squad');
  assert.equal(squadQualityTier(7.05), 'strong squad');
  assert.equal(squadQualityTier(6.85), 'solid squad');
  assert.equal(squadQualityTier(6.6), 'average squad');
  assert.equal(squadQualityTier(6.2), 'thin squad');
  assert.equal(squadQualityTier(null), null);
});

test('nationalTeamSeason uses calendar year', () => {
  assert.equal(nationalTeamSeason('2026-06-20'), 2026);
  assert.equal(nationalTeamSeason('2027-01-02'), 2027);
});

test('aggregateSquadStrength averages the core and surfaces stars + top players', () => {
  const rows = [
    player('Star A', 7.5, 540, 6, 3),
    player('Star B', 7.3, 500, 4, 5),
    player('Mid C', 6.9, 450, 1, 1),
    player('Mid D', 6.8, 400, 0, 2),
    player('Sub E', 6.6, 120, 0, 0),
    player('NoRating', null, 300, 2, 0),  // dropped (no rating)
  ];
  const agg = aggregateSquadStrength(rows);
  assert.ok(agg);
  assert.equal(agg.sampleSize, 5);             // 5 rated players
  assert.equal(agg.starCount, 2);              // ratings >= 7.2
  assert.ok(agg.avgRating >= 6.9 && agg.avgRating <= 7.1);
  assert.equal(agg.tier, squadQualityTier(agg.avgRating));
  assert.equal(agg.topPlayers.length, 3);
  // Top by goal involvement: Star A (9) then Star B (9 too — tie broken by rating)
  assert.equal(agg.topPlayers[0].name, 'Star A');
});

test('aggregateSquadStrength distinguishes a thin squad from an elite one', () => {
  const elite = aggregateSquadStrength([
    player('A', 7.5, 500), player('B', 7.4, 500), player('C', 7.3, 500),
    player('D', 7.3, 500), player('E', 7.2, 500),
  ]);
  const thin = aggregateSquadStrength([
    player('A', 6.5, 500), player('B', 6.4, 500), player('C', 6.3, 500),
    player('D', 6.3, 500), player('E', 6.2, 500),
  ]);
  assert.ok(elite.avgRating > thin.avgRating);
  assert.equal(elite.tier, 'elite squad');
  assert.equal(thin.tier, 'thin squad');
  assert.equal(thin.starCount, 0);
});

test('aggregateSquadStrength returns null on empty / unrated input', () => {
  assert.equal(aggregateSquadStrength([]), null);
  assert.equal(aggregateSquadStrength(null), null);
  assert.equal(aggregateSquadStrength([player('X', null, 200)]), null);
});
