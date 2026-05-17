import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parsePick } from '../pickParser.js';

// Helper: assert parsed fields without prop_player_name when not relevant
function assertPick(text, expected, ctx) {
  const result = parsePick(text, ctx);
  for (const [key, val] of Object.entries(expected)) {
    assert.equal(result[key], val, `"${text}" → ${key}: expected ${val}, got ${result[key]}`);
  }
}

describe('pickParser — moneyline', () => {
  test('bare team abbreviation NYY', () =>
    assertPick('NYY', { market_type: 'moneyline', side: null, line: null }));

  test('team abbreviation with ML suffix', () =>
    assertPick('NYY ML', { market_type: 'moneyline', line: null }));

  test('ML keyword alone resolves side from context', () =>
    assertPick('NYY ML', { market_type: 'moneyline', side: 'home' }, { homeAbbr: 'NYY', awayAbbr: 'BOS' }));

  test('away side resolution', () =>
    assertPick('BOS ML', { market_type: 'moneyline', side: 'away' }, { homeAbbr: 'NYY', awayAbbr: 'BOS' }));

  test('team with city prefix then abbr', () =>
    assertPick('LAD ML', { market_type: 'moneyline', line: null }));

  test('Houston Astros abbr HOU', () =>
    assertPick('HOU', { market_type: 'moneyline' }));

  test('bare SD is moneyline', () =>
    assertPick('SD', { market_type: 'moneyline' }));

  test('alias ARI resolves as moneyline', () =>
    assertPick('ARI', { market_type: 'moneyline' }));
});

describe('pickParser — run line', () => {
  test('standard runline NYY -1.5', () =>
    assertPick('NYY -1.5', { market_type: 'runline', line: -1.5 }));

  test('underdog runline BOS +1.5', () =>
    assertPick('BOS +1.5', { market_type: 'runline', line: 1.5 }));

  test('explicit RL label NYY RL -1.5', () =>
    assertPick('NYY RL -1.5', { market_type: 'runline', line: -1.5 }));

  test('runline home side resolution', () =>
    assertPick('NYY -1.5', { market_type: 'runline', side: 'home' }, { homeAbbr: 'NYY', awayAbbr: 'BOS' }));

  test('runline away side resolution', () =>
    assertPick('BOS +1.5', { market_type: 'runline', side: 'away' }, { homeAbbr: 'NYY', awayAbbr: 'BOS' }));

  test('runline no context → side null', () =>
    assertPick('NYY -1.5', { market_type: 'runline', side: null }));
});

describe('pickParser — over/under (game total)', () => {
  test('Over 8.5', () =>
    assertPick('Over 8.5', { market_type: 'overunder', side: 'over', line: 8.5, prop_kind: null }));

  test('Under 7.5', () =>
    assertPick('Under 7.5', { market_type: 'overunder', side: 'under', line: 7.5 }));

  test('lowercase over', () =>
    assertPick('over 9', { market_type: 'overunder', side: 'over', line: 9 }));

  test('abbreviated O 8', () =>
    assertPick('O 8', { market_type: 'overunder', side: 'over', line: 8 }));

  test('abbreviated U 7.5', () =>
    assertPick('U 7.5', { market_type: 'overunder', side: 'under', line: 7.5 }));

  test('NYY Over 8.5 — team prefix still OU not prop', () =>
    assertPick('NYY Over 8.5', { market_type: 'overunder', side: 'over', line: 8.5, prop_kind: null }));
});

