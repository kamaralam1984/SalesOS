import { Inject, Injectable, Logger } from '@nestjs/common';
import type { FileAsset, Prisma } from '@prisma/client';
import {
  DEFAULT_FILES_SETTINGS, EXTENSIONS, FileRejected, ObjectStorage, generateStorageKey, getSetting, maxBytesFor, parseUploadName, putSetting,
  retentionFor, verifyContent, type FilesSettings,
} from '@salesos/platform-core';
import { PLATFORM_EVENTS } from '@salesos/shared-types';
import { createHash } from 'node:crypto';
import { AccessService, type Principal } from '../../common/authz';
import { AuditService } from '../../common/audit/audit.service';
import { AppError, notFound } from '../../common/http/errors';
import { OutboxService } from '../../common/outbox/outbox.service';
import { pageArgs, pageResult, type PageQuery } from '../../common/pagination/pagination';
import { PrismaService } from '../../common/prisma';
import { FileAccessRegistry } from './file-access.registry';
import { STORAGE } from './storage.provider';

const PURPOSES = new Set(['general', 'payment_proof', 'sop_attachment', 'import']);
const GENERIC_MIME = new Set(['', 'application/octet-stream', 'binary/octet-stream']);
const CSV_MIMES = new Set(['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel']);

export function fileDto(f: FileAsset, attachments?: Array<{ entityType: string; entityId: string }>) {
  const ready = f.status === 'READY';
  return {
    id: f.id, displayName: f.displayName, extension: f.extension, contentType: f.contentType, sizeBytes: Number(f.sizeBytes), sha256: f.sha256,
    category: f.category, status: f.status, progress: f.progress,
    scanStatus: f.scanStatus,
    scanLabel: f.scanStatus === 'CLEAN' ? 'Scanned: clean' : f.scanStatus === 'INFECTED' ? 'Malware detected' : f.scanStatus === 'PENDING' ? 'Scan pending' : f.scanStatus === 'ERROR' ? 'Scan failed' : 'NOT scanned by an antivirus engine',
    processingNote: f.processingNote, lastError: f.status === 'FAILED' ? f.lastError : null,
    width: f.width, height: f.height, hasDerivative: !!f.derivedKey, derivedType: f.derivedType,
    retentionUntil: f.retentionUntil?.toISOString() ?? null, uploaderId: f.uploaderId, createdAt: f.createdAt.toISOString(),
    downloadable: ready && f.scanStatus !== 'INFECTED', attachments: attachments ?? undefined,
  };
}

