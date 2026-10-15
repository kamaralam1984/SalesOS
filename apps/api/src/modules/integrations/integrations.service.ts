import { Inject, Injectable } from '@nestjs/common';
import type { DeliveryStatus, NotificationChannel, Prisma } from '@prisma/client';
import { decryptSecret, enqueueDelivery, encryptSecret, ProviderRegistry, requeueDelivery } from '@salesos/platform-core';
import { randomUUID } from 'node:crypto';
import type { IntegrationPatch } from '@salesos/validation';
import { AuditService } from '../../common/audit/audit.service';
import type { Principal } from '../../common/authz';
import { AppError, notFound } from '../../common/http/errors';
import { pageArgs, pageResult, type PageQuery } from '../../common/pagination/pagination';
import { PrismaService } from '../../common/prisma';
import { ENCRYPTION_KEY } from './platform-config';

const SECRETISH = /secret|token|password|passwd|api[-_]?key|private/i;

type ConfigRow = Awaited<ReturnType<PrismaService['integrationConfig']['findFirst']>>;

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly providers: ProviderRegistry,
    @Inject(ENCRYPTION_KEY) private readonly key: Buffer,
  ) {}

  /** Public projection. Ciphertext is NEVER included: only booleans saying whether a secret is configured. */
  private view(provider: ReturnType<ProviderRegistry['list']>[number], cfg: NonNullable<ConfigRow> | null) {
    return {
      provider: provider.name, kind: provider.kind, label: provider.label,
      blockedReason: provider.blockedReason ?? null,
      sandbox: provider.name.startsWith('sandbox-'),
      enabled: cfg?.enabled ?? false, mode: cfg?.mode ?? 'SANDBOX',
      settings: (cfg?.settings ?? {}) as Record<string, unknown>,
      hasSecret: !!cfg?.secretCipher, hasWebhookSecret: !!cfg?.webhookSecretCipher,
      lastHealthAt: cfg?.lastHealthAt?.toISOString() ?? null, lastHealthStatus: cfg?.lastHealthStatus ?? null, lastError: cfg?.lastError ?? null,
      status: provider.blockedReason ? 'BLOCKED' : cfg?.enabled ? 'ENABLED' : 'DISABLED',
    };
  }

  async list(organizationId: string) {
    const cfgs = await this.prisma.integrationConfig.findMany({ where: { organizationId } });
    return this.providers.list().map((p) => this.view(p, cfgs.find((c) => c.provider === p.name) ?? null));
  }

  async patch(user: Principal, providerName: string, patch: IntegrationPatch) {
    const provider = this.providers.get(providerName);
    if (!provider) throw notFound('Integration');
    if (provider.blockedReason && (patch.enabled || patch.mode === 'LIVE')) {
      throw new AppError('PROVIDER_BLOCKED', `${provider.label} cannot be enabled: ${provider.blockedReason}`, 409);
    }
    if (patch.mode === 'LIVE' && provider.name.startsWith('sandbox-')) throw new AppError('SANDBOX_ONLY', 'Sandbox adapters cannot run in LIVE mode', 409);
    if (patch.settings) for (const k of Object.keys(patch.settings)) if (SECRETISH.test(k)) throw new AppError('SECRET_IN_SETTINGS', `Setting "${k}" looks like a secret; use the write-only secret fields`, 400);
    const data: Prisma.IntegrationConfigUncheckedUpdateInput = {
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.mode ? { mode: patch.mode } : {}),
      ...(patch.settings ? { settings: patch.settings as Prisma.InputJsonValue } : {}),
      ...(patch.secret !== undefined ? { secretCipher: patch.secret ? encryptSecret(patch.secret, this.key) : null } : {}),
      ...(patch.webhookSecret !== undefined ? { webhookSecretCipher: patch.webhookSecret ? encryptSecret(patch.webhookSecret, this.key) : null } : {}),
      blockedReason: provider.blockedReason ?? null,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.integrationConfig.upsert({
        where: { organizationId_provider: { organizationId: user.organizationId, provider: provider.name } },
        create: { ...(data as Prisma.IntegrationConfigUncheckedCreateInput), organizationId: user.organizationId, provider: provider.name, kind: provider.kind },
        update: data,
      });
      await this.audit.recordTx(tx, {
        organizationId: user.organizationId, actorId: user.userId, action: 'integration.updated', entityType: 'integration', entityId: null,
        // field NAMES only - never values
        metadata: { provider: provider.name, fields: Object.keys(patch), secretChanged: patch.secret !== undefined, webhookSecretChanged: patch.webhookSecret !== undefined },
      });
    });
    const cfg = await this.prisma.integrationConfig.findUnique({ where: { organizationId_provider: { organizationId: user.organizationId, provider: provider.name } } });
    return this.view(provider, cfg);
  }

  async checkHealth(user: Principal, providerName: string) {
    const provider = this.providers.get(providerName);
    if (!provider) throw notFound('Integration');
    const cfg = await this.prisma.integrationConfig.findUnique({ where: { organizationId_provider: { organizationId: user.organizationId, provider: provider.name } } });
    let result: { ok: boolean; detail: string };
    try {
      result = await provider.health({ settings: (cfg?.settings ?? {}) as Record<string, unknown>, secret: cfg?.secretCipher ? decryptSecret(cfg.secretCipher, this.key) : undefined, mode: cfg?.mode ?? 'SANDBOX' });
    } catch (e) {
      result = { ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : 'health check failed' };
    }
    const row = await this.prisma.integrationConfig.upsert({
      where: { organizationId_provider: { organizationId: user.organizationId, provider: provider.name } },
      create: { organizationId: user.organizationId, provider: provider.name, kind: provider.kind, blockedReason: provider.blockedReason ?? null, lastHealthAt: new Date(), lastHealthStatus: result.ok ? 'OK' : 'DOWN', lastError: result.ok ? null : result.detail },
      update: { lastHealthAt: new Date(), lastHealthStatus: result.ok ? 'OK' : 'DOWN', lastError: result.ok ? null : result.detail },
    });
    return { ...this.view(provider, row), detail: result.detail };
  }

  async healthSummary(organizationId: string) {
    const since = new Date(Date.now() - 24 * 3600_000);
    const [byStatus, dead, failedFiles, deadEvents, oldest, providers] = await Promise.all([
      this.prisma.notificationDelivery.groupBy({ by: ['status'], where: { organizationId, createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.notificationDelivery.count({ where: { organizationId, status: 'DEAD_LETTER' } }),
      this.prisma.fileAsset.count({ where: { organizationId, status: 'FAILED', deletedAt: null } }),
      this.prisma.outboxEvent.count({ where: { organizationId, status: 'DEAD' } }),
      this.prisma.notificationDelivery.findFirst({ where: { organizationId, status: 'QUEUED' }, orderBy: { nextAttemptAt: 'asc' }, select: { nextAttemptAt: true } }),
      this.list(organizationId),
    ]);
    return {
      providers,
      deliveriesLast24h: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
      deadLetters: dead, failedFiles, deadOutboxEvents: deadEvents,
      oldestQueuedOverdueSeconds: oldest && oldest.nextAttemptAt < new Date() ? Math.floor((Date.now() - oldest.nextAttemptAt.getTime()) / 1000) : 0,
      note: 'SENT means accepted by the provider. Only a verified provider callback marks a message DELIVERED.',
    };
  }

  async listDeliveries(organizationId: string, q: PageQuery & { status?: DeliveryStatus; channel?: NotificationChannel }) {
    const rows = await this.prisma.notificationDelivery.findMany({
      where: { organizationId, ...(q.status ? { status: q.status } : {}), ...(q.channel ? { channel: q.channel } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q),
    });
    const res = pageResult(rows, q);
    return { ...res, data: res.data.map((d) => this.deliveryView(d)) };
  }

  private deliveryView(d: { id: string; channel: string; provider: string; toAddress: string; subject: string | null; status: string; attempts: number; maxAttempts: number; nextAttemptAt: Date; providerReference: string | null; errorCode: string | null; errorMessage: string | null; sentAt: Date | null; deliveredAt: Date | null; createdAt: Date; notificationId: string | null }) {
    const mask = (a: string) => (a.includes('@') ? a.replace(/^(.).*(@.*)$/, '$1***$2') : a.length > 4 ? `${a.slice(0, 2)}***${a.slice(-2)}` : '***');
    return {
      id: d.id, channel: d.channel, provider: d.provider, to: mask(d.toAddress), subject: d.subject, status: d.status,
      statusLabel: d.status === 'SENT' ? 'Sent to provider (not confirmed delivered)' : d.status === 'DELIVERED' ? 'Delivered (provider confirmed)' : d.status,
      attempts: d.attempts, maxAttempts: d.maxAttempts, nextAttemptAt: d.nextAttemptAt.toISOString(), providerReference: d.providerReference,
      errorCode: d.errorCode, errorMessage: d.errorMessage, sentAt: d.sentAt?.toISOString() ?? null, deliveredAt: d.deliveredAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(), notificationId: d.notificationId,
    };
  }

  async getDelivery(organizationId: string, id: string) {
    const d = await this.prisma.notificationDelivery.findFirst({ where: { id, organizationId }, include: { events: { orderBy: { createdAt: 'asc' } } } });
    if (!d) throw notFound('Delivery');
    return { ...this.deliveryView(d), events: d.events.map((e) => ({ from: e.fromStatus, to: e.toStatus, source: e.source, at: e.createdAt.toISOString(), detail: e.detail })) };
  }

  async retryDelivery(user: Principal, id: string) {
    const ok = await requeueDelivery(this.prisma, id, user.organizationId);
    if (!ok) {
      const exists = await this.prisma.notificationDelivery.findFirst({ where: { id, organizationId: user.organizationId }, select: { status: true } });
      if (!exists) throw notFound('Delivery');
      throw new AppError('NOT_RETRYABLE', `A ${exists.status} delivery cannot be retried`, 409);
    }
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'delivery.requeued', entityType: 'notification_delivery', entityId: id });
    return this.getDelivery(user.organizationId, id);
  }

  /** Journey 15: everything that failed and can be recovered, in one list. */
  async failures(organizationId: string) {
    const [deliveries, files, events] = await Promise.all([
      this.prisma.notificationDelivery.findMany({ where: { organizationId, status: { in: ['FAILED', 'DEAD_LETTER'] } }, orderBy: { updatedAt: 'desc' }, take: 50 }),
      this.prisma.fileAsset.findMany({ where: { organizationId, status: { in: ['FAILED', 'REJECTED'] }, deletedAt: null }, orderBy: { updatedAt: 'desc' }, take: 50 }),
      this.prisma.outboxEvent.findMany({ where: { organizationId, status: 'DEAD' }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, eventType: true, lastError: true, createdAt: true, attempts: true } }),
    ]);
    return {
      deliveries: deliveries.map((d) => ({ ...this.deliveryView(d), recoverable: true, recoverAction: 'POST /integrations/deliveries/:id/retry' })),
      files: files.map((f) => ({ id: f.id, displayName: f.displayName, status: f.status, scanStatus: f.scanStatus, error: f.lastError ?? f.processingNote, attempts: f.attempts, recoverable: f.status === 'FAILED', recoverAction: f.status === 'FAILED' ? 'POST /files/:id/retry' : null, createdAt: f.createdAt.toISOString() })),
      deadEvents: events.map((e) => ({ id: e.id, eventType: e.eventType, error: e.lastError, attempts: e.attempts, createdAt: e.createdAt.toISOString(), recoverable: false, note: 'Dead-lettered domain event: inspect in the dead-letter queue; replay is an operator task' })),
    };
  }

  async listConsent(organizationId: string, q: PageQuery) {
    const rows = await this.prisma.consentRecord.findMany({ where: { organizationId }, orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    return pageResult(rows, q);
  }

  async upsertConsent(user: Principal, input: { channel: 'EMAIL' | 'WHATSAPP' | 'SMS'; address: string; status: 'OPTED_IN' | 'OPTED_OUT'; subjectType?: string; subjectId?: string; source: string }) {
    const address = input.address.trim().toLowerCase();
    const row = await this.prisma.consentRecord.upsert({
      where: { organizationId_channel_address: { organizationId: user.organizationId, channel: input.channel, address } },
      create: { organizationId: user.organizationId, channel: input.channel, address, status: input.status, source: input.source, subjectType: input.subjectType, subjectId: input.subjectId, recordedById: user.userId },
      update: { status: input.status, source: input.source, recordedById: user.userId, recordedAt: new Date() },
    });
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'consent.recorded', entityType: 'consent', entityId: row.id, metadata: { channel: input.channel, status: input.status } });
    return { id: row.id, channel: row.channel, status: row.status, recordedAt: row.recordedAt.toISOString() };
  }

  /** Admin: queue one test message through a provider. Sandbox adapters never reach a real recipient; real providers (blocked today) would need recorded consent. */
  async sendTest(user: Principal, providerName: string, input: { to: string; subject?: string; body: string }) {
    const provider = this.providers.get(providerName);
    if (!provider) throw notFound('Integration');
    const cfg = await this.prisma.integrationConfig.findUnique({ where: { organizationId_provider: { organizationId: user.organizationId, provider: provider.name } } });
    if (!cfg?.enabled || provider.blockedReason) throw new AppError('INTEGRATION_DISABLED', 'Enable the integration before sending a test message', 409);
    if (provider.kind === 'TELEPHONY') throw new AppError('NOT_SUPPORTED', 'Telephony providers deliver call events by webhook; there is nothing to send', 400);
    const channel = provider.kind as 'EMAIL' | 'WHATSAPP' | 'SMS' | 'CALENDAR';
    const out = await enqueueDelivery(this.prisma, {
      organizationId: user.organizationId, userId: user.userId, channel, kind: provider.kind, toAddress: input.to, subject: input.subject ?? 'Test message', body: input.body,
      idempotencyKey: `test:${randomUUID()}`, requireConsent: !provider.name.startsWith('sandbox-'), calendar: channel === 'CALENDAR' ? { startsAt: new Date(Date.now() + 3600_000).toISOString() } : undefined,
    });
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'integration.test_sent', entityType: 'notification_delivery', entityId: out.id, metadata: { provider: provider.name, channel } });
    return this.getDelivery(user.organizationId, out.id);
  }
}
