import { Injectable } from '@nestjs/common';
import type { Prisma, SopVersion, SopDocument } from '@prisma/client';
import {
  type approveSopSchema, type createGapSchema, type createSopSchema, type createSopVersionSchema, type listGapsQuerySchema, type listSopQuerySchema, type updateGapSchema, type updateSopDraftSchema,
} from '@salesos/validation';
import { SOP_EVENTS } from '@salesos/shared-types';
import type { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { AccessService, type Principal } from '../../common/authz';
import { AppError, conflict, forbidden, notFound } from '../../common/http/errors';
import { OutboxService } from '../../common/outbox/outbox.service';
import { pageArgs, pageResult } from '../../common/pagination/pagination';
import { PrismaService } from '../../common/prisma';
import { type Tx } from '../../common/prisma';
import { assertOrgUsers, isoDay, todayUtc, toDate, userNameMap, asPage } from '../people/common/helpers';
import { computeAdoption, type AdoptionRequirement } from './adoption';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;
const LOCKED = ['APPROVED', 'SUPERSEDED', 'RETIRED'] as const;

@Injectable()
export class SopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private canSeeDrafts(u: Principal) {
    return this.access.has(u, 'sop:create') || this.access.has(u, 'sop:approve');
  }

  /** Effective version = highest APPROVED version whose effective date has arrived. */
  private effectiveOf(versions: Array<Pick<SopVersion, 'status' | 'effectiveDate' | 'versionNumber'> & { id: string }>) {
    const today = todayUtc().getTime();
    return versions
      .filter((v) => v.status === 'APPROVED' && (!v.effectiveDate || v.effectiveDate.getTime() <= today))
      .sort((a, b) => b.versionNumber - a.versionNumber)[0];
  }

  private versionDto(v: SopVersion, names: Map<string, string>, includeBody: boolean) {
    return {
      id: v.id, documentId: v.documentId, versionNumber: v.versionNumber, title: v.title, status: v.status,
      changeSummary: v.changeSummary, effectiveDate: isoDay(v.effectiveDate), attachmentFileIds: v.attachmentFileIds,
      createdById: v.createdById, createdByName: names.get(v.createdById) ?? null, createdAt: v.createdAt,
      submittedAt: v.submittedAt, approvedById: v.approvedById, approvedByName: v.approvedById ? names.get(v.approvedById) ?? null : null, approvedAt: v.approvedAt,
      rejectionReason: v.rejectionReason,
      ...(includeBody ? { body: v.body } : {}),
    };
  }

  private docDto(d: SopDocument, names: Map<string, string>) {
    return {
      id: d.id, category: d.category, title: d.title, summary: d.summary, ownerId: d.ownerId, ownerName: names.get(d.ownerId) ?? null,
      isMandatory: d.isMandatory, audienceRoles: d.audienceRoles, tags: d.tags, status: d.status, createdAt: d.createdAt, updatedAt: d.updatedAt,
    };
  }

  async list(user: Principal, q: Dto<typeof listSopQuerySchema>) {
    const drafts = this.canSeeDrafts(user);
    const where: Prisma.SopDocumentWhereInput = {
      organizationId: user.organizationId,
      ...(q.category ? { category: q.category } : {}),
      ...(q.mandatory ? { isMandatory: q.mandatory === 'true' } : {}),
      ...(q.includeRetired === 'true' && drafts ? {} : { status: 'ACTIVE' }),
      ...(drafts ? {} : { versions: { some: { status: 'APPROVED' } } }),
      ...(q.q
        ? {
            OR: [
              { title: { contains: q.q, mode: 'insensitive' } },
              { summary: { contains: q.q, mode: 'insensitive' } },
              { tags: { has: q.q.toLowerCase() } },
              { versions: { some: { status: 'APPROVED', body: { contains: q.q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.sopDocument.findMany({
      where,
      include: { versions: { select: { id: true, status: true, effectiveDate: true, versionNumber: true, approvedAt: true, createdById: true } } },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
      ...pageArgs(q),
    });
    const res = pageResult(rows, q);
    const items = res.data;
    const names = await userNameMap(this.prisma, user.organizationId, items.flatMap((d) => [d.ownerId]));
    const acks = await this.prisma.sopAcknowledgement.findMany({
      where: { organizationId: user.organizationId, userId: user.userId, documentId: { in: items.map((d) => d.id) } },
      select: { versionId: true },
    });
    const ackSet = new Set(acks.map((a) => a.versionId));
    const data = items.map((d) => {
      const eff = this.effectiveOf(d.versions);
      const open = d.versions.filter((v) => v.status === 'DRAFT' || v.status === 'PENDING_APPROVAL' || v.status === 'REJECTED');
      return {
        ...this.docDto(d, names),
        effectiveVersion: eff ? { id: eff.id, versionNumber: eff.versionNumber, effectiveDate: isoDay(eff.effectiveDate), acknowledgedByMe: ackSet.has(eff.id) } : null,
        ...(drafts ? { openVersion: open.sort((a, b) => b.versionNumber - a.versionNumber)[0] ? { id: open[0]!.id, versionNumber: open[0]!.versionNumber, status: open[0]!.status } : null } : {}),
      };
    });
    return asPage(res, data);
  }

  private async loadDoc(user: Principal, id: string): Promise<SopDocument> {
    const doc = await this.prisma.sopDocument.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!doc) throw notFound('SOP');
    return doc;
  }

  async get(user: Principal, id: string) {
    const doc = await this.loadDoc(user, id);
    const drafts = this.canSeeDrafts(user);
    const versions = await this.prisma.sopVersion.findMany({ where: { documentId: id, organizationId: user.organizationId }, orderBy: { versionNumber: 'desc' } });
    const visible = drafts ? versions : versions.filter((v) => ['APPROVED', 'SUPERSEDED', 'RETIRED'].includes(v.status));
    if (!drafts && visible.length === 0) throw notFound('SOP');
    const names = await userNameMap(this.prisma, user.organizationId, [doc.ownerId, ...visible.flatMap((v) => [v.createdById, v.approvedById])]);
    const eff = this.effectiveOf(visible);
    const myAck = eff ? await this.prisma.sopAcknowledgement.findUnique({ where: { versionId_userId: { versionId: eff.id, userId: user.userId } } }) : null;
    return {
      ...this.docDto(doc, names),
      effectiveVersionId: eff?.id ?? null,
      effectiveVersion: eff ? this.versionDto(visible.find((v) => v.id === eff.id)!, names, true) : null,
      acknowledgedByMe: !!myAck,
      acknowledgedAt: myAck?.acknowledgedAt ?? null,
      versions: visible.map((v) => this.versionDto(v, names, false)),
    };
  }

  async getVersion(user: Principal, versionId: string) {
    const v = await this.prisma.sopVersion.findFirst({ where: { id: versionId, organizationId: user.organizationId }, include: { document: true } });
    if (!v) throw notFound('SOP version');
    if (!this.canSeeDrafts(user) && !['APPROVED', 'SUPERSEDED', 'RETIRED'].includes(v.status)) throw notFound('SOP version');
    const names = await userNameMap(this.prisma, user.organizationId, [v.createdById, v.approvedById, v.document.ownerId]);
    return { ...this.versionDto(v, names, true), document: this.docDto(v.document, names) };
  }

  async create(user: Principal, dto: Dto<typeof createSopSchema>) {
    const ownerId = dto.ownerId ?? user.userId;
    await assertOrgUsers(this.prisma, user.organizationId, [ownerId]);
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.sopDocument.create({
        data: { organizationId: user.organizationId, category: dto.category, title: dto.title, summary: dto.summary, ownerId, isMandatory: dto.isMandatory, audienceRoles: dto.audienceRoles, tags: dto.tags.map((t) => t.toLowerCase()), createdById: user.userId },
      });
      const v = await tx.sopVersion.create({
        data: { organizationId: user.organizationId, documentId: doc.id, versionNumber: 1, title: dto.title, body: dto.body, changeSummary: dto.changeSummary ?? 'Initial version', effectiveDate: dto.effectiveDate ? toDate(dto.effectiveDate) : null, attachmentFileIds: dto.attachmentFileIds, createdById: user.userId },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'sop.created', entityType: 'sop_document', entityId: doc.id, metadata: { category: doc.category, versionId: v.id } });
      return { id: doc.id, versionId: v.id, versionNumber: 1 };
    });
  }

  async createVersion(user: Principal, docId: string, dto: Dto<typeof createSopVersionSchema>) {
    const doc = await this.loadDoc(user, docId);
    if (doc.status === 'RETIRED') throw conflict('SOP_RETIRED', 'This SOP is retired');
    return this.prisma.$transaction(async (tx) => {
      const open = await tx.sopVersion.findFirst({ where: { documentId: docId, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'REJECTED'] } } });
      if (open) throw conflict('OPEN_VERSION_EXISTS', 'Finish or discard the open draft version first');
      const max = await tx.sopVersion.aggregate({ where: { documentId: docId }, _max: { versionNumber: true } });
      const n = (max._max.versionNumber ?? 0) + 1;
      const v = await tx.sopVersion.create({
        data: { organizationId: user.organizationId, documentId: docId, versionNumber: n, title: dto.title ?? doc.title, body: dto.body, changeSummary: dto.changeSummary, effectiveDate: dto.effectiveDate ? toDate(dto.effectiveDate) : null, attachmentFileIds: dto.attachmentFileIds, createdById: user.userId },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'sop.version_created', entityType: 'sop_version', entityId: v.id, metadata: { documentId: docId, versionNumber: n } });
      return { id: v.id, versionNumber: n, status: v.status };
    });
  }

  private async loadVersion(user: Principal, id: string) {
    const v = await this.prisma.sopVersion.findFirst({ where: { id, organizationId: user.organizationId }, include: { document: true } });
    if (!v) throw notFound('SOP version');
    return v;
  }

  async updateDraft(user: Principal, versionId: string, dto: Dto<typeof updateSopDraftSchema>) {
    const v = await this.loadVersion(user, versionId);
    if (LOCKED.includes(v.status as never)) throw new AppError('SOP_VERSION_IMMUTABLE', 'Approved versions are immutable; create a new version', 409);
    if (v.status === 'PENDING_APPROVAL') throw conflict('SOP_PENDING', 'Version is awaiting approval');
    await this.prisma.$transaction(async (tx) => {
      await tx.sopVersion.update({
        where: { id: versionId },
        data: {
          ...(dto.title ? { title: dto.title } : {}), ...(dto.body ? { body: dto.body } : {}), ...(dto.changeSummary ? { changeSummary: dto.changeSummary } : {}),
          ...(dto.effectiveDate ? { effectiveDate: toDate(dto.effectiveDate) } : {}), ...(dto.attachmentFileIds ? { attachmentFileIds: dto.attachmentFileIds } : {}),
          status: 'DRAFT', rejectionReason: null,
        },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'sop.version_updated', entityType: 'sop_version', entityId: versionId, metadata: { fields: Object.keys(dto) } });
    });
    return { id: versionId, status: 'DRAFT' };
  }

  async submit(user: Principal, versionId: string) {
    const v = await this.loadVersion(user, versionId);
    if (v.status !== 'DRAFT') throw conflict('ILLEGAL_TRANSITION', `Cannot submit a ${v.status} version`);
    await this.prisma.$transaction(async (tx) => {
      await tx.sopVersion.update({ where: { id: versionId }, data: { status: 'PENDING_APPROVAL', submittedAt: new Date() } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'sop.version_submitted', entityType: 'sop_version', entityId: versionId, metadata: { documentId: v.documentId } });
      await this.outbox.publish(tx, { eventType: SOP_EVENTS.VERSION_SUBMITTED, aggregateType: 'sop_version', aggregateId: versionId, organizationId: user.organizationId, payload: { versionId, documentId: v.documentId, submittedById: user.userId }, idempotencyKey: `sop-submitted:${versionId}` });
    });
    return { id: versionId, status: 'PENDING_APPROVAL' };
  }

  async approve(user: Principal, versionId: string, dto: Dto<typeof approveSopSchema>) {
    const v = await this.loadVersion(user, versionId);
    if (v.status !== 'PENDING_APPROVAL') throw conflict('ILLEGAL_TRANSITION', `Cannot approve a ${v.status} version`);
    if (v.createdById === user.userId && !user.roles.includes('FOUNDER_CEO')) throw forbidden('You cannot approve a version you authored');
    const effective = dto.effectiveDate ? toDate(dto.effectiveDate) : v.effectiveDate ?? todayUtc();
    const audience = await this.audienceUsers(user.organizationId, v.document);
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.sopVersion.updateMany({ where: { id: versionId, status: 'PENDING_APPROVAL' }, data: { status: 'APPROVED', approvedById: user.userId, approvedAt: new Date(), effectiveDate: effective } });
      if (res.count !== 1) throw conflict('ILLEGAL_TRANSITION', 'Version state changed');
      if (effective.getTime() <= todayUtc().getTime()) {
        await tx.sopVersion.updateMany({ where: { documentId: v.documentId, status: 'APPROVED', id: { not: versionId }, versionNumber: { lt: v.versionNumber } }, data: { status: 'SUPERSEDED' } });
      }
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'sop.version_approved', entityType: 'sop_version', entityId: versionId, metadata: { documentId: v.documentId, versionNumber: v.versionNumber, effectiveDate: isoDay(effective) } });
      await this.outbox.publish(tx, { eventType: SOP_EVENTS.VERSION_APPROVED, aggregateType: 'sop_version', aggregateId: versionId, organizationId: user.organizationId, payload: { versionId, documentId: v.documentId, versionNumber: v.versionNumber, approvedById: user.userId, effectiveDate: isoDay(effective) }, idempotencyKey: `sop-approved:${versionId}` });
      if (v.document.isMandatory) await this.publishReminders(tx, user.organizationId, v.document, versionId, audience, 'approved');
    });
    return { id: versionId, status: 'APPROVED', effectiveDate: isoDay(effective), remindersQueued: v.document.isMandatory ? audience.length : 0 };
  }

  async reject(user: Principal, versionId: string, reason: string) {
    const v = await this.loadVersion(user, versionId);
    if (v.status !== 'PENDING_APPROVAL') throw conflict('ILLEGAL_TRANSITION', `Cannot reject a ${v.status} version`);
    await this.prisma.$transaction(async (tx) => {
      await tx.sopVersion.update({ where: { id: versionId }, data: { status: 'REJECTED', rejectedById: user.userId, rejectionReason: reason } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'sop.version_rejected', entityType: 'sop_version', entityId: versionId, metadata: { documentId: v.documentId } });
      await this.outbox.publish(tx, { eventType: SOP_EVENTS.VERSION_REJECTED, aggregateType: 'sop_version', aggregateId: versionId, organizationId: user.organizationId, payload: { versionId, authorId: v.createdById, reason }, idempotencyKey: `sop-rejected:${versionId}:${Date.now()}` });
    });
    return { id: versionId, status: 'REJECTED' };
  }

  async retire(user: Principal, docId: string) {
    const doc = await this.loadDoc(user, docId);
    if (doc.status === 'RETIRED') return { id: docId, status: 'RETIRED' };
    await this.prisma.$transaction(async (tx) => {
      await tx.sopDocument.update({ where: { id: docId }, data: { status: 'RETIRED' } });
      await tx.sopVersion.updateMany({ where: { documentId: docId, status: { in: ['APPROVED', 'SUPERSEDED'] } }, data: { status: 'RETIRED' } });
      await tx.sopVersion.updateMany({ where: { documentId: docId, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'REJECTED'] } }, data: { status: 'RETIRED' } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'sop.retired', entityType: 'sop_document', entityId: docId });
    });
    return { id: docId, status: 'RETIRED' };
  }

  async acknowledge(user: Principal, versionId: string) {
    const v = await this.loadVersion(user, versionId);
    const eff = this.effectiveOf([v]);
    if (!eff) throw conflict('SOP_NOT_EFFECTIVE', 'Only the currently effective approved version can be acknowledged');
    const audience = await this.audienceUsers(user.organizationId, v.document, [user.userId]);
    if (audience.length === 0) throw forbidden('This SOP is not addressed to your role');
    const existing = await this.prisma.sopAcknowledgement.findUnique({ where: { versionId_userId: { versionId, userId: user.userId } } });
    if (existing) return { versionId, acknowledgedAt: existing.acknowledgedAt, alreadyAcknowledged: true };
    const ack = await this.prisma.$transaction(async (tx) => {
      const row = await tx.sopAcknowledgement.upsert({
        where: { versionId_userId: { versionId, userId: user.userId } },
        update: {},
        create: { organizationId: user.organizationId, versionId, documentId: v.documentId, userId: user.userId },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'sop.acknowledged', entityType: 'sop_version', entityId: versionId, metadata: { documentId: v.documentId, versionNumber: v.versionNumber } });
      await this.outbox.publish(tx, { eventType: 'sop.acknowledged', aggregateType: 'sop_version', aggregateId: versionId, organizationId: user.organizationId, payload: { versionId, documentId: v.documentId }, idempotencyKey: `sop-ack:${versionId}:${user.userId}` });
      return row;
    });
    return { versionId, acknowledgedAt: ack.acknowledgedAt, alreadyAcknowledged: false };
  }

  /** Active users of the org addressed by the document (audienceRoles empty = everyone). Optional restriction to ids. */
  async audienceUsers(organizationId: string, doc: Pick<SopDocument, 'audienceRoles'>, onlyIds?: string[]): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        organizationId, isActive: true, ...(onlyIds ? { id: { in: onlyIds } } : {}),
        ...(doc.audienceRoles.length ? { roleAssignments: { some: { role: { key: { in: doc.audienceRoles } } } } } : {}),
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  private async publishReminders(tx: Tx, organizationId: string, doc: SopDocument, versionId: string, userIds: string[], tag: string, skip = new Set<string>()) {
    const day = new Date().toISOString().slice(0, 10);
    for (const userId of userIds) {
      if (skip.has(userId)) continue;
      await this.outbox.publish(tx, {
        eventType: SOP_EVENTS.ACK_REMINDER, aggregateType: 'sop_version', aggregateId: versionId, organizationId,
        payload: { organizationId, versionId, documentId: doc.id, documentTitle: doc.title, userId },
        idempotencyKey: `sop-ack-reminder:${tag}:${versionId}:${userId}:${tag === 'approved' ? '' : day}`,
      });
    }
  }

  /** Manual reminder to everyone in scope who has not acknowledged the effective version. */
  async remind(user: Principal, versionId: string) {
    const v = await this.loadVersion(user, versionId);
    if (!this.effectiveOf([v])) throw conflict('SOP_NOT_EFFECTIVE', 'Reminders only apply to the effective version');
    const audience = await this.audienceUsers(user.organizationId, v.document);
    const acked = new Set((await this.prisma.sopAcknowledgement.findMany({ where: { versionId }, select: { userId: true } })).map((a) => a.userId));
    await this.prisma.$transaction(async (tx) => {
      await this.publishReminders(tx, user.organizationId, v.document, versionId, audience, 'manual', acked);
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'sop.reminders_sent', entityType: 'sop_version', entityId: versionId, metadata: { pending: audience.length - audience.filter((a) => acked.has(a)).length } });
    });
    return { versionId, queued: audience.filter((a) => !acked.has(a)).length };
  }

  /** Adoption / compliance. Scope: org -> all active users; team -> visible users; own -> self only. */
  async adoption(user: Principal, q: { documentId?: string }) {
    const level = this.access.scopeLevel(user, 'sop:adoption:view');
    if (!level) throw forbidden();
    const scoped = level === 'org' || level === 'summary' ? undefined : level === 'own' ? [user.userId] : (await this.access.visibleUsers(user)).ids;
    const docs = await this.prisma.sopDocument.findMany({
      where: { organizationId: user.organizationId, status: 'ACTIVE', isMandatory: true, ...(q.documentId ? { id: q.documentId } : {}) },
      include: { versions: { where: { status: 'APPROVED' } } },
    });
    const reqs: AdoptionRequirement[] = [];
    for (const d of docs) {
      const eff = this.effectiveOf(d.versions);
      if (!eff) continue;
      reqs.push({ documentId: d.id, documentTitle: d.title, versionId: eff.id, versionNumber: eff.versionNumber, requiredUserIds: await this.audienceUsers(user.organizationId, d, scoped) });
    }
    const acks = await this.prisma.sopAcknowledgement.findMany({ where: { organizationId: user.organizationId, versionId: { in: reqs.map((r) => r.versionId) } }, select: { versionId: true, userId: true } });
    const map = new Map<string, Set<string>>();
    for (const a of acks) (map.get(a.versionId) ?? map.set(a.versionId, new Set()).get(a.versionId)!).add(a.userId);
    const result = computeAdoption(reqs, map);
    const names = await userNameMap(this.prisma, user.organizationId, result.byUser.map((u) => u.userId));
    return {
      scope: level,
      overall: result.overall,
      byDocument: result.byDocument.map((d) => ({ ...d, pending: d.pendingUserIds.map((id) => ({ userId: id, name: names.get(id) ?? null })) })),
      byUser: result.byUser.map((u) => ({ ...u, name: names.get(u.userId) ?? null })).sort((a, b) => (a.ratePct ?? 101) - (b.ratePct ?? 101)),
    };
  }

  /** Acknowledgement history (who acknowledged which version when) for a document; scope follows adoption view. */
  async acknowledgementHistory(user: Principal, docId: string) {
    await this.loadDoc(user, docId);
    const level = this.access.scopeLevel(user, 'sop:adoption:view');
    if (!level) throw forbidden();
    const ids = level === 'org' || level === 'summary' ? undefined : level === 'own' ? [user.userId] : (await this.access.visibleUsers(user)).ids;
    const rows = await this.prisma.sopAcknowledgement.findMany({
      where: { organizationId: user.organizationId, documentId: docId, ...(ids ? { userId: { in: ids } } : {}) },
      include: { version: { select: { versionNumber: true } } },
      orderBy: [{ acknowledgedAt: 'desc' }, { id: 'desc' }],
      take: 500,
    });
    const names = await userNameMap(this.prisma, user.organizationId, rows.map((r) => r.userId));
    return rows.map((r) => ({ id: r.id, versionId: r.versionId, versionNumber: r.version.versionNumber, userId: r.userId, userName: names.get(r.userId) ?? null, acknowledgedAt: r.acknowledgedAt }));
  }

  // ------------------------------------------------------------------ gaps
  private async gapScope(user: Principal, perm: 'sop:gaps:view' | 'sop:gaps:manage'): Promise<Prisma.ProcessGapWhereInput> {
    const level = this.access.scopeLevel(user, perm);
    if (!level) throw forbidden();
    if (level === 'org' || level === 'summary') return {};
    const ids = level === 'own' ? [user.userId] : (await this.access.visibleUsers(user)).ids;
    return { OR: [{ ownerId: { in: ids } }, { reportedById: { in: ids } }] };
  }

  async listGaps(user: Principal, q: Dto<typeof listGapsQuerySchema>) {
    const scope = await this.gapScope(user, 'sop:gaps:view');
    const rows = await this.prisma.processGap.findMany({
      where: { ...scope, organizationId: user.organizationId, ...(q.status ? { status: q.status } : {}), ...(q.kind ? { kind: q.kind } : {}) },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      ...pageArgs(q),
    });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.flatMap((g) => [g.ownerId, g.reportedById]));
    return asPage(res, res.data.map((g) => ({ ...g, ownerName: g.ownerId ? names.get(g.ownerId) ?? null : null, reportedByName: names.get(g.reportedById) ?? null })));
  }

  async createGap(user: Principal, dto: Dto<typeof createGapSchema>) {
    if (dto.ownerId) await assertOrgUsers(this.prisma, user.organizationId, [dto.ownerId]);
    if (dto.linkedSopId) await this.loadDoc(user, dto.linkedSopId);
    return this.prisma.$transaction(async (tx) => {
      const g = await tx.processGap.create({ data: { organizationId: user.organizationId, kind: dto.kind, title: dto.title, description: dto.description, ownerId: dto.ownerId ?? user.userId, priority: dto.priority, linkedSopId: dto.linkedSopId, reportedById: user.userId } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'sop.gap_created', entityType: 'process_gap', entityId: g.id, metadata: { kind: g.kind } });
      return g;
    });
  }

  async updateGap(user: Principal, id: string, dto: Dto<typeof updateGapSchema>) {
    const g = await this.prisma.processGap.findFirst({ where: { ...(await this.gapScope(user, 'sop:gaps:manage')), id, organizationId: user.organizationId } });
    if (!g) throw notFound('Process gap');
    if (dto.ownerId) await assertOrgUsers(this.prisma, user.organizationId, [dto.ownerId]);
    if (dto.linkedSopId) await this.loadDoc(user, dto.linkedSopId);
    if (dto.status === 'RESOLVED' && !(dto.resolution ?? g.resolution)) throw new AppError('VALIDATION_ERROR', 'A resolution is required', 400);
    return this.prisma.$transaction(async (tx) => {
      const upd = await tx.processGap.update({
        where: { id },
        data: { ...dto, ...(dto.status === 'RESOLVED' || dto.status === 'WONT_FIX' ? { resolvedAt: new Date() } : dto.status ? { resolvedAt: null } : {}) },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'sop.gap_updated', entityType: 'process_gap', entityId: id, metadata: { from: g.status, to: upd.status } });
      return upd;
    });
  }
}
