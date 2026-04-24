import Anthropic from '@anthropic-ai/sdk';

// Own Anthropic instance — intentionally separate from oracle.js
// so the parlay engine can evolve independently.
const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Send a single-turn message to an LLM and return the raw text response.
 *
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {string} opts.userPrompt
 * @param {string} [opts.model]      Defaults to claude-sonnet-4-6
 * @param {number} [opts.timeoutMs]  Defaults to 90 000
 * @returns {Promise<string>} Raw text from the first text block
 */
export async function callArchitect({
  systemPrompt,
  userPrompt,
  model = 'claude-sonnet-4-6',
  timeoutMs = 90_000,
}) {
  const response = await anthropicClient.messages.create(
    {
      model,
      max_tokens: 4000,
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
