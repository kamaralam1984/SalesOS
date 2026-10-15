import { Injectable } from '@nestjs/common';
import { AccessService, type Principal } from '../../../common/authz';
import type { PermissionKey } from '../../../common/authz/permissions.catalogue';
import { AppError, forbidden } from '../../../common/http/errors';
import { PrismaService } from '../../../common/prisma';
import { addDays, forecastBounds, isIsoDate, istDate, istRange, periodBounds } from '../../revenue/calc';
import type { DateWindow, FilterInput, KpiScope, PeriodInfo, PeriodType } from './types';

export interface WindowInput {
  from?: string;
  to?: string;
  period?: PeriodType;
  asOf?: string;
}

/** Resolves the caller's server-side scope (single source of truth for every dashboard, report and export). */
@Injectable()
export class ScopeService {
  constructor(private readonly access: AccessService, private readonly prisma: PrismaService) {}

  /**
   * Base scope from the permission, then user-supplied filters INTERSECTED with it. Filters can only narrow:
   * an owner / team outside the caller's scope yields an empty user set (zero data), never a wider one.
   */
  async resolve(user: Principal, permission: PermissionKey, filters: FilterInput = {}): Promise<KpiScope> {
    const level = this.access.scopeLevel(user, permission);
    if (!level) throw forbidden();
    let ids: string[] | null;
    let teamIds: string[] = [];
    if (level === 'org' || level === 'summary') ids = null;
    else if (level === 'own') ids = [user.userId];
    else {
      const v = await this.access.visibleUsers(user);
      ids = v.ids;
      teamIds = v.teamIds;
    }
    let narrowed = false;
    if (filters.teamId) {
      const team = await this.prisma.team.findFirst({ where: { id: filters.teamId, organizationId: user.organizationId }, select: { id: true, leadUserId: true } });
      const members = team
        ? await this.prisma.teamMembership.findMany({ where: { teamId: team.id, user: { organizationId: user.organizationId } }, select: { userId: true } })
        : [];
      const set = new Set(members.map((m) => m.userId));
      if (team?.leadUserId) set.add(team.leadUserId);
      ids = ids ? ids.filter((x) => set.has(x)) : [...set];
      narrowed = true;
    }
    if (filters.ownerId) {
      const inOrg = await this.prisma.user.count({ where: { id: filters.ownerId, organizationId: user.organizationId } });
      ids = inOrg === 0 ? [] : ids ? ids.filter((x) => x === filters.ownerId) : [filters.ownerId];
      narrowed = true;
    }
    return { organizationId: user.organizationId, level, userIds: ids, teamIds: narrowed ? [] : teamIds, narrowed, detail: level !== 'summary' };
  }

  /** The narrower of two scopes (used when a KPI needs a domain permission as well as kpi:view): lower level, intersected users. */
  narrower(a: KpiScope, b: KpiScope): KpiScope {
    const rank = { own: 1, team: 2, summary: 3, org: 4 } as const;
    const level = rank[a.level] <= rank[b.level] ? a.level : b.level;
    const detail = a.detail && b.detail;
    const narrowed = a.narrowed || b.narrowed;
    if (a.userIds === null && b.userIds === null) return { organizationId: a.organizationId, level, userIds: null, teamIds: [], narrowed, detail };
    if (a.userIds === null) return { ...b, level, narrowed, detail };
    if (b.userIds === null) return { ...a, level, narrowed, detail };
    const set = new Set(b.userIds);
    return { ...a, level, userIds: a.userIds.filter((x) => set.has(x)), teamIds: a.teamIds.filter((x) => b.teamIds.includes(x)), narrowed, detail };
  }
}

const MAX_RANGE_DAYS = 800;

/** Window + period from request input. Dates are IST calendar days (inclusive). */
export function resolveWindow(input: WindowInput, now = new Date()): { window: DateWindow; period: PeriodInfo; asOf: string } {
  const today = istDate(now);
  const asOf = input.asOf && isIsoDate(input.asOf) ? input.asOf : today;
  const type: PeriodType = input.period ?? 'MONTH';
  const anchor = input.to && isIsoDate(input.to) ? input.to : asOf;
  const b = type === 'WEEK' ? forecastBounds('WEEK', anchor) : periodBounds(type, anchor);
  const startsOn = input.from && isIsoDate(input.from) ? input.from : b.startsOn;
  const endsOn = input.to && isIsoDate(input.to) ? input.to : b.endsOn;
  if (startsOn > endsOn) throw new AppError('VALIDATION_ERROR', '`from` must not be after `to`', 400);
  const days = (Date.parse(endsOn) - Date.parse(startsOn)) / 86_400_000;
  if (days > MAX_RANGE_DAYS) throw new AppError('VALIDATION_ERROR', `Date range is limited to ${MAX_RANGE_DAYS} days`, 400);
  const { from, to } = istRange(startsOn, endsOn);
  return { window: { startsOn, endsOn, from, to }, period: { type, startsOn: b.startsOn, endsOn: b.endsOn, label: b.label }, asOf };
}

export { addDays };
