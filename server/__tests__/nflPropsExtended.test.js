import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseNflProp,
  parseNflBoxscorePlayers,
  parseNflTdScorers,
  applyNflTdScorers,
  resolveNflPlayerProp,
  NFL_PROP_KINDS,
} from '../nfl-props-resolver.js';
import { normalizeNflPropEvent, nflPropMarketsFor, NFL_PROP_MARKETS_ALL } from '../nfl-props-odds.js';
import {
  buildNflAvailabilityIndex,
  findNflPlayerAvailability,
  summarizeNflUnavailable,
  isNflPlayerOut,
  nflInjurySeverity,
} from '../services/nflAvailability.js';

// ── Parsing the new markets ───────────────────────────────────────────────────

test('parses the touchdown-scorer markets, with and without a line', () => {
  assert.deepEqual(parseNflProp("Ja'Marr Chase First Touchdown Scorer"),
    { playerName: "Ja'Marr Chase", side: 'over', line: 0.5, propKind: 'first_td' });
  assert.deepEqual(parseNflProp('Chase Brown Last TD'),
    { playerName: 'Chase Brown', side: 'over', line: 0.5, propKind: 'last_td' });
  assert.equal(parseNflProp('Bucky Irving Anytime TD').propKind, 'anytime_td');
});

test('first/last TD win over the bare "touchdown" keyword', () => {
  assert.equal(parseNflProp('Mike Evans Primer Touchdown').propKind, 'first_td');
  assert.equal(parseNflProp('Mike Evans Ultimo Touchdown').propKind, 'last_td');
});

test('parses combined-yardage, kicking and defensive markets', () => {
  assert.deepEqual(parseNflProp('Bucky Irving Over 84.5 Rush + Rec Yards'),
    { playerName: 'Bucky Irving', side: 'over', line: 84.5, propKind: 'rush_rec_yds' });
  assert.equal(parseNflProp('Evan McPherson Over 7.5 Kicking Points').propKind, 'kicking_points');
  assert.equal(parseNflProp('Trey Hendrickson Over 0.5 Sacks').propKind, 'sacks');
  assert.equal(parseNflProp('Logan Wilson Under 8.5 Tackles').propKind, 'tackles_assists');
  assert.equal(parseNflProp('Baker Mayfield Over 41.5 Longest Completion').propKind, 'longest_completion');
});

test('defensive interceptions do not collide with a QB interceptions prop', () => {
  assert.equal(parseNflProp('Baker Mayfield Over 0.5 Interceptions').propKind, 'pass_interceptions');
  assert.equal(parseNflProp('Jordan Battle Over 0.5 Defensive Interceptions').propKind, 'def_interceptions');
});

test('every new kind is declared in NFL_PROP_KINDS', () => {
  for (const kind of ['first_td', 'last_td', 'rush_rec_yds', 'sacks', 'field_goals', 'longest_rush']) {
    assert.ok(NFL_PROP_KINDS.has(kind), `${kind} missing from NFL_PROP_KINDS`);
  }
});

// ── Boxscore ──────────────────────────────────────────────────────────────────

const BOXSCORE = [{
  team: { abbreviation: 'CIN' },
  statistics: [
    {
      name: 'passing',
      labels: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'LONG'],
      athletes: [{ athlete: { id: '1', displayName: 'Joe Burrow' }, stats: ['24/33', '285', '8.6', '2', '1', '42'] }],
    },
    {
      name: 'rushing',
      labels: ['CAR', 'YDS', 'AVG', 'TD', 'LONG'],
      athletes: [{ athlete: { id: '2', displayName: 'Chase Brown' }, stats: ['18', '92', '5.1', '1', '24'] }],
    },
    {
      name: 'receiving',
      labels: ['REC', 'YDS', 'AVG', 'TD', 'LONG'],
      athletes: [{ athlete: { id: '3', displayName: "Ja'Marr Chase" }, stats: ['9', '118', '13.1', '1', '31'] }],
    },
    {
      name: 'defensive',
      labels: ['TOT', 'SOLO', 'SACKS', 'TFL', 'PD', 'QB HTS', 'TD'],
      athletes: [{ athlete: { id: '4', displayName: 'Trey Hendrickson' }, stats: ['5', '4', '2.0', '3', '1', '4', '0'] }],
    },
    {
      name: 'interceptions',
      labels: ['INT', 'YDS', 'TD'],
      athletes: [{ athlete: { id: '5', displayName: 'Jordan Battle' }, stats: ['1', '14', '0'] }],
    },
    {
      name: 'kicking',
      labels: ['FG', 'PCT', 'LONG', 'XP', 'PTS'],
      athletes: [{ athlete: { id: '6', displayName: 'Evan McPherson' }, stats: ['2/3', '66.7', '48', '3/3', '9'] }],
    },
  ],
}];

