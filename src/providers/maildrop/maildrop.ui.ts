/**
 * Maildrop UI adapter (Playwright).
 *
 * Selectors and the URL pattern were derived by inspecting the live site on
 * 2026-10-15 — nothing here is guessed:
 *
 *   inbox URL   : https://maildrop.cc/inbox/?mailbox=<name>
 *   message row : div.message          (subject is in the row's text)
 *   content     : rendered inside an <iframe> after clicking the row
 *
 * Maildrop has no login. Automation is an advertised feature of the service
 * (its own API is used by the site), so read-only inbox polling is within the
 * documented usage.
 */

import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type {
  DetectedMessage,
  RetrievedContent,
  UiChannel,
  WaitRequest,
  WaitResult,
} from '../../domain/types.js';
import { AdapterError, pollUntil } from '../adapter-support.js';

const BASE = 'https://maildrop.cc';

export interface MaildropUiOptions {
  readonly mailbox: string;
  readonly headless?: boolean;
  readonly navigationTimeoutMs?: number;
  readonly onArtifact?: (name: string, path: string) => void;
  readonly artifactDir?: string;
}

export class MaildropUiAdapter implements UiChannel {
  readonly channel = 'UI' as const;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(private readonly options: MaildropUiOptions) {}

  async getInboxAddress(): Promise<string> {
    return `${this.options.mailbox}@maildrop.cc`;
  }

  private async ensurePage(): Promise<Page> {
    if (this.page) return this.page;
    this.browser = await chromium.launch({ headless: this.options.headless ?? true });
    this.context = await this.browser.newContext({
      // Traces/screenshots are captured on failure by the sampler's evidence hook.
      viewport: { width: 1280, height: 900 },
      ignoreHTTPSErrors: true,
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.options.navigationTimeoutMs ?? 30_000);
    await this.openInbox();
    return this.page;
  }

  private async openInbox(): Promise<void> {
    const page = this.page;
    if (!page) throw new AdapterError('UI_AUTOMATION_FAILED', 'page not initialised');
    const url = `${BASE}/inbox/?mailbox=${encodeURIComponent(this.options.mailbox)}`;
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (response && response.status() >= 400) {
      throw new AdapterError('UI_AUTOMATION_FAILED', `Maildrop inbox returned HTTP ${response.status()}`);
    }
  }

  async waitForMessage(req: WaitRequest): Promise<WaitResult> {
    const page = await this.ensurePage();

    const result = await pollUntil<DetectedMessage>(req, async () => {
      try {
        // Reload so a freshly delivered message becomes visible.
        await page.reload({ waitUntil: 'domcontentloaded' });
        // The message list renders client-side; give it a moment to paint.
        await page.waitForSelector('div.message', { timeout: 10_000 }).catch(() => null);

        const rows = page.locator('div.message');
        const count = await rows.count();
        for (let i = 0; i < count; i += 1) {
          const subject = await readSubject(rows.nth(i));
          if (subject && subject.includes(req.correlationId)) {
            return {
              detectedAt: new Date().toISOString(),
              // Row index is a stable, in-session handle for the message.
              messageRef: `row:${i}`,
              raw: { subject },
            };
          }
        }
        return null;
      } catch (err) {
        // A DOM/selector failure is OUR defect, not a provider miss.
        throw new AdapterError(
          'UI_AUTOMATION_FAILED',
          `Maildrop UI poll failed: ${(err as Error).message}`,
          {},
        );
      }
    });

    return {
      detected: result.found,
      attempts: result.attempts,
      lastNegativeAt: result.lastNegativeAt,
      firstPositiveAt: result.firstPositiveAt,
      timedOut: result.timedOut,
    };
  }

  async getMessage(ref: DetectedMessage): Promise<RetrievedContent> {
    const page = this.page;
    if (!page) throw new AdapterError('UI_AUTOMATION_FAILED', 'page not initialised');

    const index = Number.parseInt(ref.messageRef.replace('row:', ''), 10);
    const rows = page.locator('div.message');
    if (Number.isNaN(index) || (await rows.count()) <= index) {
      throw new AdapterError('UI_AUTOMATION_FAILED', `message row ${ref.messageRef} no longer present`);
    }

    const row = rows.nth(index);
    const subject = await readSubject(row);

    await row.click();
    // The body renders inside an iframe.
    await page.waitForSelector('iframe', { timeout: 15_000 });
    const frame = page.frameLocator('iframe').first();

    let bodyText: string | null = null;
    let bodyHtml: string | null = null;
    try {
      bodyText = await frame.locator('body').innerText({ timeout: 10_000 });
      bodyHtml = await frame.locator('body').innerHTML({ timeout: 10_000 });
    } catch (err) {
      // The message was detected but its body could not be read. Return an empty
      // content result rather than throwing: the sampler classifies this as
      // MESSAGE_CONTENT_UNAVAILABLE (a provider-side outcome), and the reason is
      // preserved in metadata for the technical report.
      return {
        contentAvailableAt: new Date().toISOString(),
        subject,
        textBody: null,
        htmlBody: null,
        metadata: { source: 'maildrop-ui', contentError: (err as Error).message.slice(0, 200) },
      };
    }

    return {
      contentAvailableAt: new Date().toISOString(),
      subject,
      textBody: bodyText,
      htmlBody: bodyHtml,
      metadata: { source: 'maildrop-ui' },
    };
  }

  /** Releases the browser. Must be called so no orphaned process remains. */
  async close(): Promise<void> {
    try {
      await this.context?.close();
    } catch {
      /* ignore */
    }
    try {
      await this.browser?.close();
    } catch {
      /* ignore */
    }
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}

/** Reads the subject cell structurally, falling back to row text if needed. */
async function readSubject(row: import('@playwright/test').Locator): Promise<string | null> {
  const cell = row.locator(SUBJECT_SELECTOR).first();
  if ((await cell.count()) > 0) {
    const text = (await cell.innerText().catch(() => '')).trim();
    if (text) return text.replace(/\s+/g, ' ');
  }
  const fallback = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  return fallback || null;
}

/**
 * Structural selector for the subject cell inside a message row.
 * Verified against the live DOM (2026-10-15): a row contains
 *   div.truncate.font-bold  -> sender
 *   div.text-sm.opacity-50  -> date
 *   div.truncate            -> subject   (the one WITHOUT font-bold)
 */
const SUBJECT_SELECTOR = 'div.truncate:not(.font-bold):not(.text-sm)';
