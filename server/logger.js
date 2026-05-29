/**
 * logger.js — Structured logging via pino.
 *
 * Usage:
 *   import logger from './logger.js';
 *   const log = logger.child({ module: 'oracle' });
 *   log.info({ gamePk: 12345 }, 'analysis started');
 *   log.error({ err }, 'analysis failed');
 *
 * In production (NODE_ENV=production), outputs NDJSON.
 * In development, outputs pretty-printed text via pino-pretty.
 *
 * The console.log/warn/error convention with [module-name] prefixes
 * continues to work alongside this logger — both channels are active.
 */

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';
const level  = process.env.LOG_LEVEL || 'info';

const transport = isDev
  ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
  : undefined;

const logger = pino({ level, transport });

export default logger;
