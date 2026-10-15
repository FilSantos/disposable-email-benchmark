/** Pins down the subject cell and the correct iframe for Mailinator. */
import { chromium } from '@playwright/test';

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://www.mailinator.com/v4/public/inboxes.jsp?to=test', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  // Header layout
  const header = await page.evaluate(() => {
    const t = document.querySelector('table.table-striped, table.jambo_table');
    const ths = t ? Array.from(t.querySelectorAll('thead th')).map((th) => (th.textContent || '').trim()) : [];
    return ths;
  });
  console.log('table headers:', JSON.stringify(header));

  // Row cell analysis
  const cells = await page.evaluate(() => {
    const t = document.querySelector('table.table-striped, table.jambo_table');
    const tr = t ? t.querySelector('tbody tr') : null;
    if (!tr) return [];
    return Array.from(tr.querySelectorAll('td')).map((td, i) => ({
      i, cls: (td.className || '').slice(0, 30), text: (td.textContent || '').trim().slice(0, 50),
    }));
  });
  console.log('first row cells:', JSON.stringify(cells, null, 1));

  // Click and identify which iframe holds the message
  await page.locator('table.table-striped tbody tr, table.jambo_table tbody tr').first().click();
  await page.waitForTimeout(4000);
  const frames = page.frames();
  console.log('frames on page:', frames.length);
  for (const f of frames) {
    const name = f.name();
    const url = f.url();
    console.log(`  frame name="${name}" url="${url.slice(0, 80)}"`);
  }
  await browser.close();
}
void main();
