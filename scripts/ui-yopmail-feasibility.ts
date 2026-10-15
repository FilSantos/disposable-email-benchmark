/**
 * Tests whether YOPmail tolerates sustained automated UI polling.
 * Read-only: opens an inbox repeatedly and records access outcomes.
 */
import { chromium } from '@playwright/test';

async function main(): Promise<void> {
  const inbox = 'ebm-feas-' + Math.floor(Date.now() / 1000);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results: string[] = [];
  try {
    await page.goto('https://yopmail.com/en/?' + inbox, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('iframe[name="ifinbox"]', { timeout: 25000 });
    console.log('initial load: OK');

    for (let i = 1; i <= 8; i += 1) {
      const started = Date.now();
      const refresh = page.locator('#refresh').first();
      let outcome = 'no-refresh-control';
      if ((await refresh.count()) > 0) {
        await refresh.click({ timeout: 8000 }).catch(() => null);
        await page.waitForTimeout(1000);
        const inboxFrame = page.frame({ name: 'ifinbox' });
        outcome = inboxFrame ? 'ok' : 'frame-missing';
      }
      results.push(`poll ${i}: ${outcome} (${Date.now() - started}ms)`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log(results.join('\n'));
  } catch (err) {
    console.log('FAILED at:', (err as Error).message.slice(0, 200));
    console.log(results.join('\n'));
  } finally {
    await browser.close();
  }
}
void main();
