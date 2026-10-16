import { Injectable } from '@nestjs/common';
import { PRIMARY_ROLE_KEYS, type RoleKey } from '@salesos/shared-types';
import type { NewJoinerInput } from '@salesos/validation';
import { addDays, addMonths, localDay, startOfLocalDay } from '@salesos/workforce-core';
import type { Principal } from '../../../common/authz';
import { AccessService } from '../../../common/authz';
import { AuditService } from '../../../common/audit/audit.service';
import { AppError, notFound } from '../../../common/http/errors';
import { PrismaService, type Tx } from '../../../common/prisma';
import { UsersService } from '../../identity/users/users.service';
import { toDate } from '../../people/common/helpers';
import { WorkforceConfigService } from '../common/workforce-config.service';

type ChecklistItem = { title: string; category: 'ONBOARDING' | 'TRAINING' | 'TOOLS' | 'CULTURE'; dueDay: number; description?: string };

/** The organisation's default plan when HR has not made one: what a new sales joiner does across the first 90 days. */
export const DEFAULT_90_DAY_ITEMS: ChecklistItem[] = [
  { title: 'Welcome, HR paperwork and company introduction', category: 'ONBOARDING', dueDay: 1 },
  { title: 'Accounts and tools set up (SalesOS, calling, meeting link)', category: 'TOOLS', dueDay: 2 },
  { title: 'Read the role expectations and acknowledge them', category: 'CULTURE', dueDay: 3 },
  { title: 'Product and programme training (AI Sprint, CBAX, MCA X)', category: 'TRAINING', dueDay: 7 },
  { title: 'Shadow five calls with a senior executive', category: 'TRAINING', dueDay: 10 },
  { title: 'Read the sales playbooks (SOP centre) and finish the quiz', category: 'TRAINING', dueDay: 14 },
  { title: 'First 20 follow-up calls logged with notes and next actions', category: 'ONBOARDING', dueDay: 21 },
  { title: '30-day check-in with the manager', category: 'CULTURE', dueDay: 30 },
  { title: 'Handle leads on your own for a full week', category: 'ONBOARDING', dueDay: 45 },
  { title: '60-day review: results so far and a plan for the next month', category: 'CULTURE', dueDay: 60 },
  { title: 'First closed-won or a documented pipeline of qualified leads', category: 'ONBOARDING', dueDay: 75 },
  { title: '90-day review and confirmation', category: 'CULTURE', dueDay: 90 },
];

const ASSIGNABLE_BY_HR: RoleKey[] = ['SALES_MANAGER', 'SALES_EXECUTIVE', 'MARKETING', 'COMMUNITY', 'OPERATIONS', 'STUDENT_SUCCESS'];