@Injectable()
export class FilesService {
  private readonly log = new Logger(FilesService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly registry: FileAccessRegistry,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  settings(organizationId: string): Promise<FilesSettings> {
    return getSetting(this.prisma, organizationId, 'files', DEFAULT_FILES_SETTINGS);
  }

  async patchSettings(user: Principal, patch: Partial<FilesSettings>) {
    const cur = await this.settings(user.organizationId);
    const next: FilesSettings = { ...cur, ...patch, maxBytesByCategory: { ...cur.maxBytesByCategory, ...(patch.maxBytesByCategory ?? {}) } };
    await putSetting(this.prisma, user.organizationId, 'files', next, user.userId);
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'files.settings_changed', entityType: 'platform_settings', metadata: { fields: Object.keys(patch) } });
    return next;
  }

  /** Validate + store + register an upload. Processing (scan/resize/optimise) happens asynchronously in the worker. */
  async upload(user: Principal, input: { filename: string; declaredType: string; data: Buffer; entityType?: string; entityId?: string; purpose?: string }) {
    const settings = await this.settings(user.organizationId);
    let parsed;
    try {
      parsed = parseUploadName(input.filename);
    } catch (e) {
      if (e instanceof FileRejected) throw new AppError(e.code, e.message, 422);
      throw e;
    }
    if (input.data.length === 0) throw new AppError('EMPTY_FILE', 'The file is empty', 422);
    if (input.data.length > maxBytesFor(parsed.category, settings)) throw new AppError('FILE_TOO_LARGE', 'File exceeds the size limit', 413);
    let sniffed;
    try {
      sniffed = verifyContent(parsed.extension, input.data.subarray(0, 4096), input.data);
    } catch (e) {
      if (e instanceof FileRejected) throw new AppError(e.code, e.message, 422);
      throw e;
    }
    const declared = input.declaredType.toLowerCase().split(';')[0]!.trim();
    const declaredOk = GENERIC_MIME.has(declared) || declared === sniffed.mime || (sniffed.mime === 'text/csv' && CSV_MIMES.has(declared)) || (sniffed.mime === 'image/jpeg' && declared === 'image/jpg');
    if (!declaredOk) throw new AppError('MIME_MISMATCH', `Declared type ${declared} does not match the file content (${sniffed.mime})`, 422);
    if (sniffed.width && sniffed.height && sniffed.width * sniffed.height > settings.maxImagePixels) {
      throw new AppError('IMAGE_TOO_LARGE', 'Image dimensions exceed the allowed pixel count', 422);
    }
    const purpose = input.purpose && PURPOSES.has(input.purpose) ? input.purpose : 'general';
    if (input.purpose && !PURPOSES.has(input.purpose)) throw new AppError('BAD_PURPOSE', 'Unknown purpose', 400);

    // quota (per user + org); soft-deleted files do not count
    const [mine, org] = await Promise.all([
      this.prisma.fileAsset.aggregate({ _sum: { sizeBytes: true }, where: { organizationId: user.organizationId, uploaderId: user.userId, deletedAt: null } }),
      this.prisma.fileAsset.aggregate({ _sum: { sizeBytes: true }, where: { organizationId: user.organizationId, deletedAt: null } }),
    ]);
    const add = BigInt(input.data.length);
    if ((mine._sum.sizeBytes ?? 0n) + add > BigInt(settings.userQuotaBytes)) throw new AppError('QUOTA_EXCEEDED', 'Your storage quota is full', 413);
    if ((org._sum.sizeBytes ?? 0n) + add > BigInt(settings.orgQuotaBytes)) throw new AppError('ORG_QUOTA_EXCEEDED', 'The organisation storage quota is full', 413);

    const entity = input.entityType && input.entityId ? { type: input.entityType, id: input.entityId } : null;
    if ((input.entityType && !input.entityId) || (!input.entityType && input.entityId)) throw new AppError('BAD_ENTITY', 'entityType and entityId go together', 400);
    if (entity) await this.assertAttachable(user, entity.type, entity.id);

    const retentionClass = purpose === 'payment_proof' ? 'payment_proof' : parsed.category;
    const storageKey = generateStorageKey(user.organizationId, retentionClass);
    await this.storage.put(storageKey, input.data, sniffed.mime);
    const sha256 = createHash('sha256').update(input.data).digest('hex');
    try {
      const file = await this.prisma.$transaction(async (tx) => {
        const f = await tx.fileAsset.create({
          data: {
            organizationId: user.organizationId, uploaderId: user.userId, category: retentionClass, displayName: parsed.displayName, extension: parsed.extension,
            contentType: sniffed.mime, declaredType: declared.slice(0, 100) || null, sizeBytes: add, sha256, bucket: this.storage.cfg.bucket, storageKey,
            width: sniffed.width ?? null, height: sniffed.height ?? null, retentionUntil: retentionFor(retentionClass, settings),
          },
        });
        if (entity) await tx.fileAttachment.create({ data: { organizationId: user.organizationId, fileId: f.id, entityType: entity.type, entityId: entity.id, attachedById: user.userId } });
        await this.outbox.publish(tx, {
          eventType: PLATFORM_EVENTS.FILE_PROCESS_REQUESTED, aggregateType: 'file', aggregateId: f.id, organizationId: user.organizationId,
          payload: { fileId: f.id, uploaderId: user.userId }, idempotencyKey: `file.process:${f.id}:0`,
        });
        return f;
      });
      return fileDto(file, entity ? [{ entityType: entity.type, entityId: entity.id }] : []);
    } catch (e) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw e;
    }
  }

  private async assertAttachable(user: Principal, entityType: string, entityId: string) {
    if (!this.registry.has(entityType)) throw new AppError('ENTITY_TYPE_NOT_ATTACHABLE', `Files cannot be attached to "${entityType}"`, 400);
    if (!(await this.registry.can(entityType, { user, entityId, mode: 'attach' }))) throw notFound('Entity');
  }

  /** Can this user read the file? uploader-scope via files:view, OR access to any entity it is attached to. */
  async canRead(user: Principal, f: FileAsset & { attachments?: Array<{ entityType: string; entityId: string }> }): Promise<boolean> {
    if (f.organizationId !== user.organizationId || f.deletedAt) return false;
    const level = this.access.scopeLevel(user, 'files:view');
    if (level && level !== 'summary' && (await this.access.canAccessRecord(user, 'files:view', { organizationId: f.organizationId, ownerId: f.uploaderId }))) return true;
    if (!level) return false;
    const atts = f.attachments ?? (await this.prisma.fileAttachment.findMany({ where: { fileId: f.id }, select: { entityType: true, entityId: true } }));
    for (const a of atts) if (await this.registry.can(a.entityType, { user, entityId: a.entityId, mode: 'read' })) return true;
    return false;
  }

  async load(user: Principal, id: string) {
    const f = await this.prisma.fileAsset.findFirst({ where: { id, organizationId: user.organizationId }, include: { attachments: { select: { entityType: true, entityId: true } } } });
    if (!f || !(await this.canRead(user, f))) throw notFound('File');
    return f;
  }

  async get(user: Principal, id: string) {
    const f = await this.load(user, id);
    return fileDto(f, f.attachments);
  }

  async list(user: Principal, q: PageQuery & { entityType?: string; entityId?: string; status?: FileAsset['status'] }) {
    if (q.entityType && q.entityId) {
      if (!(await this.registry.can(q.entityType, { user, entityId: q.entityId, mode: 'read' }))) throw notFound('Entity');
      const rows = await this.prisma.fileAsset.findMany({
        where: { organizationId: user.organizationId, deletedAt: null, attachments: { some: { entityType: q.entityType, entityId: q.entityId } }, ...(q.status ? { status: q.status } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q),
      });
      const res = pageResult(rows, q);
      return { data: res.data.map((f) => fileDto(f)), meta: res.meta };
    }
    // unattached listing: only files whose uploader is inside the caller's files:view scope (summary scope lists nothing)
    if (this.access.isSummaryOnly(user, 'files:view')) return { data: [], meta: pageResult([] as FileAsset[], q).meta };
    const where = { ...(await this.access.scopedWhere(user, { permission: 'files:view', ownerField: 'uploaderId' })), deletedAt: null, ...(q.status ? { status: q.status } : {}) };
    const rows = await this.prisma.fileAsset.findMany({ where: where as Prisma.FileAssetWhereInput, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    return { data: res.data.map((f) => fileDto(f)), meta: res.meta };
  }

  async attach(user: Principal, id: string, entityType: string, entityId: string) {
    const f = await this.load(user, id);
    await this.assertAttachable(user, entityType, entityId);
    await this.prisma.fileAttachment.upsert({
      where: { fileId_entityType_entityId: { fileId: f.id, entityType, entityId } },
      create: { organizationId: user.organizationId, fileId: f.id, entityType, entityId, attachedById: user.userId }, update: {},
    });
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'file.attached', entityType: 'file', entityId: f.id, metadata: { to: { entityType, entityId } } });
    return this.get(user, id);
  }

  private async downloadTarget(user: Principal, id: string, variant?: string) {
    const f = await this.load(user, id);
    if (f.status !== 'READY') throw new AppError('FILE_NOT_READY', `File is ${f.status.toLowerCase()}`, 409);
    if (f.scanStatus === 'INFECTED') throw new AppError('FILE_BLOCKED', 'File is blocked', 409);
    const useDerived = variant !== 'original' && !!f.derivedKey;
    const ext = useDerived && f.derivedType === 'image/webp' ? 'webp' : f.extension;
    const base = f.displayName.replace(/\.[^.]+$/, '');
    const result = { f, key: useDerived ? f.derivedKey! : f.storageKey, contentType: useDerived ? f.derivedType! : f.contentType, filename: `${base}.${ext}`, variant: useDerived ? 'processed' : 'original' };
    if (f.category === 'payment_proof') {
      await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'file.downloaded', entityType: 'file', entityId: f.id, metadata: { category: f.category } });
    }
    return result;
  }

  async signedDownload(user: Principal, id: string, variant?: string) {
    const t = await this.downloadTarget(user, id, variant);
    const settings = await this.settings(user.organizationId);
    const ttl = Math.min(300, settings.signedUrlTtlSeconds);
    const url = await this.storage.signedGetUrl(t.key, { ttlSeconds: ttl, filename: t.filename, contentType: t.contentType });
    return { url, expiresInSeconds: ttl, filename: t.filename, contentType: t.contentType, variant: t.variant, note: 'Bearer link: valid for a few minutes, do not share.' };
  }

  async streamDownload(user: Principal, id: string, variant?: string) {
    const t = await this.downloadTarget(user, id, variant);
    return { ...t, data: await this.storage.get(t.key) };
  }

  async remove(user: Principal, id: string) {
    const f = await this.prisma.fileAsset.findFirst({ where: { id, organizationId: user.organizationId, deletedAt: null } });
    await this.access.assertRecordAccess(user, 'files:delete', f && { organizationId: f.organizationId, ownerId: f.uploaderId }, 'File');
    await this.prisma.$transaction(async (tx) => {
      await tx.fileAsset.update({ where: { id }, data: { deletedAt: new Date(), deletedById: user.userId } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'file.deleted', entityType: 'file', entityId: id, metadata: { category: f!.category } });
    });
    return { id, deleted: true, note: 'Soft-deleted; the stored object is purged after the retention period' };
  }

  /** Recovery for FAILED processing (uploader in scope, or files:delete holders). */
  async retry(user: Principal, id: string) {
    const f = await this.prisma.fileAsset.findFirst({ where: { id, organizationId: user.organizationId, deletedAt: null } });
    const allowed = f && (await this.access.canAccessRecord(user, 'files:delete', { organizationId: f.organizationId, ownerId: f.uploaderId }));
    if (!f || !allowed) throw notFound('File');
    if (f.status !== 'FAILED') throw new AppError('NOT_RETRYABLE', `A ${f.status} file cannot be retried`, 409);
    const round = f.attempts + 1;
    await this.prisma.$transaction(async (tx) => {
      await tx.fileAsset.update({ where: { id }, data: { status: 'PENDING', progress: 0, lastError: null, scanStatus: 'PENDING' } });
      await this.outbox.publish(tx, { eventType: PLATFORM_EVENTS.FILE_PROCESS_REQUESTED, aggregateType: 'file', aggregateId: id, organizationId: user.organizationId, payload: { fileId: id, uploaderId: f.uploaderId }, idempotencyKey: `file.process:${id}:retry:${round}` });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'file.reprocess_requested', entityType: 'file', entityId: id });
    });
    return this.get(user, id);
  }

  allowedExtensions() {
    return Object.entries(EXTENSIONS).map(([ext, d]) => ({ extension: ext, category: d.category, mimes: d.mimes }));
  }
}