describe('pickParser — player props', () => {
  test('Aaron Judge Over 0.5 HR', () => {
    const r = parsePick('Aaron Judge Over 0.5 HR');
    assert.equal(r.market_type, 'prop');
    assert.equal(r.side, 'over');
    assert.equal(r.line, 0.5);
    assert.equal(r.prop_kind, 'home_runs');
    assert.equal(r.prop_player_name, 'Aaron Judge');
  });

  test('Shohei Ohtani Under 8.5 Strikeouts', () => {
    const r = parsePick('Shohei Ohtani Under 8.5 Strikeouts');
    assert.equal(r.market_type, 'prop');
    assert.equal(r.side, 'under');
    assert.equal(r.line, 8.5);
    assert.equal(r.prop_kind, 'strikeouts');
    assert.equal(r.prop_player_name, 'Shohei Ohtani');
  });

  test('Juan Soto Over 1.5 Hits', () => {
    const r = parsePick('Juan Soto Over 1.5 Hits');
    assert.equal(r.prop_kind, 'hits');
    assert.equal(r.prop_player_name, 'Juan Soto');
  });

  test('Yordan Alvarez Over 1.5 TB', () => {
    const r = parsePick('Yordan Alvarez Over 1.5 TB');
    assert.equal(r.prop_kind, 'total_bases');
    assert.equal(r.prop_player_name, 'Yordan Alvarez');
  });

  test('Freddie Freeman Over 0.5 RBI', () => {
    const r = parsePick('Freddie Freeman Over 0.5 RBI');
    assert.equal(r.prop_kind, 'rbis');
  });

  test('Ronald Acuna Over 0.5 SB', () => {
    const r = parsePick('Ronald Acuna Over 0.5 SB');
    assert.equal(r.prop_kind, 'stolen_bases');
  });

  test('Gerrit Cole Over 7.5 Outs Recorded', () => {
    const r = parsePick('Gerrit Cole Over 7.5 Outs Recorded');
    assert.equal(r.prop_kind, 'outs_recorded');
    assert.equal(r.prop_player_name, 'Gerrit Cole');
  });

  test('prop with K abbreviation', () => {
    const r = parsePick('Spencer Strider Over 9.5 K');
    assert.equal(r.prop_kind, 'strikeouts');
  });

  test('prop with Walks', () => {
    const r = parsePick('Kyle Tucker Under 1.5 Walks');
    assert.equal(r.prop_kind, 'walks');
    assert.equal(r.side, 'under');
  });

  test('stat-first: Gerrit Cole Strikeouts Over 6.5', () => {
    const r = parsePick('Gerrit Cole Strikeouts Over 6.5');
    assert.equal(r.market_type, 'prop');
    assert.equal(r.prop_kind, 'strikeouts');
    assert.equal(r.prop_player_name, 'Gerrit Cole');
    assert.equal(r.side, 'over');
    assert.equal(r.line, 6.5);
  });

  test('Spanish: Juan Soto Más de 1.5 Hits', () => {
    const r = parsePick('Juan Soto Más de 1.5 Hits');
    assert.equal(r.market_type, 'prop');
    assert.equal(r.prop_kind, 'hits');
    assert.equal(r.side, 'over');
    assert.equal(r.prop_player_name, 'Juan Soto');
  });

  test('Spanish line-last: Drew Rasmussen Bajo 4.5 Ponches', () => {
    const r = parsePick('Drew Rasmussen Bajo 4.5 Ponches');
    assert.equal(r.market_type, 'prop');
    assert.equal(r.prop_kind, 'strikeouts');
    assert.equal(r.side, 'under');
    assert.equal(r.line, 4.5);
    assert.equal(r.prop_player_name, 'Drew Rasmussen');
  });
});

describe('pickParser — edge cases', () => {
  test('empty string → all null', () => {
    const r = parsePick('');
    assert.equal(r.market_type, null);
    assert.equal(r.side, null);
    assert.equal(r.line, null);
  });

  test('null input → all null', () => {
    const r = parsePick(null);
    assert.equal(r.market_type, null);
  });

  test('gibberish → all null', () =>
    assertPick('???', { market_type: null, side: null, line: null }));

  test('case-insensitive team: nYy', () =>
    assertPick('nYy ML', { market_type: 'moneyline' }));

  test('prop line without .5 suffix', () => {
    const r = parsePick('Aaron Judge Over 1 HR');
    assert.equal(r.market_type, 'prop');
    assert.equal(r.line, 1);
  });

  test('RL alias ATH', () =>
    assertPick('ATH -1.5', { market_type: 'runline', line: -1.5 }));
});
