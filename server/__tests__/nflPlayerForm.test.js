import { test } from 'node:test';
import assert from 'node:assert/strict';

import { selectNflTeamPlayerForm, buildNflPlayerForm, describeNflPlayerForm } from '../services/nflPlayerForm.js';
import { buildNflChatPrompt, NFL_CHAT_PROMPT } from '../prompts/oracle-nfl-prompts.js';
import { serializeNflContext } from '../services/oracleNfl.js';

function player(name, position, team, games, season_avg, recent_avg = season_avg) {
  return { name, position, team, games, season_avg, recent_avg };
}

const payload = {
  season: 2026,
  players: {
    'baker mayfield': player('Baker Mayfield', 'QB', 'TB', 4, { pass_yds: 241.5, pass_tds: 1.5, rush_yds: 12 }),
    'teddy bridgewater': player('Teddy Bridgewater', 'QB', 'TB', 1, { pass_yds: 80 }),
    'bucky irving': player('Bucky Irving', 'RB', 'TB', 4, { rush_yds: 71.2, receptions: 2.5, anytime_td: 0.5 }),
    'mike evans': player('Mike Evans', 'WR', 'TB', 4, { receptions: 5.25, reception_yds: 72.0, anytime_td: 0.5 }, { receptions: 6, reception_yds: 88, anytime_td: 0.75 }),
    'chris godwin': player('Chris Godwin', 'WR', 'TB', 3, { receptions: 4, reception_yds: 50 }),
    'kicker guy': player('Kicker Guy', 'K', 'TB', 4, { pass_yds: null }),
    'dak prescott': player('Dak Prescott', 'QB', 'DAL', 4, { pass_yds: 280 }),
    'ceedee lamb': player('CeeDee Lamb', 'WR', 'DAL', 4, { receptions: 7, reception_yds: 95 }),
  },
  priorSeason: {
    season: 2025,
    players: {
      'old qb': player('Old QB', 'QB', 'NYJ', 17, { pass_yds: 220 }),
    },
  },
};

const tbInjuries = { ok: true, items: [{ playerName: 'Baker Mayfield', status: 'Out', position: 'QB' }] };

test('selects QBs, lead back and pass catchers for the right team, sorted', () => {
  const form = selectNflTeamPlayerForm(payload, 'TB', { injuries: tbInjuries });
  assert.equal(form.teamAbbr, 'TB');
  assert.equal(form.fromPriorSeason, false);
  const byKey = Object.fromEntries(form.groups.map(g => [g.key, g.players.map(p => p.name)]));
  assert.deepEqual(byKey.QB, ['Baker Mayfield', 'Teddy Bridgewater']);
  assert.deepEqual(byKey.RB, ['Bucky Irving']);
  assert.deepEqual(byKey['WR/TE'], ['Mike Evans', 'Chris Godwin']);
  assert.ok(!JSON.stringify(form).includes('Dak'));
  assert.ok(!JSON.stringify(form).includes('Kicker'));
});

test('injury status rides along with the player', () => {
  const form = selectNflTeamPlayerForm(payload, 'TB', { injuries: tbInjuries });
  const baker = form.groups.find(g => g.key === 'QB').players[0];
  assert.equal(baker.injuryStatus, 'Out');
});

test('falls back to last season when the team has no current-season games', () => {
  const form = selectNflTeamPlayerForm(payload, 'NYJ');
  assert.equal(form.fromPriorSeason, true);
  assert.equal(form.season, 2025);
  assert.equal(form.groups[0].players[0].name, 'Old QB');
});

test('unknown team or empty payload → null', () => {
  assert.equal(selectNflTeamPlayerForm(payload, 'MIA'), null);
  assert.equal(selectNflTeamPlayerForm(null, 'TB'), null);
  assert.equal(buildNflPlayerForm(null, { home: { teamAbbr: 'TB' } }), null);
});

test('rendered block cites season and L4 averages and flags the injured player', () => {
  const form = buildNflPlayerForm(payload, {
    home: { teamAbbr: 'TB', injuries: tbInjuries },
    away: { teamAbbr: 'DAL', injuries: null },
  });
  const text = describeNflPlayerForm(form);
  assert.match(text, /PLAYER FORM/);
  assert.match(text, /Baker Mayfield \[OUT\]/);
  assert.match(text, /rec yds 72\.0 \(L4 88\.0\)/);
  assert.match(text, /CeeDee Lamb/);
});

test('serializeNflContext includes the player form only when present', () => {
  const base = { season: 2026, gameDate: '2026-10-08', home: { teamAbbr: 'TB' }, away: { teamAbbr: 'DAL' } };
  assert.doesNotMatch(serializeNflContext({ context: base }), /PLAYER FORM/);
  const withForm = { ...base, playerForm: buildNflPlayerForm(payload, { home: base.home, away: base.away }) };
  assert.match(serializeNflContext({ context: withForm }), /PLAYER FORM/);
});

test('chat prompt is unchanged without player data and gains the sections with it', () => {
  assert.equal(buildNflChatPrompt(), NFL_CHAT_PROMPT);
  const withForm = buildNflChatPrompt({ playerForm: true });
  assert.match(withForm, /PLAYER DATA — AVAILABLE/);
  assert.match(withForm, /PLAYER PROP LINES/);
  assert.doesNotMatch(withForm, /LIVE LINES/);
  const withMarket = buildNflChatPrompt({ playerForm: true, propMarket: true });
  assert.match(withMarket, /PLAYER PROPS — LIVE LINES/);
});
