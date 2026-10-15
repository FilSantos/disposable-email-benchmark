/** Inspects the YOPmail inbox UI: is automation technically feasible? */
import { chromium } from '@playwright/test';

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    const url = 'https://yopmail.com/en/?ebm-uidemo';
    const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('status:', r?.status(), '| url:', page.url());
    console.log('title :', await page.title());
    await page.waitForTimeout(5000);

    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 400).replace(/\s+/g, ' ');
    console.log('body  :', body);

    const info = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input')).slice(0, 8).map((e) => ({
        id: e.id, name: (e as HTMLInputElement).name, type: (e as HTMLInputElement).type,
        ph: (e as HTMLInputElement).placeholder, cls: (e.className || '').slice(0, 40),
      }));
      const iframes = Array.from(document.querySelectorAll('iframe')).map((e) => ({
        id: e.id, name: e.getAttribute('name'), src: (e.getAttribute('src') || '').slice(0, 60),
      }));
      const divs = Array.from(document.querySelectorAll('[id]')).slice(0, 25).map((e) => e.id);
      return { inputs, iframes, ids: divs };
    });
    console.log('inputs :', JSON.stringify(info.inputs));
    console.log('iframes:', JSON.stringify(info.iframes, null, 1));
    console.log('ids    :', JSON.stringify(info.ids));
  } catch (err) {
    console.log('FAILED:', (err as Error).message.slice(0, 250));
  } finally {
    await browser.close();
  }
}
void main();
