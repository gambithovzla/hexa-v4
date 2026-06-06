import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseNflProp,
  resolveNflPropKind,
  parseNflBoxscorePlayers,
  resolveNflPlayerProp,
  resolveNflPropFromActual,
} from '../nfl-props-resolver.js';
import { normalizeNflPropEvent } from '../nfl-props-odds.js';
import { enrichNflPropOffers } from '../services/nflPropFeatureEnricher.js';

// ── parseNflProp ──────────────────────────────────────────────────────────────

test('parseNflProp: side-line-kind ordering', () => {
  assert.deepEqual(parseNflProp('Patrick Mahomes Over 274.5 Passing Yards'), {
    playerName: 'Patrick Mahomes', side: 'over', line: 274.5, propKind: 'pass_yds',
  });
});

test('parseNflProp: kind-side-line ordering', () => {
  assert.deepEqual(parseNflProp('Patrick Mahomes Passing Yards Over 274.5'), {
    playerName: 'Patrick Mahomes', side: 'over', line: 274.5, propKind: 'pass_yds',
  });
});

test('parseNflProp: rushing yards under, strips trailing price', () => {
  assert.deepEqual(parseNflProp('Christian McCaffrey Under 89.5 Rushing Yards (-115)'), {
    playerName: 'Christian McCaffrey', side: 'under', line: 89.5, propKind: 'rush_yds',
  });
});

test('parseNflProp: receptions', () => {
  assert.deepEqual(parseNflProp('Tyreek Hill Over 6.5 Receptions'), {
    playerName: 'Tyreek Hill', side: 'over', line: 6.5, propKind: 'receptions',
  });
});

test('parseNflProp: receiving yards beats bare yards keyword', () => {
  const p = parseNflProp('Justin Jefferson Over 92.5 Receiving Yards');
  assert.equal(p.propKind, 'reception_yds');
  assert.equal(p.playerName, 'Justin Jefferson');
});

test('parseNflProp: line-less anytime TD defaults to over 0.5', () => {
  assert.deepEqual(parseNflProp('Christian McCaffrey Anytime TD'), {
    playerName: 'Christian McCaffrey', side: 'over', line: 0.5, propKind: 'anytime_td',
  });
});

test('parseNflProp: spanish side keyword', () => {
  const p = parseNflProp('Saquon Barkley Más de 79.5 Yardas Terrestres');
  assert.equal(p.propKind, 'rush_yds');
  assert.equal(p.side, 'over');
  assert.equal(p.line, 79.5);
});

test('parseNflProp: returns null for a team total/spread pick', () => {
  assert.equal(parseNflProp('Over 47.5 Total Points'), null);
  assert.equal(parseNflProp('KC -2.5'), null);
  assert.equal(parseNflProp('BUF ML'), null);
});

test('resolveNflPropKind: passing touchdowns does not collide with passing yards', () => {
  assert.equal(resolveNflPropKind('Passing Touchdowns'), 'pass_tds');
  assert.equal(resolveNflPropKind('Passing Yards'), 'pass_yds');
});

// ── boxscore parsing + resolution ─────────────────────────────────────────────

const BOXSCORE_FIXTURE = [
  {
    team: { abbreviation: 'KC' },
    statistics: [
      {
        name: 'passing',
        labels: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'SACKS', 'QBR', 'RTG'],
        athletes: [
          { athlete: { displayName: 'Patrick Mahomes', id: '1' }, stats: ['25/35', '291', '8.3', '3', '1', '2-12', '78.4', '112.3'] },
        ],
      },
      {
        name: 'rushing',
        labels: ['CAR', 'YDS', 'AVG', 'TD', 'LONG'],
        athletes: [
          { athlete: { displayName: 'Isiah Pacheco', id: '2' }, stats: ['18', '94', '5.2', '1', '22'] },
        ],
      },
      {
        name: 'receiving',
        labels: ['REC', 'YDS', 'AVG', 'TD', 'LONG', 'TGTS'],
        athletes: [
          { athlete: { displayName: 'Travis Kelce', id: '3' }, stats: ['7', '83', '11.9', '1', '24', '9'] },
        ],
      },
    ],
  },
];