test('boxscore surfaces longest-play, kicking and defensive stats', () => {
  const players = parseNflBoxscorePlayers(BOXSCORE);
  assert.equal(players['joe burrow'].longest_completion, 42);
  assert.equal(players['chase brown'].longest_rush, 24);
  assert.equal(players['jamarr chase'].longest_reception, 31);
  assert.equal(players['trey hendrickson'].sacks, 2);
  assert.equal(players['trey hendrickson'].tackles_assists, 5);
  assert.equal(players['jordan battle'].def_interceptions, 1);
  assert.equal(players['evan mcpherson'].kicking_points, 9);
  assert.equal(players['evan mcpherson'].field_goals, 2, 'FG "2/3" settles on made');
});

test('combined kinds are derived from the component stats', () => {
  const players = parseNflBoxscorePlayers(BOXSCORE);
  assert.equal(players['chase brown'].rush_rec_yds, 92);
  assert.equal(players['joe burrow'].pass_rush_rec_yds, 285);
  assert.equal(players['joe burrow'].pass_rush_rec_tds, 2, 'a thrown TD counts for total TDs');
  assert.equal(players['joe burrow'].anytime_td, 0, 'but not for anytime TD');
  assert.equal(players['jamarr chase'].pass_rush_rec_tds, 1);
});

// ── Touchdown scorers ─────────────────────────────────────────────────────────

const SCORING_PLAYS = [
  { scoringType: { abbreviation: 'TD', name: 'touchdown' }, text: "Ja'Marr Chase 21 Yd pass from Joe Burrow (Evan McPherson Kick)" },
  { scoringType: { abbreviation: 'FG', name: 'field goal' }, text: 'Evan McPherson 48 Yd Field Goal' },
  { scoringType: { abbreviation: 'TD', name: 'touchdown' }, text: 'Chase Brown 2 Yd Run (Evan McPherson Kick)' },
];

test('TD scorers come out in scoring order, ignoring field goals', () => {
  assert.deepEqual(parseNflTdScorers(SCORING_PLAYS), ["Ja'Marr Chase", 'Chase Brown']);
});

test('first/last TD flags settle the scorer markets', () => {
  const players = applyNflTdScorers(parseNflBoxscorePlayers(BOXSCORE), SCORING_PLAYS);
  assert.equal(players['jamarr chase'].first_td, 1);
  assert.equal(players['jamarr chase'].last_td, 0);
  assert.equal(players['chase brown'].last_td, 1);
  assert.equal(players['joe burrow'].first_td, 0, 'the passer does not score the TD');

  assert.equal(resolveNflPlayerProp("Ja'Marr Chase First Touchdown", players).result, 'win');
  assert.equal(resolveNflPlayerProp('Joe Burrow First Touchdown', players).result, 'loss');
  assert.equal(resolveNflPlayerProp('Chase Brown Last TD', players).result, 'win');
});

test('missing scoring plays leave the scorer markets unresolved, not lost', () => {
  const players = applyNflTdScorers(parseNflBoxscorePlayers(BOXSCORE), undefined);
  assert.equal(players['chase brown'].first_td, null);
  assert.equal(resolveNflPlayerProp('Chase Brown First TD', players).error, 'stat_not_found');
});

