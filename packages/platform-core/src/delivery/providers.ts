import { randomUUID } from 'node:crypto';
import type { NotificationChannel, IntegrationKind } from '@prisma/client';

export class ProviderError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean) {
    super(message);
  }
}

export interface OutboundMessage {
  deliveryId: string;
  to: string;
  subject?: string | null;
  body: string;
}
export interface ProviderConfig {
  settings: Record<string, unknown>;
  secret?: string;
  mode: 'SANDBOX' | 'LIVE';
}
export interface ChannelProvider {
  readonly name: string;
  readonly kind: IntegrationKind;
  readonly label: string;
  /** Non-null: real provider that cannot be enabled (DEC-013). Sending always fails with PROVIDER_BLOCKED. */
  readonly blockedReason?: string;
  send(msg: OutboundMessage, cfg: ProviderConfig): Promise<{ providerReference: string }>;
  health(cfg: ProviderConfig): Promise<{ ok: boolean; detail: string }>;
}

export function channelKind(c: NotificationChannel): IntegrationKind {
  return c === 'IN_APP' ? 'EMAIL' : (c as IntegrationKind);
}

export interface SandboxRecord {
  at: Date;
  provider: string;
  to: string;
  subject?: string | null;
  body: string;
  providerReference: string;
}
/** In-memory dev log of everything the sandbox adapters "sent" (never reaches a real person). Bounded ring. */
export const sandboxOutbox: SandboxRecord[] = [];

/**
 * Sandbox adapter: accepts the message, returns a provider reference and NOTHING else. It never reports delivery;
 * a verified provider callback (webhook) is the only path to DELIVERED. Deterministic failure hooks exist so the
 * retry / dead-letter paths are testable: a body containing [[sandbox:fail]] fails retryably, [[sandbox:permanent]] fails
 * permanently. These markers only act on sandbox adapters.
 */
class SandboxProvider implements ChannelProvider {
  constructor(readonly name: string, readonly kind: IntegrationKind, readonly label: string) {}
  async send(msg: OutboundMessage, cfg?: ProviderConfig): Promise<{ providerReference: string }> {
    // admin-controlled outage simulation (Integrations > Configure > "Simulate provider outage"): used to rehearse recovery
    if (cfg?.settings?.simulateOutage === true) throw new ProviderError('SANDBOX_SIMULATED_OUTAGE', 'simulated provider outage', true);
    if (msg.body.includes('[[sandbox:permanent]]')) throw new ProviderError('SANDBOX_REJECTED', 'sandbox permanent rejection', false);
    if (msg.body.includes('[[sandbox:fail]]')) throw new ProviderError('SANDBOX_TEMPORARY_FAILURE', 'sandbox temporary failure', true);
    const providerReference = `sbx_${randomUUID()}`;
    sandboxOutbox.push({ at: new Date(), provider: this.name, to: msg.to, subject: msg.subject, body: msg.body.slice(0, 2000), providerReference });
    if (sandboxOutbox.length > 500) sandboxOutbox.shift();
    return { providerReference };
  }
  async health(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'sandbox adapter: no external call is made' };
  }
}

class BlockedProvider implements ChannelProvider {
  constructor(readonly name: string, readonly kind: IntegrationKind, readonly label: string, readonly blockedReason: string) {}
  async send(): Promise<{ providerReference: string }> {
    throw new ProviderError('PROVIDER_BLOCKED', this.blockedReason, false);
  }
  async health(): Promise<{ ok: boolean; detail: string }> {
    return { ok: false, detail: `BLOCKED: ${this.blockedReason}` };
  }
}

const DEC013 = 'DEC-013: no approved provider, credentials, consent/DLT/template approvals';

export const PROVIDERS: ChannelProvider[] = [
  new SandboxProvider('sandbox-email', 'EMAIL', 'Email (sandbox / dev log)'),
  new SandboxProvider('sandbox-whatsapp', 'WHATSAPP', 'WhatsApp (sandbox)'),
  new SandboxProvider('sandbox-sms', 'SMS', 'SMS (sandbox)'),
  new SandboxProvider('sandbox-calendar', 'CALENDAR', 'Calendar ICS (sandbox)'),
  new SandboxProvider('sandbox-telephony', 'TELEPHONY', 'Telephony webhooks (sandbox)'),
  new BlockedProvider('smtp', 'EMAIL', 'SMTP', DEC013),
  new BlockedProvider('resend', 'EMAIL', 'Resend', DEC013),
  new BlockedProvider('whatsapp-cloud', 'WHATSAPP', 'WhatsApp Business Cloud API', `${DEC013}; WhatsApp template approval required`),
  new BlockedProvider('sms-gateway', 'SMS', 'SMS gateway', `${DEC013}; India DLT registration required`),
  new BlockedProvider('google-calendar', 'CALENDAR', 'Google Calendar', DEC013),
  new BlockedProvider('telephony-cloud', 'TELEPHONY', 'Cloud telephony', `${DEC013}; recording/consent review pending (DEC-014)`),
];

export class ProviderRegistry {
  private readonly map = new Map<string, ChannelProvider>();
  constructor(providers: ChannelProvider[] = PROVIDERS) {
    for (const p of providers) this.map.set(p.name, p);
  }
  get(name: string): ChannelProvider | undefined {
    return this.map.get(name);
  }
  list(): ChannelProvider[] {
    return [...this.map.values()];
  }
  register(p: ChannelProvider): void {
    this.map.set(p.name, p);
  }
}
