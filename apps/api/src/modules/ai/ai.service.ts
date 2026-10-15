import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DEFAULT_AI_SETTINGS, getSetting, putSetting, type AiSettings } from '@salesos/platform-core';
import type { CrmLeadContext } from '@salesos/shared-types';
import { AuditService } from '../../common/audit/audit.service';
import type { Principal } from '../../common/authz';
import { AppError, notFound } from '../../common/http/errors';
import { PrismaService } from '../../common/prisma';
import { CrmContextRegistry } from './crm-context';
import { AI_LABEL, SYSTEM_PROMPT, neutralise, wrapNotes } from './guardrails';
import { prioritise } from './priority';
import { AiProviderError, AnthropicProvider, FakeProvider, GeminiProvider, OpenAiProvider, estimateCostUsd, promptFor, type AiProvider } from './providers';
import { redactPii } from './redact';
import { OUTPUT_SCHEMAS, type Feature } from './schemas';

const INSUFFICIENT = 'Insufficient data: there are not enough rep-entered notes or CRM history to produce this safely. Nothing was generated.';
const MIN_SOURCE_CHARS = 25;

type Source = { text: string; origin: 'REP_ENTERED_TEXT' | 'CRM_NOTES'; period: { from: string | null; to: string | null }; noteCount: number; leadId?: string; knownNames: string[]; callSources?: string[] };

