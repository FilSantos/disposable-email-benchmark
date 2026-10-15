/**
 * Reads a YOPmail inbox through the browser, the way an adapter would.
 * Usage: npx tsx scripts/ui-yopmail-read.ts <inbox>
 */
import { chromium } from '@playwright/test';

async function main(): Promise<void> {
  const box = process.argv[2];
  if (!box) {
    console.log('usage: npx tsx scripts/ui-yopmail-read.ts <inbox>');
    return;
  }
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto('https://yopmail.com/en/?' + box, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);

    const inbox = page.frame({ name: 'ifinbox' });
    if (!inbox) {
      console.log('ifinbox frame missing');
      return;
    }
    const text = await inbox.locator('body').innerText().catch(() => '');
    console.log('inbox frame text:', JSON.stringify(text.slice(0, 300)));
    console.log('contains EBM     :', text.includes('EBM'));

    const candidates = await inbox.locator('div.m, div.lm, .m, div').count();
    console.log('elements in inbox frame:', candidates);

    const firstMsg = inbox.locator('div.m').first();
    if ((await firstMsg.count()) > 0) {
      await firstMsg.click().catch(() => null);
      await page.waitForTimeout(4000);
      const mailFrame = page.frame({ name: 'ifmail' });
      if (mailFrame) {
        const body = await mailFrame.locator('body').innerText().catch(() => '');
        console.log('ifmail text (300):', JSON.stringify(body.slice(0, 300)));
      } else {
        console.log('ifmail frame not present');
      }
    } else {
      console.log('no div.m message element found');
    }
  } finally {
    await browser.close();
  }
}

void main();
