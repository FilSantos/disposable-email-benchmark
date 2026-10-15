import { describe, it, expect } from 'vitest';
import { CAPABILITY_STATES, FAILURE_CATEGORIES } from '../../src/domain/types.js';
import {
  PROVIDER_CAPABILITIES,
  getCapabilityEntry,
  apiCandidates,
  uiCandidates,
} from '../../src/providers/capabilities.js';

describe('capability matrix integrity', () => {
  it('uses only the six allowed capability states', () => {
    for (const provider of PROVIDER_CAPABILITIES) {
      for (const claim of Object.values(provider.capabilities)) {
        expect(CAPABILITY_STATES).toContain(claim.state);
      }
    }
  });

  it('requires a source URL for every DOCUMENTED claim', () => {
    for (const provider of PROVIDER_CAPABILITIES) {
      for (const [key, claim] of Object.entries(provider.capabilities)) {
        if (claim.evidence === 'DOCUMENTED') {
          expect(claim.sourceUrl, `${provider.id}.${key} is DOCUMENTED but has no sourceUrl`).toBeTruthy();
        }
      }
    }
  });

  it('records a verification date on every claim', () => {
    for (const provider of PROVIDER_CAPABILITIES) {
      for (const claim of Object.values(provider.capabilities)) {
        expect(claim.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('covers exactly the five benchmarked providers', () => {
    expect(PROVIDER_CAPABILITIES.map((p) => p.id).sort()).toEqual([
      'guerrillamail',
      'maildrop',
      'mailinator',
      'tenminutemail',
      'yopmail',
    ]);
  });

  it('does not present a documented absence as a failure', () => {
    const yop = getCapabilityEntry('yopmail');
    expect(yop?.capabilities.officialApi.state).toBe('NOT_SUPPORTED');
    expect(yop?.capabilities.officialApi.evidence).toBe('DOCUMENTED');

    const ten = getCapabilityEntry('tenminutemail');
    expect(ten?.capabilities.uiAutomation.state).toBe('BLOCKED_BY_PROVIDER');
    expect(ten?.capabilities.uiAutomation.evidence).toBe('OBSERVED');
  });

  it('lists API candidates as only providers with a documented SUPPORTED API', () => {
    expect([...apiCandidates()].sort()).toEqual(['guerrillamail', 'maildrop', 'mailinator']);
  });

  it('lists UI candidates as only providers with SUPPORTED UI automation', () => {
    // 10 Minute Mail is BLOCKED (Cloudflare) and YOPmail is BLOCKED (Turnstile).
    // Guerrilla Mail's UI was verified automatable on 2026-10-15 (no CAPTCHA).
    expect([...uiCandidates()].sort()).toEqual(['guerrillamail', 'maildrop', 'mailinator']);
  });

  it('records YOPmail UI automation as BLOCKED_BY_PROVIDER, not a delivery failure', () => {
    const yop = getCapabilityEntry('yopmail');
    expect(yop?.capabilities.uiAutomation.state).toBe('BLOCKED_BY_PROVIDER');
    expect(yop?.capabilities.uiAutomation.evidence).toBe('OBSERVED');
  });
});

describe('failure taxonomy integrity', () => {
  it('contains exactly the 13 required categories', () => {
    expect(FAILURE_CATEGORIES).toHaveLength(13);
    expect(new Set(FAILURE_CATEGORIES).size).toBe(13);
  });

  it('matches the frozen category names', () => {
    expect([...FAILURE_CATEGORIES]).toEqual([
      'SMTP_SEND_FAILED',
      'MESSAGE_NOT_DETECTED',
      'MESSAGE_CONTENT_UNAVAILABLE',
      'SUBJECT_MISMATCH',
      'BODY_MISMATCH',
      'ENCODING_MISMATCH',
      'WRONG_MESSAGE_MATCHED',
      'UI_AUTOMATION_FAILED',
      'API_REQUEST_FAILED',
      'PROVIDER_RATE_LIMITED',
      'PROVIDER_UNAVAILABLE',
      'CONFIGURATION_ERROR',
      'TEST_INFRASTRUCTURE_ERROR',
    ]);
  });
});
