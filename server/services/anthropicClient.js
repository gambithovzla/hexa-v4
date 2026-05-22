/**
 * Anthropic failover for Oracle game analysis only (MLB/NBA/parlay-synergy).
 * Postmortems, content drafts, and chat pick extraction keep using ANTHROPIC_API_KEY alone.
 *
 * Put the key you want to spend first in ANTHROPIC_API_KEY (e.g. a one-off reload).
 * Put your long-term key in ANTHROPIC_API_BACKUP_KEY; it is used when the primary
 * is rejected for auth/billing/credit reasons.
 */

import Anthropic from '@anthropic-ai/sdk';

const CREDIT_FAILOVER_PATTERNS = [
  /credit/i,
  /billing/i,
  /balance/i,
  /payment/i,
  /purchase/i,
  /insufficient/i,
  /authentication/i,
  /invalid\s*x-api-key/i,
  /api\s*key/i,
];

export function getAnthropicApiKeys() {
  const primary = String(process.env.ANTHROPIC_API_KEY ?? '').trim();
  const backup = String(process.env.ANTHROPIC_API_BACKUP_KEY ?? '').trim();
  return { primary, backup };
}

export function isAnthropicConfigured() {
  const { primary, backup } = getAnthropicApiKeys();
  return Boolean(primary || backup);
}

export function createAnthropicClient(apiKey) {
  return new Anthropic({ apiKey });
}

export function shouldFailoverToBackupAnthropicKey(err) {
  if (!err) return false;

  const status = err.status ?? err.statusCode ?? err.response?.status;
  if (status === 401 || status === 402 || status === 403) return true;

  const type = String(err.error?.type ?? err.type ?? '').toLowerCase();
  if (type === 'authentication_error' || type === 'permission_error') return true;

  const message = String(err.message ?? err.error?.message ?? '');
  if (CREDIT_FAILOVER_PATTERNS.some(re => re.test(message))) return true;

  return false;
}

/**
 * @param {(client: import('@anthropic-ai/sdk').default, meta: { keySlot: 'primary' | 'backup' }) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withAnthropicFailover(fn) {
  const { primary, backup } = getAnthropicApiKeys();
  const keys = [];
  if (primary) keys.push({ key: primary, slot: 'primary' });
  if (backup && backup !== primary) keys.push({ key: backup, slot: 'backup' });

  if (keys.length === 0) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  let lastErr;
  for (let i = 0; i < keys.length; i += 1) {
    const { key, slot } = keys[i];
    try {
      const client = createAnthropicClient(key);
      return await fn(client, { keySlot: slot });
    } catch (err) {
      lastErr = err;
      const hasBackup = i < keys.length - 1;
      if (!hasBackup || !shouldFailoverToBackupAnthropicKey(err)) throw err;
      console.warn(
        `[anthropic] ${slot} key failed (${err.message ?? err}); retrying with backup key`,
      );
    }
  }

  throw lastErr;
}
