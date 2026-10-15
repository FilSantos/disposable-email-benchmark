/** Documents Mailinator's message table + message view DOM. */
import { chromium } from '@playwright/test';

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  // 'test' is a busy public inbox; safe for structural inspection.
  await page.goto('https://www.mailinator.com/v4/public/inboxes.jsp?to=test', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  const info = await page.evaluate(() => {
    const table = document.querySelector('table.table-striped, table.jambo_table');
    const rows = table ? Array.from(table.querySelectorAll('tbody tr')) : [];
    const sample = rows.slice(0, 3).map((tr) => {
      const tds = Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim().slice(0, 45));
      const link = tr.querySelector('a');
      return { tds, href: link ? link.getAttribute('href') : null, cls: (tr.className || '').slice(0, 40) };
    });
    return { tableFound: Boolean(table), rowCount: rows.length, sample };
  });
  console.log('table found:', info.tableFound, '| rows:', info.rowCount);
  console.log('sample rows:', JSON.stringify(info.sample, null, 1));

  // Click the first row to learn the message view.
  const first = page.locator('table.table-striped tbody tr, table.jambo_table tbody tr').first();
  if (await first.count()) {
    await first.click();
    await page.waitForTimeout(4000);
    console.log('url after click:', page.url());
    const iframes = await page.locator('iframe').count();
    console.log('iframes:', iframes);
    if (iframes > 0) {
      try {
        const t = await page.frameLocator('iframe').first().locator('body').innerText({ timeout: 8000 });
        console.log('iframe text (200):', t.slice(0, 200).replace(/\s+/g, ' '));
      } catch (e) {
        console.log('iframe read failed:', (e as Error).message.slice(0, 120));
      }
    }
    const bodyText = (await page.locator('body').innerText()).slice(0, 300).replace(/\s+/g, ' ');
    console.log('body after click:', bodyText);
  }
  await browser.close();
}
void main();
