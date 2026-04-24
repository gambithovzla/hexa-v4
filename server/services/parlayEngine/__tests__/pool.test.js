// Tests for pool.js — uses Node built-in test runner (node:test).
// Run: node --test server/services/parlayEngine/__tests__/pool.test.js

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPoolBuilder, clearPoolCache } from '../pool.js';

// ── Fixtures ──────────────────────────────────────────────────────────────

const GAME_1 = {
  gamePk: 778001,
  gameDate: '2026-04-23T20:10:00Z',
  status: { simplified: 'scheduled' },
  venue: { id: 1, name: 'Fenway Park' },
  teams: {
    home: { id: 111, name: 'Boston Red Sox', abbreviation: 'BOS', probablePitcher: { id: 500, fullName: 'Brayan Bello', throwingHand: 'R' }, score: null },
    away: { id: 147, name: 'New York Yankees', abbreviation: 'NYY', probablePitcher: { id: 501, fullName: 'Gerrit Cole', throwingHand: 'R' }, score: null },
  },
};

const GAME_2 = {
  gamePk: 778002,
  gameDate: '2026-04-23T23:10:00Z',
  status: { simplified: 'scheduled' },
  venue: { id: 2, name: 'Dodger Stadium' },
  teams: {
    home: { id: 119, name: 'Los Angeles Dodgers', abbreviation: 'LAD', probablePitcher: { id: 502, fullName: 'Tyler Glasnow', throwingHand: 'R' }, score: null },
    away: { id: 109, name: 'Arizona Diamondbacks', abbreviation: 'ARI', probablePitcher: { id: 503, fullName: 'Zac Gallen', throwingHand: 'R' }, score: null },
  },
};

const GAME_3 = {
  gamePk: 778003,
  gameDate: '2026-04-23T20:05:00Z',
  status: { simplified: 'scheduled' },
  venue: { id: 3, name: 'PNC Park' },
  teams: {
    home: { id: 134, name: 'Pittsburgh Pirates', abbreviation: 'PIT', probablePitcher: null, score: null },
    away: { id: 116, name: 'Detroit Tigers', abbreviation: 'DET', probablePitcher: null, score: null },
  },
};

const ALL_GAMES = [GAME_1, GAME_2, GAME_3];

/** Build 8 safe_candidates per game covering all market types. */
function makeSafeCandidates(homeAbbr, awayAbbr) {
  return [
    { pick: `${homeAbbr} ML`, type: 'Moneyline', hit_probability: 62, odds: -140, market_type: 'moneyline', side: 'home', model_probability: 62, implied_probability: 58.3, edge: 3.7, rank: 1, reasoning: 'Strong home advantage' },
    { pick: `${awayAbbr} ML`, type: 'Moneyline', hit_probability: 38, odds: 120, market_type: 'moneyline', side: 'away', model_probability: 38, implied_probability: 45.5, edge: -7.5, rank: 6, reasoning: 'Dog pick' },
    { pick: `${homeAbbr} -1.5`, type: 'RunLine', hit_probability: 55, odds: 105, market_type: 'runline', side: 'home', model_probability: 55, implied_probability: 48.8, edge: 6.2, rank: 2, reasoning: 'Dominant offense' },
    { pick: `${awayAbbr} +1.5`, type: 'RunLine', hit_probability: 45, odds: -125, market_type: 'runline', side: 'away', model_probability: 45, implied_probability: 55.6, edge: -10.6, rank: 7, reasoning: 'Weak edge' },
    { pick: 'Over 8.5', type: 'OverUnder', hit_probability: 58, odds: -110, market_type: 'overunder', side: 'over', model_probability: 58, implied_probability: 52.4, edge: 5.6, rank: 3, reasoning: 'High scoring game' },
    { pick: 'Under 8.5', type: 'OverUnder', hit_probability: 42, odds: -110, market_type: 'overunder', side: 'under', model_probability: 42, implied_probability: 52.4, edge: -10.4, rank: 8, reasoning: 'Pitcher dominates' },
    { pick: 'Player A Over 0.5 Hits', type: 'PlayerProp', hit_probability: 72, odds: -145, market_type: 'playerprop', side: 'over', prop_kind: 'hits', model_probability: 72, implied_probability: 59.2, edge: 12.8, rank: 4, reasoning: 'Hot bat' },
    { pick: 'Pitcher A Over 6.5 Ks', type: 'PlayerProp', hit_probability: 60, odds: -118, market_type: 'playerprop', side: 'over', prop_kind: 'strikeouts', model_probability: 60, implied_probability: 54.1, edge: 5.9, rank: 5, reasoning: 'High K rate vs weak lineup' },
  ];
}

