import { Injectable } from '@nestjs/common';
import type { NotificationStatus, Prisma } from '@prisma/client';
import { notify, NotifyValidationError } from '@salesos/platform-core';
import type { NotifyRequest, NotifyResult, PlatformNotifier } from '@salesos/shared-types';
import type { NotificationListQuery, NotificationPreferencesInput, NotificationRulesPatch } from '@salesos/validation';
import { AppError, notFound } from '../../common/http/errors';
import { pageArgs, pageResult } from '../../common/pagination/pagination';
import { PrismaService, type Tx } from '../../common/prisma';

/** Public projection: no internal columns beyond what the UI needs. */
export function toNotificationDto(n: {
  id: string; type: string; severity: string; status: string; title: string; body: string | null; entityType: string | null;
  entityId: string | null; actionUrl: string | null; occurrences: number; isDigest: boolean; createdAt: Date; lastRaisedAt: Date; readAt: Date | null;
}) {
  return {
    id: n.id, type: n.type, severity: n.severity, status: n.status, title: n.title, body: n.body,
    entity: n.entityType && n.entityId ? { type: n.entityType, id: n.entityId } : null,
    actionUrl: n.actionUrl, occurrences: n.occurrences, isDigest: n.isDigest,
    createdAt: n.createdAt.toISOString(), lastRaisedAt: n.lastRaisedAt.toISOString(), readAt: n.readAt?.toISOString() ?? null,
  };
}

/**
 * Injectable notification API for every domain (`PlatformNotifier`). Pass your transaction client so the notification
 * commits (or rolls back) with your change; without `tx` it runs on the shared client.
 */
@Injectable()
export class NotificationService implements PlatformNotifier {
  constructor(private readonly prisma: PrismaService) {}

  async notify(txOrReq: Tx | NotifyRequest, maybeReq?: NotifyRequest): Promise<NotifyResult> {
    const [db, req] = maybeReq ? [txOrReq as Tx, maybeReq] : [this.prisma as Tx, txOrReq as NotifyRequest];
    try {
      return await notify(db, req);
    } catch (e) {
      if (e instanceof NotifyValidationError) throw new AppError('INVALID_NOTIFICATION', e.message, 400);
      throw e;
    }
  }

  async list(userId: string, organizationId: string, q: NotificationListQuery) {
    const where: Prisma.NotificationWhereInput = {
      organizationId, userId,
      ...(q.status !== 'ALL' ? { status: q.status as NotificationStatus } : { status: { not: 'DISMISSED' } }),
      ...(q.type ? { type: q.type } : {}),
      ...(q.since ? { lastRaisedAt: { gt: q.since } } : {}),
    };
    const rows = await this.prisma.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const unread = await this.unreadCount(userId, organizationId);
    return { data: res.data.map(toNotificationDto), meta: { ...res.meta, unreadCount: unread } };
  }

  unreadCount(userId: string, organizationId: string) {
    return this.prisma.notification.count({ where: { organizationId, userId, status: 'UNREAD' } });
  }

  async markRead(userId: string, organizationId: string, id: string) {
    const res = await this.prisma.notification.updateMany({ where: { id, userId, organizationId, status: 'UNREAD' }, data: { status: 'READ', readAt: new Date() } });
    if (res.count === 0) {
      const exists = await this.prisma.notification.findFirst({ where: { id, userId, organizationId }, select: { id: true } });
      if (!exists) throw notFound('Notification');
    }
    return { id, unreadCount: await this.unreadCount(userId, organizationId) };
  }

  async dismiss(userId: string, organizationId: string, id: string) {
    const res = await this.prisma.notification.updateMany({ where: { id, userId, organizationId, status: { not: 'DISMISSED' } }, data: { status: 'DISMISSED', dismissedAt: new Date() } });
    if (res.count === 0) {
      const exists = await this.prisma.notification.findFirst({ where: { id, userId, organizationId }, select: { id: true } });
      if (!exists) throw notFound('Notification');
    }
    return { id, unreadCount: await this.unreadCount(userId, organizationId) };
  }

