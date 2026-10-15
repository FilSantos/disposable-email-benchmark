/** Inspects the real Mailinator public inbox DOM so selectors are evidence-based. */
import { chromium } from '@playwright/test';

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    // Public inbox for a specific inbox name.
    const url = 'https://www.mailinator.com/v4/public/inboxes.jsp?to=ebm-ui-probe';
    const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('status:', r?.status(), '| final url:', page.url());
    console.log('title :', await page.title());
    await page.waitForTimeout(5000);

    const body = (await page.locator('body').innerText()).slice(0, 500).replace(/\s+/g, ' ');
    console.log('body  :', body);

    // Look for the inbox search input and the message list containers.
    const info = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input')).map((e) => ({
        id: e.id, name: (e as HTMLInputElement).name, type: (e as HTMLInputElement).type,
        ph: (e as HTMLInputElement).placeholder, cls: (e.className || '').slice(0, 50),
      }));
      const tables = Array.from(document.querySelectorAll('table')).map((e) => ({
        id: e.id, cls: (e.className || '').slice(0, 50), rows: e.querySelectorAll('tbody tr').length,
      }));
      const links = Array.from(document.querySelectorAll('a')).map((e) => ({
        href: (e as HTMLAnchorElement).getAttribute('href'),
        text: (e.textContent || '').trim().slice(0, 40),
      })).filter((l) => l.href && /msg|inbox|public/i.test(l.href)).slice(0, 10);
      return { inputs, tables, links };
    });
    console.log('inputs:', JSON.stringify(info.inputs, null, 1));
    console.log('tables:', JSON.stringify(info.tables, null, 1));
    console.log('links :', JSON.stringify(info.links, null, 1));
  } catch (err) {
    console.log('FAILED:', (err as Error).message.slice(0, 300));
  } finally {
    await browser.close();
  }
}
void main();
