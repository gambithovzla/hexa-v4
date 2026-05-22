import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const XAI_API_BASE_URL = process.env.XAI_API_BASE_URL || 'https://api.x.ai/v1';
const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1';

export const ARCHITECT_LLM_PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    models: {
      fast: process.env.ANTHROPIC_PARLAY_FAST_MODEL || process.env.ANTHROPIC_PARLAY_MODEL || 'claude-sonnet-4-6',
      deep: process.env.ANTHROPIC_PARLAY_DEEP_MODEL || process.env.ANTHROPIC_PARLAY_MODEL || 'claude-sonnet-4-6',
    },
  },
  openai: {
    label: 'GPT-5.5',
    envKey: 'OPENAI_API_KEY',
    models: {
      fast: process.env.OPENAI_PARLAY_FAST_MODEL || process.env.OPENAI_PARLAY_MODEL || 'gpt-5.5',
      deep: process.env.OPENAI_PARLAY_DEEP_MODEL || process.env.OPENAI_PARLAY_MODEL || 'gpt-5.5',
    },
  },
  xai: {
    label: 'Grok Reasoning',
    envKey: 'XAI_API_KEY',
    models: {
      fast: process.env.XAI_PARLAY_FAST_MODEL || process.env.XAI_PARLAY_MODEL || 'grok-4.20-0309-reasoning',
      deep: process.env.XAI_PARLAY_DEEP_MODEL || process.env.XAI_PARLAY_MODEL || 'grok-4.20-0309-reasoning',
    },
  },
};

const PROVIDER_ALIASES = {
  anthropic: 'anthropic',
  sonnet: 'anthropic',
  claude: 'anthropic',
  openai: 'openai',
  gpt: 'openai',
  'gpt-5.5': 'openai',
  xai: 'xai',
  grok: 'xai',
  'grok-reasoning': 'xai',
};

function cleanText(value) {
  return String(value ?? '').trim();
}

function extractOpenAiText(json) {
  const direct = cleanText(json?.output_text);
  if (direct) return direct;

  const chunks = [];
  for (const item of json?.output ?? []) {
    for (const content of item?.content ?? []) {
      const text = cleanText(content?.text);
      if (text) chunks.push(text);
    }
  }
  return chunks.join('\n').trim();
}

function providerConfigError(message) {
  const err = new Error(message);
  err.code = 'ARCHITECT_PROVIDER_NOT_CONFIGURED';
  err.noFallback = true;
  return err;
}

export function normalizeArchitectProvider(value = 'anthropic') {
  const normalized = String(value ?? 'anthropic').toLowerCase().trim();
  return PROVIDER_ALIASES[normalized] ?? 'anthropic';
}

export function resolveArchitectModelSelection({ provider = 'anthropic', tier = 'fast', model } = {}) {
  const resolvedProvider = normalizeArchitectProvider(provider);
  const resolvedTier = tier === 'deep' ? 'deep' : 'fast';
  const config = ARCHITECT_LLM_PROVIDERS[resolvedProvider];

  return {
    provider: resolvedProvider,
    providerLabel: config.label,
    tier: resolvedTier,
    model: cleanText(model) || config.models[resolvedTier] || config.models.fast,
  };
}

export function assertArchitectProviderConfigured(provider) {
  const resolvedProvider = normalizeArchitectProvider(provider);
  const envKey = ARCHITECT_LLM_PROVIDERS[resolvedProvider]?.envKey;
  if (!envKey || !process.env[envKey]) {
    throw providerConfigError(`${envKey || 'Provider API key'} is not configured for the selected Parlay Architect engine`);
  }
}

async function callAnthropicArchitect({ systemPrompt, userPrompt, model, timeoutMs, maxTokens }) {
  assertArchitectProviderConfigured('anthropic');
  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropicClient.messages.create(
    {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    },
    { timeout: timeoutMs },
  );

  return response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
}

async function postJson(url, { apiKey, body, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = json?.error?.message || json?.error || json?.message || response.statusText;
      throw new Error(detail);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAiArchitect({ systemPrompt, userPrompt, model, timeoutMs, maxTokens }) {
  assertArchitectProviderConfigured('openai');
  const json = await postJson(`${OPENAI_API_BASE_URL}/responses`, {
    apiKey: process.env.OPENAI_API_KEY,
    timeoutMs,
    body: {
      model,
      instructions: systemPrompt,
      input: userPrompt,
      max_output_tokens: maxTokens,
      store: false,
    },
  });
  const text = extractOpenAiText(json);
  if (!text) throw new Error('OpenAI response did not include text content');
  return text;
}

async function callXaiArchitect({ systemPrompt, userPrompt, model, timeoutMs, maxTokens }) {
  assertArchitectProviderConfigured('xai');
  const json = await postJson(`${XAI_API_BASE_URL}/chat/completions`, {
    apiKey: process.env.XAI_API_KEY,
    timeoutMs,
    body: {
      model,
      temperature: 0,
      max_tokens: maxTokens,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    },
  });
  const text = cleanText(json?.choices?.[0]?.message?.content);
  if (!text) throw new Error('xAI response did not include text content');
  return text;
}

/**
 * Send a single-turn message to exactly one selected LLM provider.
 *
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {string} opts.userPrompt
 * @param {string} [opts.provider]   anthropic | openai | xai
 * @param {string} [opts.tier]       fast | deep
 * @param {string} [opts.model]      Optional explicit model ID
 * @param {number} [opts.timeoutMs]  Defaults to 90 000
 * @returns {Promise<string>} Raw text response
 */
export async function callArchitect({
  systemPrompt,
  userPrompt,
  provider = 'anthropic',
  tier = 'fast',
  model,
  timeoutMs = 90_000,
  maxTokens = 4000,
}) {
  const selection = resolveArchitectModelSelection({ provider, tier, model });
  const payload = { systemPrompt, userPrompt, model: selection.model, timeoutMs, maxTokens };

  if (selection.provider === 'openai') return callOpenAiArchitect(payload);
  if (selection.provider === 'xai') return callXaiArchitect(payload);
  return callAnthropicArchitect(payload);
}
