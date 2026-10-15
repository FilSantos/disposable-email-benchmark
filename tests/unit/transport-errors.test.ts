import { describe, it, expect } from 'vitest';
import { classifyTransportError } from '../../src/smtp/transports.js';

function err(code: string, responseCode?: number): NodeJS.ErrnoException {
  const e = new Error(`simulated ${code}`) as NodeJS.ErrnoException;
  e.code = code;
  if (responseCode !== undefined) (e as unknown as { responseCode: number }).responseCode = responseCode;
  return e;
}

describe('classifyTransportError', () => {
  it('classifies a blocked port as TRANSPORT_BLOCKED', () => {
    expect(classifyTransportError(err('ECONNREFUSED'))).toBe('TRANSPORT_BLOCKED');
    expect(classifyTransportError(err('EHOSTUNREACH'))).toBe('TRANSPORT_BLOCKED');
    expect(classifyTransportError(err('ENETUNREACH'))).toBe('TRANSPORT_BLOCKED');
  });

  it('classifies a timeout as TIMEOUT', () => {
    expect(classifyTransportError(err('ETIMEDOUT'))).toBe('TIMEOUT');
  });

  it('classifies DNS problems as DNS_FAILURE', () => {
    expect(classifyTransportError(err('ENOTFOUND'))).toBe('DNS_FAILURE');
    expect(classifyTransportError(err('EAI_AGAIN'))).toBe('DNS_FAILURE');
  });

  it('classifies bad credentials as AUTH_FAILED', () => {
    expect(classifyTransportError(err('EAUTH', 535))).toBe('AUTH_FAILED');
  });

  it('classifies an IP-allowlist rejection (525) as AUTH_FAILED, not UNKNOWN', () => {
    // Brevo returns 525 "Unauthorized IP address" — a configuration problem.
    expect(classifyTransportError(err('EAUTH', 525))).toBe('AUTH_FAILED');
  });

  it('classifies a generic SMTP rejection as REJECTED', () => {
    expect(classifyTransportError(err('EENVELOPE', 550))).toBe('REJECTED');
  });

  it('falls back to UNKNOWN rather than guessing', () => {
    expect(classifyTransportError(new Error('something else'))).toBe('UNKNOWN');
  });
});
