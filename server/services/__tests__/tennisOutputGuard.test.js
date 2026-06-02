import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTennisAnalysisOutput } from '../tennisOutputGuard.js';
import { serializeTennisContext } from '../tennisContextSerializer.js';

const validReport = 'PRIMARY EDGE: Alcaraz surface ELO 2180 vs Zverev 2010 on clay, +170 gap, and leads surface H2H 3-0. CONFIRMING SIGNALS: 8-2 recent form, off two days rest. KEY RISK: a flat start on a slow court lets Zverev hold serve. EDGE MATH: 50 base +12 ELO +4 H2H +2 form = 68.';

function validData(overrides = {}) {
  return {
    master_prediction: { pick: 'Carlos Alcaraz to win', pick_side: 'player_a', oracle_confidence: 68, bet_value: 'HIGH VALUE' },
    oracle_report: validReport,
    hexa_hunch: 'Alcaraz has not dropped a set to Zverev on clay',
    alert_flags: ['High-confidence single match — retirement variance remains'],
    probability_model: { player_a_wins: 6800, player_b_wins: 3200 },
    best_pick: { type: 'Match Winner', detail: 'Alcaraz to win (-180)', confidence: 0.68 },
    model_risk: 'low',
    ...overrides,
  };
}

test('accepts a well-formed tennis pick', () => {
  const r = validateTennisAnalysisOutput(validData());
  assert.equal(r.ok, true);
  assert.equal(r.quality, 'ok');
  assert.equal(r.data.master_prediction.oracle_confidence, 68);
  assert.equal(r.data.master_prediction.pick_side, 'player_a');
});

test('rejects parse failure', () => {
  const r = validateTennisAnalysisOutput(null, { parseError: true });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ['json_parse_failed']);
});

test('rejects empty output', () => {
  const r = validateTennisAnalysisOutput(null);
  assert.equal(r.ok, false);
  assert.equal(r.quality, 'reject');
});

