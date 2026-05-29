/**
 * observability.js — Sentry error tracking initialization.
 *
 * Activates when SENTRY_DSN env var is set. No-ops otherwise.
 * Wire into index.js:
 *   import { initSentry, sentryErrorHandler } from './observability.js';
 *   initSentry(app);            // call before routes
 *   app.use(sentryErrorHandler()); // call after routes, before custom error handler
 *
 * Env vars:
 *   SENTRY_DSN              — Sentry project DSN (required to activate)
 *   SENTRY_TRACES_SAMPLE_RATE — 0.0–1.0 (default 0.05)
 *   SENTRY_ENVIRONMENT      — override environment tag (default NODE_ENV)
 */

import * as Sentry from '@sentry/node';

let _initialized = false;

export function initSentry(app) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log('[observability] SENTRY_DSN not set — Sentry disabled');
    return;
  }

  const tracesSampleRate = parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.05');
  const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development';

  Sentry.init({
    dsn,
    tracesSampleRate,
    environment,
    integrations: [
      Sentry.httpIntegration(),
      Sentry.expressIntegration({ app }),
    ],
    beforeSend(event) {
      // Strip sensitive fields from request bodies before sending
      if (event.request?.data) {
        const safe = { ...event.request.data };
        for (const k of ['password', 'token', 'api_key', 'apiKey', 'secret']) {
          if (safe[k]) safe[k] = '[REDACTED]';
        }
        event.request.data = safe;
      }
      return event;
    },
  });

  _initialized = true;
  console.log(`[observability] Sentry initialized (env=${environment}, traces=${tracesSampleRate})`);
}

export function sentryErrorHandler() {
  if (!_initialized) {
    return (_err, _req, _res, next) => next(_err);
  }
  return Sentry.expressErrorHandler();
}

/**
 * Capture an exception manually (e.g. in background jobs).
 */
export function captureException(err, context = {}) {
  if (!_initialized) return;
  Sentry.withScope(scope => {
    for (const [k, v] of Object.entries(context)) {
      scope.setExtra(k, v);
    }
    Sentry.captureException(err);
  });
}
