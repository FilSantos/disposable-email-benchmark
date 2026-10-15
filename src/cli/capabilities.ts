#!/usr/bin/env node
/**
 * Capability matrix CLI (Prompt 2 §6, BR-019).
 *
 * Prints the verified provider capability matrix as text or JSON. This is the
 * artefact a reviewer uses to see what each provider is expected to support
 * before any adapter runs.
 */

import { loadDotEnv, loadConfig } from '../config/config.js';
import { PROVIDER_CAPABILITIES } from '../providers/capabilities.js';
import { buildRegistry } from '../providers/registry.js';

const asJson = process.argv.includes('--json');

function main(): void {
  loadDotEnv();
  const config = loadConfig();

  if (asJson) {
    process.stdout.write(JSON.stringify(PROVIDER_CAPABILITIES, null, 2) + '\n');
    return;
  }

  const registry = buildRegistry(config);

  process.stdout.write(`Provider capability matrix (verified 2026-10-14)\n`);
  process.stdout.write(`${'='.repeat(100)}\n\n`);

  for (const entry of PROVIDER_CAPABILITIES) {
    const reg = registry.find((r) => r.adapter.id === entry.id);
    const executable = reg?.executableChannels.length
      ? reg.executableChannels.join(', ')
      : '(none — capability-gated)';
    process.stdout.write(`${entry.displayName}  [${entry.id}]\n`);
    process.stdout.write(`  website      : ${entry.officialWebsite}\n`);
    process.stdout.write(`  domains      : ${entry.domains.join(', ')}\n`);
    process.stdout.write(`  executable   : ${executable}\n`);
    process.stdout.write(`  retention    : ${entry.retention}\n`);
    process.stdout.write(`  limits       : ${entry.requestLimits}\n`);
    for (const [key, claim] of Object.entries(entry.capabilities)) {
      const src = claim.sourceUrl ? ` <${claim.sourceUrl}>` : '';
      process.stdout.write(`  ${key.padEnd(17)}: ${claim.state.padEnd(24)} ${claim.evidence}${src}\n`);
    }
    if (entry.knownLimitations.length > 0) {
      process.stdout.write(`  limitations  : ${entry.knownLimitations.join('; ')}\n`);
    }
    process.stdout.write('\n');
  }

  process.stdout.write('Note: NOT_SUPPORTED and BLOCKED_BY_PROVIDER are findings, not failures.\n');
  process.stdout.write('No provider is penalised for a capability it does not claim.\n');
}

main();
