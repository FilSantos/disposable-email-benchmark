/**
 * Machine-readable provider capability matrix.
 *
 * Transcribed from the approved business analysis package
 * (docs/business-analysis/00-overview.md §6), verified 2026-10-14.
 *
 * Every DOCUMENTED claim carries its source URL. Nothing here is inferred: a
 * capability that was never established is NOT_TESTED, and a capability the
 * provider does not offer is NOT_SUPPORTED (a documented absence, not a failure).
 */

import type { CapabilityClaim, CapabilityState } from '../domain/types.js';

const VERIFIED_AT = '2026-10-14';

function claim(
  state: CapabilityState,
  evidence: CapabilityClaim['evidence'],
  sourceUrl?: string,
  notes?: string,
): CapabilityClaim {
  return {
    state,
    evidence,
    verifiedAt: VERIFIED_AT,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(notes ? { notes } : {}),
  };
}

export interface ProviderCapabilityEntry {
  readonly id: string;
  readonly displayName: string;
  readonly officialWebsite: string;
  readonly domains: readonly string[];
  readonly capabilities: {
    readonly uiAccess: CapabilityClaim;
    readonly uiAutomation: CapabilityClaim;
    readonly officialApi: CapabilityClaim;
    readonly apiConfiguration: CapabilityClaim;
    readonly subject: CapabilityClaim;
    readonly textBody: CapabilityClaim;
    readonly htmlBody: CapabilityClaim;
    readonly metadata: CapabilityClaim;
  };
  readonly retention: string;
  readonly expiration: string;
  readonly requestLimits: string;
  readonly automationRestriction: string;
  readonly operationalComplexity: string;
  readonly knownLimitations: readonly string[];
}

