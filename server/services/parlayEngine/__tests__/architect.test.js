// Tests for architect.js — uses Node built-in test runner (node:test).
// Run: node --test server/services/parlayEngine/__tests__/architect.test.js
//
// No real LLM calls are made. All tests inject a mock _callArchitect.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createArchitect, resolveLegs } from '../architect.js';

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeCandidate(id, gamePk = 100) {
  return {
    candidateId: id,
    gamePk,
    matchup: 'NYY @ BOS',
    pick: `Pick for ${id}`,
    type: 'Moneyline',
    marketType: 'moneyline',
    side: 'home',
    propKind: null,
    modelProbability: 63,
    impliedProbability: 58,
    edge: 5,
    odds: -140,
    decimalOdds: 1.7143,
    xgbScore: 62,
    xgbConfidence: 68,
    xgbAgreement: true,
    riskVector: { pitching_dominance: 0.5, bullpen_exposure: 0.2, weather_exposure: 0.1, lineup_variance: 0.35, umpire_sensitivity: 0.2, ballpark_bias: 0 },
    gameScript: 'pitchers_duel',
    failureMode: 'home_starter_loses_dominance_early',
    dataQualityScore: 76,
    modelRisk: 'medium',
    reasoning: 'Strong pitching matchup',
  };
}

const POOL = [
  makeCandidate('cand_A', 100),
  makeCandidate('cand_B', 101),
  makeCandidate('cand_C', 102),
  makeCandidate('cand_D', 103),
  makeCandidate('cand_E', 104),
];

function makeComposedParlays() {
  return [
    {
      index: 0,
      legs: [POOL[0], POOL[1], POOL[2]],
      score: 18.5,
      scoreBreakdown: { edge_sum: 15, corr_bonus: 0.45, risk_div_bonus: 1.2, length_penalty: 0.4, neg_corr_penalty: 0, dq_penalty: 0, script_bonus: 3 },
      combinedMarginalProbability: 0.25,
      combinedDecimalOdds: 5.2,
      naiveExpectedValue: 0.3,
    },
    {
      index: 1,
      legs: [POOL[0], POOL[1], POOL[3]],
      score: 17.9,
      scoreBreakdown: { edge_sum: 14.5, corr_bonus: 0.45, risk_div_bonus: 1.2, length_penalty: 0.4, neg_corr_penalty: 0, dq_penalty: 0, script_bonus: 3 },
      combinedMarginalProbability: 0.22,
      combinedDecimalOdds: 4.8,
      naiveExpectedValue: 0.056,
    },
    {
      index: 2,
      legs: [POOL[1], POOL[2], POOL[4]],
      score: 16.8,
      scoreBreakdown: { edge_sum: 13.8, corr_bonus: 0.45, risk_div_bonus: 0.8, length_penalty: 0.4, neg_corr_penalty: 0, dq_penalty: 0, script_bonus: 3 },
      combinedMarginalProbability: 0.20,
      combinedDecimalOdds: 4.4,
      naiveExpectedValue: -0.12,
    },
  ];
}

/** Build a mock _callArchitect that returns the provided JSON string. */
function mockCall(jsonString) {
  return async () => jsonString;
}

/** Build a valid ArchitectDecision JSON string. */
function validDecisionJson(overrides = {}) {
  return JSON.stringify({
    decision: 'confirm',
    chosen_index: 0,
    modifications: [],
    final_legs: ['cand_A', 'cand_B', 'cand_C'],
    synergy_type: 'correlated_pitchers_duel',
    synergy_thesis: 'All legs depend on elite pitching suppressing run scoring.',
    hidden_correlations_detected: [],
    combined_probability: 0.28,
    combined_decimal_odds: 5.2,
    warnings: [],
    confidence_in_decision: 85,
    ...overrides,
  });
}

// ── Happy path ────────────────────────────────────────────────────────────

