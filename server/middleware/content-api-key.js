/**
 * content-api-key.js — X-API-Key auth for the Content API (/api/content/v1/*).
 *
 * CONTENT_API_KEYS env var format: CSV of labeled keys (label for logging only).
 *   CONTENT_API_KEYS=socialmedia:abc123...,dev:xyz456...
 * If an entry lacks the "label:" prefix, it is treated as unlabeled.
 *
 * verifyContentApiKey(req, res, next)
 *   - 401 if header missing or no key matches
 *   - 503 if CONTENT_API_KEYS is unset (fail closed)
 *   - constant-time comparison against each configured secret
 *   - on success attaches req.contentConsumer = { label }
 */

import crypto from 'crypto';

function parseKeys(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf(':');
      if (idx < 0) return { label: 'unlabeled', secret: entry };
      return {
        label: entry.slice(0, idx).trim() || 'unlabeled',
        secret: entry.slice(idx + 1).trim(),
      };
    })
    .filter((k) => k.secret);
}

function safeEquals(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function verifyContentApiKey(req, res, next) {
  const provided = req.headers['x-api-key'];
  if (!provided || typeof provided !== 'string') {
    return res.status(401).json({ success: false, error: 'Missing X-API-Key header' });
  }

  const valid = parseKeys(process.env.CONTENT_API_KEYS);
  if (valid.length === 0) {
    return res.status(503).json({ success: false, error: 'Content API not configured' });
  }

  for (const k of valid) {
    if (safeEquals(provided, k.secret)) {
      req.contentConsumer = { label: k.label };
      return next();
    }
  }

  return res.status(401).json({ success: false, error: 'Invalid API key' });
}
