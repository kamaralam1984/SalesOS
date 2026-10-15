import type { Lead, Prisma } from '@prisma/client';
import { leadAgeing } from '@salesos/crm-core';

export interface LeadLookups {
  users: Map<string, string>;
  sources: Map<string, string>;
  programs: Map<string, { name: string; code: string }>;
  lastCalls: Map<string, { outcome: string; objectionCategory: string | null; interestLevel: string | null; at: Date; source: string }>;
  attendance: Map<string, { eventId: string; title: string; type: string; status: string; startsAt: Date }>;
  exceptions: Map<string, string[]>;
}

export const emptyLookups = (): LeadLookups => ({ users: new Map(), sources: new Map(), programs: new Map(), lastCalls: new Map(), attendance: new Map(), exceptions: new Map() });

const dec = (v: Prisma.Decimal | null) => (v === null ? null : v.toString());

export function serializeLead(l: Lead, lk: LeadLookups, now = new Date()) {
  const prog = l.programId ? lk.programs.get(l.programId) : undefined;
  const call = lk.lastCalls.get(l.id);
  const att = lk.attendance.get(l.id);
  return {
    id: l.id,
    fullName: l.fullName,
    phone: l.phoneE164 ?? l.phoneRaw,
    phoneE164: l.phoneE164,
    phoneValid: l.phoneValid,
    email: l.email,
    status: l.status,
    stageCategory: l.stageCategory,
    interestLevel: l.interestLevel,
    assignedTo: l.assignedToId ? { id: l.assignedToId, name: lk.users.get(l.assignedToId) ?? null } : null,
    teamId: l.teamId,
    source: l.sourceId ? { id: l.sourceId, name: lk.sources.get(l.sourceId) ?? null } : null,
    campaignId: l.campaignId,
    program: l.programId ? { id: l.programId, name: prog?.name ?? null, code: prog?.code ?? null } : null,
    nextActionAt: l.nextActionAt?.toISOString() ?? null,
    nextActionType: l.nextActionType,
    estimatedValue: dec(l.estimatedValue),
    currency: l.currency,
    wonValue: dec(l.wonValue),
    wonAt: l.wonAt?.toISOString() ?? null,
    lostReason: l.lostReason,
    lostNote: l.lostNote,
    lostAt: l.lostAt?.toISOString() ?? null,
    preferredLanguage: l.preferredLanguage,
    isKeyProspect: l.isKeyProspect,
    consent: { status: l.consentStatus, at: l.consentAt?.toISOString() ?? null, source: l.consentSource },
    lastActivityAt: l.lastActivityAt?.toISOString() ?? null,
    lastContactAt: l.lastContactAt?.toISOString() ?? null,
    callAttemptCount: l.callAttemptCount,
    duplicateFlag: l.duplicateFlag,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
    version: l.version,
    ageing: leadAgeing(l, now),
    overdue: l.stageCategory === 'OPEN' && !!l.nextActionAt && l.nextActionAt < now,
    lastCall: call ? { outcome: call.outcome, objectionCategory: call.objectionCategory, interestLevel: call.interestLevel, at: call.at.toISOString(), source: call.source } : null,
    latestEvent: att ? { eventId: att.eventId, title: att.title, type: att.type, status: att.status, startsAt: att.startsAt.toISOString() } : null,
    exceptions: lk.exceptions.get(l.id) ?? [],
  };
}

/** Minimum-data projection for `summary` scope grants (Marketing / Student Success): no contact data, notes or owners. */
export function serializeLeadSummary(l: Lead, lk: LeadLookups) {
  const prog = l.programId ? lk.programs.get(l.programId) : undefined;
  return {
    id: l.id,
    fullName: l.fullName,
    status: l.status,
    stageCategory: l.stageCategory,
    source: l.sourceId ? { id: l.sourceId, name: lk.sources.get(l.sourceId) ?? null } : null,
    program: l.programId ? { id: l.programId, name: prog?.name ?? null, code: prog?.code ?? null } : null,
    createdAt: l.createdAt.toISOString(),
    summary: true as const,
  };
}
