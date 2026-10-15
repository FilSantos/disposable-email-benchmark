/**
 * Structured logger. Every message passes through `redact` so credentials and
 * cookies cannot reach stdout, files or reports (Prompt 2 §20).
 */

import { redact } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(scope: string): Logger;
}

function serialize(fields: LogFields | undefined): string {
  if (!fields || Object.keys(fields).length === 0) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const rendered = typeof value === 'string' ? value : JSON.stringify(value);
    parts.push(`${key}=${redact(rendered)}`);
  }
  return ' ' + parts.join(' ');
}

export function createLogger(scope = 'benchmark', minLevel: LogLevel = 'info'): Logger {
  const threshold = LEVEL_ORDER[minLevel];
  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    if (LEVEL_ORDER[level] < threshold) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${redact(msg)}${serialize(fields)}`;
    if (level === 'error') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (sub) => createLogger(`${scope}:${sub}`, minLevel),
  };
}

/** No-op logger for tests and library consumers. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};
