/** Confirms YOPmail's iframe structure for a real adapter. */
import { chromium } from '@playwright/test';

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://yopmail.com/en/?ebm-uidemo', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  console.log('frames present:');
  for (const f of page.frames()) {
    console.log(`  name="${f.name()}" url="${f.url().slice(0, 70)}"`);
  }

  // What does the inbox frame contain?
  for (const name of ['ifinbox', 'ifmail']) {
    const frame = page.frame({ name });
    if (!frame) { console.log(`\n[${name}] frame not found`); continue; }
    const text = await frame.locator('body').innerText().catch(() => '(unreadable)');
    console.log(`\n[${name}] text (250):`, text.slice(0, 250).replace(/\s+/g, ' '));
    const htmlIds = await frame.evaluate(() => Array.from(document.querySelectorAll('[id]')).slice(0, 12).map((e) => e.id));
    console.log(`[${name}] ids:`, JSON.stringify(htmlIds));
  }
  await browser.close();
}
void main();
