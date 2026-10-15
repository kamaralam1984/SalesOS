import { Injectable } from '@nestjs/common';
import { localDay, monthDay, nextBirthday, type Day } from '@salesos/workforce-core';
import { AccessService, type Principal } from '../../../common/authz';
import { PrismaService } from '../../../common/prisma';
import { isoDay } from '../../people/common/helpers';
import { WorkforceConfigService } from '../common/workforce-config.service';

export interface BirthdayRow {
  userId: string;
  name: string;
  department: string | null;
  /** next occurrence (the year is the year of the NEXT celebration, never the birth year) */
  nextDate: Day;
  month: number;
  day: number;
  daysUntil: number;
}

@Injectable()
export class BirthdaysService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly cfg: WorkforceConfigService) {}

  /** Upcoming birthdays within `days`. `sharedOnly` = only people who agreed to share (shareBirthday=true); `ids` limits to a set of users. Never returns the birth year or age. */
  async upcoming(organizationId: string, days: number, opts: { sharedOnly: boolean; ids?: string[] | null; limit: number }): Promise<{ rows: Array<BirthdayRow & { shared: boolean }>; today: Day }> {
    const { config } = await this.cfg.getConfig(organizationId);
    const today = localDay(new Date(), config.timezone);
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { organizationId, dateOfBirth: { not: null }, exitDate: null, ...(opts.sharedOnly ? { shareBirthday: true } : {}), ...(opts.ids ? { userId: { in: opts.ids } } : {}) },
      select: { userId: true, dateOfBirth: true, shareBirthday: true },
      take: 5000,
    });
    const users = await this.prisma.user.findMany({ where: { organizationId, isActive: true, id: { in: profiles.map((p) => p.userId) } }, select: { id: true, name: true, department: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    const rows = [];
    for (const p of profiles) {
      const u = byId.get(p.userId);
      if (!u || !p.dateOfBirth) continue;
      const dob = isoDay(p.dateOfBirth)!;
      const nb = nextBirthday(dob, today);
      if (nb.daysUntil > days) continue;
      const md = monthDay(dob);
      rows.push({ userId: u.id, name: u.name, department: u.department, nextDate: nb.date, month: md.month, day: md.day, daysUntil: nb.daysUntil, shared: p.shareBirthday });
    }
    rows.sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
    return { rows: rows.slice(0, opts.limit), today };
  }

  /** HR / Founder view (birthdays:view): everyone with a date of birth on file, flagged with whether they agreed to share. */
  async forHr(user: Principal, days: number, limit: number) {
    const { rows, today } = await this.upcoming(user.organizationId, days, { sharedOnly: false, limit });
    return { today, days, items: rows };
  }

  /** Team-visible list: only people with shareBirthday=true, day + month only. Scope = your team (reports, manager, peers); org-wide for birthdays:view holders. */
  async shared(user: Principal, days: number, limit: number) {
    let ids: string[] | null = null;
    if (this.access.scopeLevel(user, 'birthdays:view') !== 'org') {
      const set = new Set((await this.access.visibleUsers(user)).ids);
      if (user.managerId) {
        set.add(user.managerId);
        const peers = await this.prisma.user.findMany({ where: { organizationId: user.organizationId, managerId: user.managerId }, select: { id: true } });
        peers.forEach((p) => set.add(p.id));
      }
      ids = [...set];
    }
    const { rows, today } = await this.upcoming(user.organizationId, days, { sharedOnly: true, ids, limit });
    return { today, days, items: rows.map(({ shared: _s, ...r }) => r) };
  }
}
