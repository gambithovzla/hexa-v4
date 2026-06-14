/**
 * Tests for server/services/chatPickExtractor.js
 *
 * Covers the pure functions that don't touch the database or the Anthropic
 * API. Save and Haiku-fallback paths are integration-tested elsewhere.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  augmentChatQuestion,
  extractJsonTail,
  normalizePickJsonList,
  normalizeExtracted,
  looksLikeLockRequest,
  f5ChatAwareness,
} from '../chatPickExtractor.js';

// ── looksLikeLockRequest / f5ChatAwareness ───────────────────────────────────

describe('looksLikeLockRequest', () => {
  test('detects Spanish lock intent', () => {
    assert.ok(looksLikeLockRequest('¿Cuál es el pick imperdible de hoy?'));
    assert.ok(looksLikeLockRequest('dame el más seguro'));
    assert.ok(looksLikeLockRequest('cual es la apuesta infalible'));
  });
  test('detects English lock intent', () => {
    assert.ok(looksLikeLockRequest("what's the lock today"));
    assert.ok(looksLikeLockRequest('give me the safest pick'));
    assert.ok(looksLikeLockRequest('which is the banker'));
  });
  test('returns false for ordinary questions', () => {
    assert.equal(looksLikeLockRequest('who has the better bullpen?'), false);
    assert.equal(looksLikeLockRequest(''), false);
    assert.equal(looksLikeLockRequest(null), false);
  });
});

describe('f5ChatAwareness', () => {
  test('returns the F5 steer for a lock request (es)', () => {
    const out = f5ChatAwareness('dame el imperdible', 'es');
    assert.ok(out.includes('F5'), 'mentions F5');
    assert.ok(out.includes('abridor'), 'mentions starter in Spanish');
    assert.ok(out.includes('push'), 'notes the push rule');
    assert.ok(out.includes('NO MENCIONES'), 'hidden instruction marker');
  });
  test('returns the F5 steer for a lock request (en)', () => {
    const out = f5ChatAwareness('what is the safest pick', 'en');
    assert.ok(out.includes('F5'));
    assert.ok(/starting pitcher|starter/i.test(out));
    assert.ok(out.includes('DO NOT MENTION'));
  });
  test('returns empty string for a non-lock question', () => {
    assert.equal(f5ChatAwareness('compare the two offenses', 'en'), '');
    assert.equal(f5ChatAwareness('', 'es'), '');
  });
});

// ── augmentChatQuestion ──────────────────────────────────────────────────────

describe('augmentChatQuestion', () => {
  test('appends English instruction by default', () => {
    const out = augmentChatQuestion('Who should I bet?', 'en');
    assert.ok(out.includes('<<<HEXA_PICK_JSON>>>'), 'must mention open tag');
    assert.ok(out.includes('<<<END>>>'), 'must mention close tag');
    assert.ok(out.startsWith('Who should I bet?'), 'original question kept at the top');
  });

  test('appends Spanish instruction when lang=es', () => {
    const out = augmentChatQuestion('¿Quién apuesto?', 'es');
    assert.ok(out.includes('INSTRUCCION INTERNA'), 'spanish marker present');
    assert.ok(out.includes('NO MENCIONES'), 'spanish hide-instruction present');
  });

  test('empty input returns empty', () => {
    assert.equal(augmentChatQuestion('', 'en'), '');
    assert.equal(augmentChatQuestion(null, 'en'), '');
  });

  test('user question is preserved character-for-character', () => {
    const q = 'Statcast on Judge? Park factor at Yankee Stadium for HRs?';
    const out = augmentChatQuestion(q, 'en');
    assert.ok(out.startsWith(q));
  });

  test('jornada mode asks for a multi-pick tail with game ids', () => {
    const out = augmentChatQuestion('Give me top 2 picks', 'en', 'mlb', {
      mode: 'jornada',
      games: [
        { game_id: 101, matchup: 'NYY @ BOS', away: 'NYY', home: 'BOS' },
        { game_id: 202, matchup: 'LAD @ SF', away: 'LAD', home: 'SF' },
      ],
    });
    assert.ok(out.includes('"picks"'), 'multi schema present');
    assert.ok(out.includes('game_id=101'), 'selected game id present');
    assert.ok(out.includes('NYY @ BOS'), 'matchup present');
  });
});

// ── extractJsonTail ──────────────────────────────────────────────────────────

describe('extractJsonTail', () => {
  test('extracts well-formed JSON tail and strips it from the answer', () => {
    const answer = `Yankees look solid against this lefty.

<<<HEXA_PICK_JSON>>>
{"market_type":"moneyline","side":"home","team_or_player":"NYY","confidence":68,"reasoning_brief":"Cole vs lefty-heavy lineup"}
<<<END>>>`;
    const { cleanAnswer, pickJson } = extractJsonTail(answer);
    assert.equal(cleanAnswer, 'Yankees look solid against this lefty.');
    assert.deepEqual(pickJson, {
      market_type: 'moneyline',
      side: 'home',
      team_or_player: 'NYY',
      confidence: 68,
      reasoning_brief: 'Cole vs lefty-heavy lineup',
    });
  });

  test('no tail → returns full answer and null', () => {
    const { cleanAnswer, pickJson } = extractJsonTail('Just exploring this matchup.');
    assert.equal(cleanAnswer, 'Just exploring this matchup.');
    assert.equal(pickJson, null);
  });

  test('malformed JSON → returns answer without tail block and null pickJson', () => {
    const answer = `Some analysis.

<<<HEXA_PICK_JSON>>>
{this is not json}
<<<END>>>`;
    const { cleanAnswer, pickJson } = extractJsonTail(answer);
    assert.ok(!cleanAnswer.includes('<<<HEXA_PICK_JSON>>>'));
    assert.equal(pickJson, null);
  });

  test('empty / null input is safe', () => {
    assert.deepEqual(extractJsonTail(''), { cleanAnswer: '', pickJson: null });
    assert.deepEqual(extractJsonTail(null), { cleanAnswer: '', pickJson: null });
  });

  test('tail with extra whitespace still parses', () => {
    const answer = `Pick locked.\n<<<HEXA_PICK_JSON>>>\n\n    {"market_type":"runline","side":"home","line":-1.5}    \n\n<<<END>>>\n`;
    const { pickJson } = extractJsonTail(answer);
    assert.equal(pickJson?.market_type, 'runline');
    assert.equal(pickJson?.line, -1.5);
  });

  test('case-insensitive matching of the open/close tags', () => {
    const answer = `Analysis.\n\n<<<hexa_pick_json>>>\n{"market_type":"moneyline"}\n<<<end>>>`;
    const { pickJson } = extractJsonTail(answer);
    assert.equal(pickJson?.market_type, 'moneyline');
  });
});

describe('normalizePickJsonList', () => {
  test('single pick object becomes a one-item list', () => {
    const out = normalizePickJsonList({ market_type: 'moneyline', team_or_player: 'NYY' });
    assert.equal(out.length, 1);
    assert.equal(out[0].team_or_player, 'NYY');
  });

  test('multi-pick envelope returns the picks array', () => {
    const out = normalizePickJsonList({
      picks: [
        { game_id: '1', market_type: 'moneyline', team_or_player: 'NYY' },
        { game_id: '2', market_type: 'overunder', side: 'under', line: 8.5 },
      ],
    });
    assert.equal(out.length, 2);
    assert.equal(out[1].line, 8.5);
  });

  test('has_pick:false returns an empty list', () => {
    assert.deepEqual(normalizePickJsonList({ has_pick: false }), []);
  });
});

// ── normalizeExtracted ───────────────────────────────────────────────────────

describe('normalizeExtracted', () => {
  test('moneyline with ctx resolves home side', () => {
    const out = normalizeExtracted(
      { market_type: 'moneyline', team_or_player: 'NYY', confidence: 70 },
      { homeAbbr: 'NYY', awayAbbr: 'BOS' }
    );
    assert.equal(out.market_type, 'moneyline');
    assert.equal(out.side, 'home');
    assert.equal(out.raw_pick_text, 'NYY ML');
  });

  test('moneyline away side resolves correctly', () => {
    const out = normalizeExtracted(
      { market_type: 'moneyline', team_or_player: 'BOS' },
      { homeAbbr: 'NYY', awayAbbr: 'BOS' }
    );
    assert.equal(out.side, 'away');
  });

  test('runline keeps the line and resolves side from ctx', () => {
    const out = normalizeExtracted(
      { market_type: 'runline', team_or_player: 'NYY', line: -1.5 },
      { homeAbbr: 'NYY', awayAbbr: 'BOS' }
    );
    assert.equal(out.market_type, 'runline');
    assert.equal(out.line, -1.5);
    assert.equal(out.side, 'home');
  });

  test('overunder uses provided side and line', () => {
    const out = normalizeExtracted(
      { market_type: 'overunder', side: 'over', line: 8.5 },
      {}
    );
    assert.equal(out.market_type, 'overunder');
    assert.equal(out.side, 'over');
    assert.equal(out.line, 8.5);
  });

  test('prop carries player name and kind', () => {
    const out = normalizeExtracted(
      {
        market_type: 'prop',
        team_or_player: 'Aaron Judge',
        side: 'over',
        line: 0.5,
        prop_kind: 'home_runs',
      },
      {}
    );
    assert.equal(out.market_type, 'prop');
    assert.equal(out.prop_kind, 'home_runs');
    assert.equal(out.prop_player_name, 'Aaron Judge');
    assert.equal(out.line, 0.5);
  });

  test('null pickJson returns null', () => {
    assert.equal(normalizeExtracted(null), null);
  });

  test('missing market_type returns null', () => {
    assert.equal(normalizeExtracted({ team_or_player: 'NYY' }), null);
  });

  test('numeric strings for line are coerced', () => {
    const out = normalizeExtracted(
      { market_type: 'overunder', side: 'under', line: '7.5' },
      {}
    );
    assert.equal(out.line, 7.5);
  });
});
