/**
 * espn-http.js — hardened HTTP client for ESPN's keyless site API.
 *
 * ESPN sits behind Akamai, which started refusing our Railway egress with a 403
 * ("Access Denied") while the exact same request succeeds from a residential IP.
 * Every ESPN-backed board (NFL first, but NBA/NHL/soccer/tennis share the host)
 * degrades to an empty slate when that happens, because the fetchers swallow the
 * error and return []. Two mitigations live here:
 *
 *   1. Browser-shaped headers. A bare fetch sends no User-Agent at all, which is
 *      the cheapest signal for a bot rule to key on.
 *   2. Mirror failover. site.web.api.espn.com serves the same paths with the same
 *      payload shapes from a different edge, so a 403/timeout on the primary is
 *      retried there before we give up.
 *
 * Callers keep their own caching and stale-serving; this module only decides how
 * a single request is made and which host answers it.
 */

export const ESPN_PRIMARY_HOST = 'https://site.api.espn.com';
export const ESPN_MIRROR_HOST = 'https://site.web.api.espn.com';

const ESPN_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Referer: 'https://www.espn.com/',
  Origin: 'https://www.espn.com',
};

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return String(url);
  }
}

/** Same path on the mirror edge, or null when the URL is not on the primary. */
export function mirrorUrl(url) {
  const str = String(url);
  if (!str.startsWith(ESPN_PRIMARY_HOST)) return null;
  return ESPN_MIRROR_HOST + str.slice(ESPN_PRIMARY_HOST.length);
}

async function requestOnce(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: ESPN_HEADERS, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`timeout after ${Math.round(timeoutMs / 1000)}s`);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * espnRequest(url, { timeoutMs, label, prefix })
 *   Resolves the parsed JSON, or throws `[prefix] label → reason` after both the
 *   primary host and the mirror have failed.
 */
export async function espnRequest(url, { timeoutMs = 8000, label = 'espn', prefix = 'espn' } = {}) {
  const targets = [String(url)];
  const mirror = mirrorUrl(url);
  if (mirror) targets.push(mirror);

  let lastError = 'no attempt';
  for (let i = 0; i < targets.length; i++) {
    try {
      return await requestOnce(targets[i], timeoutMs);
    } catch (err) {
      lastError = err.message;
      const isLast = i === targets.length - 1;
      if (!isLast) {
        console.warn(
          `[${prefix}] ${label} → ${lastError} on ${hostOf(targets[i])} — retrying on ${hostOf(targets[i + 1])}`,
        );
      }
    }
  }
  throw new Error(`[${prefix}] ${label} → ${lastError}`);
}
