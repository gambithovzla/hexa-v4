/**
 * Tests for normalizeRefereeStats (Sprint 11.3 — árbitro con tendencias).
 * Tests the pure exported function — no network needed.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRefereeStats } from '../soccer-lineups-api.js';

/** Build a minimal API-Football /referees response. */
function refResponse({ name = 'Test Referee', leagueId = 39, season = 2024,
                       played = 10, yellow = 30, yellowred = 2, red = 1,
                       penaltyCommited = 4 } = {}) {
  return {
    response: [{
      id: 999,
      name,
      nationality: 'England',
      statistics: [{
        league: { id: leagueId, name: 'Premier League' },
        season,
        games: { played },
        cards: { yellow, yellowred, red },
        penalty: { commited: penaltyCommited },
      }],
    }],
  };
}

describe('normalizeRefereeStats', () => {
  test('returns null for empty or missing response', () => {
    assert.equal(normalizeRefereeStats(null), null);
    assert.equal(normalizeRefereeStats({}), null);
    assert.equal(normalizeRefereeStats({ response: [] }), null);
  });

  test('returns null when games.played is 0', () => {
    const resp = refResponse({ played: 0 });
    assert.equal(normalizeRefereeStats(resp, 39, 2024), null);
  });

  test('computes yellowsPerGame correctly', () => {
    // 30 yellow cards over 10 games → 3.0 YC/g
    const resp = refResponse({ played: 10, yellow: 30, yellowred: 0, red: 0, penaltyCommited: 0 });
    const result = normalizeRefereeStats(resp, 39, 2024);
    assert.equal(result.yellowsPerGame, 3.0);
  });

  test('redsPerGame includes both direct reds and second-yellow reds', () => {
    // 1 direct red + 2 second-yellows over 10 games → 0.3 RC/g
    const resp = refResponse({ played: 10, yellow: 20, yellowred: 2, red: 1, penaltyCommited: 0 });
    const result = normalizeRefereeStats(resp, 39, 2024);
    assert.equal(result.redsPerGame, 0.3);
  });

  test('redsPerGame is 0 when no red cards', () => {
    const resp = refResponse({ played: 10, yellow: 25, yellowred: 0, red: 0, penaltyCommited: 2 });
    const result = normalizeRefereeStats(resp, 39, 2024);
    assert.equal(result.redsPerGame, 0);
  });

  test('computes penaltiesPerGame correctly', () => {
    // 4 penalties over 10 games → 0.4 pen/g
    const resp = refResponse({ played: 10, yellow: 25, yellowred: 0, red: 0, penaltyCommited: 4 });
    const result = normalizeRefereeStats(resp, 39, 2024);
    assert.equal(result.penaltiesPerGame, 0.4);
  });

  test('returns null for penaltiesPerGame when penalty field absent', () => {
    const resp = {
      response: [{
        id: 1, name: 'No Pen Ref',
        statistics: [{
          league: { id: 39 }, season: 2024,
          games: { played: 8 },
          cards: { yellow: 20, yellowred: 0, red: 0 },
          // no penalty field
        }],
      }],
    };
    const result = normalizeRefereeStats(resp, 39, 2024);
    assert.equal(result.penaltiesPerGame, null);
  });

  test('falls back to "penalties.commited" spelling (API-Football inconsistency)', () => {
    const resp = {
      response: [{
        id: 2, name: 'Alt Pen Ref',
        statistics: [{
          league: { id: 39 }, season: 2024,
          games: { played: 5 },
          cards: { yellow: 10, yellowred: 0, red: 0 },
          penalties: { commited: 3 },  // "penalties" plural, not "penalty"
        }],
      }],
    };
    const result = normalizeRefereeStats(resp, 39, 2024);
    assert.equal(result.penaltiesPerGame, 0.6);
  });

  test('prefers matching league+season stats over first entry', () => {
    const resp = {
      response: [{
        id: 3, name: 'Multi League Ref',
        statistics: [
          {
            league: { id: 140 }, season: 2024,
            games: { played: 5 },
            cards: { yellow: 10, yellowred: 0, red: 0 },
            penalty: { commited: 0 },
          },
          {
            league: { id: 39 }, season: 2024,
            games: { played: 20 },
            cards: { yellow: 80, yellowred: 0, red: 0 },
            penalty: { commited: 10 },
          },
        ],
      }],
    };
    // Should pick EPL (leagueId=39) stats: 80/20 = 4.0 YC/g
    const result = normalizeRefereeStats(resp, 39, 2024);
    assert.equal(result.gamesOfficiated, 20);
    assert.equal(result.yellowsPerGame, 4.0);
  });

  test('returns correct referee name', () => {
    const resp = refResponse({ name: 'Michael Oliver', played: 15 });
    const result = normalizeRefereeStats(resp, 39, 2024);
    assert.equal(result.name, 'Michael Oliver');
    assert.equal(result.gamesOfficiated, 15);
  });
});
