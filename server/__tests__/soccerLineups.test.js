import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  apiFootballLeagueId,
  apiFootballSeason,
  buildApiFootballRequest,
  matchFixtureByTeams,
  normalizeLineups,
  normalizeAvailability,
  normalizeH2H,
  normalizeCongestion,
  normalizeTeamSplits,
} from '../soccer-lineups-api.js';

test('apiFootballLeagueId maps the 6 supported leagues', () => {
  assert.equal(apiFootballLeagueId('eng.1'), 39);
  assert.equal(apiFootballLeagueId('esp.1'), 140);
  assert.equal(apiFootballLeagueId('usa.1'), 253);
  assert.equal(apiFootballLeagueId('xxx.9'), null);
});

test('apiFootballSeason: Europe by start year, MLS by calendar year', () => {
  // European league in September 2024 → 2024-25 season → 2024
  assert.equal(apiFootballSeason('eng.1', '2024-09-15'), 2024);
  // European league in February 2025 → still the 2024-25 season → 2024
  assert.equal(apiFootballSeason('eng.1', '2025-02-10'), 2024);
  // MLS is a calendar-year season
  assert.equal(apiFootballSeason('usa.1', '2025-07-01'), 2025);
});

test('buildApiFootballRequest: direct api-sports auth (default)', () => {
  const prevKey = process.env.API_FOOTBALL_KEY;
  const prevProv = process.env.API_FOOTBALL_PROVIDER;
  process.env.API_FOOTBALL_KEY = 'k123';
  delete process.env.API_FOOTBALL_PROVIDER;
  delete process.env.API_FOOTBALL_HOST;
  const req = buildApiFootballRequest('/fixtures', { league: 39, season: 2024, date: '2024-09-15' });
  assert.match(req.url, /^https:\/\/v3\.football\.api-sports\.io\/fixtures\?/);
  assert.match(req.url, /league=39&season=2024&date=2024-09-15/);
  assert.equal(req.headers['x-apisports-key'], 'k123');
  assert.equal(req.headers['x-rapidapi-key'], undefined);
  process.env.API_FOOTBALL_KEY = prevKey;
  if (prevProv != null) process.env.API_FOOTBALL_PROVIDER = prevProv;
});

test('buildApiFootballRequest: RapidAPI auth when provider=rapidapi', () => {
  const prevKey = process.env.API_FOOTBALL_KEY;
  const prevProv = process.env.API_FOOTBALL_PROVIDER;
  process.env.API_FOOTBALL_KEY = 'rk';
  process.env.API_FOOTBALL_PROVIDER = 'rapidapi';
  const req = buildApiFootballRequest('/injuries', { fixture: 99 });
  assert.match(req.url, /api-football-v1\.p\.rapidapi\.com\/v3\/injuries\?fixture=99/);
  assert.equal(req.headers['x-rapidapi-key'], 'rk');
  assert.equal(req.headers['x-rapidapi-host'], 'api-football-v1.p.rapidapi.com');
  process.env.API_FOOTBALL_KEY = prevKey;
  if (prevProv != null) process.env.API_FOOTBALL_PROVIDER = prevProv; else delete process.env.API_FOOTBALL_PROVIDER;
});

test('matchFixtureByTeams matches by normalized names (drops FC/accents)', () => {
  const fixtures = [
    { fixture: { id: 1 }, teams: { home: { name: 'Arsenal FC' }, away: { name: 'Chelsea FC' } } },
    { fixture: { id: 2 }, teams: { home: { name: 'Manchester City' }, away: { name: 'Burnley' } } },
  ];
  assert.equal(matchFixtureByTeams(fixtures, 'Arsenal', 'Chelsea').fixture.id, 1);
  assert.equal(matchFixtureByTeams(fixtures, 'Manchester City', 'Burnley').fixture.id, 2);
  assert.equal(matchFixtureByTeams(fixtures, 'Real Madrid', 'Barcelona'), null);
});

test('normalizeLineups: confirmed only when startXI has 11', () => {
  const resp = { response: [
    { team: { name: 'Arsenal' }, formation: '4-3-3', startXI: new Array(11).fill({}) },
    { team: { name: 'Chelsea' }, formation: null, startXI: [] },
  ] };
  const n = normalizeLineups(resp, 'Arsenal', 'Chelsea');
  assert.equal(n.home.confirmed, true);
  assert.equal(n.home.formation, '4-3-3');
  assert.equal(n.away.confirmed, false);
});

test('normalizeAvailability splits injuries vs suspensions by reason', () => {
  const resp = { response: [
    { team: { name: 'Arsenal' }, player: { name: 'Saka', reason: 'Knee Injury' } },
    { team: { name: 'Arsenal' }, player: { name: 'Rice', reason: 'Suspended' } },
    { team: { name: 'Chelsea' }, player: { name: 'James', reason: 'Red Card Suspension' } },
  ] };
  const a = normalizeAvailability(resp, 'Arsenal', 'Chelsea');
  assert.equal(a.home.injuries.length, 1);
  assert.equal(a.home.injuries[0].player, 'Saka');
  assert.equal(a.home.suspensions.length, 1);
  assert.equal(a.home.suspensions[0].player, 'Rice');
  assert.equal(a.away.suspensions.length, 1);
  assert.equal(a.away.injuries.length, 0);
});

test('normalizers tolerate empty/missing input', () => {
  assert.deepEqual(normalizeLineups({}, 'A', 'B').home.confirmed, false);
  assert.deepEqual(normalizeAvailability(null, 'A', 'B').home.injuries, []);
  assert.equal(matchFixtureByTeams(null, 'A', 'B'), null);
});

