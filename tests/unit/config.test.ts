import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, ConfigurationError, assertLoopbackBind } from '../../src/config/config.js';

const MANAGED = [
  'EBM_TRANSPORT',
  'EBM_SMTP_HOST',
  'EBM_SMTP_PORT',
  'EBM_RELAY_HOST',
  'EBM_RELAY_USER',
  'EBM_RELAY_PASS',
  'EBM_POLL_INTERVAL_MS',
  'EBM_SAMPLES_PER_PROVIDER',
  'EBM_MAILINATOR_TOKEN',
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of MANAGED) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of MANAGED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('loadConfig', () => {
  it('defaults to the safe loopback transport', () => {
    const config = loadConfig();
    expect(config.transport).toBe('loopback');
    expect(config.smtpHost).toBe('127.0.0.1');
    expect(config.smtpPort).toBe(2525);
  });

  it('rejects an unknown transport instead of guessing', () => {
    process.env['EBM_TRANSPORT'] = 'carrier-pigeon';
    expect(() => loadConfig()).toThrowError(ConfigurationError);
  });

  it('requires relay settings when relay transport is selected', () => {
    process.env['EBM_TRANSPORT'] = 'relay';
    expect(() => loadConfig()).toThrowError(/EBM_RELAY_HOST/);
  });

  it('builds a relay config when settings are present', () => {
    process.env['EBM_TRANSPORT'] = 'relay';
    process.env['EBM_RELAY_HOST'] = 'smtp.example.com';
    process.env['EBM_RELAY_USER'] = 'user';
    process.env['EBM_RELAY_PASS'] = 'pass';
    const config = loadConfig();
    expect(config.relay?.host).toBe('smtp.example.com');
    expect(config.relay?.port).toBe(587);
  });

  it('rejects a non-numeric integer setting', () => {
    process.env['EBM_SMTP_PORT'] = 'not-a-port';
    expect(() => loadConfig()).toThrowError(/positive integer/);
  });

  it('exposes documented defaults for the run plan', () => {
    const config = loadConfig();
    expect(config.defaults.pollIntervalMs).toBe(2000);
    expect(config.defaults.detectionTimeoutMs).toBe(180000);
  });
});

describe('assertLoopbackBind', () => {
  it('accepts loopback addresses', () => {
    expect(() => assertLoopbackBind('127.0.0.1')).not.toThrow();
    expect(() => assertLoopbackBind('localhost')).not.toThrow();
    expect(() => assertLoopbackBind('::1')).not.toThrow();
  });

  it('refuses to bind the SMTP server to a public address', () => {
    expect(() => assertLoopbackBind('0.0.0.0')).toThrowError(ConfigurationError);
    expect(() => assertLoopbackBind('192.168.1.10')).toThrowError(ConfigurationError);
  });
});
