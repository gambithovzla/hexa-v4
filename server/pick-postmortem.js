import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL_ID = 'claude-sonnet-4-6';

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
- "adjustment_signals" must be useful for future system learning, not user advice.
- Keep every string single-line and plain text.
- When lang=es, all values must be in Spanish. Keys stay in English.`;

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

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 4);
}

function normalizePostmortemPayload(payload) {
  return {
    summary: String(payload?.summary ?? '').replace(/\s+/g, ' ').trim(),
    key_factors: normalizeStringArray(payload?.key_factors),
    what_hexa_got_right: normalizeStringArray(payload?.what_hexa_got_right),
    what_hexa_missed: normalizeStringArray(payload?.what_hexa_missed),
    adjustment_signals: normalizeStringArray(payload?.adjustment_signals),
    training_takeaway: String(payload?.training_takeaway ?? '').replace(/\s+/g, ' ').trim(),
  };
}

export async function generatePickPostmortem({
  lang = 'en',
  pick,
  featureSnapshot = null,
  gameSummary = null,
}) {
  const userMessage = JSON.stringify(
    {
      lang,
      pick,
      featureSnapshot,
      gameSummary,
    },
    null,
    2
  );

  const response = await anthropic.messages.create({
    model: MODEL_ID,
    max_tokens: 900,
    temperature: 0.2,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const raw = extractRawText(response);
  const cleaned = cleanJsonResponse(raw);
  const parsed = JSON.parse(cleaned);
  return normalizePostmortemPayload(parsed);
}
