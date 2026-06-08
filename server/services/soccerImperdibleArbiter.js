/**
 * server/services/soccerImperdibleArbiter.js — LLM risk auditor for Soccer Pick
 * Imperdible. Mirrors nflImperdibleArbiter.js with the soccer prompt. Owns its
 * own Anthropic client (project convention; does NOT import oracle.js). Defaults
 * to Opus for the single most important soccer bet of the slate.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  SOCCER_IMPERDIBLE_ARBITER_PROMPT,
  buildSoccerImperdibleArbiterUserMessage,
} from '../prompts/soccer-imperdible-prompts.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ARBITER_MODEL = process.env.IMPERDIBLE_ARBITER_MODEL || 'claude-opus-4-7';
const ARBITER_MAX_TOKENS = 1500;

function extractText(message) {
  return (message?.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

function stripToJson(raw) {
  if (!raw) return null;
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeVerdict(parsed, validIds) {
  if (!parsed || typeof parsed !== 'object') return null;
  const verdict = String(parsed.verdict ?? '').toUpperCase() === 'CONFIRM' ? 'CONFIRM' : 'PASS';
  let selectedId = parsed.selected_candidate_id != null ? String(parsed.selected_candidate_id) : null;

  // Guard: never let the LLM confirm a candidate that is not in the list.
  if (verdict === 'CONFIRM' && (!selectedId || !validIds.includes(selectedId))) {
    return {
      verdict: 'PASS',
      selected_candidate_id: null,
      confidence: null,
      headline: parsed.headline ?? 'No valid lock confirmed',
      rationale: 'Arbiter returned an unlisted candidate; auto-vetoed for safety.',
      disqualifiers_checked: Array.isArray(parsed.disqualifiers_checked) ? parsed.disqualifiers_checked : [],
      runner_up_id: null,
      guard_triggered: true,
    };
  }

  if (verdict === 'PASS') selectedId = null;

  const runnerUp = parsed.runner_up_id != null && validIds.includes(String(parsed.runner_up_id))
    ? String(parsed.runner_up_id)
    : null;

  return {
    verdict,
    selected_candidate_id: selectedId,
    confidence: parsed.confidence != null ? Number(parsed.confidence) : null,
    headline: parsed.headline ?? null,
    rationale: parsed.rationale ?? null,
    disqualifiers_checked: Array.isArray(parsed.disqualifiers_checked) ? parsed.disqualifiers_checked : [],
    runner_up_id: runnerUp,
    guard_triggered: false,
  };
}

/**
 * @param {object} p
 * @param {Array}  p.candidates   pre-ranked scored candidates (with candidateId)
 * @param {Array}  p.gameContexts [{ gamePk, matchup, context }]
 * @param {string} [p.lang]
 * @param {number} [p.timeoutMs]
 */
export async function arbitrateSoccerImperdible({ candidates, gameContexts, lang = 'en', timeoutMs = 60000 }) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return {
      verdict: 'PASS',
      selected_candidate_id: null,
      confidence: null,
      headline: lang === 'es' ? 'No hay candidatos elegibles hoy' : 'No eligible candidates today',
      rationale: lang === 'es'
        ? 'Ningún candidato cruzó el umbral de convicción determinista.'
        : 'No candidate cleared the deterministic conviction gate.',
      disqualifiers_checked: [],
      runner_up_id: null,
      model: ARBITER_MODEL,
      parseError: false,
    };
  }

  const validIds = candidates.map((c) => c.candidateId);
  const userMessage = buildSoccerImperdibleArbiterUserMessage({
    lang,
    slateSize: gameContexts?.length ?? candidates.length,
    candidates,
    gameContexts,
  });

  const message = await anthropic.messages.create(
    {
      model: ARBITER_MODEL,
      max_tokens: ARBITER_MAX_TOKENS,
      system: [
        { type: 'text', text: SOCCER_IMPERDIBLE_ARBITER_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userMessage }],
    },
    { timeout: timeoutMs },
  );

  const rawText = extractText(message);
  const parsed = stripToJson(rawText);
  const normalized = normalizeVerdict(parsed, validIds);

  if (!normalized) {
    console.warn('[soccer-imperdible-arbiter] failed to parse verdict, defaulting to PASS');
    return {
      verdict: 'PASS',
      selected_candidate_id: null,
      confidence: null,
      headline: lang === 'es' ? 'Veredicto no interpretable — sin imperdible' : 'Unparseable verdict — no lock',
      rationale: lang === 'es'
        ? 'El árbitro no devolvió un JSON válido; se descarta por seguridad.'
        : 'Arbiter returned invalid JSON; vetoed for safety.',
      disqualifiers_checked: [],
      runner_up_id: null,
      model: ARBITER_MODEL,
      parseError: true,
      rawText: rawText.slice(0, 400),
    };
  }

  return { ...normalized, model: ARBITER_MODEL, parseError: false, usage: message.usage ?? null };
}
