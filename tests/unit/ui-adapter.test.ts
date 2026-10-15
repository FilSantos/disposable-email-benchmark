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

const guerrillaSource = readFileSync(
  new URL('../../src/providers/guerrillamail/guerrillamail.ui.ts', import.meta.url),
  'utf8',
);

describe('Guerrilla Mail UI adapter — verified assumptions', () => {
  it('reads the subject from the anchor inside td3, not the whole cell', () => {
    // td3 also contains span.email-excerpt (a body preview). Reading the cell
    // produced a false SUBJECT_MISMATCH before this was fixed.
    expect(guerrillaSource).toContain('td.td3 a.masked_links');
    expect(guerrillaSource).toContain('email-excerpt');
  });

  it('clicks the subject anchor rather than the row (which contains a checkbox)', () => {
    expect(guerrillaSource).toContain('await anchor.first().click()');
  });

  it('returns to the inbox before polling, because opening a message hides the table', () => {
    // Regression: without this, later row clicks failed with "element is not visible".
    expect(guerrillaSource).toContain('returnToInbox');
    expect(guerrillaSource).toContain('Back to inbox');
  });

  it('waits for #display_email to populate instead of a fixed sleep', () => {
    expect(guerrillaSource).toContain('deadline');
    expect(guerrillaSource).toContain('#display_email');
  });

  it('rate-limits polling to respect the ToS "no over-use" obligation', () => {
    expect(guerrillaSource).toContain('this.limiter.acquire()');
  });

  it('reads the assigned address from #inbox-id', () => {
    expect(guerrillaSource).toContain('#inbox-id');
  });
});

const mailinatorSource = readFileSync(
  new URL('../../src/providers/mailinator/mailinator.ui.ts', import.meta.url),
  'utf8',
);

describe('Mailinator UI adapter — verified assumptions', () => {
  it('uses the documented public inbox URL pattern', () => {
    expect(mailinatorSource).toContain('inboxes.jsp?to=');
  });

  it('targets the message table classes observed in the live DOM', () => {
    expect(mailinatorSource).toContain('table.table-striped');
    expect(mailinatorSource).toContain('jambo_table');
  });

  it('reads the subject from the third cell (checkbox, from, subject, received)', () => {
    expect(mailinatorSource).toContain('SUBJECT_CELL_INDEX = 2');
  });

  it('reads bodies from the named message frames, not a guessed iframe', () => {
    expect(mailinatorSource).toContain('html_msg_body');
    expect(mailinatorSource).toContain('texthtml_msg_body');
  });

  it('treats an empty string body as unavailable, not as content', () => {
    expect(mailinatorSource).toContain('usableText');
  });

  it('releases the browser via close()', () => {
    expect(mailinatorSource).toContain('async close(): Promise<void>');
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
    // 10 Minute Mail has an active bot challenge and no UI adapter.
    for (const id of ['tenminutemail']) {
      const entry = registry.find((r) => r.adapter.id === id);
      expect(entry?.adapter.ui).toBeUndefined();
    }
  });

  it('keeps YOPmail UI opt-in because the policy question is unresolved', async () => {
    const { buildRegistry } = await import('../../src/providers/registry.js');
    const { loadConfig } = await import('../../src/config/config.js');
    const config = loadConfig();

    const off = buildRegistry(config);
    const yopOff = off.find((r) => r.adapter.id === 'yopmail');
    expect(yopOff?.adapter.ui).toBeDefined();
    expect(yopOff?.executableChannels).toEqual([]); // not executed by default

    const on = buildRegistry(config, { enableYopmailUi: true });
    const yopOn = on.find((r) => r.adapter.id === 'yopmail');
    expect(yopOn?.executableChannels).toEqual(['UI']);
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
