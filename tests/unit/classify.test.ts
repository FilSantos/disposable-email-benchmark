import { describe, it, expect } from 'vitest';
import { classify, type ClassificationInput } from '../../src/benchmark/classify.js';

function input(overrides: Partial<ClassificationInput>): ClassificationInput {
  return {
    smtpStatus: 'ACCEPTED',
    detected: true,
    contentAvailable: true,
    contentValidationStatus: 'PASS',
    validationDifferences: [],
    wrongMessageMatched: false,
    timeoutStatus: 'NONE',
    providerReachable: true,
    rateLimited: false,
    channel: 'API',
    transportMode: 'relay',
    ...overrides,
  };
}

describe('classify — transport', () => {
  it('classifies local SMTP rejection as SMTP_SEND_FAILED / ENVIRONMENT', () => {
    const r = classify(input({ smtpStatus: 'REJECTED' }));
    expect(r.category).toBe('SMTP_SEND_FAILED');
    expect(r.attribution).toBe('ENVIRONMENT');
  });

  it('never blames the provider when SMTP was not attempted', () => {
    const r = classify(input({ smtpStatus: 'NOT_ATTEMPTED' }));
    expect(r.category).toBe('TEST_INFRASTRUCTURE_ERROR');
    expect(r.attribution).toBe('HARNESS');
  });
});

describe('classify — configuration and harness errors', () => {
  it('classifies missing configuration as CONFIGURATION_ERROR / HARNESS', () => {
    const r = classify(input({ adapterErrorCode: 'CONFIGURATION_ERROR' }));
    expect(r.category).toBe('CONFIGURATION_ERROR');
    expect(r.attribution).toBe('HARNESS');
  });

  it('classifies a selector failure as UI_AUTOMATION_FAILED / HARNESS', () => {
    const r = classify(input({ adapterErrorCode: 'UI_AUTOMATION_FAILED', channel: 'UI' }));
    expect(r.category).toBe('UI_AUTOMATION_FAILED');
    expect(r.attribution).toBe('HARNESS');
  });
});

describe('classify — provider availability', () => {
  it('classifies an unreachable provider as PROVIDER_UNAVAILABLE', () => {
    const r = classify(input({ providerReachable: false }));
    expect(r.category).toBe('PROVIDER_UNAVAILABLE');
    expect(r.attribution).toBe('PROVIDER');
  });

  it('classifies throttling as PROVIDER_RATE_LIMITED', () => {
    const r = classify(input({ rateLimited: true }));
    expect(r.category).toBe('PROVIDER_RATE_LIMITED');
    expect(r.attribution).toBe('PROVIDER');
  });
});

describe('classify — detection and content', () => {
  it('classifies a genuine miss as MESSAGE_NOT_DETECTED', () => {
    const r = classify(input({ detected: false, timeoutStatus: 'DETECTION_TIMEOUT' }));
    expect(r.category).toBe('MESSAGE_NOT_DETECTED');
    expect(r.attribution).toBe('PROVIDER');
  });

  it('classifies a transport timeout as infrastructure, not provider', () => {
    const r = classify(input({ detected: false, timeoutStatus: 'TRANSPORT_TIMEOUT' }));
    expect(r.category).toBe('TEST_INFRASTRUCTURE_ERROR');
    expect(r.attribution).toBe('ENVIRONMENT');
  });

  it('classifies unavailable content separately from non-detection', () => {
    const r = classify(input({ contentAvailable: false }));
    expect(r.category).toBe('MESSAGE_CONTENT_UNAVAILABLE');
    expect(r.attribution).toBe('PROVIDER');
  });

  it('classifies a wrong message match as a harness defect', () => {
    const r = classify(input({ wrongMessageMatched: true }));
    expect(r.category).toBe('WRONG_MESSAGE_MATCHED');
    expect(r.attribution).toBe('HARNESS');
  });
});

describe('classify — validation', () => {
  it('classifies a subject-only difference as SUBJECT_MISMATCH', () => {
    const r = classify(
      input({ contentValidationStatus: 'FAIL', validationDifferences: ['subject mismatch: expected x'] }),
    );
    expect(r.category).toBe('SUBJECT_MISMATCH');
  });

  it('classifies a body-only difference as BODY_MISMATCH', () => {
    const r = classify(
      input({ contentValidationStatus: 'FAIL', validationDifferences: ['body mismatch: not found'] }),
    );
    expect(r.category).toBe('BODY_MISMATCH');
  });

  it('classifies encoding damage as ENCODING_MISMATCH', () => {
    const r = classify(
      input({
        contentValidationStatus: 'FAIL',
        validationDifferences: ['subject mismatch: expected x', 'subject encoding damage detected'],
      }),
    );
    expect(r.category).toBe('ENCODING_MISMATCH');
  });
});

describe('classify — transport mode attribution', () => {
  it('never blames the provider for a loopback non-detection', () => {
    const r = classify(input({ detected: false, timeoutStatus: 'DETECTION_TIMEOUT', transportMode: 'loopback' }));
    expect(r.category).toBe('MESSAGE_NOT_DETECTED');
    expect(r.attribution).toBe('HARNESS');
  });

  it('blames the provider for a non-detection over a real transport', () => {
    const r = classify(input({ detected: false, timeoutStatus: 'DETECTION_TIMEOUT', transportMode: 'relay' }));
    expect(r.category).toBe('MESSAGE_NOT_DETECTED');
    expect(r.attribution).toBe('PROVIDER');
  });

  it('still reports a successful loopback detection as detected', () => {
    // The loopback rule only applies when nothing was detected.
    const r = classify(
      input({ detected: true, contentAvailable: false, transportMode: 'loopback' }),
    );
    expect(r.category).toBe('MESSAGE_CONTENT_UNAVAILABLE');
    expect(r.attribution).toBe('PROVIDER');
  });
});

describe('classify — passes are not classified', () => {
  it('throws when asked to classify a passing sample', () => {
    expect(() => classify(input({}))).toThrowError(/passing sample/);
  });
});
