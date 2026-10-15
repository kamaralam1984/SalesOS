import { Injectable } from '@nestjs/common';
import { getFlag, getSetting, putSetting, type FeatureFlags } from '@salesos/platform-core';
import type { DeviceRegisterInput } from '@salesos/validation';
import { createHash } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import type { Principal } from '../../common/authz';
import { AppError, notFound } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma';

const MAX_DEVICES_PER_USER = 5;

type DeviceRow = NonNullable<Awaited<ReturnType<PrismaService['device']['findFirst']>>>;
const dto = (d: DeviceRow) => ({
  id: d.id, userId: d.userId, platform: d.platform, label: d.label, osVersion: d.osVersion, appVersion: d.appVersion, status: d.status,
  disclosureVersion: d.disclosureVersion, disclosureAcceptedAt: d.disclosureAcceptedAt.toISOString(), approvedAt: d.approvedAt?.toISOString() ?? null,
  revokedAt: d.revokedAt?.toISOString() ?? null, lastSeenAt: d.lastSeenAt?.toISOString() ?? null, createdAt: d.createdAt.toISOString(),
});

/**
 * Companion device registry - DATA MODEL ONLY (Android companion is NO-GO for v1, DEC-036, docs/android-feasibility.md).
 * Registering a device does not grant call capture of any kind; calls from a device would carry source=DEVICE, provider
 * events source=PROVIDER, and manual logs stay source=MANUAL.
 */
@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async settings(organizationId: string) {
    const flags = await getSetting<Partial<FeatureFlags>>(this.prisma, organizationId, 'flags', {});
    return {
      'devices.enabled': flags['devices.enabled'] === true,
      'recordings.enabled': false, // blocked pending legal review; never settable through the API
      goNoGo: 'NO-GO for v1 (DEC-036). Manual call logging remains the guaranteed path; see docs/android-feasibility.md.',
    };
  }

  async setEnabled(user: Principal, enabled: boolean) {
    const flags = await getSetting<Partial<FeatureFlags>>(this.prisma, user.organizationId, 'flags', {});
    await putSetting(this.prisma, user.organizationId, 'flags', { ...flags, 'devices.enabled': enabled }, user.userId);
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'devices.flag_changed', entityType: 'platform_settings', metadata: { enabled } });
    return this.settings(user.organizationId);
  }

  async register(user: Principal, input: DeviceRegisterInput) {
    if (!(await getFlag(this.prisma, user.organizationId, 'devices.enabled'))) {
      throw new AppError('DEVICES_DISABLED', 'Companion devices are not enabled for this organisation (Android companion go/no-go is NO-GO for v1)', 403);
    }
    const deviceIdHash = createHash('sha256').update(`${user.organizationId}:${input.deviceId}`).digest('hex');
    const existing = await this.prisma.device.findUnique({ where: { organizationId_userId_deviceIdHash: { organizationId: user.organizationId, userId: user.userId, deviceIdHash } } });
    if (existing) {
      if (existing.status === 'REVOKED') throw new AppError('DEVICE_REVOKED', 'This device was revoked; ask an administrator', 409);
      return dto(await this.prisma.device.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(), appVersion: input.appVersion ?? existing.appVersion, osVersion: input.osVersion ?? existing.osVersion } }));
    }
    const active = await this.prisma.device.count({ where: { organizationId: user.organizationId, userId: user.userId, status: { not: 'REVOKED' } } });
    if (active >= MAX_DEVICES_PER_USER) throw new AppError('DEVICE_LIMIT', `At most ${MAX_DEVICES_PER_USER} devices per user`, 409);
    const d = await this.prisma.$transaction(async (tx) => {
      const row = await tx.device.create({
        data: {
          organizationId: user.organizationId, userId: user.userId, platform: input.platform, label: input.label, deviceIdHash, osVersion: input.osVersion, appVersion: input.appVersion,
          disclosureVersion: input.disclosureVersion, disclosureAcceptedAt: new Date(), status: 'PENDING', lastSeenAt: new Date(),
        },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'device.registered', entityType: 'device', entityId: row.id, metadata: { platform: row.platform, disclosureVersion: row.disclosureVersion } });
      return row;
    });
    return dto(d);
  }

  async list(user: Principal, orgWide: boolean) {
    const rows = await this.prisma.device.findMany({ where: { organizationId: user.organizationId, ...(orgWide ? {} : { userId: user.userId }) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200 });
    return rows.map(dto);
  }

  async approve(user: Principal, id: string) {
    const d = await this.prisma.device.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!d) throw notFound('Device');
    if (d.status !== 'PENDING') throw new AppError('NOT_PENDING', `Device is ${d.status}`, 409);
    const out = await this.prisma.$transaction(async (tx) => {
      const u = await tx.device.update({ where: { id }, data: { status: 'ACTIVE', approvedById: user.userId, approvedAt: new Date() } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'device.approved', entityType: 'device', entityId: id, metadata: { ownerId: d.userId } });
      return u;
    });
    return dto(out);
  }

  async revoke(user: Principal, id: string, isAdmin: boolean) {
    const d = await this.prisma.device.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!d || (!isAdmin && d.userId !== user.userId)) throw notFound('Device');
    if (d.status === 'REVOKED') return dto(d);
    const out = await this.prisma.$transaction(async (tx) => {
      const u = await tx.device.update({ where: { id }, data: { status: 'REVOKED', revokedAt: new Date(), revokedById: user.userId } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'device.revoked', entityType: 'device', entityId: id, metadata: { ownerId: d.userId } });
      return u;
    });
    return dto(out);
  }
}
