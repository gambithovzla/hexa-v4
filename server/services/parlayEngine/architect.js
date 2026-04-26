import { callArchitect as _defaultCallArchitect } from './llmClient.js';
import { PARLAY_ARCHITECT_SYSTEM, buildArchitectUserMessage } from './prompts.js';

// ── JSON parsing ──────────────────────────────────────────────────────────

/** Strip markdown code fences that some models add despite instructions. */
function cleanJsonText(text) {
  return text
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/im, '')
    .trim();
}

const REQUIRED_FIELDS = [
  'decision',
  'final_legs',
  'synergy_type',
  'synergy_thesis',
  'combined_probability',
  'combined_decimal_odds',
];

function validateDecision(parsed) {
  for (const f of REQUIRED_FIELDS) {
    if (!(f in parsed)) throw new Error(`missing field: ${f}`);
  }
  if (!['confirm', 'modify', 'reject'].includes(parsed.decision)) {
    throw new Error(`invalid decision value: ${parsed.decision}`);
  }
  if (!Array.isArray(parsed.final_legs) || parsed.final_legs.length === 0) {
    throw new Error('final_legs must be a non-empty array');
  }
  if (typeof parsed.combined_probability !== 'number' ||
      parsed.combined_probability < 0 ||
      parsed.combined_probability > 1) {
    throw new Error(`combined_probability out of range: ${parsed.combined_probability}`);
  }
}

// ── Fallback builder ──────────────────────────────────────────────────────

/**
 * Build a safe ArchitectDecision from the top composer parlay.
 * Used when the LLM call fails or returns unparseable JSON.
 */
function buildFallback(composedParlays) {
  const top = composedParlays[0];
  return {
    decision: 'confirm',
    chosen_index: 0,
    modifications: [],
    final_legs: top.legs.map(l => l.candidateId),
    synergy_type: 'orthogonal_stability',
    synergy_thesis:
      'Composer top pick selected — LLM validation was unavailable. / ' +
      'Se seleccionó la combinación principal del compositor — validación LLM no disponible.',
    hidden_correlations_detected: [],
    combined_probability: top.combinedMarginalProbability,
    combined_decimal_odds: top.combinedDecimalOdds,
    warnings: [],
    confidence_in_decision: 60,
    _fallback: true,
  };
}

// ── Response parser ───────────────────────────────────────────────────────

function parseArchitectResponse(text, composedParlays) {
  try {
    const cleaned = cleanJsonText(text);
    const parsed = JSON.parse(cleaned);
    validateDecision(parsed);
    return { ...parsed, _fallback: false };
  } catch (err) {
    console.warn('[parlay-synergy] architect response parse failed, using fallback:', err.message);
    return buildFallback(composedParlays);
  }
}

// ── Leg resolver ──────────────────────────────────────────────────────────

/**
 * Resolve the architect's final_legs (candidate ID strings) into full
 * ParlayCandidate objects from the candidate pool.
 * IDs missing from the pool are skipped with a warning.
 *
 * @param {string[]} finalLegIds
 * @param {object[]} candidatePool
 * @returns {object[]} ParlayCandidate[]
 */
export function resolveLegs(finalLegIds, candidatePool) {
  const byId = new Map(candidatePool.map(c => [c.candidateId, c]));
  const resolved = [];
  for (const id of finalLegIds) {
    const c = byId.get(id);
    if (c) {
      resolved.push(c);
    } else {
      console.warn(`[parlay-synergy] architect returned unknown candidateId: ${id}`);
    }
  }
  return resolved;
}

// ── Factory (enables DI for tests) ───────────────────────────────────────

/**
 * Create an askArchitect function with injected LLM caller.
 * Production code uses the real callArchitect; tests inject a mock.
 */
export function createArchitect({ _callArchitect }) {
  return async function askArchitect({
    candidatePool,
    composedParlays,
    mode,
    N,
    lang = 'en',
    provider = 'anthropic',
    tier = 'fast',
    model,
    timeoutMs = 90_000,
  }) {
    if (!composedParlays?.length) {
      throw new Error('[parlay-synergy] askArchitect requires at least one composed parlay');
    }

    const systemPrompt = PARLAY_ARCHITECT_SYSTEM;
    const userPrompt = buildArchitectUserMessage({ candidatePool, composedParlays, mode, N, lang });

    let rawText;
    try {
      rawText = await _callArchitect({
        systemPrompt,
        userPrompt,
        provider,
        tier,
        model,
        timeoutMs,
      });
    } catch (err) {
      console.error('[parlay-synergy] architect LLM call failed:', err.message);
      if (err.noFallback) throw err;
      return buildFallback(composedParlays);
    }

    return parseArchitectResponse(rawText, composedParlays);
  };
}

// Default export uses the real Anthropic client.
export const askArchitect = createArchitect({ _callArchitect: _defaultCallArchitect });
