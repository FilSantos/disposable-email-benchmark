import { test, expect } from '@playwright/test';
import { MaildropUiAdapter } from '../../src/providers/maildrop/maildrop.ui.js';

/**
 * External provider UI test — OPT-IN.
 *
 * Hits the live maildrop.cc site. Excluded from the deterministic unit and
 * integration suites (`vitest.config.ts` excludes tests/e2e). Run with:
 *
 *   EBM_E2E=1 npx playwright test
 *
 * The mailbox must already contain a message whose subject carries the
 * correlation id below, so this is a structural smoke test of the adapter
 * against the real DOM, not a delivery test.
 */

const MAILBOX = process.env['EBM_E2E_MAILBOX'] ?? 'ebm-1d09649f-910';
const CORRELATION = process.env['EBM_E2E_CORRELATION'] ?? 'EBM-real-maildrop';

test.describe('Maildrop UI adapter against the live site', () => {
  test.skip(process.env['EBM_E2E'] !== '1', 'set EBM_E2E=1 to run external provider UI tests');

  test('opens the inbox, detects a message and reads its content', async () => {
    const adapter = new MaildropUiAdapter({ mailbox: MAILBOX, headless: true });
    try {
      const address = await adapter.getInboxAddress();
      expect(address).toBe(`${MAILBOX}@maildrop.cc`);

      const result = await adapter.waitForMessage({
        inbox: address,
        correlationId: CORRELATION,
        timeoutMs: 60_000,
        pollIntervalMs: 3_000,
      });

      expect(result.detected).not.toBeNull();
      expect(result.detected?.messageRef).toMatch(/^row:\d+$/);

      const content = await adapter.getMessage(result.detected!);
      expect(content.subject).toBeTruthy();
      expect(content.subject).toContain(CORRELATION);
      expect(content.textBody).toBeTruthy();
      expect(content.textBody).toContain(CORRELATION);
    } finally {
      // Must always release the browser; an orphan would fail the run.
      await adapter.close();
    }
  });
});
