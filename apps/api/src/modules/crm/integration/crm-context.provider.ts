import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RoleKey } from '@salesos/shared-types';
import type { CrmContextProvider, CrmContextResult } from '@salesos/shared-types';
import { AccessService, type Principal } from '../../../common/authz';
import { PermissionResolver } from '../../../common/authz/principal.loader';
import { PrismaService } from '../../../common/prisma';
import { redactPii } from '../../ai/redact';

type Caller = { id: string; organizationId: string };
const NO = (reason: string) => ({ available: false as const, reason });
const CALL_WINDOW_DAYS = 90;
const MAX_NOTES = 30;
const MAX_NOTE_CHARS = 600;

/**
 * Real CRM data for the AI copilot (call briefs, lead priority). Binds `CrmContextRegistry`.
 *
 * Security: the principal is rebuilt from the database (active user + current roles) for every call, never trusted from
 * the caller; leads are read through the same scope rules as the CRM (org / team hierarchy / own). Summary-only roles
 * (Marketing, Student Success) get nothing. Out-of-scope and missing leads are indistinguishable.
 * PII minimisation: no phone, e-mail, address, lead name or free-text contact fields leave this provider in the brief
 * context; only rep-entered notes (PRIVATE notes only for holders of leads:notes:view-private), call dispositions and task titles.
 */
@Injectable()
export class CrmAiContextProvider implements CrmContextProvider {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly resolver: PermissionResolver) {}

  private async principal(c: Caller): Promise<Principal | null> {
    const u = await this.prisma.user.findFirst({ where: { id: c.id, organizationId: c.organizationId, isActive: true }, include: { roleAssignments: { include: { role: true } } } });
    if (!u) return null;
    const roles = u.roleAssignments.map((a) => a.role.key as RoleKey);
    return { userId: u.id, organizationId: u.organizationId, email: u.email, name: u.name, managerId: u.managerId, roles, permissions: this.resolver.effective(roles), sessionId: 'ai-context', sessionFamilyId: 'ai-context' };
  }

  async getLeadContext(user: Caller, leadId: string): Promise<CrmContextResult> {
    if (!/^[0-9a-f-]{36}$/i.test(leadId)) return NO('Lead not found in your scope');
    const p = await this.principal(user);
    if (!p || !this.access.has(p, 'leads:view') || this.access.isSummaryOnly(p, 'leads:view')) return NO('No access to lead history');
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, organizationId: p.organizationId, mergedIntoId: null } });
    if (!lead || !(await this.access.canAccessRecord(p, 'leads:view', { organizationId: lead.organizationId, ownerId: lead.assignedToId, teamId: lead.teamId }))) return NO('Lead not found in your scope');

    const to = new Date();
    const from = new Date(to.getTime() - CALL_WINDOW_DAYS * 86_400_000);
    const seePrivate = this.access.has(p, 'leads:notes:view-private') && (await this.access.canAccessRecord(p, 'leads:notes:view-private', { organizationId: lead.organizationId, ownerId: lead.assignedToId, teamId: lead.teamId }));
    const [notes, calls, tasks, source] = await Promise.all([
      this.prisma.leadNote.findMany({
        where: { leadId, organizationId: p.organizationId, createdAt: { gte: from }, OR: [{ visibility: 'SHARED' }, { authorId: p.userId }, ...(seePrivate ? [{ visibility: 'PRIVATE' as const }] : [])] },
        orderBy: { createdAt: 'desc' }, take: MAX_NOTES,
      }),
      this.access.has(p, 'calls:view')
        ? this.prisma.callLog.findMany({ where: { leadId, organizationId: p.organizationId, createdAt: { gte: from } }, orderBy: { createdAt: 'desc' }, take: MAX_NOTES })
        : Promise.resolve([]),
      this.access.has(p, 'tasks:view')
        ? this.prisma.task.findMany({ where: { leadId, organizationId: p.organizationId, status: 'OPEN' }, orderBy: { dueAt: 'asc' }, take: 10 })
        : Promise.resolve([]),
      lead.sourceId ? this.prisma.leadSource.findFirst({ where: { id: lead.sourceId, organizationId: p.organizationId }, select: { name: true } }) : null,
    ]);
    // the lead's own name (and its parts) and any contact detail typed into notes/titles are masked at the source
    const names = [lead.fullName, ...lead.fullName.split(/\s+/).filter((x) => x.length >= 3)];
    const clean = (text: string, max: number) => redactPii(text.slice(0, max), names).text;
    return {
      available: true,
      context: {
        leadId,
        periodFrom: from.toISOString(),
        periodTo: to.toISOString(),
        lead: { stage: lead.status, source: source?.name ?? null, interest: lead.interestLevel ?? null, budget: null, createdAt: lead.createdAt.toISOString() },
        notes: notes.map((n) => ({ at: n.createdAt.toISOString(), byUserId: n.authorId, text: clean(n.body, MAX_NOTE_CHARS) })),
        calls: calls.map((c) => ({ at: c.startedAt.toISOString(), disposition: c.outcome, callSource: c.source, notes: c.notes ? clean(c.notes, MAX_NOTE_CHARS) : null })),
        openTasks: tasks.map((t) => ({ dueAt: t.dueAt.toISOString(), title: clean(t.title, 120) })),
      },
    };
  }

  async listLeadSignals(user: Caller, limit: number) {
    const p = await this.principal(user);
    if (!p || !this.access.has(p, 'leads:view') || this.access.isSummaryOnly(p, 'leads:view')) return NO('No access to lead data');
    const scoped = await this.access.scopedWhere(p, { permission: 'leads:view', ownerField: 'assignedToId', teamField: 'teamId' });
    const leads = await this.prisma.lead.findMany({
      where: { ...scoped, mergedIntoId: null, stageCategory: 'OPEN' } as Prisma.LeadWhereInput,
      orderBy: [{ lastActivityAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
      take: Math.max(1, Math.min(limit, 200)),
    });
    if (leads.length === 0) return { available: true as const, leads: [] };
    const overdue = await this.prisma.task.groupBy({ by: ['leadId'], where: { organizationId: p.organizationId, leadId: { in: leads.map((l) => l.id) }, status: 'OPEN', dueAt: { lt: new Date() } }, _count: { _all: true } });
    const overdueBy = new Map(overdue.map((o) => [o.leadId, o._count._all]));
    return {
      available: true as const,
      leads: leads.map((l) => ({
        leadId: l.id,
        name: l.fullName,
        stage: l.status,
        lastContactAt: l.lastContactAt?.toISOString() ?? null,
        nextActionAt: l.nextActionAt?.toISOString() ?? null,
        hasOwner: !!l.assignedToId,
        openOverdueTasks: overdueBy.get(l.id) ?? 0,
        valueEstimate: l.estimatedValue ? Number(l.estimatedValue) : null,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  }
}
