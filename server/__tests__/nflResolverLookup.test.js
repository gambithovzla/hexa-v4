import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { getNflGameById, _resetNflApiCache } = await import('../nfl-api.js');

let originalFetch;
beforeEach(() => { originalFetch = global.fetch; _resetNflApiCache(); });
afterEach(() => { global.fetch = originalFetch; _resetNflApiCache(); });

function finalSummary({ homeScore = 27, awayScore = 20 } = {}) {
  return {
    header: {
      id: '401872925',
      season: { year: 2026, type: 2 },
      week: 2,
      competitions: [{
        id: '401872925',
        date: '2026-09-13T17:00:00Z',
        status: { type: { state: 'post', completed: true, shortDetail: 'Final' }, period: 4, displayClock: '0:00' },
        competitors: [
          { homeAway: 'home', score: String(homeScore), team: { id: '4', abbreviation: 'CIN', displayName: 'Cincinnati Bengals' } },
          { homeAway: 'away', score: String(awayScore), team: { id: '27', abbreviation: 'TB', displayName: 'Tampa Bay Buccaneers' } },
        ],
      }],
    },
  };
}

// The resolver used to find games only through that date's scoreboard, so a pick
// whose stored game_date was not kickoff day stayed pending forever. The
// event-id lookup is what makes resolution date-independent.
test('a finished game resolves from its event id alone, with the final score', async () => {
  global.fetch = async (url) => {
    assert.ok(String(url).includes('/summary?event=401872925'));
    return { ok: true, json: async () => finalSummary() };
  };

  const game = await getNflGameById(401872925);
  assert.equal(game.game_status_id, 3, 'final');
  assert.equal(game.home_score, 27);
  assert.equal(game.away_score, 20);
  assert.equal(game.home_team_abbr, 'CIN');
  assert.equal(game.game_date, '2026-09-13');
});

test('an in-progress game reports scores but not a final status', async () => {
  const live = finalSummary({ homeScore: 10, awayScore: 7 });
  live.header.competitions[0].status.type = { state: 'in', completed: false, shortDetail: '2nd Quarter' };
  global.fetch = async () => ({ ok: true, json: async () => live });

  const game = await getNflGameById(401872925);
  assert.notEqual(game.game_status_id, 3);
  assert.equal(game.home_score, 10);
});
