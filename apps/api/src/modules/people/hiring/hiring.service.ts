import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  createCandidateSchema, createInterviewFeedbackSchema, createRequisitionSchema, listRequisitionsQuerySchema, moveCandidateSchema, updateRequisitionSchema, upsertEmployeeProfileSchema, upsertRoleProfileSchema,
} from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { AppError, forbidden, notFound } from '../../../common/http/errors';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { ensureCompetencies } from '../performance/competencies';
import { assertOrgUsers, isoDay, scopeUserIds, toDate, userNameMap, asPage } from '../common/helpers';
import { matchProfile } from './profile-match';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;

@Injectable()
export class HiringService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService) {}

  private async reqWhere(user: Principal): Promise<Prisma.RequisitionWhereInput> {
    const ids = await scopeUserIds(this.access, user, 'hiring:view');
    return { organizationId: user.organizationId, ...(ids ? { hiringManagerId: { in: ids } } : {}) };
  }

  private async assertManageReq(user: Principal, reqId: string) {
    const ids = await scopeUserIds(this.access, user, 'hiring:manage');
    const r = await this.prisma.requisition.findFirst({ where: { id: reqId, organizationId: user.organizationId, ...(ids ? { hiringManagerId: { in: ids } } : {}) } });
    if (!r) throw notFound('Requisition');
    return r;
  }

  // ---------------------------------------------------------------- role profiles (configurable hiring criteria)
  async listProfiles(user: Principal) {
    return this.prisma.hiringRoleProfile.findMany({ where: { organizationId: user.organizationId, isActive: true }, orderBy: [{ title: 'asc' }, { id: 'asc' }], take: 100 });
  }

  async upsertProfile(user: Principal, dto: Dto<typeof upsertRoleProfileSchema>) {
    if (this.access.scopeLevel(user, 'hiring:manage') !== 'org') throw forbidden('Role profiles are managed at organization level');
    const p = await this.prisma.$transaction(async (tx) => {
      const row = await tx.hiringRoleProfile.upsert({
        where: { organizationId_roleKey: { organizationId: user.organizationId, roleKey: dto.roleKey } },
        update: { ...dto, isActive: true },
        create: { organizationId: user.organizationId, ...dto },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'hiring.profile_saved', entityType: 'hiring_role_profile', entityId: row.id, metadata: { roleKey: dto.roleKey } });
      return row;
    });
    return p;
  }

  // ---------------------------------------------------------------- requisitions + pipeline
  async pipeline(user: Principal, q: Dto<typeof listRequisitionsQuerySchema>) {
    const where: Prisma.RequisitionWhereInput = { AND: [await this.reqWhere(user), q.status ? { status: q.status } : {}] };
    const rows = await this.prisma.requisition.findMany({ where, include: { candidates: { select: { stage: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.map((r) => r.hiringManagerId));
    return asPage(
      res,
      res.data.map((r) => {
        const stages: Record<string, number> = {};
        for (const c of r.candidates) stages[c.stage] = (stages[c.stage] ?? 0) + 1;
        return { id: r.id, title: r.title, roleKey: r.roleKey, profileId: r.profileId, hiringManagerId: r.hiringManagerId, hiringManagerName: names.get(r.hiringManagerId) ?? null, teamId: r.teamId, headcount: r.headcount, status: r.status, targetDate: isoDay(r.targetDate), notes: r.notes, candidateCount: r.candidates.length, stages, createdAt: r.createdAt };
      }),
    );
  }

  async createRequisition(user: Principal, dto: Dto<typeof createRequisitionSchema>) {
    const level = this.access.scopeLevel(user, 'hiring:manage');
    const hiringManagerId = dto.hiringManagerId ?? user.userId;
    await assertOrgUsers(this.prisma, user.organizationId, [hiringManagerId]);
    if (level !== 'org' && hiringManagerId !== user.userId) {
      const ids = await scopeUserIds(this.access, user, 'hiring:manage');
      if (ids && !ids.includes(hiringManagerId)) throw notFound('Hiring manager');
    }
    if (dto.profileId && !(await this.prisma.hiringRoleProfile.findFirst({ where: { id: dto.profileId, organizationId: user.organizationId } }))) throw notFound('Role profile');
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.requisition.create({ data: { organizationId: user.organizationId, title: dto.title, roleKey: dto.roleKey, profileId: dto.profileId, hiringManagerId, teamId: dto.teamId, headcount: dto.headcount, targetDate: dto.targetDate ? toDate(dto.targetDate) : null, notes: dto.notes, createdById: user.userId } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'hiring.requisition_created', entityType: 'requisition', entityId: r.id, metadata: { roleKey: dto.roleKey, headcount: dto.headcount } });
      return { id: r.id };
    });
  }

  async updateRequisition(user: Principal, id: string, dto: Dto<typeof updateRequisitionSchema>) {
    await this.assertManageReq(user, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.requisition.update({ where: { id }, data: { ...(dto.status ? { status: dto.status } : {}), ...(dto.headcount ? { headcount: dto.headcount } : {}), ...(dto.targetDate !== undefined ? { targetDate: dto.targetDate ? toDate(dto.targetDate) : null } : {}), ...(dto.notes !== undefined ? { notes: dto.notes } : {}) } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'hiring.requisition_updated', entityType: 'requisition', entityId: id, metadata: { fields: Object.keys(dto), status: dto.status } });
    });
    return { id };
  }

  // ---------------------------------------------------------------- candidates
  private candidateView(c: Prisma.CandidateGetPayload<{ include: { requisition: true } }>, profile: Prisma.HiringRoleProfileGetPayload<object> | null) {
    return {
      id: c.id, requisitionId: c.requisitionId, requisitionTitle: c.requisition.title, name: c.name, email: c.email, phone: c.phone, source: c.source, stage: c.stage, stageReason: c.stageReason,
      educationLevel: c.educationLevel, experienceYears: c.experienceYears, teamMgmtYears: c.teamMgmtYears, industries: c.industries, resumeFileId: c.resumeFileId, createdAt: c.createdAt,
      profileMatch: profile ? matchProfile(profile, { educationLevel: c.educationLevel, experienceYears: c.experienceYears, teamMgmtYears: c.teamMgmtYears, industries: c.industries }) : null,
    };
  }

  async listCandidates(user: Principal, requisitionId: string | undefined, q: Dto<typeof listRequisitionsQuerySchema>) {
    const reqWhere = await this.reqWhere(user);
    const rows = await this.prisma.candidate.findMany({
      where: { organizationId: user.organizationId, requisition: reqWhere, ...(requisitionId ? { requisitionId } : {}) },
      include: { requisition: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q),
    });
    const res = pageResult(rows, q);
    const profiles = new Map((await this.prisma.hiringRoleProfile.findMany({ where: { organizationId: user.organizationId } })).map((p) => [p.id, p]));
    return asPage(res, res.data.map((c) => this.candidateView(c, c.requisition.profileId ? profiles.get(c.requisition.profileId) ?? null : null)));
  }

  private async loadCandidate(user: Principal, id: string, perm: 'hiring:view' | 'hiring:manage') {
    const ids = await scopeUserIds(this.access, user, perm);
    const c = await this.prisma.candidate.findFirst({ where: { id, organizationId: user.organizationId, requisition: { organizationId: user.organizationId, ...(ids ? { hiringManagerId: { in: ids } } : {}) } }, include: { requisition: true } });
    if (!c) throw notFound('Candidate');
    return c;
  }

  async getCandidate(user: Principal, id: string) {
    const c = await this.loadCandidate(user, id, 'hiring:view');
    const profile = c.requisition.profileId ? await this.prisma.hiringRoleProfile.findUnique({ where: { id: c.requisition.profileId } }) : null;
    const feedback = await this.prisma.interviewFeedback.findMany({ where: { candidateId: id, organizationId: user.organizationId }, orderBy: [{ interviewAt: 'asc' }, { id: 'asc' }] });
    const names = await userNameMap(this.prisma, user.organizationId, feedback.map((f) => f.interviewerId));
    const hrView = this.access.has(user, 'hr:records:view');
    return {
      ...this.candidateView(c, profile),
      feedback: feedback.map((f) => ({
        id: f.id, interviewerId: f.interviewerId, interviewerName: names.get(f.interviewerId) ?? null, round: f.round, interviewAt: f.interviewAt, recommendation: f.recommendation, competencyScores: f.competencyScores,
        // Free-text interview notes: HR, the interviewer and the requisition's hiring manager only.
        notes: hrView || f.interviewerId === user.userId || c.requisition.hiringManagerId === user.userId ? f.notes : null,
        notesRestricted: !(hrView || f.interviewerId === user.userId || c.requisition.hiringManagerId === user.userId) && !!f.notes,
      })),
    };
  }

  async createCandidate(user: Principal, dto: Dto<typeof createCandidateSchema>) {
    await this.assertManageReq(user, dto.requisitionId);
    const { requisitionId, ...rest } = dto;
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.candidate.create({ data: { organizationId: user.organizationId, requisitionId, createdById: user.userId, ...rest } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'hiring.candidate_added', entityType: 'candidate', entityId: c.id, metadata: { requisitionId } });
      return { id: c.id };
    });
  }

  async moveCandidate(user: Principal, id: string, dto: Dto<typeof moveCandidateSchema>) {
    const c = await this.loadCandidate(user, id, 'hiring:manage');
    if (['HIRED', 'REJECTED', 'WITHDRAWN'].includes(c.stage)) throw new AppError('ILLEGAL_TRANSITION', `Candidate is already ${c.stage}`, 409);
    await this.prisma.$transaction(async (tx) => {
      await tx.candidate.update({ where: { id }, data: { stage: dto.stage, stageReason: dto.reason } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'hiring.candidate_stage_changed', entityType: 'candidate', entityId: id, metadata: { from: c.stage, to: dto.stage } });
    });
    return { id, stage: dto.stage };
  }

  async addFeedback(user: Principal, candidateId: string, dto: Dto<typeof createInterviewFeedbackSchema>) {
    await this.loadCandidate(user, candidateId, 'hiring:manage');
    const competencies = Object.keys(dto.competencyScores);
    if (competencies.length) {
      const known = await ensureCompetencies(this.prisma, user.organizationId);
      if (competencies.some((k) => !known.has(k))) throw new AppError('VALIDATION_ERROR', 'Unknown competency key', 400);
    }
    return this.prisma.$transaction(async (tx) => {
      const f = await tx.interviewFeedback.create({ data: { organizationId: user.organizationId, candidateId, interviewerId: user.userId, round: dto.round, interviewAt: new Date(dto.interviewAt), recommendation: dto.recommendation, competencyScores: dto.competencyScores, notes: dto.notes } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'hiring.feedback_added', entityType: 'candidate', entityId: candidateId, metadata: { round: dto.round, recommendation: dto.recommendation } });
      return { id: f.id };
    });
  }

  // ---------------------------------------------------------------- employee profiles (HR only)
  private profileView(p: Prisma.EmployeeProfileGetPayload<object>, name: string | null) {
    return { id: p.id, userId: p.userId, name, employmentType: p.employmentType, positionTitle: p.positionTitle, joinDate: isoDay(p.joinDate), probationEndDate: isoDay(p.probationEndDate), exitDate: isoDay(p.exitDate), exitType: p.exitType, exitReason: p.exitReason, updatedAt: p.updatedAt, probationMonths: p.probationMonths, dateOfBirth: isoDay(p.dateOfBirth), shareBirthday: p.shareBirthday, employeeCode: p.employeeCode, workLocation: p.workLocation, hrContactId: p.hrContactId };
  }

  async listEmployees(user: Principal, q: Dto<typeof listRequisitionsQuerySchema>) {
    const rows = await this.prisma.employeeProfile.findMany({ where: { organizationId: user.organizationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.map((p) => p.userId));
    return asPage(res, res.data.map((p) => this.profileView(p, names.get(p.userId) ?? null)));
  }

  async getEmployee(user: Principal, userId: string) {
    const u = await this.prisma.user.findFirst({ where: { id: userId, organizationId: user.organizationId }, select: { id: true, name: true } });
    if (!u) throw notFound('Employee');
    const p = await this.prisma.employeeProfile.findUnique({ where: { userId } });
    // reading an HR record is itself auditable
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'hr.record_viewed', entityType: 'employee_profile', entityId: p?.id ?? userId, metadata: { userId } });
    return p ? this.profileView(p, u.name) : { id: null, userId, name: u.name, employmentType: null, positionTitle: null, joinDate: null, probationEndDate: null, exitDate: null, exitType: null, exitReason: null, updatedAt: null, probationMonths: null, dateOfBirth: null, shareBirthday: false, employeeCode: null, workLocation: null, hrContactId: null };
  }

  async upsertEmployee(user: Principal, userId: string, dto: Dto<typeof upsertEmployeeProfileSchema>) {
    await assertOrgUsers(this.prisma, user.organizationId, [userId], { active: false });
    const data = {
      employmentType: dto.employmentType, positionTitle: dto.positionTitle,
      ...(dto.joinDate ? { joinDate: toDate(dto.joinDate) } : {}),
      ...(dto.probationEndDate !== undefined ? { probationEndDate: dto.probationEndDate ? toDate(dto.probationEndDate) : null } : {}),
      ...(dto.exitDate !== undefined ? { exitDate: dto.exitDate ? toDate(dto.exitDate) : null } : {}),
      ...(dto.exitType !== undefined ? { exitType: dto.exitType } : {}), ...(dto.exitReason !== undefined ? { exitReason: dto.exitReason } : {}),
      ...(dto.probationMonths !== undefined ? { probationMonths: dto.probationMonths } : {}),
      ...(dto.dateOfBirth !== undefined ? { dateOfBirth: dto.dateOfBirth ? toDate(dto.dateOfBirth) : null } : {}),
      ...(dto.shareBirthday !== undefined ? { shareBirthday: dto.shareBirthday } : {}),
      ...(dto.employeeCode !== undefined ? { employeeCode: dto.employeeCode } : {}),
      ...(dto.workLocation !== undefined ? { workLocation: dto.workLocation } : {}),
      ...(dto.hrContactId !== undefined ? { hrContactId: dto.hrContactId } : {}),
    };
    if (dto.hrContactId) await assertOrgUsers(this.prisma, user.organizationId, [dto.hrContactId]);
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.employeeProfile.upsert({ where: { userId }, update: data, create: { organizationId: user.organizationId, userId, ...data } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'hr.record_saved', entityType: 'employee_profile', entityId: r.id, metadata: { userId, fields: Object.keys(dto) } });
      return r;
    });
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    return this.profileView(row, u?.name ?? null);
  }
}
