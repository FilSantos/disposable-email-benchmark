/**
 * Provider adapter registry (Prompt 2 §6, §11).
 *
 * Builds the adapters that are justified by verified capabilities. Providers
 * without an authorized API receive NO api channel; nothing is faked.
 */

import type { ProviderAdapter } from '../domain/types.js';
import type { AppConfig } from '../config/config.js';
import { PROVIDER_CAPABILITIES } from './capabilities.js';
import { createMaildropAdapter } from './maildrop/maildrop.api.js';
import { MaildropUiAdapter } from './maildrop/maildrop.ui.js';
import { createGuerrillaMailAdapter } from './guerrillamail/guerrillamail.api.js';
import { GuerrillaMailUiAdapter } from './guerrillamail/guerrillamail.ui.js';
import { createMailinatorAdapter } from './mailinator/mailinator.api.js';
import { MailinatorUiAdapter } from './mailinator/mailinator.ui.js';
import { createYopmailAdapter } from './yopmail/yopmail.status.js';
import { YopmailUiAdapter } from './yopmail/yopmail.ui.js';
import { createTenMinuteMailAdapter } from './tenminutemail/tenminutemail.status.js';

export interface RegisteredProvider {
  readonly adapter: ProviderAdapter;
  /** Channels this provider can actually be executed for, given configuration. */
  readonly executableChannels: readonly ('UI' | 'API')[];
}

export interface RegistryOptions {
  readonly maildropMailbox?: string;
  readonly mailinatorInbox?: string;
  readonly yopmailInbox?: string;
  /**
   * YOPmail UI is opt-in: feasibility is proven, but automated use is not
   * contractually confirmed (DQ-5). Default false.
   */
  readonly enableYopmailUi?: boolean;
}

/** Deterministic-per-process mailbox name when the caller does not pin one. */
function defaultMailbox(provider: string): string {
  return `ebm-ui-${provider}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildRegistry(
  config: AppConfig,
  options: RegistryOptions = {},
): readonly RegisteredProvider[] {
  const entries: RegisteredProvider[] = [];

  const maildrop = createMaildropAdapter(
    options.maildropMailbox ? { mailbox: options.maildropMailbox } : {},
  );
  // Maildrop also exposes an authorised UI; its automation status is SUPPORTED.
  const maildropUi = new MaildropUiAdapter({
    mailbox: options.maildropMailbox ?? defaultMailbox('maildrop'),
  });
  entries.push({
    adapter: { ...maildrop, ui: maildropUi },
    executableChannels: ['API', 'UI'],
  });

  const guerrilla = createGuerrillaMailAdapter();
  // UI automation is SUPPORTED (observed): no CAPTCHA, and the ToS restricts
  // over-use rather than automation. Polling is rate-limited accordingly.
  const guerrillaUi = new GuerrillaMailUiAdapter();
  entries.push({
    adapter: { ...guerrilla, ui: guerrillaUi },
    executableChannels: guerrilla.api ? ['API', 'UI'] : ['UI'],
  });

  const mailinator = createMailinatorAdapter({ token: config.mailinatorToken });
  // The public inbox UI needs no account or token, so it is executable even when
  // the API is not. UI automation status is documented SUPPORTED.
  const mailinatorUi = new MailinatorUiAdapter({
    inbox: options.mailinatorInbox ?? defaultMailbox('mailinator'),
  });
  entries.push({
    adapter: { ...mailinator, ui: mailinatorUi },
    // The API stays CONFIGURATION_REQUIRED without a token; the UI is not.
    executableChannels: mailinator.api ? ['API', 'UI'] : ['UI'],
  });

  // YOPmail's UI is technically automatable (verified 2026-10-15: inbox + message
  // frames render, 8/8 consecutive polls succeeded). It stays OPT-IN because the
  // policy question (DQ-5) is unresolved: the site publishes no accessible terms
  // text and its robots.txt disallows query-string URLs for crawlers.
  const yopmail = createYopmailAdapter();
  const yopmailUi = new YopmailUiAdapter({
    inbox: options.yopmailInbox ?? defaultMailbox('yopmail'),
  });
  entries.push({
    adapter: { ...yopmail, ui: yopmailUi },
    executableChannels: options.enableYopmailUi ? ['UI'] : [],
  });
  entries.push({ adapter: createTenMinuteMailAdapter(), executableChannels: [] });

  return entries;
}

export function getAdapter(id: string, config: AppConfig, options: RegistryOptions = {}): ProviderAdapter | undefined {
  return buildRegistry(config, options).find((r) => r.adapter.id === id)?.adapter;
}

/**
 * Releases every UI adapter's browser. Must be called after a run so no orphaned
 * Chromium process survives (Prompt 2 §8: no orphaned processes).
 */
export async function closeRegistry(registry: readonly RegisteredProvider[]): Promise<void> {
  await Promise.all(
    registry.map(async ({ adapter }) => {
      const ui = adapter.ui as { close?: () => Promise<void> } | undefined;
      if (ui?.close) await ui.close();
    }),
  );
}

export { PROVIDER_CAPABILITIES };