  async markAllRead(userId: string, organizationId: string) {
    const res = await this.prisma.notification.updateMany({ where: { userId, organizationId, status: 'UNREAD' }, data: { status: 'READ', readAt: new Date() } });
    return { updated: res.count, unreadCount: 0 };
  }

  async getPreferences(userId: string, organizationId: string) {
    const [prefs, settings, org] = await Promise.all([
      this.prisma.notificationPreference.findMany({ where: { userId, organizationId } }),
      this.prisma.notificationUserSettings.findUnique({ where: { userId } }),
      this.prisma.notificationOrgConfig.findUnique({ where: { organizationId } }),
    ]);
    return {
      preferences: prefs.map((p) => ({ type: p.type, channel: p.channel, enabled: p.enabled })),
      quietHours: settings?.quietStart ? { quietStart: settings.quietStart, quietEnd: settings.quietEnd, timezone: settings.timezone } : null,
      organisationDefaults: {
        quietStart: org?.quietStart ?? '21:00', quietEnd: org?.quietEnd ?? '08:00', timezone: org?.timezone ?? 'Asia/Kolkata', workingDays: org?.workingDays ?? [1, 2, 3, 4, 5, 6],
      },
    };
  }

  async putPreferences(userId: string, organizationId: string, input: NotificationPreferencesInput) {
    await this.prisma.$transaction(async (tx) => {
      for (const p of input.preferences) {
        await tx.notificationPreference.upsert({
          where: { userId_type_channel: { userId, type: p.type, channel: p.channel } },
          create: { organizationId, userId, type: p.type, channel: p.channel, enabled: p.enabled },
          update: { enabled: p.enabled },
        });
      }
      if (input.quietHours === null) {
        await tx.notificationUserSettings.deleteMany({ where: { userId } });
      } else if (input.quietHours) {
        await tx.notificationUserSettings.upsert({
          where: { userId },
          create: { userId, organizationId, ...input.quietHours },
          update: input.quietHours,
        });
      }
    });
    return this.getPreferences(userId, organizationId);
  }

  async getRules(organizationId: string) {
    const [rules, cfg] = await Promise.all([
      this.prisma.notificationRule.findMany({ where: { organizationId } }),
      this.prisma.notificationOrgConfig.findUnique({ where: { organizationId } }),
    ]);
    return {
      rules: rules.map((r) => ({ type: r.type, enabled: r.enabled, channels: r.channels, severity: r.severity, bypassQuietHours: r.bypassQuietHours })),
      orgConfig: {
        quietStart: cfg?.quietStart ?? '21:00', quietEnd: cfg?.quietEnd ?? '08:00', timezone: cfg?.timezone ?? 'Asia/Kolkata',
        workingDays: cfg?.workingDays ?? [1, 2, 3, 4, 5, 6], digestThreshold: cfg?.digestThreshold ?? 5, digestWindowMinutes: cfg?.digestWindowMinutes ?? 60,
      },
    };
  }

  async patchRules(organizationId: string, patch: NotificationRulesPatch) {
    await this.prisma.$transaction(async (tx) => {
      for (const r of patch.rules ?? []) {
        const data = {
          ...(r.enabled !== undefined ? { enabled: r.enabled } : {}),
          ...(r.channels ? { channels: r.channels } : {}),
          ...(r.severity !== undefined ? { severity: r.severity } : {}),
          ...(r.bypassQuietHours !== undefined ? { bypassQuietHours: r.bypassQuietHours } : {}),
        };
        await tx.notificationRule.upsert({
          where: { organizationId_type: { organizationId, type: r.type } },
          create: { organizationId, type: r.type, ...data, channels: r.channels ?? ['IN_APP'] },
          update: data,
        });
      }
      if (patch.orgConfig) {
        await tx.notificationOrgConfig.upsert({ where: { organizationId }, create: { organizationId, ...patch.orgConfig }, update: patch.orgConfig });
      }
    });
    return this.getRules(organizationId);
  }
}
