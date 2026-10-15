import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The Maildrop UI adapter talks to a live site, so it is not unit-testable over
 * the network. What IS testable — and what has broken before — is the assumption
 * set it depends on: selectors and the inbox URL pattern. These tests fail loudly
 * if someone edits the adapter away from the verified structure.
 */
const source = readFileSync(
  new URL('../../src/providers/maildrop/maildrop.ui.ts', import.meta.url),
  'utf8',
);

describe('Maildrop UI adapter — verified assumptions', () => {
  it('uses the documented inbox URL pattern', () => {
    expect(source).toContain('/inbox/?mailbox=');
  });

  it('targets the message row class observed in the live DOM', () => {
    expect(source).toContain("div.message");
  });

  it('selects the subject cell structurally, excluding sender and date cells', () => {
    // Subject = div.truncate WITHOUT font-bold (sender) or text-sm (date).
    expect(source).toContain('div.truncate:not(.font-bold):not(.text-sm)');
  });

  it('reads message bodies from the iframe, which is where Maildrop renders them', () => {
    expect(source).toContain('frameLocator');
  });

  it('exposes close() so the browser can be released', () => {
    expect(source).toContain('async close(): Promise<void>');
  });

  it('classifies a DOM failure as UI_AUTOMATION_FAILED (a harness defect)', () => {
    expect(source).toContain("'UI_AUTOMATION_FAILED'");
  });

  it('disables headless=false by default so CI can run it', () => {
    expect(source).toContain('headless: this.options.headless ?? true');
  });
});

describe('registry — UI channel wiring', () => {
  it('attaches the UI adapter to Maildrop and marks the channel executable', async () => {
    const { buildRegistry } = await import('../../src/providers/registry.js');
    const { loadConfig } = await import('../../src/config/config.js');
    const registry = buildRegistry(loadConfig());
    const maildrop = registry.find((r) => r.adapter.id === 'maildrop');
    expect(maildrop?.adapter.ui).toBeDefined();
    expect(maildrop?.executableChannels).toContain('UI');
  });

  it('does not attach a UI adapter to providers without authorized UI automation', async () => {
    const { buildRegistry } = await import('../../src/providers/registry.js');
    const { loadConfig } = await import('../../src/config/config.js');
    const registry = buildRegistry(loadConfig());
    for (const id of ['guerrillamail', 'yopmail', 'tenminutemail']) {
      const entry = registry.find((r) => r.adapter.id === id);
      expect(entry?.adapter.ui).toBeUndefined();
    }
  });

  it('attaches a UI adapter to Mailinator, executable without an API token', async () => {
    const { buildRegistry } = await import('../../src/providers/registry.js');
    const { loadConfig } = await import('../../src/config/config.js');
    const registry = buildRegistry(loadConfig());
    const mailinator = registry.find((r) => r.adapter.id === 'mailinator');
    expect(mailinator?.adapter.ui).toBeDefined();
    expect(mailinator?.executableChannels).toContain('UI');
    // The API stays gated on a token.
    expect(mailinator?.adapter.api).toBeUndefined();
  });

  it('provides closeRegistry() so no browser is orphaned', async () => {
    const { buildRegistry, closeRegistry } = await import('../../src/providers/registry.js');
    const { loadConfig } = await import('../../src/config/config.js');
    const registry = buildRegistry(loadConfig());
    // No browsers have been launched, so this must resolve without throwing.
    await expect(closeRegistry(registry)).resolves.toBeUndefined();
  });
});
