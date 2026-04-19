import dotenv from 'dotenv';

dotenv.config();

const XAI_API_BASE_URL = process.env.XAI_API_BASE_URL || 'https://api.x.ai/v1';

const DEFAULT_MODELS = {
  deep: process.env.XAI_ORACLE_MODEL || 'grok-4-fast-reasoning',
  safe: process.env.XAI_SAFE_MODEL || process.env.XAI_ORACLE_MODEL || 'grok-4-fast-reasoning',
};

function cleanText(value) {
  return String(value ?? '').trim();
}

export function isXaiConfigured() {
  return Boolean(process.env.XAI_API_KEY);
}

export function getXaiModelId(mode = 'deep') {
  return mode === 'safe' ? DEFAULT_MODELS.safe : DEFAULT_MODELS.deep;
}

export async function createXaiChatCompletion({
  model,
  systemPrompt,
  userMessage,
  maxTokens = 2000,
  temperature = 0.2,
}) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    const err = new Error('XAI_API_KEY is not configured');
    err.code = 'XAI_NOT_CONFIGURED';
    throw err;
  }

  const response = await fetch(`${XAI_API_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = json?.error?.message || json?.error || json?.message || response.statusText;
    const err = new Error(`xAI request failed: ${detail}`);
    err.code = 'XAI_REQUEST_FAILED';
    throw err;
  }

  const text = cleanText(json?.choices?.[0]?.message?.content);
  if (!text) {
    const err = new Error('xAI response did not include text content');
    err.code = 'XAI_EMPTY_RESPONSE';
    throw err;
  }

  return {
    rawText: text,
    usage: json?.usage ?? null,
    model: json?.model ?? model,
    id: json?.id ?? null,
  };
}
