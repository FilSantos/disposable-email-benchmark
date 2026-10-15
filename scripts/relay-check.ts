/**
 * Relay credential check — sends a SINGLE message to a real provider address and
 * reports exactly what the relay said. Proves the transport works without
 * running a full benchmark.
 *
 * Usage: npx tsx scripts/relay-check.ts [recipient]
 */
import { loadDotEnv, loadConfig } from '../src/config/config.js';
import { RelayTransport, classifyTransportError } from '../src/smtp/transports.js';
import { generateMessage } from '../src/smtp/message.js';

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  if (config.transport !== 'relay' || !config.relay) {
    console.log('EBM_TRANSPORT is not "relay" or relay config is missing.');
    process.exitCode = 1;
    return;
  }
  console.log('relay host :', config.relay.host + ':' + config.relay.port);
  console.log('relay user :', config.relay.user ? '(set)' : '(missing)');
  console.log('relay pass :', config.relay.pass ? '(set)' : '(missing)');

  const to = process.argv[2] ?? 'ebm-relay-check@maildrop.cc';
  const transport = new RelayTransport({ relay: config.relay, timeoutMs: config.smtpTimeoutMs });
  const message = generateMessage({
    runId: 'relaycheck',
    sampleId: 's1',
    from: config.relay.user,
    to,
    scenario: 'ascii',
  });

  console.log('\nsending to :', to);
  const result = await transport.send(message);
  console.log('accepted   :', result.accepted);
  console.log('acceptedAt :', result.acceptedAt);
  console.log('response   :', result.response);
  if (result.error) {
    console.log('error      :', JSON.stringify(result.error));
    console.log('kind       :', classifyTransportError(Object.assign(new Error(result.error.message), { code: result.error.code })));
  }
  console.log('\ncorrelation:', message.correlationId);
}

void main();
