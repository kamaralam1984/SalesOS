import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { createSatisfactionSchema, createSurveyTemplateSchema, listSatisfactionQuerySchema, satisfactionStatsQuerySchema, updateSurveyTemplateSchema } from '@salesos/validation';
import type { z } from 'zod';
import { AuditService } from '../../../common/audit/audit.service';
import { AccessService, type Principal } from '../../../common/authz';
import { AppError, conflict, notFound } from '../../../common/http/errors';
import { pageArgs, pageResult } from '../../../common/pagination/pagination';
import { PrismaService } from '../../../common/prisma';
import { assertOrgRefs, loadVisibleLead, scopedByUsers, userNameMap, withData } from '../common/support';
import { BUILTIN_TEMPLATES, SCORE_RANGE, type SurveyQuestion } from './survey-defaults';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;
type Kind = 'CSAT' | 'NPS' | 'ENROLMENT_EXPERIENCE';
const ENROLMENT_WINDOW_DAYS = 7;

@Injectable()
export class SatisfactionService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService) {}

  // ------------------------------------------------------------------ templates (configurable questions)
  async templates(user: Principal) {
    const rows = await this.prisma.surveyTemplate.findMany({ where: { organizationId: user.organizationId }, orderBy: [{ kind: 'asc' }, { key: 'asc' }] });
    const have = new Set(rows.filter((r) => r.isActive).map((r) => r.kind));
    const builtin = (['CSAT', 'NPS', 'ENROLMENT_EXPERIENCE'] as Kind[]).filter((k) => !have.has(k)).map((k) => ({ id: null, key: `builtin-${k.toLowerCase()}`, name: BUILTIN_TEMPLATES[k].name, kind: k, questions: BUILTIN_TEMPLATES[k].questions, version: 0, isActive: true, builtin: true }));
    return [...rows.map((r) => ({ id: r.id, key: r.key, name: r.name, kind: r.kind, questions: r.questions as unknown as SurveyQuestion[], version: r.version, isActive: r.isActive, builtin: false })), ...builtin];
  }

  async createTemplate(user: Principal, dto: Dto<typeof createSurveyTemplateSchema>) {
    const exists = await this.prisma.surveyTemplate.findFirst({ where: { organizationId: user.organizationId, key: dto.key } });
    if (exists) throw conflict('TEMPLATE_KEY_EXISTS', 'A survey template with this key already exists');
    this.assertQuestions(dto.kind, dto.questions);
    const t = await this.prisma.$transaction(async (tx) => {
      // one active template per kind: activating a new one retires the previous (history keeps its own version)
      await tx.surveyTemplate.updateMany({ where: { organizationId: user.organizationId, kind: dto.kind, isActive: true }, data: { isActive: false } });
      const row = await tx.surveyTemplate.create({ data: { organizationId: user.organizationId, key: dto.key, name: dto.name, kind: dto.kind, questions: dto.questions as unknown as Prisma.InputJsonValue, createdById: user.userId } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'survey_template.created', entityType: 'survey_template', entityId: row.id, metadata: { kind: dto.kind, key: dto.key } });
      return row;
    });
    return { id: t.id, key: t.key, name: t.name, kind: t.kind, questions: dto.questions, version: t.version, isActive: t.isActive, builtin: false };
  }

  async updateTemplate(user: Principal, id: string, dto: Dto<typeof updateSurveyTemplateSchema>) {
    const t = await this.prisma.surveyTemplate.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!t) throw notFound('Survey template');
    if (dto.questions) this.assertQuestions(t.kind, dto.questions);
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isActive === true) await tx.surveyTemplate.updateMany({ where: { organizationId: user.organizationId, kind: t.kind, isActive: true, id: { not: id } }, data: { isActive: false } });
      const row = await tx.surveyTemplate.update({ where: { id }, data: { ...(dto.name ? { name: dto.name } : {}), ...(dto.questions ? { questions: dto.questions as unknown as Prisma.InputJsonValue, version: { increment: 1 } } : {}), ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}) } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'survey_template.updated', entityType: 'survey_template', entityId: id, metadata: { fields: Object.keys(dto) } });
      return row;
    });
    return { id: updated.id, key: updated.key, name: updated.name, kind: updated.kind, questions: updated.questions as unknown as SurveyQuestion[], version: updated.version, isActive: updated.isActive, builtin: false };
  }

  private assertQuestions(kind: Kind, qs: SurveyQuestion[]) {
    const want = kind === 'NPS' ? 'NPS_0_10' : 'RATING_1_5';
    if (!qs.some((q) => q.type === want && q.required)) throw new AppError('VALIDATION_ERROR', `A ${kind} template needs a required ${want} question (it provides the headline score)`, 422);
    if (new Set(qs.map((q) => q.id)).size !== qs.length) throw new AppError('VALIDATION_ERROR', 'Question ids must be unique', 422);
  }

  // ------------------------------------------------------------------ responses
  async create(user: Principal, dto: Dto<typeof createSatisfactionSchema>) {
    const tpl = dto.templateId ? await this.prisma.surveyTemplate.findFirst({ where: { id: dto.templateId, organizationId: user.organizationId, isActive: true } }) : null;
    if (dto.templateId && !tpl) throw notFound('Survey template');
    const kind = (tpl?.kind ?? dto.kind) as Kind | undefined;
    if (!kind) throw new AppError('VALIDATION_ERROR', 'kind or templateId is required', 400);
    if (tpl && dto.kind && dto.kind !== tpl.kind) throw new AppError('VALIDATION_ERROR', 'kind does not match the template', 400);
    const questions = (tpl ? (tpl.questions as unknown as SurveyQuestion[]) : BUILTIN_TEMPLATES[kind].questions) as SurveyQuestion[];
    const answers = dto.answers;

    // validate answers against the questions
    const byQ = new Map(answers.map((a) => [a.questionId, a.value]));
    for (const a of answers) if (!questions.some((q) => q.id === a.questionId)) throw new AppError('VALIDATION_ERROR', `Unknown question: ${a.questionId}`, 422);
    let derived: number | undefined;
    const want = kind === 'NPS' ? 'NPS_0_10' : 'RATING_1_5';
    for (const q of questions) {
      const v = byQ.get(q.id);
      if (v === undefined || v === '') {
        if (q.required && answers.length > 0) throw new AppError('FIELDS_REQUIRED', `Answer required: ${q.text}`, 422, [{ path: q.id, message: 'required' }]);
        continue;
      }
      if (q.type === 'RATING_1_5' && !(typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5)) throw new AppError('VALIDATION_ERROR', `${q.id}: rating must be 1-5`, 422);
      if (q.type === 'NPS_0_10' && !(typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10)) throw new AppError('VALIDATION_ERROR', `${q.id}: score must be 0-10`, 422);
      if (q.type === 'YES_NO' && typeof v !== 'boolean') throw new AppError('VALIDATION_ERROR', `${q.id}: expected yes/no`, 422);
      if (q.type === 'TEXT' && typeof v !== 'string') throw new AppError('VALIDATION_ERROR', `${q.id}: expected text`, 422);
      if (q.type === want && derived === undefined && typeof v === 'number') derived = v;
    }
    const score = dto.score ?? derived;
    const [lo, hi] = SCORE_RANGE[kind];
    if (score === undefined || !Number.isInteger(score) || score < lo || score > hi) throw new AppError('VALIDATION_ERROR', `A ${kind} score of ${lo}-${hi} is required`, 422, [{ path: 'score', message: `${lo}-${hi}` }]);

    const lead = dto.leadId ? await loadVisibleLead(this.prisma, this.access, user, dto.leadId) : null;
    await assertOrgRefs(this.prisma, user.organizationId, { dealId: dto.dealId, complaintId: dto.complaintId, handoverId: dto.handoverId, programId: dto.programId });
    if (!lead && !dto.respondentRef) throw new AppError('VALIDATION_ERROR', 'A respondent reference is required: link a learner (leadId) or give respondentRef', 422, [{ path: 'respondentRef', message: 'required' }]);
    const respondedAt = dto.respondedAt ? new Date(dto.respondedAt) : new Date();
    if (respondedAt.getTime() > Date.now() + 5 * 60_000) throw new AppError('VALIDATION_ERROR', 'respondedAt cannot be in the future', 422);
    const outsideWindow = kind === 'ENROLMENT_EXPERIENCE' && !!lead?.wonAt && respondedAt.getTime() - lead.wonAt.getTime() > ENROLMENT_WINDOW_DAYS * 86_400_000;

    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.satisfactionResponse.create({
        data: {
          organizationId: user.organizationId, templateId: tpl?.id ?? null, templateVersion: tpl?.version ?? null, kind, leadId: lead?.id ?? null,
          respondentRef: dto.respondentRef ?? (lead ? `lead:${lead.id}` : null), respondentName: dto.respondentName ?? null, dealId: dto.dealId ?? null,
          complaintId: dto.complaintId ?? null, handoverId: dto.handoverId ?? null, programId: dto.programId ?? lead?.programId ?? null, score,
          answers: answers as unknown as Prisma.InputJsonValue, comment: dto.comment ?? null, consentGiven: true, consentAt: new Date(), channel: dto.channel,
          respondedAt, capturedById: user.userId, ownerId: lead?.assignedToId ?? user.userId, outsideWindow,
        },
      });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'satisfaction.captured', entityType: 'satisfaction_response', entityId: r.id, metadata: { kind, score, leadId: lead?.id ?? null } });
      return r;
    });
    return this.view(row, new Map());
  }

  private view(r: Prisma.SatisfactionResponseGetPayload<object>, names: Map<string, string>) {
    return {
      id: r.id, kind: r.kind, score: r.score, answers: r.answers, comment: r.comment, leadId: r.leadId, respondentRef: r.respondentRef, respondentName: r.respondentName,
      dealId: r.dealId, complaintId: r.complaintId, handoverId: r.handoverId, programId: r.programId, templateId: r.templateId, templateVersion: r.templateVersion,
      consentGiven: r.consentGiven, consentAt: r.consentAt, channel: r.channel, respondedAt: r.respondedAt, capturedByName: names.get(r.capturedById) ?? null, outsideWindow: r.outsideWindow, createdAt: r.createdAt,
    };
  }

  private async where(user: Principal): Promise<Prisma.SatisfactionResponseWhereInput> {
    return (await scopedByUsers(this.access, user, 'satisfaction:view', ['ownerId', 'capturedById'])) as Prisma.SatisfactionResponseWhereInput;
  }

  async list(user: Principal, q: Dto<typeof listSatisfactionQuerySchema>) {
    const f: Prisma.SatisfactionResponseWhereInput = {
      ...(q.kind ? { kind: q.kind } : {}), ...(q.leadId ? { leadId: q.leadId } : {}), ...(q.programId ? { programId: q.programId } : {}),
      ...(q.from || q.to ? { respondedAt: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00.000Z`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999Z`) } : {}) } } : {}),
    };
    const rows = await this.prisma.satisfactionResponse.findMany({ where: { AND: [await this.where(user), f] }, orderBy: [{ respondedAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) });
    const res = pageResult(rows, q);
    const names = await userNameMap(this.prisma, user.organizationId, res.data.map((r) => r.capturedById));
    return withData(res, res.data.map((r) => this.view(r, names)));
  }

  /** KPI-CX-001/004 inputs: mean, % satisfied (4-5), NPS, n with the minimum-sample caution flag (n < 5). */
  async stats(user: Principal, q: Dto<typeof satisfactionStatsQuerySchema>) {
    const to = q.to ? new Date(`${q.to}T23:59:59.999Z`) : new Date();
    const from = q.from ? new Date(`${q.from}T00:00:00.000Z`) : new Date(to.getTime() - 180 * 86_400_000);
    const rows = await this.prisma.satisfactionResponse.findMany({
      where: { AND: [await this.where(user), { respondedAt: { gte: from, lte: to } }, ...(q.kind ? [{ kind: q.kind }] : []), ...(q.programId ? [{ programId: q.programId }] : [])] },
      select: { kind: true, score: true, respondedAt: true, outsideWindow: true, programId: true },
      take: 50_000,
    });
    const summarise = (rs: typeof rows, kind: Kind) => {
      const k = rs.filter((r) => r.kind === kind && !(kind === 'ENROLMENT_EXPERIENCE' && r.outsideWindow));
      const n = k.length;
      const mean = n ? Math.round((k.reduce((a, r) => a + r.score, 0) / n) * 10) / 10 : null;
      const out: Record<string, unknown> = { kind, n, mean, lowSample: n > 0 && n < 5, excludedOutsideWindow: kind === 'ENROLMENT_EXPERIENCE' ? rs.filter((r) => r.kind === kind && r.outsideWindow).length : 0 };
      if (kind === 'NPS') {
        const pro = k.filter((r) => r.score >= 9).length;
        const det = k.filter((r) => r.score <= 6).length;
        out.nps = n ? Math.round(((pro - det) / n) * 100) : null;
        out.promoters = pro; out.detractors = det;
      } else {
        out.satisfiedPct = n ? Math.round((k.filter((r) => r.score >= 4).length / n) * 1000) / 10 : null;
      }
      return out;
    };
    const kinds: Kind[] = q.kind ? [q.kind] : ['CSAT', 'NPS', 'ENROLMENT_EXPERIENCE'];
    const bucketKey = (d: Date) => {
      if (q.bucket === 'month') return d.toISOString().slice(0, 7);
      const dow = (d.getUTCDay() + 6) % 7;
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)).toISOString().slice(0, 10);
    };
    const series = new Map<string, { bucket: string; n: number; sum: number }>();
    for (const r of rows) {
      if (r.kind === 'NPS' || (r.kind === 'ENROLMENT_EXPERIENCE' && r.outsideWindow)) continue;
      const k = `${r.kind}|${bucketKey(r.respondedAt)}`;
      const b = series.get(k) ?? { bucket: k, n: 0, sum: 0 };
      b.n += 1; b.sum += r.score; series.set(k, b);
    }
    return {
      from: from.toISOString(), to: to.toISOString(), bucket: q.bucket,
      summaries: kinds.map((k) => summarise(rows, k)),
      series: [...series.values()].map((b) => ({ kind: b.bucket.split('|')[0], bucket: b.bucket.split('|')[1], n: b.n, mean: Math.round((b.sum / b.n) * 10) / 10 })).sort((a, b) => `${a.kind}${a.bucket}`.localeCompare(`${b.kind}${b.bucket}`)),
      note: 'Responses under n=5 are flagged lowSample (KPI-CX-001 exclusions). Enrolment responses beyond 7 days are excluded and counted separately.',
    };
  }
}