function makeFeatures() {
  return {
    homePitcherSavant: { xwOBA_against: 0.280, k_pct: 0.28 },
    awayPitcherSavant: { xwOBA_against: 0.295, k_pct: 0.25 },
    homePitcherStats: { era: 3.20, whip: 1.05, inningsPerStart: 6.1 },
    awayPitcherStats: { era: 3.80, whip: 1.18, inningsPerStart: 5.8 },
    homeHitting: { avg: 0.265, ops: 0.820 },
    awayHitting: { avg: 0.248, ops: 0.775 },
    savantBatters: {
      home: [{ name: 'Player A', savant: { xwOBA: 0.360, xBA: 0.290 } }],
      away: [{ name: 'Player B', savant: { xwOBA: 0.320, xBA: 0.260 } }],
    },
    batterSplitsMap: { home: [], away: [] },
    parkFactorData: { park_factor_overall: 105 },
    weatherData: { temperature: 72, windSpeed: 8, wind_speed: 8 },
    dataQuality: { score: 78, strategy: 'FULL_ANALYSIS' },
    signalCoherence: { coherenceScore: 0.65, dominantDirection: 'OVER', overSignals: 4, underSignals: 2, neutralSignals: 1, signals: [] },
    oddsData: null,
  };
}

// ── Mock factory ──────────────────────────────────────────────────────────