describe('askArchitect — happy path', () => {
  it('returns a valid ArchitectDecision when LLM responds with correct JSON', async () => {
    const ask = createArchitect({ _callArchitect: mockCall(validDecisionJson()) });
    const result = await ask({
      candidatePool: POOL,
      composedParlays: makeComposedParlays(),
      mode: 'balanced',
      N: 3,
      lang: 'en',
      engine: 'claude-sonnet-4-6',
    });

    assert.strictEqual(result.decision, 'confirm');
    assert.deepStrictEqual(result.final_legs, ['cand_A', 'cand_B', 'cand_C']);
    assert.strictEqual(result.synergy_type, 'correlated_pitchers_duel');
    assert.ok(typeof result.synergy_thesis === 'string' && result.synergy_thesis.length > 0);
    assert.ok(typeof result.combined_probability === 'number');
    assert.ok(typeof result.combined_decimal_odds === 'number');
    assert.ok(Array.isArray(result.warnings));
    assert.strictEqual(result._fallback, false);
  });

  it('strips markdown code fences before parsing', async () => {
    const wrapped = '```json\n' + validDecisionJson() + '\n```';
    const ask = createArchitect({ _callArchitect: mockCall(wrapped) });
    const result = await ask({
      candidatePool: POOL,
      composedParlays: makeComposedParlays(),
      mode: 'balanced',
      N: 3,
      lang: 'en',
    });
    assert.strictEqual(result.decision, 'confirm');
    assert.strictEqual(result._fallback, false);
  });

  it('handles modify decision with modifications array', async () => {
    const json = validDecisionJson({
      decision: 'modify',
      chosen_index: 1,
      modifications: [{ action: 'swap', remove_candidate_id: 'cand_D', add_candidate_id: 'cand_E' }],
      final_legs: ['cand_A', 'cand_B', 'cand_E'],
    });
    const ask = createArchitect({ _callArchitect: mockCall(json) });
    const result = await ask({
      candidatePool: POOL,
      composedParlays: makeComposedParlays(),
      mode: 'balanced',
      N: 3,
      lang: 'en',
    });
    assert.strictEqual(result.decision, 'modify');
    assert.deepStrictEqual(result.final_legs, ['cand_A', 'cand_B', 'cand_E']);
    assert.strictEqual(result._fallback, false);
  });

  it('passes hidden_correlations_detected through', async () => {
    const json = validDecisionJson({
      hidden_correlations_detected: [
        { candidates: ['cand_A', 'cand_B'], type: 'positive', explanation: 'Both depend on pitcher dominance.' },
      ],
    });
    const ask = createArchitect({ _callArchitect: mockCall(json) });
    const result = await ask({
      candidatePool: POOL,
      composedParlays: makeComposedParlays(),
      mode: 'balanced',
      N: 3,
      lang: 'en',
    });
    assert.strictEqual(result.hidden_correlations_detected.length, 1);
    assert.strictEqual(result.hidden_correlations_detected[0].type, 'positive');
  });
});

// ── Fallback scenarios ────────────────────────────────────────────────────

