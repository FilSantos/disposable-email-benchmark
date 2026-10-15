/**
 * Verifies what Mailinator's PUBLIC API exposes WITHOUT an API token.
 * Read-only. Establishes whether a credential-free real path exists.
 */
const BASE = 'https://api.mailinator.com/api/v2';
const headers = { Connection: 'close' } as Record<string, string>;

async function get(path: string): Promise<{ status: number; json: unknown }> {
  const r = await fetch(`${BASE}${path}`, { headers });
  let json: unknown = null;
  try { json = await r.json(); } catch { /* ignore */ }
  return { status: r.status, json };
}

async function main(): Promise<void> {
  const candidates = ['test', 'mailinator', 'demo', 'example', 'hello', 'inbox'];
  for (const box of candidates) {
    const { status, json } = await get(`/domains/public/inboxes/${box}`);
    const msgs = (json as { msgs?: Array<{ id: string; subject?: string }> } | null)?.msgs ?? [];
    console.log(`inbox "${box}": HTTP ${status}, ${msgs.length} message(s)`);
    if (msgs.length === 0) continue;
    const first = msgs[0]!;
    console.log(`  first: id=${first.id} subject=${JSON.stringify((first.subject ?? '').slice(0, 70))}`);

    const full = await get(`/domains/public/inboxes/${box}/messages/${first.id}`);
    const d = full.json as {
      subject?: string; from?: string; to?: string;
      parts?: Array<{ body?: string; headers?: Record<string, string> }>;
    } | null;
    console.log(`  full message: HTTP ${full.status}`);
    console.log(`    subject : ${JSON.stringify((d?.subject ?? '').slice(0, 60))}`);
    console.log(`    from    : ${d?.from}`);
    console.log(`    parts    : ${d?.parts?.length ?? 0}`);
    for (const p of (d?.parts ?? []).slice(0, 2)) {
      console.log(`      part body length=${(p.body ?? '').length} headerKeys=${Object.keys(p.headers ?? {}).length}`);
    }
    return; // one successful read is enough to prove the path
  }
  console.log('No public inbox with messages found on this attempt.');
}

void main();
