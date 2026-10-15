/**
 * 10 Minute Mail — capability-only entry.
 *
 * An active Cloudflare bot challenge returned HTTP 403 to non-browser clients on
 * 2026-10-14 (observed). Automated access is therefore BLOCKED_BY_PROVIDER and is
 * NOT circumvented (Prompt 2 §5, §20; BR-008). This is a reportable finding, not
 * a failure to measure.
 */

import type { ProviderAdapter } from '../../domain/types.js';
import { getCapabilityEntry } from '../capabilities.js';

export function createTenMinuteMailAdapter(): ProviderAdapter {
  const entry = getCapabilityEntry('tenminutemail');
  if (!entry) throw new Error('tenminutemail capability entry missing');
  const capabilities = entry.capabilities;
  return {
    id: entry.id,
    displayName: entry.displayName,
    officialWebsite: entry.officialWebsite,
    domains: entry.domains,
    notes: [
      ...entry.knownLimitations,
      'UI automation BLOCKED_BY_PROVIDER (Cloudflare challenge observed 2026-10-14). Not circumvented.',
      'No API channel: official API is NOT_SUPPORTED. Excluded from API comparisons.',
    ],
    capabilities: () => capabilities,
  };
}
