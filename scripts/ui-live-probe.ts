/** Live probe of the Maildrop UI adapter against a mailbox containing real messages. */
import { MaildropUiAdapter } from '../src/providers/maildrop/maildrop.ui.js';

async function main(): Promise<void> {
  // Reuse the mailbox that already holds messages from the real API run.
  const adapter = new MaildropUiAdapter({ mailbox: 'ebm-1d09649f-910', headless: true });
  console.log('inbox:', await adapter.getInboxAddress());
  try {
    const res = await adapter.waitForMessage({
      inbox: await adapter.getInboxAddress(),
      correlationId: 'EBM-real-maildrop-maildrop-api-2-c7a3e3a2',
      timeoutMs: 30000,
      pollIntervalMs: 3000,
      onPoll: (i) => console.log(`  poll ${i.attempt}: found=${i.found} ${i.requestDurationMs}ms`),
    });
    console.log('detected:', res.detected?.messageRef ?? null, '| attempts:', res.attempts);
    if (res.detected) {
      const c = await adapter.getMessage(res.detected);
      console.log('subject :', JSON.stringify(c.subject));
      console.log('textBody:', JSON.stringify((c.textBody ?? '').slice(0, 160)));
      console.log('htmlBody:', c.htmlBody === null ? 'null' : `present (${c.htmlBody.length} chars)`);
    }
  } finally {
    await adapter.close();
    console.log('browser closed');
  }
}
void main();
