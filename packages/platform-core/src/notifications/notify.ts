import { randomUUID } from 'node:crypto';
import type { NotificationChannel, NotificationSeverity, Prisma } from '@prisma/client';
import type { NotificationChannelKey, NotifyRequest, NotifyResult } from '@salesos/shared-types';
import type { Db } from '../settings';
import { NOTIFICATION_CATALOGUE, isNotificationType } from './catalogue';
import { DEFAULT_QUIET, isQuietNow, nextAllowedAt, type QuietConfig } from './policy';
import { enqueueDelivery } from '../delivery/service';
import { channelKind } from '../delivery/providers';

export class NotifyValidationError extends Error {}

export interface NotifyOptions {
  now?: Date;
}

const BREAKER = 'digest';

function validate(req: NotifyRequest): void {
  if (!isNotificationType(req.type)) throw new NotifyValidationError(`Unknown notification type ${String(req.type)}`);
  if (!req.dedupeKey || req.dedupeKey.length > 200) throw new NotifyValidationError('dedupeKey is required (<= 200 chars)');
  // eslint-disable-next-line no-control-regex
  if (req.actionUrl && (!req.actionUrl.startsWith('/') || req.actionUrl.startsWith('//') || req.actionUrl.includes('\\') || /[\u0000-\u001f\u007f]/.test(req.actionUrl))) {
    throw new NotifyValidationError('actionUrl must be a same-origin path');
  }
  const targets = [req.userId, req.userIds?.length ? 1 : null, req.role, req.roles?.length ? 1 : null].filter(Boolean).length;
  if (targets === 0) throw new NotifyValidationError('one of userId, userIds, role or roles is required');
}

/** Resolve recipients: only ACTIVE users of the request's organisation (never trusts ids across orgs). */
export async function resolveRecipients(db: Db, req: NotifyRequest): Promise<Array<{ id: string; email: string }>> {
  const ids = [...new Set([req.userId, ...(req.userIds ?? [])].filter((x): x is string => !!x))];
  const roles = [...new Set([req.role, ...(req.roles ?? [])].filter((x): x is string => !!x))];
  const or: Prisma.UserWhereInput[] = [];
  if (ids.length) or.push({ id: { in: ids } });
  if (roles.length) or.push({ roleAssignments: { some: { role: { key: { in: roles } } } } });
  return db.user.findMany({ where: { organizationId: req.organizationId, isActive: true, OR: or }, select: { id: true, email: true } });
}

export async function loadQuietConfig(db: Db, organizationId: string, userId?: string): Promise<QuietConfig> {
  const org = await db.notificationOrgConfig.findUnique({ where: { organizationId } });
  const base: QuietConfig = org
    ? { quietStart: org.quietStart, quietEnd: org.quietEnd, timezone: org.timezone, workingDays: org.workingDays }
    : DEFAULT_QUIET;
  if (!userId) return base;
  const u = await db.notificationUserSettings.findUnique({ where: { userId } });
  if (!u) return base;
  return { ...base, quietStart: u.quietStart ?? base.quietStart, quietEnd: u.quietEnd ?? base.quietEnd, timezone: u.timezone ?? base.timezone };
}

/**
 * Raise a notification for one or more recipients. Idempotent per (organisation, recipient, dedupeKey): a repeat only
 * increments `occurrences`. Never throws for per-recipient problems (preference off, digest, missing channel config) -
 * a notification failure must never break the business transaction that raised it. Validation errors do throw.
 */