@Injectable()
export class NewJoinerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly cfg: WorkforceConfigService,
    private readonly users: UsersService,
  ) {}

  /** What the joining form offers this caller: roles they may give, possible managers, training templates and suggested first tasks. */
  async options(user: Principal) {
    const sensitive = this.access.has(user, 'users:role:assign-sensitive');
    const roles = sensitive ? ([...PRIMARY_ROLE_KEYS, 'ADMIN', 'FINANCE', 'HR', 'MARKETING', 'COMMUNITY', 'OPERATIONS', 'STUDENT_SUCCESS'] as string[]).filter((r, i, a) => a.indexOf(r) === i && r !== 'DEVELOPER') : ASSIGNABLE_BY_HR;
    const [managers, templates] = await Promise.all([
      this.prisma.user.findMany({
        where: { organizationId: user.organizationId, isActive: true, roleAssignments: { some: { role: { key: { in: ['FOUNDER_CEO', 'SALES_TEAM_LEAD', 'SALES_MANAGER'] } } } } },
        select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 200,
      }),
      this.prisma.onboardingTemplate.findMany({ where: { organizationId: user.organizationId, isActive: true }, select: { id: true, name: true, roleKey: true }, orderBy: { name: 'asc' }, take: 50 }),
    ]);
    return {
      roles, managers, templates,
      defaultPlan: DEFAULT_90_DAY_ITEMS.map((i) => ({ title: i.title, dueDay: i.dueDay })),
      suggestedTasks: [
        { title: 'Complete product training and send the notes to your manager', dueDay: 7, priority: 'HIGH' },
        { title: 'Log your first 20 follow-up calls with next actions', dueDay: 21, priority: 'MEDIUM' },
        { title: 'Prepare for the 30-day review: results and questions', dueDay: 28, priority: 'MEDIUM' },
      ],
    };
  }

  /** One transaction: account (+ invite link), HR record with the probation end, the 90-day plan with its 30/60/90 reviews, and the first tasks. */
  async create(user: Principal, dto: NewJoinerInput) {
    const { config } = await this.cfg.getConfig(user.organizationId);
    const join = dto.joinDate ?? localDay(new Date(), config.timezone);
    const start = toDate(join);
    const primary = (dto.roles.find((r) => (PRIMARY_ROLE_KEYS as readonly string[]).includes(r)) ?? dto.roles[0]) as string;
    return this.prisma.$transaction(async (tx) => {
      const created = await this.users.createForJoiner(user, tx, { email: dto.email, name: dto.name, roles: dto.roles, managerId: dto.managerId ?? null, department: dto.department ?? null });
      const userId = created.userId;
      await tx.employeeProfile.create({
        data: {
          organizationId: user.organizationId, userId, positionTitle: dto.positionTitle, joinDate: start, probationMonths: config.hr.probationDefaultMonths,
          probationEndDate: toDate(addMonths(join, config.hr.probationDefaultMonths)),
        },
      });
      const template = await this.template(tx, user.organizationId, dto.templateId, primary);
      const items = (template.items as unknown as ChecklistItem[]).map((i) => ({
        organizationId: user.organizationId, title: i.title, category: i.category ?? 'ONBOARDING', description: i.description ?? null, dueDate: toDate(addDays(join, Math.max(0, (i.dueDay ?? 7) - 1))),
      }));
      const plan = await tx.onboardingPlan.create({ data: { organizationId: user.organizationId, employeeId: userId, templateId: template.id, startDate: start, createdById: user.userId, items: { create: items } } });
      for (const day of template.probationDays) {
        await tx.probationReview.upsert({
          where: { employeeId_checkpointDay: { employeeId: userId, checkpointDay: day } }, update: {},
          create: { organizationId: user.organizationId, employeeId: userId, checkpointDay: day, dueDate: toDate(addDays(join, day)) },
        });
      }
      for (const tk of dto.tasks) {
        const due = new Date(startOfLocalDay(addDays(join, tk.dueDay - 1), config.timezone).getTime() + 18 * 3_600_000);
        const t = await tx.workTask.create({
          data: { organizationId: user.organizationId, title: tk.title, description: tk.description ?? null, priority: tk.priority, assignerId: user.userId, assigneeId: userId, dueAt: due, status: 'ASSIGNED', project: '90-day plan' },
        });
        await tx.workTaskEvent.create({ data: { organizationId: user.organizationId, taskId: t.id, actorId: user.userId, kind: 'CREATED', toStatus: 'ASSIGNED' } });
        await this.audit.recordTx(tx, { organizationId: user.organizationId, actorId: user.userId, action: 'work_task.created', entityType: 'work_task', entityId: t.id, metadata: { assigneeId: userId, from: null, to: 'ASSIGNED', via: 'new_joiner' } });
      }
      await this.audit.recordTx(tx, {
        organizationId: user.organizationId, actorId: user.userId, action: 'joiner.created', entityType: 'user', entityId: userId,
        metadata: { joinDate: join, planItems: items.length, reviews: template.probationDays, tasks: dto.tasks.length, templateId: template.id },
      });
      return {
        userId, name: dto.name, email: dto.email, positionTitle: dto.positionTitle, joinDate: join, probationEnd: addMonths(join, config.hr.probationDefaultMonths),
        planId: plan.id, planItems: items.length, reviewDays: template.probationDays, tasks: dto.tasks.length,
        invite: { link: created.invite.link, expiresAt: created.invite.expiresAt }, warnings: created.warnings,
      };
    });
  }

  private async template(tx: Tx, orgId: string, templateId: string | undefined, primaryRole: string) {
    if (templateId) {
      const t = await tx.onboardingTemplate.findFirst({ where: { id: templateId, organizationId: orgId, isActive: true } });
      if (!t) throw notFound('Template');
      return t;
    }
    const existing = (await tx.onboardingTemplate.findFirst({ where: { organizationId: orgId, isActive: true, roleKey: primaryRole }, orderBy: { createdAt: 'asc' } }))
      ?? (await tx.onboardingTemplate.findFirst({ where: { organizationId: orgId, isActive: true, roleKey: 'ALL' }, orderBy: { createdAt: 'asc' } }));
    if (existing) return existing;
    if (!DEFAULT_90_DAY_ITEMS.length) throw new AppError('NO_TEMPLATE', 'No onboarding template', 409);
    return tx.onboardingTemplate.create({ data: { organizationId: orgId, roleKey: 'ALL', name: '90-day new joiner plan', items: DEFAULT_90_DAY_ITEMS, probationDays: [30, 60, 90] } });
  }
}
