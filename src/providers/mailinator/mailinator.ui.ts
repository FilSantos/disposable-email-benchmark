/**
 * Mailinator UI adapter (Playwright).
 *
 * Selectors were derived from the live public inbox on 2026-10-15 — nothing is
 * guessed:
 *
 *   inbox URL    : https://www.mailinator.com/v4/public/inboxes.jsp?to=<inbox>
 *   inbox input  : #inbox_field  (with the adjacent GO control)
 *   message table: table.table-striped / table.jambo_table
 *   row cells    : [0] checkbox, [1] from, [2] subject, [3] received
 *   message body : <iframe name="html_msg_body"> and
 *                  <iframe name="texthtml_msg_body">
 *
 * Mailinator's public inboxes require no account. API automation is explicitly
 * sanctioned by the vendor, and its documentation positions the platform for QA
 * testing, so read-only inbox polling is within documented usage.
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

const BASE = 'https://www.mailinator.com/v4/public/inboxes.jsp';
const MESSAGE_TABLE = 'table.table-striped, table.jambo_table';
const SUBJECT_CELL_INDEX = 2;
const HTML_BODY_FRAME = 'iframe[name="html_msg_body"], iframe[name="texthtml_msg_body"], iframe';

export interface MailinatorUiOptions {
  readonly inbox: string;
  readonly headless?: boolean;
  /** Optional login overlay dismissal is NOT attempted: no credentials are used. */
}

export class MailinatorUiAdapter implements UiChannel {
  readonly channel = 'UI' as const;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(private readonly options: MailinatorUiOptions) {}

  async getInboxAddress(): Promise<string> {
    return `${this.options.inbox}@mailinator.com`;
  }

  private inboxUrl(): string {
    return `${BASE}?to=${encodeURIComponent(this.options.inbox)}`;
  }

  private async ensurePage(): Promise<Page> {
    if (this.page) return this.page;
    this.browser = await chromium.launch({ headless: this.options.headless ?? true });
    this.context = await this.browser.newContext({
      viewport: { width: 1400, height: 950 },
      ignoreHTTPSErrors: true,
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(30_000);
    const response = await this.page.goto(this.inboxUrl(), { waitUntil: 'domcontentloaded' });
    if (response && response.status() >= 400) {
      throw new AdapterError(
        'UI_AUTOMATION_FAILED',
        `Mailinator inbox returned HTTP ${response.status()}`,
      );
    }
    return this.page;
  }

  async waitForMessage(req: WaitRequest): Promise<WaitResult> {
    const page = await this.ensurePage();

    const result = await pollUntil<DetectedMessage>(req, async () => {
      try {
        // A fresh load guarantees newly delivered messages are listed.
        await page.goto(this.inboxUrl(), { waitUntil: 'domcontentloaded' });
        await Promise.race([
          page.waitForSelector(`${MESSAGE_TABLE} tbody tr`, { timeout: 12_000 }),
          page.waitForSelector('text=Currently Empty', { timeout: 12_000 }),
        ]).catch(() => null);

        const rows = page.locator(`${MESSAGE_TABLE} tbody tr`);
        const count = await rows.count();
        for (let i = 0; i < count; i += 1) {
          const subject = await this.readSubject(rows.nth(i));
          if (subject && subject.includes(req.correlationId)) {
            return {
              detectedAt: new Date().toISOString(),
              messageRef: `row:${i}`,
              raw: { subject },
            };
          }
        }
        return null;
      } catch (err) {
        throw new AdapterError(
          'UI_AUTOMATION_FAILED',
          `Mailinator UI poll failed: ${(err as Error).message}`,
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
    const rows = page.locator(`${MESSAGE_TABLE} tbody tr`);
    if (Number.isNaN(index) || (await rows.count()) <= index) {
      throw new AdapterError('UI_AUTOMATION_FAILED', `message row ${ref.messageRef} no longer present`);
    }

    const row = rows.nth(index);
    const subject = await this.readSubject(row);
    const metadata: Record<string, string> = { source: 'mailinator-ui' };
    const sender = (await row.locator('td').nth(1).innerText().catch(() => '')).trim();
    if (sender) metadata['from'] = sender;

    await row.click();
    await page.waitForSelector(HTML_BODY_FRAME, { timeout: 15_000 });

    // Mailinator renders the message into two named frames: HTML and text.
    const htmlFrame = page.frameLocator('iframe[name="html_msg_body"]').first();
    const textFrame = page.frameLocator('iframe[name="texthtml_msg_body"]').first();

    const htmlBody = await htmlFrame.locator('body').innerHTML({ timeout: 10_000 }).catch(() => null);
    const textBody = await textFrame.locator('body').innerText({ timeout: 10_000 }).catch(() => null);

    // An empty string is as unusable as null, so treat both as "no text body".
    const usableText = textBody && textBody.trim().length > 0 ? textBody : null;
    const usableHtml = htmlBody && htmlBody.trim().length > 0 ? htmlBody : null;

    if (usableText === null && usableHtml === null) {
      // Detected but unreadable: a provider-side outcome, not a harness crash.
      return {
        contentAvailableAt: new Date().toISOString(),
        subject,
        textBody: null,
        htmlBody: null,
        metadata: { ...metadata, contentError: 'message frames contained no readable body' },
      };
    }

    return {
      contentAvailableAt: new Date().toISOString(),
      subject,
      // Prefer the dedicated text frame; fall back to the HTML body (which the
      // validator can strip) so a plain-text-only message is still comparable.
      textBody: usableText ?? usableHtml,
      htmlBody: usableHtml,
      metadata,
    };
  }

  /** Subject lives in the third cell; read it structurally, not by parsing row text. */
  private async readSubject(row: import('@playwright/test').Locator): Promise<string | null> {
    const cell = row.locator('td').nth(SUBJECT_CELL_INDEX);
    if ((await cell.count()) > 0) {
      const text = (await cell.innerText().catch(() => '')).trim();
      if (text) return text.replace(/\s+/g, ' ');
    }
    const fallback = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    return fallback || null;
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
