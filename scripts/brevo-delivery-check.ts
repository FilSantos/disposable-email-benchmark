/**
 * Queries Brevo's transactional log to classify asynchronous delivery outcomes.
 *
 * The SMTP relay returns `250 queued` even when the destination later rejects the
 * message, so a rejection is invisible to the SMTP client. Brevo's API exposes
 * the real outcome (delivered / soft bounce / blocked) which is what a technical
 * report needs.
 *
 * Requires a Brevo API key (Settings -> SMTP & API -> API Keys), NOT the SMTP key.
 * Usage: BREVO_API_KEY=xxx npx tsx scripts/brevo-delivery-check.ts [limit]
 */
const BASE = 'https://api.brevo.com/v3';

interface BrevoEvent {
  readonly event?: string;
  readonly email?: string;
  readonly subject?: string;
  readonly reason?: string;
  readonly date?: string;
  readonly tag?: string;
}

async function main(): Promise<void> {
  const key = process.env['BREVO_API_KEY'];
  if (!key) {
    console.log('BREVO_API_KEY not set — skipping live delivery check.');
    console.log('Set it (Settings -> SMTP & API -> API Keys) to classify async outcomes.');
    return;
  }
  const limit = process.argv[2] ?? '50';
  const res = await fetch(`${BASE}/smtp/statistics/events?limit=${limit}&sort=desc`, {
    headers: { 'api-key': key, accept: 'application/json' },
  });
  if (!res.ok) {
    console.log(`Brevo API returned HTTP ${res.status}. Check that the key is an API key, not an SMTP key.`);
    return;
  }
  const body = (await res.json()) as { events?: readonly BrevoEvent[] };
  const events = body.events ?? [];
  const tally = new Map<string, number>();
  console.log(`\n${events.length} recent transactional events:\n`);
  for (const e of events.slice(0, 25)) {
    const outcome = e.event ?? 'unknown';
    tally.set(outcome, (tally.get(outcome) ?? 0) + 1);
    console.log(
      `  ${outcome.padEnd(14)} ${(e.email ?? '').padEnd(38)} ${(e.subject ?? '').slice(0, 46)}`,
    );
    if (e.reason) console.log(`      reason: ${e.reason}`);
  }
  console.log('\nOutcome tally:', Object.fromEntries(tally));
}
void main();