test('the new stat kinds resolve over/under against the boxscore', () => {
  const players = parseNflBoxscorePlayers(BOXSCORE);
  assert.equal(resolveNflPlayerProp('Trey Hendrickson Over 1.5 Sacks', players).result, 'win');
  assert.equal(resolveNflPlayerProp('Evan McPherson Under 8.5 Kicking Points', players).result, 'loss');
  assert.equal(resolveNflPlayerProp('Chase Brown Over 24.5 Longest Rush', players).result, 'loss');
});

// ── Odds normalization ────────────────────────────────────────────────────────

test('market scopes: core stays cheap, all covers every mapped market', () => {
  const core = nflPropMarketsFor('core');
  assert.ok(core.includes('player_anytime_td'));
  assert.ok(!core.includes('player_sacks'), 'defense is opt-in');
  assert.equal(nflPropMarketsFor('all').length, NFL_PROP_MARKETS_ALL.length);
  assert.ok(NFL_PROP_MARKETS_ALL.includes('player_sacks'));
});

test('1st/last TD normalize as yes-markets at over 0.5', () => {
  const offers = normalizeNflPropEvent({
    bookmakers: [{
      key: 'draftkings',
      markets: [
        { key: 'player_1st_td', outcomes: [{ name: "Ja'Marr Chase", price: 750 }] },
        { key: 'player_last_td', outcomes: [{ name: 'Chase Brown', price: 900 }] },
        { key: 'player_sacks', outcomes: [
          { name: 'Over', description: 'Trey Hendrickson', point: 0.5, price: -150 },
          { name: 'Under', description: 'Trey Hendrickson', point: 0.5, price: 115 },
        ] },
      ],
    }],
  });

  const first = offers.find(o => o.propKind === 'first_td');
  assert.equal(first.side, 'over');
  assert.equal(first.line, 0.5);
  assert.equal(first.oddsAmerican, 750);
  assert.equal(offers.find(o => o.propKind === 'last_td').playerName, 'Chase Brown');
  assert.equal(offers.filter(o => o.propKind === 'sacks').length, 2);
});

// ── Availability ──────────────────────────────────────────────────────────────

const INJURY_FEED = {
  byTeamId: {},
  byAbbr: {
    CIN: {
      teamId: '4', abbreviation: 'CIN',
      injuries: [
        { playerName: "Ja'Marr Chase", position: 'WR', status: 'Out', statusKey: 'out', detail: 'Hamstring' },
        { playerName: 'Chase Brown', position: 'RB', status: 'Questionable', statusKey: 'questionable', detail: 'Ankle' },
      ],
    },
    TB: {
      teamId: '27', abbreviation: 'TB',
      injuries: [{ playerName: 'Mike Evans', position: 'WR', status: 'Doubtful', statusKey: 'doubtful', detail: 'Hip' }],
    },
  },
};

test('availability index covers both sides of the game and keeps the worse status', () => {
  const index = buildNflAvailabilityIndex(INJURY_FEED, [
    { teamId: 4, teamAbbr: 'CIN' },
    { teamId: 27, teamAbbr: 'TB' },
  ]);

  assert.equal(findNflPlayerAvailability(index, "Ja'Marr Chase").statusKey, 'out');
  assert.equal(findNflPlayerAvailability(index, 'Mike Evans').team, 'TB');
  assert.equal(findNflPlayerAvailability(index, 'Joe Burrow'), null, 'healthy players are absent');
});

test('doubtful and worse make the slate report; questionable does not', () => {
  const index = buildNflAvailabilityIndex(INJURY_FEED, [{ teamAbbr: 'CIN' }, { teamAbbr: 'TB' }]);
  const report = summarizeNflUnavailable(index);
  assert.deepEqual(report.map(r => r.playerName), ["Ja'Marr Chase", 'Mike Evans']);
  assert.ok(isNflPlayerOut('out_for_season'));
  assert.ok(!isNflPlayerOut('questionable'));
  assert.ok(nflInjurySeverity('out') > nflInjurySeverity('doubtful'));
});