export async function notify(db: Db, req: NotifyRequest, opts: NotifyOptions = {}): Promise<NotifyResult> {
  validate(req);
  const now = opts.now ?? new Date();
  const def = NOTIFICATION_CATALOGUE[req.type];
  const result: NotifyResult = { created: 0, deduplicated: 0, suppressed: 0, digested: 0, notificationIds: [] };

  const rule = await db.notificationRule.findUnique({ where: { organizationId_type: { organizationId: req.organizationId, type: req.type } } });
  const recipients = await resolveRecipients(db, req);
  if (rule && !rule.enabled && !def.mandatory) {
    result.suppressed = recipients.length;
    return result;
  }
  const severity: NotificationSeverity = (req.severity ?? rule?.severity ?? def.severity) as NotificationSeverity;
  const orgCfg = await db.notificationOrgConfig.findUnique({ where: { organizationId: req.organizationId } });
  const digestThreshold = orgCfg?.digestThreshold ?? 5;
  const digestWindowMs = (orgCfg?.digestWindowMinutes ?? 60) * 60_000;

  const requestedChannels: NotificationChannelKey[] = req.channel
    ? Array.isArray(req.channel) ? req.channel : [req.channel]
    : (rule?.channels?.length ? (rule.channels as NotificationChannelKey[]) : def.defaultChannels);
  const external = requestedChannels.filter((c) => c !== 'IN_APP');

  for (const user of recipients) {
    const prefs = await db.notificationPreference.findMany({ where: { userId: user.id, type: { in: [req.type, '*'] } } });
    const pref = (channel: NotificationChannel): boolean | undefined =>
      (prefs.find((p) => p.channel === channel && p.type === req.type) ?? prefs.find((p) => p.channel === channel && p.type === '*'))?.enabled;

    const mandatory = def.mandatory === true || severity === 'CRITICAL';
    if (pref('IN_APP') === false && !mandatory) {
      result.suppressed++;
      continue;
    }

    // Digest / anti-spam: many un-read, non-critical notifications of one type collapse into a single digest row.
    if (!mandatory) {
      const recent = await db.notification.count({
        where: { organizationId: req.organizationId, userId: user.id, type: req.type, isDigest: false, status: 'UNREAD', createdAt: { gte: new Date(now.getTime() - digestWindowMs) } },
      });
      if (recent >= digestThreshold) {
        const bucket = Math.floor(now.getTime() / digestWindowMs);
        const digestKey = `${BREAKER}:${req.type}:${bucket}`;
        const created = await db.notification.createMany({
          data: [{
            id: randomUUID(), organizationId: req.organizationId, userId: user.id, type: 'digest.summary', severity: 'INFO', title: `${def.label}: more updates`,
            body: `Further "${def.label}" updates are grouped here to avoid spam.`, dedupeKey: digestKey, isDigest: true, occurrences: 1,
            actionUrl: '/notifications', payload: { digestOf: req.type }, createdAt: now, lastRaisedAt: now,
          }],
          skipDuplicates: true,
        });
        if (created.count === 0) {
          await db.notification.updateMany({ where: { organizationId: req.organizationId, userId: user.id, dedupeKey: digestKey }, data: { occurrences: { increment: 1 }, lastRaisedAt: now } });
        }
        result.digested++;
        continue;
      }
    }

    const id = randomUUID();
    const quiet = await loadQuietConfig(db, req.organizationId, user.id);
    const bypass = mandatory || rule?.bypassQuietHours === true;
    const quietNow = !bypass && isQuietNow(now, quiet);
    const ins = await db.notification.createMany({
      data: [{
        id, organizationId: req.organizationId, userId: user.id, type: req.type, severity,
        title: (req.title ?? def.defaultTitle).slice(0, 200), body: req.body?.slice(0, 1000) ?? null,
        entityType: req.entity?.type ?? null, entityId: req.entity?.id ?? null, actionUrl: req.actionUrl ?? null,
        dedupeKey: req.dedupeKey, payload: (req.payload ?? {}) as Prisma.InputJsonValue,
        quietUntil: quietNow ? nextAllowedAt(now, quiet) : null, createdAt: now, lastRaisedAt: now,
      }],
      skipDuplicates: true,
    });
    if (ins.count === 0) {
      const dup = await db.notification.findUnique({ where: { organizationId_userId_dedupeKey: { organizationId: req.organizationId, userId: user.id, dedupeKey: req.dedupeKey } } });
      await db.notification.updateMany({ where: { organizationId: req.organizationId, userId: user.id, dedupeKey: req.dedupeKey }, data: { occurrences: { increment: 1 }, lastRaisedAt: now } });
      result.deduplicated++;
      if (dup) result.notificationIds.push(dup.id);
      continue;
    }
    result.created++;
    result.notificationIds.push(id);

    for (const ch of external) {
      const channel = ch as NotificationChannel;
      if (pref(channel) !== true) continue; // external channels are opt-in per user
      await enqueueDelivery(db, {
        organizationId: req.organizationId, notificationId: id, userId: user.id, channel,
        toAddress: channel === 'EMAIL' || channel === 'CALENDAR' ? user.email : null,
        subject: (req.title ?? def.defaultTitle).slice(0, 200), body: req.body ?? req.title ?? def.defaultTitle,
        calendar: channel === 'CALENDAR' ? (req.payload?.calendar as { startsAt: string; endsAt?: string; title?: string } | undefined) : undefined,
        idempotencyKey: `${id}:${ch}`, notBefore: quietNow ? nextAllowedAt(now, quiet) : now, kind: channelKind(channel),
      });
    }
  }
  return result;
}
