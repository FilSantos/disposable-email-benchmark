import { describe, it, expect, beforeEach } from 'vitest';
import { validateContent } from '../../src/validation/validate.js';

const expected = {
  subject: 'EBM-BENCH ascii [EBM-run-1-s1-abc12345]',
  text: 'Hello synthetic world\nCorrelation: EBM-run-1-s1-abc12345',
  html: '<p>Hello synthetic world</p>',
};

const correlationId = 'EBM-run-1-s1-abc12345';
const recipient = 'box@maildrop.cc';

describe('validateContent — strict mode', () => {
  it('passes on exact content', () => {
    const r = validateContent({
      mode: 'strict',
      expected,
      actual: { subject: expected.subject, textBody: expected.text, htmlBody: expected.html },
      expectHtml: true,
      correlationId,
      recipient,
    });
    expect(r.status).toBe('PASS');
    expect(r.differences).toEqual([]);
    expect(r.appliedTransformations).toEqual([]);
  });

  it('passes on a plain-text-only message when no HTML was sent', () => {
    const plain = { subject: expected.subject, text: expected.text };
    const r = validateContent({
      mode: 'strict',
      expected: plain,
      actual: { subject: plain.subject, textBody: plain.text, htmlBody: null },
      correlationId,
      recipient,
    });
    expect(r.status).toBe('PASS');
  });

  it('preserves exact differences (no normalization applied)', () => {
    const r = validateContent({
      mode: 'strict',
      expected,
      actual: { subject: ` ${expected.subject} `, textBody: expected.text, htmlBody: null },
      correlationId,
      recipient,
    });
    expect(r.status).toBe('FAIL');
    expect(r.appliedTransformations).toEqual([]);
    expect(r.differences.some((d) => d.startsWith('subject mismatch'))).toBe(true);
  });
});

describe('validateContent — normalized mode', () => {
  it('tolerates whitespace and records the transformations used', () => {
    const r = validateContent({
      mode: 'normalized',
      expected,
      actual: {
        subject: `  ${expected.subject}  `,
        textBody: expected.text.replace(' ', '\n\t'),
        htmlBody: expected.html,
      },
      expectHtml: true,
      correlationId,
      recipient,
    });
    expect(r.status).toBe('PASS');
    expect(r.appliedTransformations).toContain('collapse-whitespace');
    expect(r.appliedTransformations).toContain('trim');
  });
});

describe('validateContent — content availability', () => {
  it('reports missing subject as a difference rather than a crash', () => {
    const r = validateContent({
      mode: 'strict',
      expected,
      actual: { subject: null, textBody: expected.text, htmlBody: null },
      correlationId,
      recipient,
    });
    expect(r.status).toBe('FAIL');
    expect(r.differences).toContain('subject: not available from provider');
  });

  it('does not require an HTML part when the message contained no HTML', () => {
    // Regression: expectHtml used to be derived from provider capability alone,
    // so a plain-text scenario demanded HTML that was never sent.
    const plain = { subject: expected.subject, text: expected.text };
    const r = validateContent({
      mode: 'strict',
      expected: plain,
      actual: { subject: plain.subject, textBody: plain.text, htmlBody: null },
      expectHtml: true,
      correlationId,
      recipient,
    });
    expect(r.status).toBe('PASS');
  });

  it('reports HTML as unavailable when HTML was sent but the provider returned none', () => {
    const r = validateContent({
      mode: 'strict',
      expected,
      actual: { subject: expected.subject, textBody: expected.text, htmlBody: null },
      expectHtml: true,
      correlationId,
      recipient,
    });
    expect(r.status).toBe('FAIL');
    expect(r.differences).toContain('html body not available from provider');
  });
});

describe('validateContent — encoding and correlation', () => {
  it('detects replacement characters as encoding damage', () => {
    const r = validateContent({
      mode: 'strict',
      expected: { subject: 'café', text: 'ação' },
      actual: { subject: 'caf\uFFFD', textBody: 'a\uFFFDo', htmlBody: null },
      correlationId: 'café',
      recipient,
    });
    expect(r.status).toBe('FAIL');
    expect(r.differences.some((d) => /encoding damage/.test(d))).toBe(true);
  });

  it('flags a missing correlation id even when other fields look plausible', () => {
    const r = validateContent({
      mode: 'strict',
      expected,
      actual: { subject: 'Different subject', textBody: 'Unrelated body', htmlBody: null },
      correlationId,
      recipient,
    });
    expect(r.status).toBe('FAIL');
    expect(r.correlationFoundInSubject).toBe(false);
    expect(r.correlationFoundInBody).toBe(false);
    expect(r.differences).toContain('correlation id not found in subject or body');
  });

  it('detects a recipient mismatch', () => {
    const r = validateContent({
      mode: 'strict',
      expected,
      actual: { subject: expected.subject, textBody: expected.text, htmlBody: null },
      correlationId,
      recipient,
      actualRecipient: 'someone-else@maildrop.cc',
    });
    expect(r.status).toBe('FAIL');
    expect(r.differences.some((d) => d.startsWith('recipient mismatch'))).toBe(true);
  });
});

describe('validateContent isolation', () => {
  beforeEach(() => {
    // guard: expectations must not leak between cases
    expect(correlationId).toBeTruthy();
  });

  it('exposes the correlation in both subject and body when present', () => {
    const r = validateContent({
      mode: 'strict',
      expected,
      actual: { subject: expected.subject, textBody: expected.text, htmlBody: null },
      correlationId,
      recipient,
    });
    expect(r.correlationFoundInSubject).toBe(true);
    expect(r.correlationFoundInBody).toBe(true);
  });
});
