/**
 * Live adapter probe — verifies provider adapters against real endpoints.
 * Read-only: it never sends mail and never asserts on data it cannot see.
 *
 * Usage: npx tsx scripts/live-probe.ts
 */
import { createMaildropAdapter } from '../src/providers/maildrop/maildrop.api.js';
import { createGuerrillaMailAdapter } from '../src/providers/guerrillamail/guerrillamail.api.js';

async function probeMaildrop(): Promise<void> {
  console.log('\n--- Maildrop (live) ---');
  const adapter = createMaildropAdapter({ mailbox: 'ebm-live-probe' });
  const api = adapter.api;
  if (!api) return console.log('  no API channel');
  console.log('  isConfigured :', api.isConfigured());
  console.log('  inbox        :', await api.getInboxAddress());
  const started = Date.now();
  const result = await api.waitForMessage({
    inbox: await api.getInboxAddress(),
    correlationId: 'EBM-NEVER-EXISTS-0000',
    timeoutMs: 4000,
    pollIntervalMs: 1000,
    onPoll: (i) => console.log(`    poll ${i.attempt}: found=${i.found} ${i.requestDurationMs}ms`),
  });
  console.log('  detected     :', result.detected, '| attempts:', result.attempts, '| timedOut:', result.timedOut);
  console.log('  elapsed      :', Date.now() - started, 'ms');
}

async function probeGuerrilla(): Promise<void> {
  console.log('\n--- Guerrilla Mail (live) ---');
  const adapter = createGuerrillaMailAdapter();
  const api = adapter.api;
  if (!api) return console.log('  no API channel');
  console.log('  isConfigured :', api.isConfigured());
  const address = await api.getInboxAddress();
  console.log('  inbox        :', address);
  const result = await api.waitForMessage({
    inbox: address,
    correlationId: 'EBM-NEVER-EXISTS-0000',
    timeoutMs: 3000,
    pollIntervalMs: 1000,
    onPoll: (i) => console.log(`    poll ${i.attempt}: found=${i.found} ${i.requestDurationMs}ms`),
  });
  console.log('  detected     :', result.detected, '| attempts:', result.attempts);
}

async function main(): Promise<void> {
  for (const probe of [probeMaildrop, probeGuerrilla]) {
    try {
      await probe();
    } catch (err) {
      console.log('  probe failed:', (err as Error).name, '-', (err as Error).message);
    }
  }
}

void main();
