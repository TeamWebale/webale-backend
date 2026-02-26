/**
 * sentrySetup.js — src/sentrySetup.js
 * Backend Sentry initialization.
 * Import and call initSentry() at the TOP of server.js before anything else.
 */

import * as Sentry from '@sentry/node';

export function initSentry() {
  if (!process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    release: 'webale-api@1.0.0',
    tracesSampleRate: 0.1,
  });

  console.log('✓ Sentry initialized');
}

// Express error handler middleware — add as LAST app.use() in server.js
export function sentryErrorHandler() {
  return Sentry.expressErrorHandler();
}