@Injectable()
export class AiService {
  private readonly providers = new Map<string, AiProvider>([
    ['fake', new FakeProvider()], ['openai', new OpenAiProvider()], ['gemini', new GeminiProvider()], ['anthropic', new AnthropicProvider()],
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crm: CrmContextRegistry,
  ) {}

  settings(organizationId: string): Promise<AiSettings> {
    return getSetting(this.prisma, organizationId, 'ai', DEFAULT_AI_SETTINGS);
  }

  async config(organizationId: string) {
    const s = await this.settings(organizationId);
    return {
      ...s,
      providersAvailable: {
        fake: true, openai: !!process.env.OPENAI_API_KEY, gemini: !!process.env.GEMINI_API_KEY, anthropic: !!process.env.ANTHROPIC_API_KEY,
      },
      note: 'API keys are read from the server environment only and are never stored in the database or returned by the API.',
    };
  }

  async patchConfig(user: Principal, patch: Partial<AiSettings>) {
    const cur = await this.settings(user.organizationId);
    const next = { ...cur, ...patch };
    await putSetting(this.prisma, user.organizationId, 'ai', next, user.userId);
    await this.audit.record({ organizationId: user.organizationId, actorId: user.userId, action: 'ai.config_changed', entityType: 'platform_settings', metadata: { fields: Object.keys(patch), enabled: next.enabled, provider: next.provider } });
    return this.config(user.organizationId);
  }

  /** Flag gate: with AI off every Copilot endpoint answers 404 (the CRM never depends on it). */
  private async requireEnabled(organizationId: string): Promise<AiSettings> {
    const s = await this.settings(organizationId);
    if (!s.enabled) throw new AppError('AI_DISABLED', 'AI Copilot is not enabled for this organisation', 404);
    return s;
  }

  async status(user: Principal) {
    const s = await this.settings(user.organizationId);
    return { enabled: s.enabled, label: AI_LABEL };
  }

  private async log(user: Principal, feature: string, s: AiSettings, outcome: string, extra: Partial<{ latencyMs: number; inputTokens: number; outputTokens: number; errorCode: string; redactions: number; model: string; provider: string }> = {}) {
    const model = extra.model ?? s.model;
    await this.prisma.aiUsageLog.create({
      data: {
        organizationId: user.organizationId, userId: user.userId, feature, provider: extra.provider ?? s.provider, model, outcome, latencyMs: extra.latencyMs ?? 0,
        inputTokens: extra.inputTokens ?? 0, outputTokens: extra.outputTokens ?? 0, costUsd: estimateCostUsd(model, extra.inputTokens ?? 0, extra.outputTokens ?? 0), errorCode: extra.errorCode ?? null, redactions: extra.redactions ?? 0,
      },
    });
  }

  private async rateLimit(user: Principal, s: AiSettings, feature: string) {
    const n = await this.prisma.aiUsageLog.count({ where: { organizationId: user.organizationId, userId: user.userId, createdAt: { gte: new Date(Date.now() - 60_000) }, outcome: { not: 'RATE_LIMITED' } } });
    if (n >= s.rateLimitPerMinute) {
      await this.log(user, feature, s, 'RATE_LIMITED');
      throw new AppError('AI_RATE_LIMITED', 'Too many AI requests; try again in a minute', 429);
    }
  }

  /** Resolve the source text. Free text is rep-entered; leadId reads authorised CRM history through the injected provider. */
  private async source(user: Principal, input: { leadId?: string; text?: string }): Promise<Source | { insufficient: string }> {
    if (input.text && input.text.trim()) {
      return { text: input.text.trim(), origin: 'REP_ENTERED_TEXT', period: { from: null, to: null }, noteCount: 1, knownNames: [] };
    }
    if (!input.leadId) return { insufficient: INSUFFICIENT };
    const r = await this.crm.getLeadContext({ id: user.userId, organizationId: user.organizationId }, input.leadId);
    if (!r.available) return { insufficient: `${INSUFFICIENT} (${r.reason})` };
    const c: CrmLeadContext = r.context;
    // only REP-ENTERED notes and call dispositions notes; labelled by source so a manual note is never presented as provider data
    const lines = [
      ...c.notes.map((n) => `[${n.at.slice(0, 10)}] ${n.text}`),
      ...c.calls.filter((x) => x.notes).map((x) => `[${x.at.slice(0, 10)}] (${x.callSource} call, ${x.disposition}) ${x.notes}`),
      ...c.openTasks.map((t) => `Open task: ${t.title}${t.dueAt ? ` (due ${t.dueAt.slice(0, 10)})` : ''}`),
    ];
    return {
      text: lines.join('\n'), origin: 'CRM_NOTES', period: { from: c.periodFrom, to: c.periodTo }, noteCount: c.notes.length + c.calls.length, leadId: input.leadId,
      knownNames: [], callSources: [...new Set(c.calls.map((x) => x.callSource))],
    };
  }

  async run(user: Principal, feature: Feature, input: { leadId?: string; text?: string; channel?: string; intent?: string }) {
    const s = await this.requireEnabled(user.organizationId);
    await this.rateLimit(user, s, feature);
    const src = await this.source(user, input);
    if ('insufficient' in src || src.text.replace(/\s+/g, ' ').trim().length < MIN_SOURCE_CHARS) {
      await this.log(user, feature, s, 'INSUFFICIENT_DATA');
      return { insufficientData: true as const, message: 'insufficient' in src ? src.insufficient : INSUFFICIENT, label: AI_LABEL, suggestion: null };
    }
    const clean = neutralise(src.text);
    const red = s.redactPii ? redactPii(clean.text, src.knownNames) : { text: clean.text, count: 0, kinds: {} };
    const extra = feature === 'draft_followup' ? `Channel: ${input.channel ?? 'EMAIL'}${input.intent ? `; intent (from the rep): ${redactPii(input.intent).text.slice(0, 200)}` : ''}` : undefined;
    const provider = this.providers.get(s.provider);
    const started = Date.now();
    if (!provider) throw new AppError('AI_UNAVAILABLE', 'AI provider is not configured', 503);
    let resp;
    try {
      resp = await provider.complete({ feature, system: SYSTEM_PROMPT, user: promptFor(feature, wrapNotes(red.text), extra), maxTokens: 700 }, s.model);
    } catch (e) {
      const code = e instanceof AiProviderError ? e.code : 'PROVIDER_ERROR';
      await this.log(user, feature, s, 'FAILED', { latencyMs: Date.now() - started, errorCode: code, redactions: red.count });
      // Controlled degradation: the caller (CRM UI) keeps working manually.
      throw new AppError('AI_UNAVAILABLE', 'The AI provider is unavailable right now. Continue manually; nothing was changed.', 503);
    }
    const latencyMs = Date.now() - started;
    let output: unknown;
    try {
      output = OUTPUT_SCHEMAS[feature].parse(JSON.parse(resp.text));
    } catch {
      await this.log(user, feature, s, 'INVALID_OUTPUT', { latencyMs, inputTokens: resp.inputTokens, outputTokens: resp.outputTokens, errorCode: 'SCHEMA', redactions: red.count, model: resp.model });
      throw new AppError('AI_INVALID_OUTPUT', 'The AI response did not match the expected format and was discarded', 502);
    }
    const sources = {
      origin: src.origin, period: src.period, noteCount: src.noteCount, redactions: red.count, redactionKinds: red.kinds,
      warnings: clean.flagged ? [`${clean.removed} instruction-like passage(s) in the notes were removed and treated as data`] : [],
      ...(src.leadId ? { leadId: src.leadId } : {}), ...(src.callSources ? { callSources: src.callSources } : {}),
    };
    const row = await this.prisma.aiSuggestion.create({
      data: { organizationId: user.organizationId, userId: user.userId, feature, entityType: src.leadId ? 'lead' : null, entityId: src.leadId ?? null, output: output as Prisma.InputJsonValue, sources: sources as Prisma.InputJsonValue, provider: s.provider, model: resp.model },
    });
    await this.log(user, feature, s, 'OK', { latencyMs, inputTokens: resp.inputTokens, outputTokens: resp.outputTokens, redactions: red.count, model: resp.model });
    return { insufficientData: false as const, suggestion: this.dto(row), label: AI_LABEL };
  }

  /** Explainable rule-based priority (no model call). */
  async leadPriority(user: Principal, limit: number) {
    const s = await this.requireEnabled(user.organizationId);
    await this.rateLimit(user, s, 'lead_priority');
    const r = await this.crm.listLeadSignals({ id: user.userId, organizationId: user.organizationId }, limit);
    if (!r.available || r.leads.length === 0) {
      await this.log(user, 'lead_priority', s, 'INSUFFICIENT_DATA', { provider: 'rules', model: 'rules-v1' });
      return { insufficientData: true as const, message: r.available ? 'No leads in your scope to prioritise.' : `${INSUFFICIENT} (${r.reason})`, label: AI_LABEL, leads: [] };
    }
    const leads = prioritise(r.leads);
    await this.log(user, 'lead_priority', s, 'OK', { provider: 'rules', model: 'rules-v1' });
    return {
      insufficientData: false as const, label: AI_LABEL, method: 'Rule-based scoring from CRM fields (no machine-learning model); every point is listed under factors.',
      generatedAt: new Date().toISOString(), leads,
    };
  }

  async callBrief(user: Principal, leadId: string) {
    return this.run(user, 'call_brief', { leadId });
  }

  private dto(r: { id: string; feature: string; status: string; output: unknown; editedOutput: unknown; sources: unknown; provider: string; model: string; createdAt: Date; reviewedAt: Date | null; entityId: string | null; entityType: string | null }) {
    return {
      id: r.id, feature: r.feature, status: r.status, output: r.output, editedOutput: r.editedOutput, sources: r.sources, provider: r.provider, model: r.model,
      entity: r.entityId ? { type: r.entityType, id: r.entityId } : null, createdAt: r.createdAt.toISOString(), reviewedAt: r.reviewedAt?.toISOString() ?? null,
      label: AI_LABEL,
    };
  }

  async listSuggestions(user: Principal) {
    const rows = await this.prisma.aiSuggestion.findMany({ where: { organizationId: user.organizationId, userId: user.userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50 });
    return rows.map((r) => this.dto(r));
  }

  async getSuggestion(user: Principal, id: string) {
    const r = await this.prisma.aiSuggestion.findFirst({ where: { id, organizationId: user.organizationId, userId: user.userId } });
    if (!r) throw notFound('Suggestion');
    return this.dto(r);
  }

  /** Human review: accept / edit / reject. Accepting only records the decision - it never executes anything. */
  async review(user: Principal, id: string, action: 'ACCEPT' | 'EDIT' | 'REJECT', editedOutput?: Record<string, unknown>) {
    await this.requireEnabled(user.organizationId);
    const r = await this.prisma.aiSuggestion.findFirst({ where: { id, organizationId: user.organizationId, userId: user.userId } });
    if (!r) throw notFound('Suggestion');
    if (r.status !== 'DRAFT') throw new AppError('ALREADY_REVIEWED', `Suggestion is already ${r.status}`, 409);
    let edited: Prisma.InputJsonValue | undefined;
    if (action === 'EDIT') {
      if (!editedOutput) throw new AppError('EDIT_REQUIRED', 'editedOutput is required for EDIT', 400);
      const parsed = OUTPUT_SCHEMAS[r.feature as Feature]?.safeParse(editedOutput);
      if (!parsed?.success) throw new AppError('INVALID_EDIT', 'Edited content does not match the suggestion format', 400);
      edited = parsed.data as Prisma.InputJsonValue;
    }
    const status = action === 'ACCEPT' ? 'ACCEPTED' : action === 'EDIT' ? 'EDITED' : 'REJECTED';
    const out = await this.prisma.$transaction(async (tx) => {
      const u = await tx.aiSuggestion.update({ where: { id }, data: { status, reviewedAt: new Date(), ...(edited ? { editedOutput: edited } : {}) } });
      await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'ai.suggestion_reviewed', entityType: 'ai_suggestion', entityId: id, metadata: { feature: r.feature, decision: status } });
      return u;
    });
    return this.dto(out);
  }

