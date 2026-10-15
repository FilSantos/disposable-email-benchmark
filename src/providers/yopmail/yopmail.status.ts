/**
 * YOPmail — capability-only entry.
 *
 * No official API was found (docs/business-analysis/00-overview.md §6), so there
 * is deliberately NO API adapter. UI automation is NOT_TESTED: robots.txt
 * disallows query-string access, but that is a crawl directive rather than a
 * contractual prohibition, so we do not assert either support or block
 * (Prompt 2 §6: "implement the documented capability status ... rather than a
 * fake adapter").
 */

import type { ProviderAdapter } from '../../domain/types.js';
import { getCapabilityEntry } from '../capabilities.js';

export function createYopmailAdapter(): ProviderAdapter {
  const entry = getCapabilityEntry('yopmail');
  if (!entry) throw new Error('yopmail capability entry missing');
  const capabilities = entry.capabilities;
  return {
    id: entry.id,
    displayName: entry.displayName,
    officialWebsite: entry.officialWebsite,
    domains: entry.domains,
    notes: [
      ...entry.knownLimitations,
      'No API channel: official API is NOT_SUPPORTED. Excluded from API comparisons.',
      'UI automation is NOT_TESTED pending a legal/policy decision (Q-07/DQ-5).',
    ],
    capabilities: () => capabilities,
  };
}