test('rejects parlay shape on a single match', () => {
  const r = validateTennisAnalysisOutput({ parlay: { legs: [] } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('parlay_shape_on_single_match'));
});

test('rejects ABSTAIN / PASS picks', () => {
  const r = validateTennisAnalysisOutput(validData({ master_prediction: { pick: 'PASS', pick_side: 'player_a', oracle_confidence: 60 } }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('abstain_pick'));
});

test('rejects missing pick_side', () => {
  const d = validData();
  delete d.master_prediction.pick_side;
  const r = validateTennisAnalysisOutput(d);
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('missing_pick_side'));
});

test('rejects invalid pick_side (e.g. draw)', () => {
  const r = validateTennisAnalysisOutput(validData({ master_prediction: { pick: 'Draw', pick_side: 'draw', oracle_confidence: 60 } }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('invalid_pick_side'));
});

test('normalizes "Player A" / hyphenated pick_side to player_a', () => {
  const r = validateTennisAnalysisOutput(validData({
    master_prediction: { pick: 'Alcaraz to win', pick_side: 'Player-A', oracle_confidence: 60, bet_value: 'MODERATE VALUE' },
  }));
  assert.equal(r.ok, true);
  assert.equal(r.data.master_prediction.pick_side, 'player_a');
});

test('blocks per-set / player prop bet types (fatal)', () => {
  const r = validateTennisAnalysisOutput(validData({ best_pick: { type: 'Aces', detail: 'Over 10.5 aces', confidence: 0.6 } }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('player_prop_blocked'));
});

test('flags a draw in probability_model (degraded, not fatal)', () => {
  const r = validateTennisAnalysisOutput(validData({
    probability_model: { player_a_wins: 5000, player_b_wins: 4000, draws: 1000 },
  }));
  assert.equal(r.ok, true);
  assert.equal(r.quality, 'degraded');
  assert.ok(r.errors.includes('probability_model_has_draw'));
});

test('caps confidence: rejects out-of-range (>72)', () => {
  const r = validateTennisAnalysisOutput(validData({
    master_prediction: { pick: 'Alcaraz to win', pick_side: 'player_a', oracle_confidence: 85, bet_value: 'HIGH VALUE' },
  }));
  assert.equal(r.quality, 'degraded');
  assert.ok(r.errors.includes('confidence_out_of_range'));
});

test('accepts Set Handicap and Total Games bet types', () => {
  const sh = validateTennisAnalysisOutput(validData({ best_pick: { type: 'Set Handicap', detail: 'Alcaraz -1.5 sets (+120)', confidence: 0.6 } }));
  assert.equal(sh.ok, true);
  const tg = validateTennisAnalysisOutput(validData({ best_pick: { type: 'Total Games', detail: 'Over 22.5 (-110)', confidence: 0.6 } }));
  assert.equal(tg.ok, true);
});

test('degrades on short oracle_report but stays ok', () => {
  const r = validateTennisAnalysisOutput(validData({ oracle_report: 'too short' }));
  assert.equal(r.ok, true);
  assert.equal(r.quality, 'degraded');
  assert.ok(r.errors.includes('oracle_report_too_short'));
});

// ── serializer ────────────────────────────────────────────────────────────────

const sampleContext = {
  tour: 'atp',
  matchDate: '2026-01-20',
  surface: 'clay',
  round: 'Quarterfinals',
  bestOf: 5,
  playerA: { playerName: 'Carlos Alcaraz', rank: 2, seed: 2, country: 'ESP', eloOverall: 2150, eloSurface: 2180, recentForm: { record: '8-2', recent: 'WWWLW', surfaceRecord: '5-1' } },
  playerB: { playerName: 'Alexander Zverev', rank: 5, seed: 5, country: 'GER', eloOverall: 2030, eloSurface: 2010, recentForm: { record: '6-4', recent: 'WLWWL', surfaceRecord: '3-2' } },
  h2h: { aWins: 4, bWins: 1, aWinsSurface: 3, bWinsSurface: 0 },
  context_meta: { overallCompleteness: 0.9, staleFlags: ['moneyline_odds_missing'] },
};

const sampleOdds = {
  moneyline: { a: -180, b: +155, aImplied: 64.3, bImplied: 39.2 },
  setHandicap: { line: -1.5, aPrice: +120, bPrice: -140 },
  totalGames: { line: 36.5, overPrice: -110, underPrice: -110 },
};

test('serializeTennisContext renders surface header, ELO delta, H2H and odds', () => {
  const txt = serializeTennisContext({ context: sampleContext, marketOdds: sampleOdds });
  assert.match(txt, /SURFACE: clay/);
  assert.match(txt, /BEST OF: 5/);
  assert.match(txt, /Surface-ELO gap \(clay\): Carlos Alcaraz \+170/);
  assert.match(txt, /H2H: Carlos Alcaraz 4-1 Alexander Zverev \| on surface 3-0/);
  assert.match(txt, /Match Winner A -180/);
  assert.match(txt, /Total Games 36.5/);
  assert.match(txt, /DATA QUALITY: completeness 90%/);
});

test('serializeTennisContext degrades gracefully without ELO/H2H/odds', () => {
  const txt = serializeTennisContext({
    context: {
      tour: 'wta', matchDate: '2026-01-21', surface: null,
      playerA: { playerName: 'Player A', rank: null, eloSurface: null, eloOverall: null, recentForm: null },
      playerB: { playerName: 'Player B', rank: null, eloSurface: null, eloOverall: null, recentForm: null },
      h2h: null,
      context_meta: { overallCompleteness: 0.2, staleFlags: ['elo_surface_unavailable', 'h2h_unavailable'] },
    },
    marketOdds: null,
  });
  assert.match(txt, /ELO: unavailable/);
  assert.match(txt, /H2H: no matchup history/);
  assert.match(txt, /MARKET ODDS: not provided/);
});

test('serializeTennisContext returns a placeholder for null context', () => {
  assert.equal(serializeTennisContext({ context: null }), 'No tennis context provided.');
});