function makeMockDeps(overrides = {}) {
  return {
    _getTodayGames: async (_date) => ALL_GAMES,
    _getGameOdds: async () => [],
    _matchOddsToGame: (_odds, _home, _away) => null,
    _buildContext: async (gameData) => ({
      context: 'mock context',
      _features: makeFeatures(),
    }),
    _buildDeterministicSafePayload: ({ gameData }) => ({
      safe_candidates: makeSafeCandidates(
        gameData.teams.home.abbreviation,
        gameData.teams.away.abbreviation,
      ),
      model_risk: 'medium',
    }),
    _calculateParallelScore: (_statcast, gameData) => ({
      score: 62,
      predicted_winner: String(gameData.teams.home.id),
      predicted_winner_abbr: gameData.teams.home.abbreviation,
      confidence: 68,
    }),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('buildCandidatePool', () => {
  before(() => clearPoolCache());
  after(() => clearPoolCache());

  it('returns ≥10 candidates for 3 game ids', async () => {
    const build = createPoolBuilder(makeMockDeps());
    const result = await build({ gameIds: [778001, 778002, 778003], date: '2026-04-23', lang: 'en' });

    assert.ok(Array.isArray(result), 'result must be an array');
    assert.ok(result.length >= 10, `expected ≥10 candidates, got ${result.length}`);
    // 3 games × 8 candidates = 24
    assert.strictEqual(result.length, 24);
  });

  it('each candidate has all required ParlayCandidate fields', async () => {
    clearPoolCache();
    const build = createPoolBuilder(makeMockDeps());
    const result = await build({ gameIds: [778001], date: '2026-04-23', lang: 'en' });

    assert.ok(result.length > 0, 'must have at least one candidate');
    const c = result[0];

    // Identity
    assert.ok(typeof c.candidateId === 'string' && c.candidateId.length > 0, 'candidateId present');
    assert.ok(typeof c.gamePk === 'number', 'gamePk is number');
    assert.ok(typeof c.matchup === 'string' && c.matchup.includes('@'), 'matchup contains @');
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(c.gameDate), `gameDate format: ${c.gameDate}`);
    assert.ok(typeof c.gameStartUTC === 'string', 'gameStartUTC present');

    // Pick
    assert.ok(typeof c.pick === 'string' && c.pick.length > 0, 'pick present');
    assert.ok(typeof c.type === 'string', 'type present');
    assert.ok(typeof c.marketType === 'string', 'marketType present');
    assert.ok('side' in c, 'side field present');
    assert.ok('propKind' in c, 'propKind field present');

    // Probabilities
    assert.ok(typeof c.modelProbability === 'number', 'modelProbability is number');
    assert.ok('impliedProbability' in c, 'impliedProbability present');
    assert.ok('edge' in c, 'edge present');

    // Odds
    assert.ok('odds' in c, 'odds present');
    assert.ok('decimalOdds' in c, 'decimalOdds present');
    assert.ok('line' in c, 'line present');

    // XGBoost
    assert.ok('xgbScore' in c, 'xgbScore present');
    assert.ok('xgbConfidence' in c, 'xgbConfidence present');
    assert.ok(typeof c.xgbAgreement === 'boolean', 'xgbAgreement is boolean');

    // Fase 2 placeholders must be null in Fase 1
    assert.strictEqual(c.riskVector, null, 'riskVector is null in Fase 1');
    assert.strictEqual(c.gameScript, null, 'gameScript is null in Fase 1');
    assert.strictEqual(c.failureMode, null, 'failureMode is null in Fase 1');

    // Metadata
    assert.ok(typeof c.dataQualityScore === 'number', 'dataQualityScore is number');
    assert.ok(['low', 'medium', 'high'].includes(c.modelRisk), `modelRisk valid: ${c.modelRisk}`);
    assert.ok(typeof c.reasoning === 'string', 'reasoning is string');
  });

  it('all candidateIds are unique within the pool', async () => {
    clearPoolCache();
    const build = createPoolBuilder(makeMockDeps());
    const result = await build({ gameIds: [778001, 778002, 778003], date: '2026-04-23', lang: 'en' });

    const ids = result.map(c => c.candidateId);
    const unique = new Set(ids);
    assert.strictEqual(unique.size, ids.length, `expected all IDs unique; got ${ids.length - unique.size} duplicates`);
  });

  it('americanToDecimal conversion is correct', async () => {
    clearPoolCache();
    const build = createPoolBuilder(makeMockDeps());
    const result = await build({ gameIds: [778001], date: '2026-04-23', lang: 'en' });

    // -140 → 100/140 + 1 = 1.7143
    const mlHome = result.find(c => c.marketType === 'moneyline' && c.side === 'home');
    assert.ok(mlHome, 'moneyline home candidate must exist');
    assert.ok(Math.abs(mlHome.decimalOdds - 1.7143) < 0.001, `expected ~1.7143, got ${mlHome.decimalOdds}`);

    // +120 → 120/100 + 1 = 2.2
    const mlAway = result.find(c => c.marketType === 'moneyline' && c.side === 'away');
    assert.ok(mlAway, 'moneyline away candidate must exist');
    assert.ok(Math.abs(mlAway.decimalOdds - 2.2) < 0.001, `expected 2.2, got ${mlAway.decimalOdds}`);
  });

  it('cache returns same result without re-fetching', async () => {
    clearPoolCache();
    let fetchCount = 0;
    const build = createPoolBuilder(makeMockDeps({
      _getTodayGames: async () => { fetchCount++; return ALL_GAMES; },
    }));

    await build({ gameIds: [778001], date: '2026-04-23', lang: 'en' });
    await build({ gameIds: [778001], date: '2026-04-23', lang: 'en' });

    assert.strictEqual(fetchCount, 1, 'getTodayGames must only be called once (cache hit on 2nd call)');
  });

  it('skips unknown gameIds gracefully and returns candidates for known games', async () => {
    clearPoolCache();
    const build = createPoolBuilder(makeMockDeps());
    const result = await build({ gameIds: [778001, 999999], date: '2026-04-23', lang: 'en' });

    assert.ok(result.length > 0, 'must return candidates for known game');
    assert.ok(result.every(c => c.gamePk === 778001), 'unknown gamePk produces no candidates');
  });

  it('xgbAgreement is true for home ML when xgb predicts home winner', async () => {
    clearPoolCache();
    // Mock always predicts BOS (home) as winner for game 778001
    const build = createPoolBuilder(makeMockDeps());
    const result = await build({ gameIds: [778001], date: '2026-04-23', lang: 'en' });

    const mlHome = result.find(c => c.gamePk === 778001 && c.marketType === 'moneyline' && c.side === 'home');
    assert.ok(mlHome, 'ML home candidate must exist');
    assert.strictEqual(mlHome.xgbAgreement, true, 'xgbAgreement true when xgb predicts home and pick is home');

    const mlAway = result.find(c => c.gamePk === 778001 && c.marketType === 'moneyline' && c.side === 'away');
    assert.ok(mlAway, 'ML away candidate must exist');
    assert.strictEqual(mlAway.xgbAgreement, false, 'xgbAgreement false when xgb predicts home but pick is away');
  });

  it('propKind maps hits and strikeouts correctly', async () => {
    clearPoolCache();
    const build = createPoolBuilder(makeMockDeps());
    const result = await build({ gameIds: [778001], date: '2026-04-23', lang: 'en' });

    const hitsProp = result.find(c => c.pick.includes('Hits'));
    assert.ok(hitsProp, 'hits prop candidate must exist');
    assert.strictEqual(hitsProp.propKind, 'hits', 'prop_kind hits maps to propKind hits');

    const kProp = result.find(c => c.pick.includes('Ks'));
    assert.ok(kProp, 'strikeouts prop candidate must exist');
    assert.strictEqual(kProp.propKind, 'k', 'prop_kind strikeouts maps to propKind k');
  });

  it('omits unpriced player props but keeps unpriced main-market candidates', async () => {
    clearPoolCache();
    const build = createPoolBuilder(makeMockDeps({
      _buildDeterministicSafePayload: ({ gameData }) => ({
        safe_candidates: [
          ...makeSafeCandidates(gameData.teams.home.abbreviation, gameData.teams.away.abbreviation),
          { pick: 'Unpriced Player Over 0.5 Hits', type: 'PlayerProp', hit_probability: 70, odds: null, market_type: 'playerprop', side: 'over', prop_kind: 'hits', model_probability: 70, implied_probability: null, edge: null, rank: 9, reasoning: 'No market price' },
        ],
      }),
    }));
    const result = await build({ gameIds: [778001], date: '2026-04-23', lang: 'en' });

    assert.ok(result.length > 0, 'priced candidates still flow through');
    assert.ok(!result.some(c => c.pick.includes('Unpriced Player')), 'unpriced player prop omitted');
    // Player props in the pool must have odds; main markets may be null (odds-api match can fail)
    assert.ok(
      result.every(c => c.marketType !== 'playerprop' || c.odds != null),
      'no player prop with null odds',
    );
  });

  it('keeps main-market candidates even when odds matching fails (null odds)', async () => {
    clearPoolCache();
    const build = createPoolBuilder(makeMockDeps({
      _buildDeterministicSafePayload: ({ gameData }) => ({
        safe_candidates: [
          { pick: `${gameData.teams.home.abbreviation} Moneyline`, type: 'Moneyline', hit_probability: 60, odds: null, market_type: 'moneyline', side: 'home', model_probability: 60, implied_probability: null, edge: null, rank: 1, reasoning: 'No odds matched' },
          { pick: `${gameData.teams.away.abbreviation} Moneyline`, type: 'Moneyline', hit_probability: 40, odds: null, market_type: 'moneyline', side: 'away', model_probability: 40, implied_probability: null, edge: null, rank: 2, reasoning: 'No odds matched' },
        ],
      }),
    }));
    const result = await build({ gameIds: [778001], date: '2026-04-23', lang: 'en' });

    assert.ok(result.length >= 2, `expected >=2 candidates even without odds, got ${result.length}`);
    assert.ok(result.every(c => c.marketType === 'moneyline'), 'main-market candidates preserved');
  });
});
