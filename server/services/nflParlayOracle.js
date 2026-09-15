/**
 * server/services/nflParlayOracle.js — NFL multi-game parlay (the "Parlay" tab).
 *
 * The MLB parlay runs through the frozen oracle.js (analyzeParlay). This is the
 * NFL equivalent: its own Anthropic client, its own prompt, and the same JSON
 * shape so the existing ResultCard renderer handles both without a branch.
 *
 * Distinct from the Parlay Synergy Architect (POST /api/nfl/parlay), which scores
 * a candidate pool and composes tickets. Here the user picks the games and gets
 * exactly one leg per game.
 *
 * Frozen files are imported, never edited.
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

import { NFL_PARLAY_SYSTEM_PROMPT } from '../prompts/nfl-parlay-prompts.js';
import { serializeNflContext, parseNflOracleJson } from './oracleNfl.js';

dotenv.config();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PARLAY_MODELS = {
  deep:    { id: 'claude-sonnet-4-6', maxTokens: 6000 },
  premium: { id: 'claude-opus-4-7',   maxTokens: 8000 },
};

export const NFL_LEG_CONFIDENCE_MIN = 0.50;
export const NFL_LEG_CONFIDENCE_MAX = 0.72;

function clampLegConfidence(raw) {
  let n = Number(raw);
  if (!Number.isFinite(n)) return NFL_LEG_CONFIDENCE_MIN;
  if (n > 1) n /= 100;
  return Math.min(NFL_LEG_CONFIDENCE_MAX, Math.max(NFL_LEG_CONFIDENCE_MIN, n));
}

function riskLevelFor(combined) {
  if (combined >= 0.35) return 'MODERATE';
  if (combined >= 0.20) return 'HIGH';
  return 'VERY HIGH';
}

/**
 * normalizeNflParlay — enforce the arithmetic the model is asked for but cannot
 * be trusted to do. Legs are independent games, so the ticket's probability is
 * the product of the legs; a model that reports 0.55 for a four-leg ticket is
 * selling a number that does not exist. Pure, unit-tested.
 *
 * @param {object} data — parsed LLM JSON
 * @returns {object|null} normalized data, or null when there is no usable parlay
 */
export function normalizeNflParlay(data) {
  const parlay = data?.parlay;
  if (!parlay || !Array.isArray(parlay.legs) || parlay.legs.length === 0) return null;

  const legs = parlay.legs.map(leg => ({
    ...leg,
    confidence: clampLegConfidence(leg?.confidence),
  }));

  const combined = legs.reduce((acc, leg) => acc * leg.confidence, 1);
  const combinedRounded = Math.round(combined * 1000) / 1000;

  return {
    ...data,
    parlay: {
      ...parlay,
      legs,
      combined_confidence: combinedRounded,
      risk_level: riskLevelFor(combinedRounded),
    },
  };
}

function buildParlayUserMessage({ legs, lang, riskProfile, requestedLegs }) {
  const langTag = lang === 'es'
    ? '\n\nIMPORTANTE: Responde TODO el contenido de texto en español (pick, reasoning, strategy_note). Las claves JSON siguen en inglés.'
    : '';

  const blocks = legs.map((leg, i) => (
    `=== GAME ${i + 1}: ${leg.gameDescription} ===\n${leg.contextText}`
  )).join('\n\n');

  return (
    `Build a ${requestedLegs}-leg NFL parlay, one leg per game, in the order given.\n` +
    `Risk profile: ${riskProfile ?? 'balanced'}\n\n` +
    `${blocks}` +
    langTag
  );
}

/**
 * analyzeNflParlay — one leg per supplied game.
 *
 * @param {object}   p
 * @param {object[]} p.legs         — [{ context, marketOdds, gameDescription }]
 * @param {string}   [p.lang]
 * @param {string}   [p.riskProfile]
 * @param {string}   [p.engine]     — 'deep' | 'premium'
 * @param {number}   [p.timeoutMs]
 */
export async function analyzeNflParlay({
  legs,
  lang = 'en',
  riskProfile = 'balanced',
  engine = 'deep',
  model,
  timeoutMs = 120_000,
}) {
  if (!Array.isArray(legs) || legs.length < 2) {
    throw new Error('An NFL parlay needs at least 2 games');
  }

  const serialized = legs.map(leg => ({
    gameDescription: leg.gameDescription,
    contextText: serializeNflContext({ context: leg.context, marketOdds: leg.marketOdds }),
  }));

  const cfg = PARLAY_MODELS[engine] ?? PARLAY_MODELS.deep;
  const modelId = model || cfg.id;

  const response = await anthropic.messages.create(
    {
      model: modelId,
      max_tokens: cfg.maxTokens,
      system: NFL_PARLAY_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: buildParlayUserMessage({
          legs: serialized,
          lang,
          riskProfile,
          requestedLegs: legs.length,
        }),
      }],
    },
    { timeout: timeoutMs },
  );

  const rawText = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  const { data, parseError } = parseNflOracleJson(rawText);
  const normalized = data ? normalizeNflParlay(data) : null;

  return {
    provider: 'anthropic',
    model: modelId,
    data: normalized,
    rawText,
    parseError: parseError || (data != null && normalized == null),
    stopReason: response.stop_reason,
    usage: response.usage,
  };
}
