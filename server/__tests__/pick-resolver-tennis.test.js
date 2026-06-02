import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTennisPick } from '../tennis-resolution.js';

// Best-of-3, Alcaraz beats Zverev 2-1 (6-4, 3-6, 6-2) → games A=15, B=12, total 27
function bo3Final() {
  return {
    matchId: '401',
    status: 'final',
    statusName: 'STATUS_FINAL',
    isVoidStatus: false,
    winner: 'a',
    players: {
      a: { name: 'Carlos Alcaraz', setsWon: 2, gamesPerSet: [6, 3, 6] },
      b: { name: 'Alexander Zverev', setsWon: 1, gamesPerSet: [4, 6, 2] },
    },
  };
}

// Best-of-5 straight sets, Sinner beats Medvedev 3-0 (6-3, 6-4, 6-2) → games A=18, B=9
function bo5Straight() {
  return {
    matchId: '402',
    status: 'final',
    statusName: 'STATUS_FINAL',
    isVoidStatus: false,
    winner: 'a',
    players: {
      a: { name: 'Jannik Sinner', setsWon: 3, gamesPerSet: [6, 6, 6] },
      b: { name: 'Daniil Medvedev', setsWon: 0, gamesPerSet: [3, 4, 2] },
    },
  };
}

// ── Match Winner ────────────────────────────────────────────────────────────

test('match winner: picked winner → win', () => {
  assert.deepEqual(resolveTennisPick('Carlos Alcaraz to win', bo3Final()), { result: 'win', market: 'match_winner' });
});

test('match winner: picked loser → loss', () => {
  assert.deepEqual(resolveTennisPick('Alexander Zverev to win', bo3Final()), { result: 'loss', market: 'match_winner' });
});

test('match winner: surname only resolves', () => {
  assert.equal(resolveTennisPick('Sinner ML', bo5Straight()).result, 'win');
  assert.equal(resolveTennisPick('Medvedev', bo5Straight()).result, 'loss');
});

test('match winner: ambiguous / unknown player → null', () => {
  assert.equal(resolveTennisPick('Roger Federer to win', bo3Final()).result, null);
});

test('match winner: not final (no winner) → null', () => {
  const m = bo3Final();
  m.winner = null;
  assert.equal(resolveTennisPick('Carlos Alcaraz to win', m).result, null);
});

// ── Set Handicap (±1.5 sets) ──────────────────────────────────────────────────

test('set handicap -1.5: favorite wins 2-1 → does NOT cover (loss)', () => {
  // Alcaraz -1.5 needs a 2+ set margin; 2-1 is only +1 → loss
  assert.deepEqual(resolveTennisPick('Carlos Alcaraz -1.5 sets', bo3Final()), { result: 'loss', market: 'set_handicap' });
});

test('set handicap -1.5: straight-sets win (3-0 Bo5) → covers (win)', () => {
  assert.deepEqual(resolveTennisPick('Jannik Sinner -1.5 sets', bo5Straight()), { result: 'win', market: 'set_handicap' });
});

test('set handicap +1.5: underdog loses 1-2 → covers (win)', () => {
  // Zverev +1.5: lost by 1 set → adjusted 1+1.5=2.5 > 2 → win
  assert.deepEqual(resolveTennisPick('Alexander Zverev +1.5 sets', bo3Final()), { result: 'win', market: 'set_handicap' });
});

test('set handicap +1.5: underdog swept 0-3 → does NOT cover (loss)', () => {
  // Medvedev +1.5: 0+1.5=1.5 < 3 → loss
  assert.deepEqual(resolveTennisPick('Daniil Medvedev +1.5 sets', bo5Straight()), { result: 'loss', market: 'set_handicap' });
});

// ── Total Games ───────────────────────────────────────────────────────────────

test('total games: over hits (27 > 26.5)', () => {
  assert.deepEqual(resolveTennisPick('Over 26.5 games', bo3Final()), { result: 'win', market: 'total_games' });
});

test('total games: under misses (27 > 26.5)', () => {
  assert.deepEqual(resolveTennisPick('Under 26.5 games', bo3Final()), { result: 'loss', market: 'total_games' });
});

test('total games: exact line → push (whole-number line)', () => {
  // total is 27; line 27 → push
  assert.deepEqual(resolveTennisPick('Over 27 games', bo3Final()), { result: 'push', market: 'total_games' });
});

test('total games: unresolvable when per-set games missing → null', () => {
  const m = bo3Final();
  m.players.a.gamesPerSet = [];
  m.players.b.gamesPerSet = [];
  assert.equal(resolveTennisPick('Over 26.5 games', m).result, null);
});

// ── Void: retirement / walkover ───────────────────────────────────────────────

test('retirement → void regardless of market', () => {
  const m = bo3Final();
  m.isVoidStatus = true;
  m.statusName = 'STATUS_RETIRED';
  assert.deepEqual(resolveTennisPick('Carlos Alcaraz to win', m), { result: 'void', market: 'void' });
  assert.deepEqual(resolveTennisPick('Over 26.5 games', m), { result: 'void', market: 'void' });
});

test('walkover → void', () => {
  const m = bo3Final();
  m.isVoidStatus = true;
  m.statusName = 'STATUS_WALKOVER';
  assert.equal(resolveTennisPick('Alexander Zverev to win', m).result, 'void');
});

test('null match → null result', () => {
  assert.equal(resolveTennisPick('Anyone to win', null).result, null);
});
