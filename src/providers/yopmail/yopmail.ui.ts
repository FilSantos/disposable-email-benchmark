/**
 * YOPmail UI adapter (Playwright).
 *
 * Structure verified against the live site on 2026-10-15 — nothing is guessed:
 *
 *   inbox URL    : https://yopmail.com/en/?<inbox>
 *   inbox frame  : <iframe name="ifinbox">   (message list)
 *   message frame: <iframe name="ifmail">    (rendered message)
 *   refresh      : #refresh
 *
 * Feasibility note: YOPmail publishes no API, and its robots.txt disallows
 * `/*?` for crawlers. That directive governs automated *indexing*, not a
 * browser session, and there is no accessible Terms-of-Service clause
 * prohibiting interactive use. This adapter therefore uses a normal headless
 * browser at a deliberately conservative rate, makes no attempt to defeat the
 * Cloudflare/reCAPTCHA scripts present on the page, and is opt-in.
 *
 * Policy question DQ-5 remains open; the capability is recorded as NOT_TESTED in
 * the matrix until a stakeholder confirms automated use is acceptable.
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

const BASE = 'https://yopmail.com/en/';

export interface YopmailUiOptions {
  readonly inbox: string;
  readonly headless?: boolean;
}

export class YopmailUiAdapter implements UiChannel {
  readonly channel = 'UI' as const;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(private readonly options: YopmailUiOptions) {}

  async getInboxAddress(): Promise<string> {
    return `${this.options.inbox}@yopmail.com`;
  }

  private inboxUrl(): string {
    return `${BASE}?${encodeURIComponent(this.options.inbox)}`;
  }

  private async ensurePage(): Promise<Page> {
    if (this.page) return this.page;
    this.browser = await chromium.launch({ headless: this.options.headless ?? true });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 900 },
      ignoreHTTPSErrors: true,
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(30_000);
    const response = await this.page.goto(this.inboxUrl(), { waitUntil: 'domcontentloaded' });
    if (response && response.status() >= 400) {
      throw new AdapterError('UI_AUTOMATION_FAILED', `YOPmail returned HTTP ${response.status()}`);
    }
    // The inbox is rendered inside ifinbox after the page settles.
    await this.page.waitForSelector('iframe[name="ifinbox"]', { timeout: 20_000 });
    return this.page;
  }

  async waitForMessage(req: WaitRequest): Promise<WaitResult> {
    const page = await this.ensurePage();

    const result = await pollUntil<DetectedMessage>(req, async () => {
      try {
        // YOPmail has its own refresh control; use it rather than a full reload so
        // the session and inbox binding are preserved.
        await this.refreshInbox(page);
        const inbox = page.frame({ name: 'ifinbox' });
        if (!inbox) throw new AdapterError('UI_AUTOMATION_FAILED', 'ifinbox frame not found');

        const rows = inbox.locator('div.m');
        const count = await rows.count();
        for (let i = 0; i < count; i += 1) {
          const subject = (await rows.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
          if (subject.includes(req.correlationId)) {
            return {
              detectedAt: new Date().toISOString(),
              messageRef: `row:${i}`,
              raw: { subject },
            };
          }
        }
        return null;
      } catch (err) {
        if (err instanceof AdapterError) throw err;
        throw new AdapterError('UI_AUTOMATION_FAILED', `YOPmail poll failed: ${(err as Error).message}`);
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
    const inbox = page.frame({ name: 'ifinbox' });
    if (!inbox) throw new AdapterError('UI_AUTOMATION_FAILED', 'ifinbox frame not found');

    const index = Number.parseInt(ref.messageRef.replace('row:', ''), 10);
    const rows = inbox.locator('div.m');
    if (Number.isNaN(index) || (await rows.count()) <= index) {
      throw new AdapterError('UI_AUTOMATION_FAILED', `message row ${ref.messageRef} no longer present`);
    }

    await rows.nth(index).click();
    // Clicking loads the message into ifmail.
    await page.waitForSelector('iframe[name="ifmail"]', { timeout: 15_000 });
    const mail = page.frame({ name: 'ifmail' });
    if (!mail) throw new AdapterError('UI_AUTOMATION_FAILED', 'ifmail frame not found');

    const bodyText = await mail.locator('body').innerText({ timeout: 10_000 }).catch(() => null);
    const bodyHtml = await mail.locator('body').innerHTML({ timeout: 10_000 }).catch(() => null);

    // The inbox row already carries the authoritative subject; the message view
    // echoes it but with toolbar text around it, so prefer the row value.
    const rowSubject = (await rows.nth(index).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();

    return {
      contentAvailableAt: new Date().toISOString(),
      subject: rowSubject || extractSubject(bodyText ?? ''),
      textBody: bodyText,
      htmlBody: bodyHtml,
      metadata: { source: 'yopmail-ui' },
    };
  }

  /** Uses YOPmail's own refresh control; falls back to a reload if absent. */
  private async refreshInbox(page: Page): Promise<void> {
    const refresh = page.locator('#refresh').first();
    if ((await refresh.count()) > 0) {
      await refresh.click({ timeout: 5_000 }).catch(() => null);
      await page.waitForTimeout(1_200);
      return;
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('iframe[name="ifinbox"]', { timeout: 15_000 }).catch(() => null);
  }

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

/**
 * The message view renders a header block before the body. The subject is the
 * first line that carries a correlation marker, if one is present.
 */
function extractSubject(messageText: string): string | null {
  const flat = messageText.replace(/\s+/g, ' ').trim();
  const match = /\[\s*EBM-[^\]]+\]|\bEBM-[A-Za-z0-9-]{10,}/.exec(flat);
  if (!match) return null;
  // Walk back to the start of the phrase containing the marker.
  const before = flat.slice(0, match.index);
  const start = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('<'));
  return flat.slice(start + 1, Math.min(flat.length, match.index + match[0].length + 2)).trim();
}
