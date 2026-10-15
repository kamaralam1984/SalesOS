import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { applyProviderCallback, decryptSecret, verifyWebhook } from '@salesos/platform-core';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma';
import { CallEventPortRegistry } from './call-event-port';
import { ENCRYPTION_KEY } from './platform-config';

const envelope = z.object({ id: z.string().min(1).max(200), type: z.string().min(1).max(80), data: z.record(z.unknown()).default({}) });

const deliveryData = z.object({ reference: z.string().min(1).max(200), status: z.enum(['delivered', 'failed', 'bounced', 'opted_out']), errorCode: z.string().max(80).optional() });
const callData = z.object({
  callId: z.string().min(1).max(200), direction: z.enum(['INBOUND', 'OUTBOUND']),
  status: z.enum(['RINGING', 'ANSWERED', 'NO_ANSWER', 'BUSY', 'FAILED', 'COMPLETED']),
  from: z.string().max(40).optional(), to: z.string().max(40).optional(), agentEmail: z.string().email().optional(),
  startedAt: z.string().datetime().optional(), durationSec: z.number().int().min(0).max(86_400).optional(),
});

export interface WebhookResult { accepted: boolean; duplicate: boolean; outcome: string }

@Injectable()
export class WebhooksService {
  private readonly log = new Logger(WebhooksService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly calls: CallEventPortRegistry,
    @Inject(ENCRYPTION_KEY) private readonly key: Buffer,
  ) {}

  /**
   * Verify (HMAC over RAW body + timestamp tolerance) -> parse -> replay check (unique provider+event id) -> dispatch.
   * The organisation is derived from the integration whose secret verified the signature, never from the request.
   */
  async handle(provider: string, raw: Buffer | undefined, signature: string | undefined, opts: { telephonyOnly?: boolean } = {}): Promise<WebhookResult> {
    if (!raw || raw.length === 0) throw new AppError('INVALID_SIGNATURE', 'Invalid webhook signature', 401);
    const configs = await this.prisma.integrationConfig.findMany({ where: { provider, enabled: true, webhookSecretCipher: { not: null } } });
    const matches = new Set<string>();
    let lastReason = 'NO_CONFIG';
    for (const c of configs) {
      const secret = decryptSecret(c.webhookSecretCipher!, this.key);
      const r = verifyWebhook(secret, raw, signature, { toleranceSeconds: Number(process.env.WEBHOOK_TOLERANCE_SECONDS ?? 300) });
      if (r.ok) matches.add(c.organizationId);
      else lastReason = r.reason;
    }
    // Fail closed when the same secret verifies for more than one organisation (ambiguous tenant).
    if (matches.size !== 1) {
      this.log.warn(`webhook rejected for provider=${provider}: ${matches.size > 1 ? 'AMBIGUOUS_TENANT' : lastReason}`);
      throw new AppError('INVALID_SIGNATURE', 'Invalid webhook signature', 401); // same answer for every failure reason
    }
    const orgId = [...matches][0]!;

    let parsed: z.infer<typeof envelope>;
    try {
      parsed = envelope.parse(JSON.parse(raw.toString('utf8')));
    } catch {
      throw new AppError('INVALID_PAYLOAD', 'Webhook payload is not valid', 400);
    }
    const payloadHash = createHash('sha256').update(raw).digest('hex');
    try {
      await this.prisma.webhookEvent.create({ data: { organizationId: orgId, provider, eventId: parsed.id, payloadHash, outcome: 'ACCEPTED' } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const prior = await this.prisma.webhookEvent.findUnique({ where: { provider_eventId: { provider, eventId: parsed.id } } });
        if (prior && prior.payloadHash === payloadHash) return { accepted: false, duplicate: true, outcome: 'DUPLICATE' };
        throw new AppError('REPLAY_MISMATCH', 'Event id was already used with a different payload', 409);
      }
      throw e;
    }

    try {
      const outcome = await this.dispatch(orgId, provider, parsed, opts);
      await this.prisma.webhookEvent.update({ where: { provider_eventId: { provider, eventId: parsed.id } }, data: { outcome: outcome.startsWith('IGNORED') ? 'IGNORED' : 'ACCEPTED', detail: outcome } });
      return { accepted: true, duplicate: false, outcome };
    } catch (e) {
      // free the event id so the provider's retry is processed (handlers are idempotent)
      await this.prisma.webhookEvent.delete({ where: { provider_eventId: { provider, eventId: parsed.id } } }).catch(() => undefined);
      throw e;
    }
  }

  private async dispatch(orgId: string, provider: string, ev: z.infer<typeof envelope>, opts: { telephonyOnly?: boolean }): Promise<string> {
    if (ev.type === 'delivery.status' && !opts.telephonyOnly) {
      const d = deliveryData.safeParse(ev.data);
      if (!d.success) throw new AppError('INVALID_PAYLOAD', 'Invalid delivery.status data', 400);
      // callbacks are matched on the provider that sent the message (config provider name == delivery.provider)
      return applyProviderCallback(this.prisma, { organizationId: orgId, provider, providerReference: d.data.reference, status: d.data.status, errorCode: d.data.errorCode });
    }
    if (ev.type === 'call.event') {
      const c = callData.safeParse(ev.data);
      if (!c.success) throw new AppError('INVALID_PAYLOAD', 'Invalid call.event data', 400);
      const agent = c.data.agentEmail ? await this.prisma.user.findFirst({ where: { email: c.data.agentEmail.toLowerCase(), organizationId: orgId }, select: { id: true } }) : null;
      await this.calls.ingest({
        organizationId: orgId, provider, providerCallId: c.data.callId, direction: c.data.direction, status: c.data.status,
        fromNumber: c.data.from, toNumber: c.data.to, userId: agent?.id ?? null, startedAt: c.data.startedAt, durationSec: c.data.durationSec,
      });
      return 'APPLIED';
    }
    return 'IGNORED_UNKNOWN_TYPE';
  }
}
