/**
 * Reads a rendered page's visible text. Used to review provider terms, which are
 * client-rendered and cannot be read with curl.
 * Usage: npx tsx scripts/read-page.ts <url>
 */
import { chromium } from '@playwright/test';

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.log('usage: npx tsx scripts/read-page.ts <url>');
    return;
  }
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);
    const text = await page.locator('body').innerText();
    console.log(text.replace(/\n{3,}/g, '\n\n').slice(0, 6000));
  } finally {
    await browser.close();
  }
}

void main();
