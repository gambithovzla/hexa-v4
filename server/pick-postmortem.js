import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const PRIMARY_MODEL = 'claude-haiku-4-5-20251001';
const FALLBACK_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1200;
const TEMPERATURE = 0.2;

export const POSTMORTEM_SCHEMA_VERSION = 2;

// Shadow log: run both models in parallel for the first N postmortems and log
// a coincidence score, so we can validate Haiku quality before committing.
// Gated by POSTMORTEM_SHADOW_LOG=1; defaults to first 20 runs per process.
const SHADOW_LOG_ENABLED = process.env.POSTMORTEM_SHADOW_LOG === '1';
const SHADOW_LOG_MAX = Number.parseInt(process.env.POSTMORTEM_SHADOW_MAX ?? '20', 10) || 20;
let shadowLogCount = 0;

const SYSTEM_PROMPT = `You are H.E.X.A. Postmortem, an MLB betting review engine.

Your job is to explain why a pick won, lost, or pushed after the game ended, and to extract adjustment signals that can help future model tuning.

Respond ONLY with valid JSON. No markdown. No backticks. No preamble.

Required JSON shape:
{
  "summary": "single paragraph under 320 chars",
  "key_factors": ["1-4 short bullets as plain strings"],
  "what_hexa_got_right": ["0-3 short strings"],
  "what_hexa_missed": ["0-3 short strings"],
  "adjustment_signals": ["1-4 concrete model tuning signals"],
  "training_takeaway": "single sentence under 220 chars"
}

Rules:
- Base everything on the provided pick, stored reasoning, final game outcome, and feature snapshot.
- Be specific and analytical, not generic.
- If the pick WON, explain why the logic held.
- If the pick LOST, explain what invalidated the original thesis.
- If the pick PUSHED, explain why the edge was neutralized.
- If gameSummary.pickOutcomeContext.thresholdEvent exists, that is the first play that satisfied the pick. Do not describe a later play as the fulfillment moment.
- If gameSummary.pickOutcomeContext.breakEvent exists, that is the first play that broke the pick. Do not describe a later play as the failure trigger.
- Treat gameSummary.recentPlays as late-game context only. They are not proof of when the pick was first decided.
- If a relevant event includes pitcher.role = "starter" or "bullpen", preserve that distinction accurately.
- "adjustment_signals" must be useful for future system learning, not user advice.
- Keep every string single-line and plain text.
- When lang=es, all values must be in Spanish. Keys stay in English.`;

function normalizeLanguage(lang) {
  return String(lang ?? '').toLowerCase().startsWith('es') ? 'es' : 'en';
}

function extractRawText(response) {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function cleanJsonResponse(text) {
  if (!text) return text;
  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

function tryParseJson(raw) {
  if (!raw) return null;
  const cleaned = cleanJsonResponse(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    // ignore
  }
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {
      // ignore
    }
  }
  return null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 4);
}

function normalizePostmortemPayload(payload) {
  const resolvedLang = normalizeLanguage(payload?.lang);
  return {
    version: POSTMORTEM_SCHEMA_VERSION,
    lang: resolvedLang,
    summary: String(payload?.summary ?? '').replace(/\s+/g, ' ').trim(),
    key_factors: normalizeStringArray(payload?.key_factors),
    what_hexa_got_right: normalizeStringArray(payload?.what_hexa_got_right),
    what_hexa_missed: normalizeStringArray(payload?.what_hexa_missed),
    adjustment_signals: normalizeStringArray(payload?.adjustment_signals),
    training_takeaway: String(payload?.training_takeaway ?? '').replace(/\s+/g, ' ').trim(),
  };
}

async function callModel({ model, userMessage }) {
  const response = await anthropic.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });
  return extractRawText(response);
}

async function generateWithModel({ model, userMessage }) {
  const raw = await callModel({ model, userMessage });
  const parsed = tryParseJson(raw);
  if (!parsed) {
    const err = new Error(`postmortem: invalid JSON from ${model}`);
    err.rawPreview = (raw || '').slice(0, 200);
    throw err;
  }
  return parsed;
}

// Jaccard similarity on word sets — cheap proxy for semantic overlap.
function jaccard(a, b) {
  const setA = new Set(String(a ?? '').toLowerCase().split(/\W+/).filter(Boolean));
  const setB = new Set(String(b ?? '').toLowerCase().split(/\W+/).filter(Boolean));
  if (!setA.size && !setB.size) return 1;
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function scoreCoincidence(a, b) {
  if (!a || !b) return null;
  const summarySim = jaccard(a.summary, b.summary);
  const takeawaySim = jaccard(a.training_takeaway, b.training_takeaway);
  const factorsSim = jaccard(
    (a.key_factors || []).join(' '),
    (b.key_factors || []).join(' ')
  );
  return {
    summary: Number(summarySim.toFixed(3)),
    training_takeaway: Number(takeawaySim.toFixed(3)),
    key_factors: Number(factorsSim.toFixed(3)),
    average: Number(((summarySim + takeawaySim + factorsSim) / 3).toFixed(3)),
  };
}

async function runShadowComparison({ userMessage, pickId, haikuResult }) {
  try {
    const sonnetRaw = await callModel({ model: FALLBACK_MODEL, userMessage });
    const sonnetParsed = tryParseJson(sonnetRaw);
    const coincidence = scoreCoincidence(haikuResult, sonnetParsed);
    console.log('[postmortem:shadow]', JSON.stringify({
      pickId: pickId ?? null,
      run: shadowLogCount,
      haiku_ok: Boolean(haikuResult),
      sonnet_ok: Boolean(sonnetParsed),
      coincidence,
    }));
  } catch (err) {
    console.log('[postmortem:shadow] error', err?.message || err);
  }
}

export async function generatePickPostmortem({
  lang = 'en',
  pick,
  featureSnapshot = null,
  gameSummary = null,
}) {
  const resolvedLang = normalizeLanguage(lang);
  const userMessage = JSON.stringify(
    {
      lang: resolvedLang,
      output_language: resolvedLang === 'es' ? 'Spanish' : 'English',
      pick,
      featureSnapshot,
      gameSummary,
    },
    null,
    2
  );

  let parsed;
  let modelUsed = PRIMARY_MODEL;
  try {
    parsed = await generateWithModel({ model: PRIMARY_MODEL, userMessage });
  } catch (primaryErr) {
    console.log('[postmortem] haiku failed, falling back to sonnet:', primaryErr?.message);
    parsed = await generateWithModel({ model: FALLBACK_MODEL, userMessage });
    modelUsed = FALLBACK_MODEL;
  }

  if (SHADOW_LOG_ENABLED && shadowLogCount < SHADOW_LOG_MAX && modelUsed === PRIMARY_MODEL) {
    shadowLogCount += 1;
    // Fire-and-forget: don't block the user response on the shadow comparison.
    runShadowComparison({ userMessage, pickId: pick?.id, haikuResult: parsed });
  }

  return normalizePostmortemPayload({ ...parsed, lang: resolvedLang });
}
