import { createHash } from 'node:crypto';
import { isWorkingDay, zonedParts, zonedToUtc, type WorkingHours } from '@salesos/crm-core';
import type { CxConfig } from './config';

export type ReportType = 'WEEKLY' | 'MONTHLY';

/** Deterministic JSON: object keys sorted recursively, undefined dropped. Same content => same string => same hash. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      if (v instanceof Date) return v.toISOString();
      const o = v as Record<string, unknown>;
      return Object.keys(o).sort().reduce<Record<string, unknown>>((acc, k) => {
        if (o[k] !== undefined) acc[k] = norm(o[k]);
        return acc;
      }, {});
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

export const contentHash = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex');

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const day = 86_400_000;

/** Period (UTC dates, inclusive) of the most recent COMPLETED week (Mon-Sun) or month before `now` in the report timezone. */
export function lastCompletedPeriod(type: ReportType, now: Date, tz: string): { start: string; end: string } {
  const p = zonedParts(now, tz);
  const today = Date.UTC(p.y, p.m - 1, p.d);
  if (type === 'WEEKLY') {
    const thisMonday = today - (p.dow - 1) * day;
    return { start: ymd(new Date(thisMonday - 7 * day)), end: ymd(new Date(thisMonday - day)) };
  }
  const firstThis = Date.UTC(p.y, p.m - 1, 1);
  const prevStart = Date.UTC(p.y, p.m - 2, 1);
  return { start: ymd(new Date(prevStart)), end: ymd(new Date(firstThis - day)) };
}

/** Period containing the given date. */
export function periodContaining(type: ReportType, date: string): { start: string; end: string } {
  const d = new Date(`${date}T00:00:00.000Z`);
  if (type === 'WEEKLY') {
    const dow = (d.getUTCDay() + 6) % 7;
    const start = d.getTime() - dow * day;
    return { start: ymd(new Date(start)), end: ymd(new Date(start + 6 * day)) };
  }
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
  return { start: ymd(new Date(start)), end: ymd(new Date(end)) };
}

const hm = (s: string): [number, number] => {
  const [h, m] = s.split(':').map(Number);
  return [h ?? 0, m ?? 0];
};

/**
 * DEC-028 due time. WEEKLY: the configured weekday (default Monday) after the period ends, at dueTime local.
 * MONTHLY: the Nth working day of the month after the period ends (default 3rd), at dueTime local.
 */
export function reportDueAt(type: ReportType, periodEnd: string, cfg: CxConfig, wh: WorkingHours): Date {
  const tz = cfg.reports.timezone;
  const [h, m] = hm(cfg.reports.dueTime);
  const end = new Date(`${periodEnd}T00:00:00.000Z`);
  if (type === 'WEEKLY') {
    let cur = end.getTime() + day;
    for (let i = 0; i < 7; i++) {
      const d = new Date(cur);
      const dow = ((d.getUTCDay() + 6) % 7) + 1;
      if (dow === cfg.reports.weeklyDueWeekday) return zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, m, tz);
      cur += day;
    }
  }
  let cur = end.getTime() + day;
  let counted = 0;
  for (let i = 0; i < 62; i++) {
    const d = new Date(cur);
    const dow = ((d.getUTCDay() + 6) % 7) + 1;
    if (isWorkingDay({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), dow }, wh)) {
      counted += 1;
      if (counted >= cfg.reports.monthlyDueWorkingDay) return zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, m, tz);
    }
    cur += day;
  }
  throw new Error('Could not compute the report due date: check working-hours configuration');
}

// ---------------------------------------------------------------- content / quality

export interface ReportRisk {
  title: string;
  description?: string;
  severity?: number;
  proposedSolution?: string;
  riskId?: string;
}
export interface ReportSections {
  performance?: { narrative?: string; highlights?: string[] };
  risks?: { items?: ReportRisk[]; noneConfirmed?: boolean };
  opportunities?: { items?: Array<{ title: string; description?: string }>; noneConfirmed?: boolean };
  solutions?: { items?: Array<{ title: string; description?: string }> };
  actionItems?: { reviewed?: boolean };
}

const filled = (s: unknown) => typeof s === 'string' && s.trim().length > 0;

/** DEC-028 quality proxy: required-section completeness as an integer % (performance, risks+solutions, opportunities, action items). */
export function reportCompleteness(s: ReportSections): { pct: number; checks: Record<'performance' | 'risks' | 'opportunities' | 'actionItems', boolean> } {
  const risks = s.risks?.items ?? [];
  const checks = {
    performance: filled(s.performance?.narrative),
    risks: (risks.length > 0 && risks.every((r) => filled(r.proposedSolution))) || (risks.length === 0 && s.risks?.noneConfirmed === true),
    opportunities: (s.opportunities?.items?.length ?? 0) > 0 || s.opportunities?.noneConfirmed === true,
    actionItems: s.actionItems?.reviewed === true,
  };
  const done = Object.values(checks).filter(Boolean).length;
  return { pct: Math.round((done / 4) * 100), checks };
}

/** JD-REPORT-003: every risk entered in a report needs a proposed solution before publishing. */
export function risksMissingSolution(s: ReportSections): string[] {
  return (s.risks?.items ?? []).filter((r) => !filled(r.proposedSolution)).map((r) => r.title);
}

// ---------------------------------------------------------------- metrics inputs (Phase 5 feeds these into KPI-FND-*)

export interface TimelinessRow {
  dueAt: Date;
  publishedAt: Date | null;
  /** approved deferral excluded from the denominator (KPI-FND-003 exclusions) */
  deferred?: boolean;
}

/** KPI-FND-003: on-time / due (rows with dueAt inside [from,to)), 1 decimal, null (dash) when nothing was due. */
export function reportTimeliness(rows: TimelinessRow[], from: Date, to: Date, now: Date = new Date()): { due: number; onTime: number; late: number; missing: number; pct: number | null } {
  const due = rows.filter((r) => !r.deferred && r.dueAt >= from && r.dueAt < to && r.dueAt <= now);
  const onTime = due.filter((r) => r.publishedAt && r.publishedAt <= r.dueAt).length;
  const late = due.filter((r) => r.publishedAt && r.publishedAt > r.dueAt).length;
  const missing = due.length - onTime - late;
  return { due: due.length, onTime, late, missing, pct: due.length === 0 ? null : Math.round((onTime / due.length) * 1000) / 10 };
}

export interface ActionItemRow {
  dueAt: Date;
  status: string;
  completedAt: Date | null;
}

/** KPI-FND-001: completed on/before due / due in period (cancelled excluded), 1 decimal, null when none due. */
export function actionItemCompletion(rows: ActionItemRow[], from: Date, to: Date): { due: number; onTime: number; pct: number | null } {
  const due = rows.filter((r) => r.status !== 'CANCELLED' && r.dueAt >= from && r.dueAt < to);
  const onTime = due.filter((r) => r.status === 'COMPLETED' && r.completedAt && r.completedAt <= r.dueAt).length;
  return { due: due.length, onTime, pct: due.length === 0 ? null : Math.round((onTime / due.length) * 1000) / 10 };
}