  async usage(user: Principal, days: number) {
    const since = new Date(Date.now() - days * 86_400_000);
    const where = { organizationId: user.organizationId, createdAt: { gte: since } };
    const [byOutcome, byFeature, agg, recent] = await Promise.all([
      this.prisma.aiUsageLog.groupBy({ by: ['outcome'], where, _count: { _all: true } }),
      this.prisma.aiUsageLog.groupBy({ by: ['feature'], where, _count: { _all: true }, _sum: { costUsd: true, inputTokens: true, outputTokens: true }, _avg: { latencyMs: true } }),
      this.prisma.aiUsageLog.aggregate({ where, _sum: { costUsd: true, inputTokens: true, outputTokens: true }, _avg: { latencyMs: true }, _count: { _all: true } }),
      this.prisma.aiUsageLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, userId: true, feature: true, provider: true, model: true, outcome: true, latencyMs: true, errorCode: true, costUsd: true, createdAt: true } }),
    ]);
    return {
      days, requests: agg._count._all, totalCostUsd: Number(agg._sum.costUsd ?? 0), avgLatencyMs: Math.round(agg._avg.latencyMs ?? 0),
      inputTokens: agg._sum.inputTokens ?? 0, outputTokens: agg._sum.outputTokens ?? 0,
      byOutcome: Object.fromEntries(byOutcome.map((g) => [g.outcome, g._count._all])),
      byFeature: byFeature.map((g) => ({ feature: g.feature, requests: g._count._all, costUsd: Number(g._sum.costUsd ?? 0), avgLatencyMs: Math.round(g._avg.latencyMs ?? 0) })),
      recent: recent.map((r) => ({ ...r, costUsd: Number(r.costUsd), createdAt: r.createdAt.toISOString() })),
      costNote: 'Cost is an estimate from list prices and token counts; it is not an invoice.',
    };
  }
}
