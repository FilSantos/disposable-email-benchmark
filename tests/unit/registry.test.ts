import { describe, it, expect } from 'vitest';
import { buildRegistry, getAdapter } from '../../src/providers/registry.js';
import { loadConfig } from '../../src/config/config.js';
import { createMailinatorAdapter } from '../../src/providers/mailinator/mailinator.api.js';

function baseConfig() {
  return loadConfig();
}

describe('registry — capability gating', () => {
  it('executes only providers with a usable channel', () => {
    const registry = buildRegistry(baseConfig());
    const byId = Object.fromEntries(registry.map((r) => [r.adapter.id, r]));

    // Maildrop exposes both an authorised API and an authorised UI.
    expect(byId['maildrop']?.executableChannels).toEqual(['API', 'UI']);
    // Guerrilla Mail exposes a documented API and a verified-automatable UI.
    expect(byId['guerrillamail']?.executableChannels).toEqual(['API', 'UI']);
    // No token → the Mailinator API is CONFIGURATION_REQUIRED, but its public
    // UI needs no account, so the UI channel remains executable.
    expect(byId['mailinator']?.executableChannels).toEqual(['UI']);
    // No API and blocked/unverified UI → nothing to execute.
    expect(byId['yopmail']?.executableChannels).toEqual([]);
    expect(byId['tenminutemail']?.executableChannels).toEqual([]);
  });

  it('never attaches an API channel to providers without an authorized API', () => {
    const registry = buildRegistry(baseConfig());
    for (const id of ['yopmail', 'tenminutemail']) {
      const entry = registry.find((r) => r.adapter.id === id);
      expect(entry?.adapter.api).toBeUndefined();
      expect(entry?.adapter.capabilities().officialApi.state).toBe('NOT_SUPPORTED');
    }
  });

  it('exposes exactly the five benchmarked providers', () => {
    const registry = buildRegistry(baseConfig());
    expect(registry.map((r) => r.adapter.id).sort()).toEqual([
      'guerrillamail',
      'maildrop',
      'mailinator',
      'tenminutemail',
      'yopmail',
    ]);
  });
});

describe('Mailinator adapter — configuration gating', () => {
  it('has no API channel when no token is supplied', () => {
    const adapter = createMailinatorAdapter({ token: null });
    expect(adapter.api).toBeUndefined();
    expect(adapter.capabilities().apiConfiguration.state).toBe('CONFIGURATION_REQUIRED');
  });

  it('has an API channel when a token is supplied, and reports configured', () => {
    const adapter = createMailinatorAdapter({ token: 'fake-token-for-test' });
    expect(adapter.api).toBeDefined();
    expect(adapter.api?.isConfigured()).toBe(true);
  });

  it('exposes the inbox address without calling the network', async () => {
    const adapter = createMailinatorAdapter({ token: 'fake-token-for-test', inbox: 'fixed' });
    await expect(adapter.api?.getInboxAddress()).resolves.toBe('fixed@mailinator.com');
  });
});

describe('getAdapter', () => {
  it('resolves a known provider', () => {
    expect(getAdapter('maildrop', baseConfig())?.id).toBe('maildrop');
  });

  it('returns undefined for an unknown provider instead of throwing', () => {
    expect(getAdapter('not-a-provider', baseConfig())).toBeUndefined();
  });
});