test('parseNflBoxscorePlayers: extracts passing/rushing/receiving + anytime_td', () => {
  const players = parseNflBoxscorePlayers(BOXSCORE_FIXTURE);
  const mahomes = players['patrick mahomes'];
  assert.equal(mahomes.pass_yds, 291);
  assert.equal(mahomes.pass_tds, 3);
  assert.equal(mahomes.pass_completions, 25);
  assert.equal(mahomes.pass_attempts, 35);
  assert.equal(mahomes.pass_interceptions, 1);

  const pacheco = players['isiah pacheco'];
  assert.equal(pacheco.rush_yds, 94);
  assert.equal(pacheco.rush_attempts, 18);
  assert.equal(pacheco.anytime_td, 1);

  const kelce = players['travis kelce'];
  assert.equal(kelce.receptions, 7);
  assert.equal(kelce.reception_yds, 83);
  assert.equal(kelce.anytime_td, 1);
});

test('resolveNflPlayerProp: over win / loss / push', () => {
  const players = parseNflBoxscorePlayers(BOXSCORE_FIXTURE);
  assert.equal(resolveNflPlayerProp('Patrick Mahomes Over 274.5 Passing Yards', players).result, 'win'); // 291 > 274.5
  assert.equal(resolveNflPlayerProp('Patrick Mahomes Over 299.5 Passing Yards', players).result, 'loss'); // 291 < 299.5
  assert.equal(resolveNflPlayerProp('Travis Kelce Under 6.5 Receptions', players).result, 'loss'); // 7 > 6.5
  assert.equal(resolveNflPlayerProp('Isiah Pacheco Anytime TD', players).result, 'win'); // 1 >= 0.5
});

test('resolveNflPlayerProp: whole-number push', () => {
  const players = parseNflBoxscorePlayers(BOXSCORE_FIXTURE);
  // Mahomes pass TD = 3; Over 3 → push
  assert.equal(resolveNflPlayerProp('Patrick Mahomes Over 3 Passing Touchdowns', players).result, 'push');
});

test('resolveNflPlayerProp: unknown player → null result with error', () => {
  const players = parseNflBoxscorePlayers(BOXSCORE_FIXTURE);
  const r = resolveNflPlayerProp('Joe Burrow Over 250.5 Passing Yards', players);
  assert.equal(r.result, null);
  assert.equal(r.error, 'player_not_found');
});

test('resolveNflPropFromActual: pure resolver', () => {
  assert.equal(resolveNflPropFromActual({ side: 'over', line: 89.5 }, 94), 'win');
  assert.equal(resolveNflPropFromActual({ side: 'under', line: 89.5 }, 94), 'loss');
  assert.equal(resolveNflPropFromActual({ side: 'over', line: 6 }, 6), 'push');
});

// ── odds normalization + de-vig ───────────────────────────────────────────────

const EVENT_FIXTURE = {
  id: 'evt1',
  bookmakers: [
    {
      key: 'draftkings',
      markets: [
        {
          key: 'player_pass_yds',
          outcomes: [
            { description: 'Patrick Mahomes', name: 'Over', point: 274.5, price: -115 },
            { description: 'Patrick Mahomes', name: 'Under', point: 274.5, price: -105 },
          ],
        },
        {
          key: 'player_anytime_td',
          outcomes: [
            { name: 'Isiah Pacheco', price: 120 },
          ],
        },
      ],
    },
  ],
};

test('normalizeNflPropEvent: O/U pair + anytime TD yes-market', () => {
  const offers = normalizeNflPropEvent(EVENT_FIXTURE);
  const over = offers.find(o => o.propKind === 'pass_yds' && o.side === 'over');
  const under = offers.find(o => o.propKind === 'pass_yds' && o.side === 'under');
  assert.equal(over.line, 274.5);
  assert.equal(over.oddsAmerican, -115);
  assert.equal(under.oddsAmerican, -105);

  const td = offers.find(o => o.propKind === 'anytime_td');
  assert.equal(td.side, 'over');
  assert.equal(td.line, 0.5);
  assert.equal(td.playerName, 'Isiah Pacheco');
});

test('enrichNflPropOffers: de-vig pairs to fair probability summing ~1', () => {
  const offers = normalizeNflPropEvent(EVENT_FIXTURE);
  const enriched = enrichNflPropOffers(offers);
  const over = enriched.find(o => o.propKind === 'pass_yds' && o.side === 'over');
  const under = enriched.find(o => o.propKind === 'pass_yds' && o.side === 'under');
  assert.ok(over.pairComplete);
  assert.ok(over.vig > 0); // book overhead exists
  assert.ok(Math.abs(over.fairProb + under.fairProb - 1) < 1e-6);
});

test('enrichNflPropOffers: unpaired offer has null fairProb', () => {
  const enriched = enrichNflPropOffers(normalizeNflPropEvent(EVENT_FIXTURE));
  const td = enriched.find(o => o.propKind === 'anytime_td');
  assert.equal(td.fairProb, null);
  assert.equal(td.pairComplete, false);
});
