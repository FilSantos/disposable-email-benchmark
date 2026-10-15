/**
 * Configuration: environment loading, validation and the run manifest.
 *
 * Secrets are read from the environment (or a .env file via the CLI) and
 * immediately registered with the redaction layer. Configuration errors are
 * reported as CONFIGURATION_ERROR, never attributed to a provider
 * (Prompt 2 §7, §13, §20).
 */

import { readFileSync, existsSync } from 'node:fs';
import type { TransportMode } from '../domain/types.js';
import { registerSecret } from '../observability/redact.js';

export const FRAMEWORK_VERSION = '0.1.0';

export interface RelayConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly pass: string;
}

export interface BenchmarkDefaults {
  readonly pollIntervalMs: number;
  readonly detectionTimeoutMs: number;
  readonly transportTimeoutMs: number;
  readonly samplesPerProvider: number;
  readonly runs: number;
}

export interface AppConfig {
  readonly transport: TransportMode;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly smtpTimeoutMs: number;
  readonly relay: RelayConfig | null;
  readonly mailinatorToken: string | null;
  /**
   * Envelope sender. Must be a sender the relay is authorised to use; a
   * non-authorised sender can be accepted (250 queued) but never delivered.
   */
  readonly sendFrom: string;
  readonly defaults: BenchmarkDefaults;
}

export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError';
}

/** Loads KEY=VALUE pairs from a .env file into process.env without overwriting. */
export function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return;
  const contents = readFileSync(path, 'utf8');
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new ConfigurationError(`${name} must be a positive integer, received "${raw}"`);
  }
  return parsed;
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

const VALID_TRANSPORTS: readonly TransportMode[] = ['loopback', 'direct-mx', 'relay'];

export interface LoadConfigOptions {
  readonly requireTransport?: boolean;
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const rawTransport = (process.env['EBM_TRANSPORT'] ?? 'loopback').trim() as TransportMode;
  if (!VALID_TRANSPORTS.includes(rawTransport)) {
    throw new ConfigurationError(
      `EBM_TRANSPORT must be one of ${VALID_TRANSPORTS.join(', ')}, received "${rawTransport}"`,
    );
  }

  const relayHost = process.env['EBM_RELAY_HOST']?.trim() ?? '';
  const relayUser = process.env['EBM_RELAY_USER']?.trim() ?? '';
  const relayPass = process.env['EBM_RELAY_PASS']?.trim() ?? '';

  let relay: RelayConfig | null = null;
  if (rawTransport === 'relay' || options.requireTransport === false) {
    if (relayHost) {
      relay = {
        host: relayHost,
        port: intFromEnv('EBM_RELAY_PORT', 587),
        secure: boolFromEnv('EBM_RELAY_SECURE', false),
        user: relayUser,
        pass: relayPass,
      };
    }
  }

  if (rawTransport === 'relay' && !relay) {
    throw new ConfigurationError(
      'EBM_TRANSPORT=relay requires EBM_RELAY_HOST (and usually EBM_RELAY_USER/EBM_RELAY_PASS)',
    );
  }

  const mailinatorToken = process.env['EBM_MAILINATOR_TOKEN']?.trim() || null;

  // Register secrets for redaction as early as possible.
  registerSecret(relayPass);
  registerSecret(relayUser);
  registerSecret(mailinatorToken);

  return {
    transport: rawTransport,
    smtpHost: process.env['EBM_SMTP_HOST']?.trim() || '127.0.0.1',
    smtpPort: intFromEnv('EBM_SMTP_PORT', 2525),
    smtpTimeoutMs: intFromEnv('EBM_SMTP_TIMEOUT_MS', 15_000),
    relay,
    mailinatorToken,
    sendFrom: process.env['EBM_SEND_FROM']?.trim() || 'benchmark@ebm.local',
    defaults: {
      pollIntervalMs: intFromEnv('EBM_POLL_INTERVAL_MS', 2_000),
      detectionTimeoutMs: intFromEnv('EBM_DETECTION_TIMEOUT_MS', 180_000),
      transportTimeoutMs: intFromEnv('EBM_TRANSPORT_TIMEOUT_MS', 15_000),
      samplesPerProvider: intFromEnv('EBM_SAMPLES_PER_PROVIDER', 3),
      runs: intFromEnv('EBM_RUNS', 1),
    },
  };
}

/**
 * Loopback transport binds to loopback only. Refuse a public bind address so the
 * local SMTP server can never be exposed (Prompt 2 §20).
 */
export function assertLoopbackBind(host: string): void {
  const allowed = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!allowed.has(host)) {
    throw new ConfigurationError(
      `SMTP server must bind to loopback (127.0.0.1/localhost/::1); received "${host}"`,
    );
  }
}
