import { Injectable } from '@nestjs/common';
import type { createSurveySchema, submitSurveyResponseSchema } from '@salesos/validation';
import type { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { AuditService } from '../../../common/audit/audit.service';
import type { Principal } from '../../../common/authz';
import { AppError, conflict, notFound } from '../../../common/http/errors';
import { PrismaService } from '../../../common/prisma';

type Dto<T extends z.ZodTypeAny> = z.infer<T>;
/** Aggregates are suppressed below this many responses (anonymity floor). */
export const MIN_RESPONSES_FOR_RESULTS = 5;

interface Question { id: string; text: string; type: 'SCALE_5' | 'TEXT' }

/** Pure: aggregate scale answers; returns null below the anonymity floor. */
export function aggregateResponses(questions: Question[], answers: Array<Record<string, number | string>>, floor = MIN_RESPONSES_FOR_RESULTS) {
  if (answers.length < floor) return null;
  return questions.filter((q) => q.type === 'SCALE_5').map((q) => {
    const vals = answers.map((a) => a[q.id]).filter((v): v is number => typeof v === 'number');
    const dist: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const v of vals) dist[String(v)] = (dist[String(v)] ?? 0) + 1;
    return { questionId: q.id, text: q.text, responses: vals.length, average: vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100 : null, distribution: dist };
  });
}

@Injectable()
export class EngagementService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly outbox: OutboxService) {}

  async openSurveys(user: Principal) {
    const rows = await this.prisma.engagementSurvey.findMany({ where: { organizationId: user.organizationId, status: 'OPEN' }, include: { participation: { where: { userId: user.userId } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 });
    return rows.map((s) => ({ id: s.id, title: s.title, questions: s.questions, closesAt: s.closesAt, answered: s.participation.length > 0 }));
  }

  async createSurvey(user: Principal, dto: Dto<typeof createSurveySchema>) {
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.engagementSurvey.create({ data: { organizationId: user.organizationId, title: dto.title, questions: dto.questions, closesAt: dto.closesAt ? new Date(dto.closesAt) : null, createdById: user.userId } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'engagement.survey_created', entityType: 'engagement_survey', entityId: s.id });
      return { id: s.id };
    });
  }

  /** Anonymous: the response row has no user reference; a separate participation row blocks duplicates. */
  async respond(user: Principal, dto: Dto<typeof submitSurveyResponseSchema>) {
    const s = await this.prisma.engagementSurvey.findFirst({ where: { id: dto.surveyId, organizationId: user.organizationId } });
    if (!s) throw notFound('Survey');
    if (s.status !== 'OPEN' || (s.closesAt && s.closesAt < new Date())) throw conflict('SURVEY_CLOSED', 'This survey is closed');
    const qs = s.questions as unknown as Question[];
    for (const [qid, val] of Object.entries(dto.answers)) {
      const q = qs.find((x) => x.id === qid);
      if (!q || (q.type === 'SCALE_5') !== (typeof val === 'number')) throw new AppError('VALIDATION_ERROR', `Invalid answer for question ${qid}`, 400);
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.engagementParticipation.create({ data: { surveyId: s.id, userId: user.userId } });
        await tx.engagementResponse.create({ data: { organizationId: user.organizationId, surveyId: s.id, answers: dto.answers, respondedOn: new Date(new Date().toISOString().slice(0, 10)) } });
        // anonymous by design: the event names the survey only, never the respondent (the key is random, not user-derived)
        await this.outbox.publish(tx, { eventType: 'engagement.responded', aggregateType: 'engagement_survey', aggregateId: s.id, organizationId: user.organizationId, payload: { surveyId: s.id }, idempotencyKey: `engagement-response:${s.id}:${randomUUID()}` });
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw conflict('ALREADY_RESPONDED', 'You have already responded to this survey');
      throw e;
    }
    return { surveyId: s.id, submitted: true };
  }

  async results(user: Principal, surveyId?: string) {
    const surveys = await this.prisma.engagementSurvey.findMany({ where: { organizationId: user.organizationId, ...(surveyId ? { id: surveyId } : {}) }, include: { responses: { select: { answers: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 12 });
    return surveys.map((s) => {
      const answers = s.responses.map((r) => r.answers as Record<string, number | string>);
      const agg = aggregateResponses(s.questions as unknown as Question[], answers);
      return { surveyId: s.id, title: s.title, status: s.status, responseCount: answers.length, suppressed: agg === null, minResponses: MIN_RESPONSES_FOR_RESULTS, questions: agg };
    });
  }
}
