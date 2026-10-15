/** Verifies positive detection + content read on a busy Mailinator inbox. */
import { chromium } from '@playwright/test';
import { MailinatorUiAdapter } from '../src/providers/mailinator/mailinator.ui.js';

async function main(): Promise<void> {
  // First, find a real subject to search for.
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  await p.goto('https://www.mailinator.com/v4/public/inboxes.jsp?to=test', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(6000);
  const subject = (await p.locator('table.table-striped tbody tr, table.jambo_table tbody tr')
    .first().locator('td').nth(2).innerText()).trim();
  await b.close();
  console.log('searching for subject fragment:', JSON.stringify(subject.slice(0, 30)));

  const adapter = new MailinatorUiAdapter({ inbox: 'test', headless: true });
  try {
    const res = await adapter.waitForMessage({
      inbox: await adapter.getInboxAddress(),
      correlationId: subject.slice(0, 25),
      timeoutMs: 20000,
      pollIntervalMs: 2000,
      onPoll: (i) => console.log(`  poll ${i.attempt}: found=${i.found}`),
    });
    console.log('detected:', res.detected?.messageRef ?? null);
    if (res.detected) {
      const c = await adapter.getMessage(res.detected);
      console.log('subject :', JSON.stringify((c.subject ?? '').slice(0, 60)));
      console.log('textBody:', JSON.stringify((c.textBody ?? '').slice(0, 100)));
      console.log('htmlBody:', c.htmlBody === null ? 'null' : `present (${c.htmlBody.length} chars)`);
    }
  } finally {
    await adapter.close();
  }
}
void main();