export const PROVIDER_CAPABILITIES: readonly ProviderCapabilityEntry[] = [
  {
    id: 'mailinator',
    displayName: 'Mailinator',
    officialWebsite: 'https://www.mailinator.com/',
    domains: ['mailinator.com'],
    capabilities: {
      uiAccess: claim('SUPPORTED', 'DOCUMENTED', 'https://www.mailinator.com/documentation/docs/core/publicmailbox/index.html'),
      uiAutomation: claim('SUPPORTED', 'DOCUMENTED', 'https://www.mailinator.com/mailinator-api/', 'API is explicitly intended for automation'),
      officialApi: claim('SUPPORTED', 'DOCUMENTED', 'https://www.mailinator.com/mailinator-api/', 'REST API v2'),
      apiConfiguration: claim('CONFIGURATION_REQUIRED', 'DOCUMENTED', 'https://www.mailinator.com/pricing/', 'API token required; Verified Pro is free with verification, paid tiers available'),
      subject: claim('SUPPORTED', 'DOCUMENTED', 'https://www.mailinator.com/mailinator-api/'),
      textBody: claim('SUPPORTED', 'DOCUMENTED', 'https://www.mailinator.com/mailinator-api/'),
      htmlBody: claim('SUPPORTED', 'DOCUMENTED', 'https://www.mailinator.com/mailinator-api/'),
      metadata: claim('SUPPORTED', 'DOCUMENTED', 'https://www.mailinator.com/mailinator-api/'),
    },
    retention: 'public inboxes auto-delete after a few hours; paid tiers are persistent',
    expiration: 'public inboxes always exist; messages expire',
    requestLimits: 'published email quotas only (e.g. 60/day on Verified Pro); HTTP request limits unpublished',
    automationRestriction: 'ToS prohibits overburdening servers; API use is sanctioned',
    operationalComplexity: 'medium (token/plan required)',
    knownLimitations: ['receive-only', 'public inboxes are not private', 'HTTP rate limits unpublished'],
  },
  {
    id: 'maildrop',
    displayName: 'Maildrop',
    officialWebsite: 'https://maildrop.cc/',
    domains: ['maildrop.cc'],
    capabilities: {
      uiAccess: claim('SUPPORTED', 'DOCUMENTED', 'https://maildrop.cc/how-it-works/'),
      uiAutomation: claim('SUPPORTED', 'DOCUMENTED', 'https://docs.maildrop.cc/api-reference/overview'),
      officialApi: claim('SUPPORTED', 'DOCUMENTED', 'https://docs.maildrop.cc/developer-documentation', 'GraphQL API'),
      apiConfiguration: claim('SUPPORTED', 'DOCUMENTED', 'https://docs.maildrop.cc/api-reference/overview', 'no authentication required at time of verification'),
      subject: claim('SUPPORTED', 'DOCUMENTED', 'https://docs.maildrop.cc/graphql-types/message'),
      textBody: claim('SUPPORTED', 'DOCUMENTED', 'https://docs.maildrop.cc/graphql-types/message', 'raw SMTP `data` field'),
      htmlBody: claim('SUPPORTED', 'DOCUMENTED', 'https://docs.maildrop.cc/graphql-types/message'),
      metadata: claim('SUPPORTED', 'DOCUMENTED', 'https://docs.maildrop.cc/graphql-types/message'),
    },
    retention: '24 hours (cleared after 24h without a message); 10-message cap per mailbox',
    expiration: 'mailboxes implicit; content cleared after inactivity',
    requestLimits: 'published: 50 queries per 10 seconds',
    automationRestriction: 'no standalone ToS found (privacy policy only)',
    operationalComplexity: 'low (no authentication)',
    knownLimitations: ['greylisting delays first message from a new sender', '10-message cap', 'cannot send or forward'],
  },
  {
    id: 'guerrillamail',
    displayName: 'Guerrilla Mail',
    officialWebsite: 'https://www.guerrillamail.com/',
    domains: ['guerrillamail.com', 'guerrillamail.info', 'sharklasers.com'],
    capabilities: {
      uiAccess: claim('SUPPORTED', 'DOCUMENTED', 'https://www.guerrillamail.com/about'),
      uiAutomation: claim('NOT_TESTED', 'UNVERIFIED', undefined, 'ToS forbids request flooding; UI automated access not established'),
      officialApi: claim('SUPPORTED', 'DOCUMENTED', 'https://www.guerrillamail.com/GuerrillaMailAPI.html', 'public JSON API v1.0'),
      apiConfiguration: claim('SUPPORTED', 'DOCUMENTED', 'https://www.guerrillamail.com/GuerrillaMailAPI.html', 'no API key; requires ip/agent params and cookie handling'),
      subject: claim('SUPPORTED', 'DOCUMENTED', 'https://www.guerrillamail.com/GuerrillaMailAPI.html'),
      textBody: claim('SUPPORTED', 'DOCUMENTED', 'https://www.guerrillamail.com/GuerrillaMailAPI.html'),
      htmlBody: claim('SUPPORTED', 'DOCUMENTED', 'https://www.guerrillamail.com/GuerrillaMailAPI.html', 'HTML is sanitized (scripts/iframes removed)'),
      metadata: claim('SUPPORTED', 'DOCUMENTED', 'https://www.guerrillamail.com/GuerrillaMailAPI.html', 'partial metadata'),
    },
    retention: 'emails expire after 60 minutes',
    expiration: 'addresses persist; messages expire',
    requestLimits: 'unpublished ("the API may be rate limited")',
    automationRestriction: 'ToS explicitly prohibits over-use / repeated requests',
    operationalComplexity: 'low (no key, but cookie state required)',
    knownLimitations: ['1-hour retention', 'HTML sanitized', 'no spam folder', 'rate limits unpublished'],
  },
  {
    id: 'yopmail',
    displayName: 'YOPmail',
    officialWebsite: 'https://yopmail.com/en/',
    domains: ['yopmail.com'],
    capabilities: {
      uiAccess: claim('SUPPORTED', 'DOCUMENTED', 'https://yopmail.com/en/'),
      uiAutomation: claim('NOT_TESTED', 'UNVERIFIED', 'https://yopmail.com/robots.txt', 'robots.txt disallows /*? ; automation stance not contractually established'),
      officialApi: claim('NOT_SUPPORTED', 'DOCUMENTED', 'https://yopmail.com/en/', 'no official API found in documentation'),
      apiConfiguration: claim('NOT_SUPPORTED', 'DOCUMENTED', 'https://yopmail.com/en/', 'no API to configure'),
      subject: claim('NOT_TESTED', 'UNVERIFIED', 'https://yopmail.com/en/', 'webmail displays messages; programmatic retrieval not verified'),
      textBody: claim('NOT_TESTED', 'UNVERIFIED'),
      htmlBody: claim('NOT_TESTED', 'UNVERIFIED'),
      metadata: claim('NOT_TESTED', 'UNVERIFIED'),
    },
    retention: '8 days',
    expiration: 'inboxes are never deleted',
    requestLimits: 'unpublished',
    automationRestriction: 'robots.txt disallows query-string access; no ToS page found',
    operationalComplexity: 'unknown (UI only)',
    knownLimitations: ['no documented API', 'inboxes not password protected', 'anti-scrape robots directive'],
  },
  {
    id: 'tenminutemail',
    displayName: '10 Minute Mail',
    officialWebsite: 'https://10minutemail.com/',
    domains: ['10minutemail.com', '10minutemail.net'],
    capabilities: {
      uiAccess: claim('SUPPORTED', 'DOCUMENTED', 'https://10minutemail.com/', 'public webmail; archived FAQ: https://web.archive.org/web/20200120051837/https://10minutemail.com/10MinuteMail/faq.html'),
      uiAutomation: claim(
        'BLOCKED_BY_PROVIDER',
        'OBSERVED',
        'https://10minutemail.com/',
        'Cloudflare bot challenge returned HTTP 403 to non-browser clients on 2026-10-14',
      ),
      officialApi: claim('NOT_SUPPORTED', 'DOCUMENTED', 'https://10minutemail.com/', 'no official API found'),
      apiConfiguration: claim('NOT_SUPPORTED', 'DOCUMENTED', 'https://10minutemail.com/', 'no API to configure'),
      subject: claim('NOT_TESTED', 'UNVERIFIED'),
      textBody: claim('NOT_TESTED', 'UNVERIFIED'),
      htmlBody: claim('NOT_TESTED', 'UNVERIFIED'),
      metadata: claim('NOT_TESTED', 'UNVERIFIED'),
    },
    retention: 'messages self-destruct after ~10 minutes',
    expiration: 'address expires after ~10 minutes (extendable)',
    requestLimits: 'unpublished; anti-bot challenge acts as a practical throttle',
    automationRestriction: 'no accessible ToS; active anti-bot measure observed',
    operationalComplexity: 'high / blocked for automation',
    knownLimitations: ['Cloudflare challenge blocks automated clients', '~10-minute lifetime', 'no documented API'],
  },
];

export function getCapabilityEntry(id: string): ProviderCapabilityEntry | undefined {
  return PROVIDER_CAPABILITIES.find((p) => p.id === id);
}

/** Providers whose API channel is usable given the current credentials. */
export function apiCandidates(): readonly string[] {
  return PROVIDER_CAPABILITIES.filter(
    (p) => p.capabilities.officialApi.state === 'SUPPORTED',
  ).map((p) => p.id);
}

/** Providers whose UI channel may be automated. */
export function uiCandidates(): readonly string[] {
  return PROVIDER_CAPABILITIES.filter(
    (p) => p.capabilities.uiAutomation.state === 'SUPPORTED',
  ).map((p) => p.id);
}