test('normalizeH2H aggregates from the upcoming home/away perspective', () => {
  // Arsenal (upcoming home) vs Chelsea (upcoming away). Past meetings include
  // both orientations — the helper must orient by club name, not past side.
  const resp = { response: [
    { fixture: { date: '2025-03-01T00:00:00Z' }, teams: { home: { name: 'Arsenal' }, away: { name: 'Chelsea' } }, goals: { home: 2, away: 1 } }, // Arsenal win
    { fixture: { date: '2024-11-10T00:00:00Z' }, teams: { home: { name: 'Chelsea' }, away: { name: 'Arsenal' } }, goals: { home: 0, away: 0 } }, // draw, BTTS no
    { fixture: { date: '2024-04-20T00:00:00Z' }, teams: { home: { name: 'Chelsea' }, away: { name: 'Arsenal' } }, goals: { home: 3, away: 1 } }, // Chelsea win, BTTS yes
    { fixture: { date: '2024-01-01T00:00:00Z' }, teams: { home: { name: 'Arsenal' }, away: { name: 'Chelsea' } }, goals: { home: null, away: null } }, // unfinished, ignored
  ] };
  const h = normalizeH2H(resp, 'Arsenal', 'Chelsea');
  assert.equal(h.meetings, 3);
  assert.equal(h.homeWins, 1); // Arsenal
  assert.equal(h.awayWins, 1); // Chelsea
  assert.equal(h.draws, 1);
  assert.equal(h.avgTotalGoals, Math.round(((3 + 0 + 4) / 3) * 100) / 100);
  assert.equal(h.bttsPct, Math.round((2 / 3) * 100)); // meetings 1 & 3 had both scoring
  assert.equal(h.last.length, 3);
});

test('normalizeCongestion flags short rest + midweek cup game', () => {
  const ref = '2026-03-15T15:00:00Z';
  // Domestic league id 39 (PL). A midweek cup game (id 45) 3 days ago + a league
  // game 7 days ago — short rest and congestion.
  const resp = { response: [
    { fixture: { date: '2026-03-12T20:00:00Z' }, league: { id: 45, name: 'FA Cup' } },
    { fixture: { date: '2026-03-08T15:00:00Z' }, league: { id: 39, name: 'Premier League' } },
    { fixture: { date: '2026-01-01T15:00:00Z' }, league: { id: 39, name: 'Premier League' } }, // outside 14d window
  ] };
  const c = normalizeCongestion(resp, { domesticLeagueId: 39, referenceDate: ref });
  assert.equal(c.matchesLast14d, 2);
  assert.equal(c.otherCompMatches, 1);
  assert.equal(c.lastCompetition, 'FA Cup');
  assert.equal(c.daysSinceLast, 2.8); // 2d 19h before the 15:00 kickoff
  assert.equal(c.shortRest, true);
  assert.equal(c.midweekCongestion, true);
});

test('normalizeCongestion: well-rested single league game = no flags', () => {
  const ref = '2026-03-15T15:00:00Z';
  const resp = { response: [
    { fixture: { date: '2026-03-08T15:00:00Z' }, league: { id: 39, name: 'Premier League' } },
  ] };
  const c = normalizeCongestion(resp, { domesticLeagueId: 39, referenceDate: ref });
  assert.equal(c.matchesLast14d, 1);
  assert.equal(c.otherCompMatches, 0);
  assert.equal(c.shortRest, false);
  assert.equal(c.midweekCongestion, false);
  assert.equal(c.daysSinceLast, 7);
});

test('normalizeCongestion tolerates empty/missing input', () => {
  assert.equal(normalizeCongestion(null, {}).matchesLast14d, 0);
  assert.equal(normalizeCongestion({ response: [] }, { domesticLeagueId: 39, referenceDate: '2026-03-15' }).daysSinceLast, null);
});

test('normalizeTeamSplits parses home/away record + goal averages', () => {
  const resp = { response: {
    fixtures: {
      played: { home: 9, away: 8, total: 17 },
      wins:   { home: 7, away: 3, total: 10 },
      draws:  { home: 1, away: 2, total: 3 },
      loses:  { home: 1, away: 3, total: 4 },
    },
    goals: {
      for:     { average: { home: '2.4', away: '1.1' } },
      against: { average: { home: '0.7', away: '1.6' } },
    },
    clean_sheet:     { home: 5, away: 2, total: 7 },
    failed_to_score: { home: 0, away: 3, total: 3 },
  } };
  const s = normalizeTeamSplits(resp);
  assert.equal(s.home.wins, 7);
  assert.equal(s.home.losses, 1);          // mapped from API-Football "loses"
  assert.equal(s.home.gfAvg, 2.4);
  assert.equal(s.home.gaAvg, 0.7);
  assert.equal(s.home.cleanSheets, 5);
  assert.equal(s.away.played, 8);
  assert.equal(s.away.gfAvg, 1.1);
  assert.equal(s.away.failedToScore, 3);
});

test('normalizeTeamSplits returns null for empty/missing payload', () => {
  assert.equal(normalizeTeamSplits(null), null);
  assert.equal(normalizeTeamSplits({ response: {} }), null);
  assert.equal(normalizeTeamSplits({ response: { fixtures: { played: { home: null, away: null } } } }), null);
});

test('normalizeH2H ignores unrelated fixtures and empty input', () => {
  const resp = { response: [
    { fixture: { date: '2025-01-01' }, teams: { home: { name: 'Liverpool' }, away: { name: 'Everton' } }, goals: { home: 1, away: 1 } },
  ] };
  assert.equal(normalizeH2H(resp, 'Arsenal', 'Chelsea').meetings, 0);
  assert.equal(normalizeH2H(null, 'A', 'B').meetings, 0);
  assert.deepEqual(normalizeH2H({ response: [] }, 'A', 'B').last, []);
});
