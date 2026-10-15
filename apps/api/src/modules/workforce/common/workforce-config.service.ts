import { Injectable } from '@nestjs/common';
import { buildCalendar, type Day, type HolidayInput, type WorkCalendar } from '@salesos/workforce-core';
import { resolveWorkforceConfig, type WorkforceConfig } from '@salesos/validation';
import { PrismaService } from '../../../common/prisma';

/** Loads the organisation's workforce policy and working calendar. Shared by every workforce module (and mirrored by the worker). */
@Injectable()
export class WorkforceConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig(organizationId: string): Promise<{ config: WorkforceConfig; version: number }> {
    const row = await this.prisma.workforceSetting.findUnique({ where: { organizationId } });
    return { config: resolveWorkforceConfig(row?.config), version: row?.version ?? 0 };
  }

  /** Approved + suggested holidays overlapping [from, to] (calendar ignores SUGGESTED rows). */
  async loadHolidays(organizationId: string, from: Day, to: Day): Promise<HolidayInput[]> {
    const rows = await this.prisma.holiday.findMany({ where: { organizationId, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, orderBy: { date: 'asc' } });
    return rows.map((h) => ({ date: h.date.toISOString().slice(0, 10), name: h.name, kind: h.kind, status: h.status }));
  }

  async getCalendar(organizationId: string, from: Day, to: Day): Promise<{ config: WorkforceConfig; version: number; calendar: WorkCalendar; holidays: HolidayInput[] }> {
    const [{ config, version }, holidays] = await Promise.all([this.getConfig(organizationId), this.loadHolidays(organizationId, from, to)]);
    return { config, version, calendar: buildCalendar(config, holidays), holidays };
  }
}
