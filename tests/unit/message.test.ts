import { describe, it, expect } from 'vitest';
import { generateMessage, generateSimilarPair, buildCorrelationId } from '../../src/smtp/message.js';

const base = { runId: 'run1', from: 'bench@ebm.local', to: 'box@maildrop.cc' };

describe('correlation identifiers', () => {
  it('are unique across calls', () => {
    const a = buildCorrelationId('run1', 's1');
    const b = buildCorrelationId('run1', 's1');
    expect(a).not.toBe(b);
  });

  it('embed the run and sample identifiers for traceability', () => {
    const id = buildCorrelationId('run1', 's1');
    expect(id).toContain('run1');
    expect(id).toContain('s1');
  });
});

describe('generateMessage', () => {
  it('places the correlation id in the subject and the body', () => {
    const msg = generateMessage({ ...base, sampleId: 's1', scenario: 'ascii' });
    expect(msg.subject).toContain(msg.correlationId);
    expect(msg.text).toContain(msg.correlationId);
    expect(msg.expectedSubject).toBe(msg.subject);
    expect(msg.expectedText).toBe(msg.text);
  });

  it('produces a unique Message-ID and correlation header', () => {
    const a = generateMessage({ ...base, sampleId: 's1', scenario: 'ascii' });
    const b = generateMessage({ ...base, sampleId: 's2', scenario: 'ascii' });
    expect(a.messageId).not.toBe(b.messageId);
    expect(a.headers['X-EBM-Correlation-Id']).toBe(a.correlationId);
  });

  it('does not rely on the subject alone as an identifier', () => {
    // Two messages with the same marker/scenario still differ by correlation id.
    const a = generateMessage({ ...base, sampleId: 's1', scenario: 'similar', marker: 'M' });
    const b = generateMessage({ ...base, sampleId: 's2', scenario: 'similar', marker: 'M' });
    expect(a.subject).not.toBe(b.subject);
  });

  it('includes HTML only for the html scenario', () => {
    const plain = generateMessage({ ...base, sampleId: 's1', scenario: 'ascii' });
    const html = generateMessage({ ...base, sampleId: 's2', scenario: 'html' });
    expect(plain.expectedHtml).toBeNull();
    expect(plain.html).toBeUndefined();
    expect(html.expectedHtml).toContain('<html>');
  });

  it('produces non-ASCII content for the utf8 scenario', () => {
    const msg = generateMessage({ ...base, sampleId: 's1', scenario: 'utf8' });
    expect(msg.text).toMatch(/[^\u0000-\u007F]/);
  });

  it('produces a long body for the long scenario', () => {
    const msg = generateMessage({ ...base, sampleId: 's1', scenario: 'long' });
    expect(msg.text.length).toBeGreaterThan(1000);
  });

  it('persists the expected content for later comparison', () => {
    const msg = generateMessage({ ...base, sampleId: 's1', scenario: 'ascii' });
    expect(msg.expectedSubject.length).toBeGreaterThan(0);
    expect(msg.expectedText.length).toBeGreaterThan(0);
  });
});

describe('generateSimilarPair', () => {
  it('creates two messages that differ only by correlation identity', () => {
    const { decoy, target } = generateSimilarPair({ ...base, sampleId: 's1' });
    expect(decoy.correlationId).not.toBe(target.correlationId);
    expect(decoy.subject).not.toBe(target.subject);
    // A decoy can never satisfy the target assertion.
    expect(target.expectedSubject).not.toContain(decoy.correlationId);
  });
});
