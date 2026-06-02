/**
 * oracleTennis.js — Tennis branch of the Oracle.
 *
 * Mirrors oracleSoccer.js (which mirrors the frozen MLB oracle.js), isolated in
 * its own module with its own Anthropic client so the frozen Oracle never
 * changes. `context` is the object returned by buildTennisMatchContext().
 *
 * Public API:
 *   analyzeTennisMatch({ context, matchDescription, lang, riskProfile,
 *                        userBankroll, marketOdds, engine, model })
 *     → { provider, model, data, rawText, parseError, stopReason, usage }
 *   analyzeTennisChat({ context, matchDescription, question, conversationHistory,
 *                       lang, marketOdds, model })
 *     → { provider, model, text, usage }
 *   serializeTennisContext({ context, marketOdds }) → string
 *
 * Tennis-specific serialisation vs Soccer:
 *   - Player A vs Player B (no teams, no home/away)
 *   - surface-ELO + overall-ELO + surface H2H + recent form per player
 *   - 2-way market (match winner) + set handicap + total games (no draw, no BTTS)
 *   - surface / round / best-of header
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

import { TENNIS_CHAT_PROMPT, TENNIS_SYSTEM_PROMPT } from '../prompts/oracle-tennis-prompts.js';
import { serializeTennisContext } from './tennisContextSerializer.js';

dotenv.config();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TENNIS_MODELS = {
  deep:    { id: 'claude-sonnet-4-6',         maxTokens: 8000 },
  premium: { id: 'claude-opus-4-8',           maxTokens: 10000 },
  haiku:   { id: 'claude-haiku-4-5-20251001', maxTokens: 1200 },
};

// serializeTennisContext is re-exported below for callers that import it from
// this module (routes/services), keeping the public surface unchanged.
export { serializeTennisContext };

// ── JSON parser — local copy so we don't import from frozen oracle.js ─────────

function cleanJsonResponse(text) {
  if (!text) return text;
  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .replace(/^`+|`+$/g, '')
    .trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

function repairJson(text) {
  let s = text;
  s = s.replace(/[""]/g, '"');
  s = s.replace(/['']/g, "'");
  s = s.replace(/[—–]/g, '-');
  s = s.replace(/"((?:[^"\\]|\\.)*)"/g, (_match, inner) => {
    const fixed = inner
      .replace(/\n/g, ' ')
      .replace(/\r/g, ' ')
      .replace(/\t/g, ' ')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/#{1,6}\s/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return `"${fixed}"`;
  });
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s;
}

function parseResponse(rawText) {
  const cleaned = cleanJsonResponse(rawText);
  if (!cleaned || !cleaned.startsWith('{')) {
    return { data: null, parseError: false };
  }
  try {
    return { data: JSON.parse(cleaned), parseError: false };
  } catch {
    try {
      return { data: JSON.parse(repairJson(cleaned)), parseError: false };
    } catch {
      return { data: null, parseError: true };
    }
  }
}

// ── User-message builders ─────────────────────────────────────────────────────

function buildAnalysisUserMessage({ matchDescription, lang, riskProfile, userBankroll, contextText }) {
  const langTag = lang === 'es'
    ? '\n\nIMPORTANT: Responde TODO el contenido de texto en español. Todos los campos: oracle_report, hexa_hunch, alert_flags, descripciones de picks, todo en español.'
    : '';
  const bankrollLine = userBankroll != null
    ? `\nUSER BANKROLL: $${Number(userBankroll).toFixed(2)} — You MUST compute the Kelly stake and include kelly_recommendation in your JSON output.`
    : '';
  return (
    `Analyze tennis match: ${matchDescription}\n` +
    `Bet focus: Match Winner (2-way, no draw) first, then Set Handicap (±1.5 sets), then Total Games — select the highest-value bet type based on the data. No per-set or player-prop markets.\n` +
    `Risk: ${riskProfile ?? 'balanced'}${bankrollLine}\n\n` +
    `CONTEXT:\n${contextText}` +
    langTag
  );
}

function buildChatUserMessage({ matchDescription, question, contextText, lang }) {
  const langTag = lang === 'es' ? '\n\n(Responde en español.)' : '\n\n(Respond in English.)';
  return (
    `Match: ${matchDescription}\n\n` +
    `DATA:\n${contextText}\n\n` +
    `ADMIN QUESTION: ${question}` +
    langTag
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * analyzeTennisMatch — single-match tennis pick.
 * @param {object} opts
 * @param {object} opts.context           — output of buildTennisMatchContext()
 * @param {string} opts.matchDescription  — "Alcaraz vs Zverev — 2026-01-20 — Australian Open (ATP)"
 * @param {string} [opts.lang]            — 'en' | 'es'
 * @param {string} [opts.riskProfile]     — 'conservative' | 'balanced' | 'aggressive'
 * @param {number} [opts.userBankroll]    — triggers Kelly calc
 * @param {object} [opts.marketOdds]      — { moneyline, setHandicap, totalGames }
 * @param {string} [opts.engine]          — 'deep' | 'premium' | 'haiku' (default 'deep')
 * @param {string} [opts.model]           — explicit model id override
 * @param {number} [opts.timeoutMs]       — request timeout (default 120 s)
 */
export async function analyzeTennisMatch({
  context,
  matchDescription,
  lang = 'en',
  riskProfile = 'balanced',
  userBankroll,
  marketOdds,
  engine = 'deep',
  model,
  timeoutMs = 120_000,
}) {
  const contextText = serializeTennisContext({ context, marketOdds });
  const userMessage = buildAnalysisUserMessage({
    matchDescription,
    lang,
    riskProfile,
    userBankroll,
    contextText,
  });

  const cfg = TENNIS_MODELS[engine] ?? TENNIS_MODELS.deep;
  const modelId = model || cfg.id;

  const response = await anthropic.messages.create(
    {
      model: modelId,
      max_tokens: cfg.maxTokens,
      system: TENNIS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    },
    { timeout: timeoutMs },
  );

  const rawText = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  const { data, parseError } = parseResponse(rawText);

  return {
    provider: 'anthropic',
    model: modelId,
    data,
    rawText,
    parseError,
    stopReason: response.stop_reason,
    usage: response.usage,
  };
}

/**
 * analyzeTennisChat — conversational mode for admins. Plain text response.
 */
export async function analyzeTennisChat({
  context,
  matchDescription,
  question,
  conversationHistory = [],
  lang = 'en',
  marketOdds,
  model,
  timeoutMs = 90_000,
}) {
  const contextText = serializeTennisContext({ context, marketOdds });
  const modelId = model || TENNIS_MODELS.haiku.id;

  const messages = [];
  for (const turn of conversationHistory) {
    if (turn?.question) messages.push({ role: 'user', content: turn.question });
    if (turn?.answer)   messages.push({ role: 'assistant', content: turn.answer });
  }

  const currentMessage = buildChatUserMessage({ matchDescription, question, contextText, lang });
  messages.push({ role: 'user', content: currentMessage });

  const response = await anthropic.messages.create(
    {
      model: modelId,
      max_tokens: 1200,
      system: TENNIS_CHAT_PROMPT,
      messages,
    },
    { timeout: timeoutMs },
  );

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  return {
    provider: 'anthropic',
    model: modelId,
    text,
    usage: response.usage,
  };
}