describe('askArchitect — fallback', () => {
  it('returns fallback when LLM response is invalid JSON', async () => {
    const ask = createArchitect({ _callArchitect: mockCall('this is not json at all') });
    const result = await ask({
      candidatePool: POOL,
      composedParlays: makeComposedParlays(),
      mode: 'balanced',
      N: 3,
      lang: 'en',
    });
    assert.strictEqual(result._fallback, true);
    assert.strictEqual(result.decision, 'confirm');
    assert.strictEqual(result.chosen_index, 0);
    assert.ok(Array.isArray(result.final_legs) && result.final_legs.length > 0);
  });

  it('returns fallback when required field is missing', async () => {
    const incomplete = JSON.stringify({ decision: 'confirm', final_legs: ['cand_A'] });
    const ask = createArchitect({ _callArchitect: mockCall(incomplete) });
    const result = await ask({
      candidatePool: POOL,
      composedParlays: makeComposedParlays(),
      mode: 'balanced',
      N: 3,
      lang: 'en',
    });
    assert.strictEqual(result._fallback, true);
  });

  it('returns fallback when final_legs is empty array', async () => {
    const json = validDecisionJson({ final_legs: [] });
    const ask = createArchitect({ _callArchitect: mockCall(json) });
    const result = await ask({
      candidatePool: POOL,
      composedParlays: makeComposedParlays(),
      mode: 'balanced',
      N: 3,
      lang: 'en',
    });
    assert.strictEqual(result._fallback, true);
  });

  it('returns fallback when combined_probability is out of [0,1]', async () => {
    const json = validDecisionJson({ combined_probability: 1.5 });
    const ask = createArchitect({ _callArchitect: mockCall(json) });
    const result = await ask({
      candidatePool: POOL,
      composedParlays: makeComposedParlays(),
      mode: 'balanced',
      N: 3,
      lang: 'en',
    });
    assert.strictEqual(result._fallback, true);
  });

  it('returns fallback when LLM call throws', async () => {
    const ask = createArchitect({
      _callArchitect: async () => { throw new Error('network timeout'); },
    });
    const result = await ask({
      candidatePool: POOL,
      composedParlays: makeComposedParlays(),
      mode: 'balanced',
      N: 3,
      lang: 'en',
    });
    assert.strictEqual(result._fallback, true);
    // Fallback uses top-1 composer parlay legs
    const expectedIds = makeComposedParlays()[0].legs.map(l => l.candidateId);
    assert.deepStrictEqual(result.final_legs, expectedIds);
  });

  it('fallback combined_probability equals top composer combinedMarginalProbability', async () => {
    const ask = createArchitect({ _callArchitect: async () => { throw new Error('fail'); } });
    const composed = makeComposedParlays();
    const result = await ask({
      candidatePool: POOL,
      composedParlays: composed,
      mode: 'balanced',
      N: 3,
      lang: 'en',
    });
    assert.strictEqual(result.combined_probability, composed[0].combinedMarginalProbability);
    assert.strictEqual(result.combined_decimal_odds, composed[0].combinedDecimalOdds);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────

describe('askArchitect — edge cases', () => {
  it('throws when composedParlays is empty', async () => {
    const ask = createArchitect({ _callArchitect: mockCall(validDecisionJson()) });
    await assert.rejects(
      () => ask({ candidatePool: POOL, composedParlays: [], mode: 'balanced', N: 3, lang: 'en' }),
      /requires at least one composed parlay/,
    );
  });

  it('spanish lang tag is included in user prompt (verifiable via prompt builder)', async () => {
    let capturedPrompt = '';
    const ask = createArchitect({
      _callArchitect: async ({ userPrompt }) => {
        capturedPrompt = userPrompt;
        return validDecisionJson();
      },
    });
    await ask({ candidatePool: POOL, composedParlays: makeComposedParlays(), mode: 'balanced', N: 3, lang: 'es' });
    assert.ok(capturedPrompt.includes('español'), 'Spanish lang instruction missing from prompt');
  });

  it('mode and N are reflected in user prompt', async () => {
    let capturedPrompt = '';
    const ask = createArchitect({
      _callArchitect: async ({ userPrompt }) => {
        capturedPrompt = userPrompt;
        return validDecisionJson();
      },
    });
    await ask({ candidatePool: POOL, composedParlays: makeComposedParlays(), mode: 'aggressive', N: 7, lang: 'en' });
    assert.ok(capturedPrompt.includes('aggressive'), 'mode missing from prompt');
    assert.ok(capturedPrompt.includes('7'), 'N missing from prompt');
  });
});

// ── resolveLegs ───────────────────────────────────────────────────────────

describe('resolveLegs', () => {
  it('resolves known IDs to full candidate objects', () => {
    const legs = resolveLegs(['cand_A', 'cand_C'], POOL);
    assert.strictEqual(legs.length, 2);
    assert.strictEqual(legs[0].candidateId, 'cand_A');
    assert.strictEqual(legs[1].candidateId, 'cand_C');
  });

  it('skips unknown IDs gracefully', () => {
    const legs = resolveLegs(['cand_A', 'UNKNOWN_ID'], POOL);
    assert.strictEqual(legs.length, 1);
    assert.strictEqual(legs[0].candidateId, 'cand_A');
  });

  it('returns empty array for all unknown IDs', () => {
    const legs = resolveLegs(['X', 'Y', 'Z'], POOL);
    assert.strictEqual(legs.length, 0);
  });

  it('preserves original order from finalLegIds', () => {
    const legs = resolveLegs(['cand_E', 'cand_B', 'cand_A'], POOL);
    assert.deepStrictEqual(
      legs.map(l => l.candidateId),
      ['cand_E', 'cand_B', 'cand_A'],
    );
  });
});
