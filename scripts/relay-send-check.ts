/**
 * Single relay send with an explicit sender, for manual verification in the
 * Brevo panel. Prints the relay's verbatim response.
 *
 * Usage: npx tsx scripts/relay-send-check.ts <from> <to>
 */
import { loadDotEnv, loadConfig } from '../src/config/config.js';
import nodemailer from 'nodemailer';

async function main(): Promise<void> {
  loadDotEnv();
  const c = loadConfig();
  const from = process.argv[2] ?? 'filipe@foodsistema.com.br';
  const to = process.argv[3] ?? 'ebm-brevo-check@maildrop.cc';
  const tag = `EBM-${Date.now()}`;

  const t = nodemailer.createTransport({
    host: c.relay!.host, port: c.relay!.port, secure: false,
    auth: { user: c.relay!.user, pass: c.relay!.pass }, connectionTimeout: 20000,
  });

  console.log('relay     :', `${c.relay!.host}:${c.relay!.port}`);
  console.log('login     :', c.relay!.user);
  console.log('from      :', from);
  console.log('to        :', to);
  console.log('subject   :', `EBM relay check ${tag}`);
  console.log('---');

  try {
    const info = await t.sendMail({
      from,
      to,
      subject: `EBM relay check ${tag}`,
      text: `Relay verification ${tag}. If you see this, the relay delivered end to end.`,
      headers: { 'X-EBM-Tag': tag },
    });
    console.log('ACCEPTED  :', JSON.stringify(info.accepted));
    console.log('REJECTED  :', JSON.stringify(info.rejected));
    console.log('RESPONSE  :', info.response);
    console.log('MESSAGE-ID:', info.messageId);
    console.log('\nTag for the Brevo panel:', tag);
  } catch (err) {
    const e = err as { responseCode?: number; code?: string; message: string };
    console.log('FAILED    : code=' + (e.code ?? '-') + ' responseCode=' + (e.responseCode ?? '-'));
    console.log('MESSAGE   :', e.message);
  } finally {
    t.close();
  }
}
void main();
