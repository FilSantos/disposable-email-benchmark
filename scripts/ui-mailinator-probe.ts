/** Live probe of the Mailinator UI adapter against a busy public inbox. */
import { MailinatorUiAdapter } from '../src/providers/mailinator/mailinator.ui.js';

async function main(): Promise<void> {
  // 'test' is a busy public inbox we already inspected.
  const adapter = new MailinatorUiAdapter({ inbox: 'test', headless: true });
  try {
    console.log('inbox:', await adapter.getInboxAddress());
    const res = await adapter.waitForMessage({
      inbox: await adapter.getInboxAddress(),
      // Deliberately matches nothing, proving the poll loop and timeout behave.
      correlationId: 'EBM-NEVER-EXISTS-0000',
      timeoutMs: 8000,
      pollIntervalMs: 2000,
      onPoll: (i) => console.log(`  poll ${i.attempt}: found=${i.found} ${i.requestDurationMs}ms`),
    });
    console.log('detected:', res.detected, '| attempts:', res.attempts, '| timedOut:', res.timedOut);
  } finally {
    await adapter.close();
    console.log('browser closed');
  }
}
void main();
