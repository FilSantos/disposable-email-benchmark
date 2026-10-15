/**
 * Guerrilla Mail UI adapter (Playwright).
 *
 * Structure verified against the live site on 2026-10-15 — nothing is guessed:
 *
 *   homepage      : https://www.guerrillamail.com/
 *   address       : #inbox-id            (assigned on load)
 *   message table : #email_table         (cells: checkbox, from, subject, time)
 *   message body  : #display_email       (populated after clicking a row)
 *
 * Policy note: Guerrilla Mail's ToS prohibits *over-use* — "repeatedly making
 * many requests to our servers" — not automation as such. It has no CAPTCHA and
 * no bot challenge. This adapter therefore polls at a conservative interval
 * (comparable to a person checking their inbox), honours the same limiter as the
 * API channel, and performs only read operations. That keeps usage within the
 * stated terms rather than testing their limits.
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
import { RateLimiter } from '../rate-limit.js';

const HOME = 'https://www.guerrillamail.com/';

export interface GuerrillaMailUiOptions {
  readonly headless?: boolean;
  /**
   * Fixed inbox name. Guerrilla Mail assigns a random address on load, so when
   * this is unset the adapter adopts whatever the site assigned.
   */
  readonly inbox?: string;
  readonly limiter?: RateLimiter;
}

export class GuerrillaMailUiAdapter implements UiChannel {
  readonly channel = 'UI' as const;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private address: string | null = null;
  private readonly limiter: RateLimiter;

  constructor(private readonly options: GuerrillaMailUiOptions = {}) {
    this.limiter = options.limiter ?? RateLimiter.forProvider('guerrillamail');
  }

  async getInboxAddress(): Promise<string> {
    if (this.address) return this.address;
    const page = await this.ensurePage();
    const assigned = (await page.locator('#inbox-id').first().innerText().catch(() => '')).trim();
    if (!assigned) {
      throw new AdapterError('UI_AUTOMATION_FAILED', 'Guerrilla Mail did not display an inbox address');
    }
    this.address = assigned.includes('@') ? assigned : `${assigned}@guerrillamail.com`;
    return this.address;
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
    const response = await this.page.goto(HOME, { waitUntil: 'domcontentloaded' });
    if (response && response.status() >= 400) {
      throw new AdapterError('UI_AUTOMATION_FAILED', `Guerrilla Mail returned HTTP ${response.status()}`);
    }
    await this.page.waitForSelector('#email_table', { timeout: 25_000 });
    return this.page;
  }

  async waitForMessage(req: WaitRequest): Promise<WaitResult> {
    const page = await this.ensurePage();

    const result = await pollUntil<DetectedMessage>(req, async () => {
      // The rate limiter keeps polling within the ToS "no over-use" obligation.
      await this.limiter.acquire();
      try {
        await this.returnToInbox(page);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#email_table', { timeout: 15_000 }).catch(() => null);

        const rows = page.locator('#email_table tr');
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
          `Guerrilla Mail UI poll failed: ${(err as Error).message}`,
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
    const rows = page.locator('#email_table tr');
    if (Number.isNaN(index) || (await rows.count()) <= index) {
      throw new AdapterError('UI_AUTOMATION_FAILED', `message row ${ref.messageRef} no longer present`);
    }

    const row = rows.nth(index);
    const subject = await this.readSubject(row);

    // Click the subject anchor so we never hit the checkbox in td1 and never
    // accidentally select the wrong row. Fall back to the cell when absent.
    const anchor = row.locator('td.td3 a.masked_links');
    if ((await anchor.count()) > 0) {
      await anchor.first().click();
    } else {
      const subjectCell = row.locator('td.td3');
      if ((await subjectCell.count()) > 0) await subjectCell.first().click();
      else await row.click();
    }

    // Wait for the message view to actually populate rather than sleeping a
    // fixed interval: the earlier fixed 1.5s wait caused spurious
    // MESSAGE_CONTENT_UNAVAILABLE results.
    let bodyText: string | null = null;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const candidate = await page.locator('#display_email').innerText().catch(() => '');
      if (candidate.trim().length > 0) {
        bodyText = candidate;
        break;
      }
      await page.waitForTimeout(500);
    }
    const bodyHtml = await page.locator('#display_email').innerHTML({ timeout: 10_000 }).catch(() => null);

    if (bodyText === null && bodyHtml === null) {
      return {
        contentAvailableAt: new Date().toISOString(),
        subject,
        textBody: null,
        htmlBody: null,
        metadata: { source: 'guerrillamail-ui', contentError: 'message view unreadable' },
      };
    }

    return {
      contentAvailableAt: new Date().toISOString(),
      subject,
      textBody: bodyText,
      htmlBody: bodyHtml,
      metadata: { source: 'guerrillamail-ui' },
    };
  }

  /**
   * Row cells are explicitly classed: td1 checkbox, td2 from, td3 subject,
   * td4 time. Crucially, `td3` contains BOTH the subject anchor and a body
   * preview span:
   *
   *   td.td3
   *     a.masked_links        <- the subject   (use this)
   *     span.email-excerpt    <- body preview  (ignore this)
   *
   * Reading the whole cell previously pulled the excerpt into the subject and
   * produced a false SUBJECT_MISMATCH (observed 2026-10-15).
   */
  private async readSubject(row: import('@playwright/test').Locator): Promise<string | null> {
    const anchor = row.locator('td.td3 a.masked_links');
    if ((await anchor.count()) > 0) {
      const text = (await anchor.first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    // Fallbacks for minor layout changes: the anchor alone, then the cell with
    // any excerpt span excluded.
    const anyAnchor = row.locator('td.td3 a');
    if ((await anyAnchor.count()) > 0) {
      const text = (await anyAnchor.first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    const cell = row.locator('td.td3');
    if ((await cell.count()) > 0) {
      const html = await cell.first().innerHTML().catch(() => '');
      const withoutExcerpt = html.replace(/<span[^>]*email-excerpt[^>]*>[\s\S]*?<\/span>/gi, '');
      const text = withoutExcerpt.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    return null;
  }

  /**
   * Guarantees the inbox table is showing before we interact with rows.
   *
   * Opening a message REPLACES the table with the message view, which made later
   * row clicks fail with "element is not visible" (observed 2026-10-15). Reloading
   * the homepage reliably restores the inbox and keeps the same address.
   */
  private async returnToInbox(page: Page): Promise<void> {
    const table = page.locator('#email_table');
    if (await table.isVisible().catch(() => false)) return;

    const back = page.locator('a:has-text("Back to inbox")').first();
    if ((await back.count()) > 0) {
      await back.click({ timeout: 8_000 }).catch(() => null);
      if (await table.isVisible().catch(() => false)) return;
    }
    await page.goto(HOME, { waitUntil: 'domcontentloaded' }).catch(() => null);
    await page.waitForSelector('#email_table', { timeout: 15_000 }).catch(() => null);
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
