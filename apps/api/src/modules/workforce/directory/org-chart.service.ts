import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { DirectoryStatus, OrgChartQuery } from '@salesos/validation';
import { AccessService, type Principal } from '../../../common/authz';
import { notFound } from '../../../common/http/errors';
import { PrismaService } from '../../../common/prisma';
import { WorkforceConfigService } from '../common/workforce-config.service';
import { employmentStatus, todayIn } from './directory.common';

export const ORG_CHART_MAX_NODES = 1000;
export const ORG_CHART_MAX_DEPTH = 12;

export interface OrgNode {
  id: string;
  name: string;
  employeeCode: string | null;
  designation: string | null;
  department: string | null;
  status: DirectoryStatus;
  managerId: string | null;
  directReports: number;
  /** present when the person was attached as a root only to break a reporting loop in the data */
  loop?: true;
  children: OrgNode[];
}

type Flat = Omit<OrgNode, 'children' | 'directReports'>;

/**
 * Builds the tree from `users.managerId`. Cycle-safe (every person is rendered at most once, loops are broken by attaching the
 * first member as a root), depth-limited and size-limited; `truncated` tells the UI when the chart was cut.
 */
export function buildTree(people: Flat[], rootIds?: string[]): { roots: OrgNode[]; total: number; truncated: boolean } {
  const byId = new Map(people.map((p) => [p.id, p]));
  const kids = new Map<string, Flat[]>();
  for (const p of people) {
    if (p.managerId && byId.has(p.managerId) && p.managerId !== p.id) {
      const list = kids.get(p.managerId) ?? [];
      list.push(p);
      kids.set(p.managerId, list);
    }
  }
  for (const list of kids.values()) list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const visited = new Set<string>();
  let truncated = false;
  let count = 0;
  const grow = (rootPerson: Flat, loop: boolean): OrgNode => {
    const rootNode: OrgNode = { ...rootPerson, directReports: kids.get(rootPerson.id)?.length ?? 0, children: [], ...(loop ? { loop: true as const } : {}) };
    visited.add(rootPerson.id);
    count++;
    const stack: Array<{ node: OrgNode; depth: number }> = [{ node: rootNode, depth: 1 }];
    while (stack.length) {
      const { node, depth } = stack.pop()!;
      const children = kids.get(node.id) ?? [];
      for (const c of children) {
        if (visited.has(c.id)) continue; // loop or duplicate: never render twice
        if (depth >= ORG_CHART_MAX_DEPTH || count >= ORG_CHART_MAX_NODES) { truncated = true; continue; }
        visited.add(c.id);
        count++;
        const child: OrgNode = { ...c, directReports: kids.get(c.id)?.length ?? 0, children: [] };
        node.children.push(child);
        stack.push({ node: child, depth: depth + 1 });
      }
    }
    return rootNode;
  };
  const sortedPeople = [...people].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const roots: OrgNode[] = [];
  const natural = rootIds ? rootIds.map((id) => byId.get(id)).filter((p): p is Flat => !!p) : sortedPeople.filter((p) => !p.managerId || !byId.has(p.managerId) || p.managerId === p.id);
  for (const p of natural) if (!visited.has(p.id) && count < ORG_CHART_MAX_NODES) roots.push(grow(p, false));
  if (!rootIds) {
    // anyone still unvisited sits in a reporting loop: surface the first member of each loop as a root
    for (const p of sortedPeople) if (!visited.has(p.id) && count < ORG_CHART_MAX_NODES) roots.push(grow(p, true));
  }
  return { roots, total: count, truncated };
}

@Injectable()
export class OrgChartService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly cfg: WorkforceConfigService) {}

  async get(user: Principal, q: OrgChartQuery) {
    const org = user.organizationId;
    const { config } = await this.cfg.getConfig(org);
    const today = todayIn(config.timezone);
    const scoped = (await this.access.scopedWhere(user, { permission: 'directory:view', ownerField: 'id' })) as Prisma.UserWhereInput;
    const where: Prisma.UserWhereInput = { AND: [scoped, { isActive: true }] };

    let rootIds: string[] | undefined;
    let team: { id: string; name: string } | null = null;
    let memberIds: string[] | undefined;
    if (q.view === 'department') {
      (where.AND as Prisma.UserWhereInput[]).push({ department: q.department ?? '__none__' });
    } else if (q.view === 'team') {
      if (q.teamId) {
        const t = await this.prisma.team.findFirst({ where: { id: q.teamId, organizationId: org }, select: { id: true, name: true, leadUserId: true } });
        if (!t) throw notFound('Team');
        team = { id: t.id, name: t.name };
        const members = await this.prisma.teamMembership.findMany({ where: { teamId: t.id }, select: { userId: true }, take: 500 });
        memberIds = [...new Set([...members.map((m) => m.userId), ...(t.leadUserId ? [t.leadUserId] : [])])];
        (where.AND as Prisma.UserWhereInput[]).push({ id: { in: memberIds } });
      }
    }
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: ORG_CHART_MAX_NODES + 1,
      select: { id: true, name: true, department: true, managerId: true, isActive: true },
    });
    const capped = rows.length > ORG_CHART_MAX_NODES;
    const used = rows.slice(0, ORG_CHART_MAX_NODES);

    // "my team" without a chosen team: me and everyone below me (or my manager with their reports when I lead nobody)
    let people = used;
    if (q.view === 'team' && !q.teamId) {
      const all = used;
      const kidsOf = (id: string) => all.filter((p) => p.managerId === id);
      rootIds = kidsOf(user.userId).length > 0 || !user.managerId ? [user.userId] : [user.managerId];
      const include = new Set<string>(rootIds);
      const queue = [...rootIds];
      let guard = 0;
      while (queue.length && guard++ < ORG_CHART_MAX_NODES * 2) for (const c of kidsOf(queue.shift()!)) if (!include.has(c.id)) { include.add(c.id); queue.push(c.id); }
      people = all.filter((p) => include.has(p.id));
    }
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { organizationId: org, userId: { in: people.map((p) => p.id) } },
      select: { userId: true, employeeCode: true, positionTitle: true, exitDate: true, probationEndDate: true },
    });
    const byUser = new Map(profiles.map((p) => [p.userId, p]));
    const flat: Flat[] = people.map((p) => {
      const pr = byUser.get(p.id);
      return { id: p.id, name: p.name, employeeCode: pr?.employeeCode ?? null, designation: pr?.positionTitle ?? null, department: p.department, managerId: p.managerId, status: employmentStatus(p.isActive, pr, today) };
    });
    // people whose exit date has passed are not part of the chart
    const present = flat.filter((p) => p.status !== 'EXITED');
    const tree = buildTree(present, rootIds);
    const [depRows, teams] = await Promise.all([
      this.prisma.user.findMany({ where: { AND: [scoped, { isActive: true, department: { not: null } }] }, distinct: ['department'], select: { department: true }, orderBy: { department: 'asc' }, take: 200 }),
      this.prisma.team.findMany({ where: { organizationId: org }, orderBy: { name: 'asc' }, take: 200, select: { id: true, name: true } }),
    ]);
    return {
      view: q.view,
      department: q.view === 'department' ? q.department ?? null : null,
      team,
      roots: tree.roots,
      total: tree.total,
      truncated: tree.truncated || capped,
      limits: { maxNodes: ORG_CHART_MAX_NODES, maxDepth: ORG_CHART_MAX_DEPTH },
      departments: depRows.map((d) => d.department!),
      teams,
    };
  }
}
