import { describe, it, expect, afterEach } from 'vitest';
import { redact, registerSecret, clearSecrets } from '../../src/observability/redact.js';
import { createLogger } from '../../src/observability/logger.js';

afterEach(() => clearSecrets());

describe('redact', () => {
  it('replaces a registered secret', () => {
    registerSecret('super-secret-token-1234');
    expect(redact('token is super-secret-token-1234 here')).toBe('token is [REDACTED] here');
  });

  it('ignores trivially short values to avoid mangling ordinary text', () => {
    registerSecret('ab');
    expect(redact('abc')).toBe('abc');
  });

  it('replaces every occurrence', () => {
    registerSecret('aaaaaaaa');
    expect(redact('aaaaaaaa/aaaaaaaa')).toBe('[REDACTED]/[REDACTED]');
  });

  it('redacts authorization headers defensively', () => {
    expect(redact('Authorization: Bearer abc.def.ghi')).toContain('[REDACTED]');
  });

  it('redacts token query parameters', () => {
    expect(redact('https://api.example.com/x?token=abcd1234&y=1')).toBe(
      'https://api.example.com/x?token=[REDACTED]&y=1',
    );
  });

  it('redacts api key headers', () => {
    expect(redact('X-Api-Key: 9f8e7d6c')).toBe('X-Api-Key: [REDACTED]');
  });

  it('redacts session cookies', () => {
    expect(redact('Cookie: PHPSESSID=abc123; other=1')).toContain('PHPSESSID=[REDACTED]');
  });

  it('handles regex metacharacters inside a secret safely', () => {
    registerSecret('a+b*c?d');
    expect(redact('value a+b*c?d end')).toBe('value [REDACTED] end');
  });
});

describe('logger redaction boundary', () => {
  it('does not write a registered secret to stdout', () => {
    registerSecret('leak-me-please-9876');
    const chunks: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      chunks.push(s);
      return true;
    };
    try {
      const log = createLogger('test', 'debug');
      log.info('connecting', { token: 'leak-me-please-9876' });
    } finally {
      (process.stdout as unknown as { write: typeof original }).write = original;
    }
    const output = chunks.join('');
    expect(output).not.toContain('leak-me-please-9876');
    expect(output).toContain('[REDACTED]');
  });
});
