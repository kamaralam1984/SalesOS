import type { WorkforceReportKey } from '@salesos/validation';

export type ColumnType = 'text' | 'int' | 'number' | 'pct' | 'date';
export interface ReportColumn { key: string; label: string; type: ColumnType }
export type Cell = string | number | boolean | null;
export type ReportRow = Record<string, Cell>;

export interface BuiltReport {
  report: WorkforceReportKey;
  title: string;
  columns: ReportColumn[];
  /** all rows up to the cap (callers slice for pages) */
  rows: ReportRow[];
  /** counts/aggregates over the returned rows' source; null = not computable (never 0 or NaN) */
  summary: Record<string, number | string | null | Record<string, number>>;
  truncated: boolean;
  rowCap: number;
  scopeLevel: string;
  range: { from: string; to: string };
  filters: { departmentId: string | null; userId: string | null; groupBy: string | null };
}

export const REPORT_TITLES: Record<WorkforceReportKey, string> = {
  attendance: 'Attendance report',
  leave: 'Leave report',
  'earned-leave': 'Earned Leave transactions',
  tasks: 'Task assignment and completion report',
  goals: 'Goal progress report',
  holidays: 'Holiday report',
  probation: 'Probation report',
  birthdays: 'Birthday report',
  'department-performance': 'Department / manager performance report',
  'weekly-progress': 'Weekly progress report (attendance, tasks, goals)',
  'new-joiners': 'New joiner 90-day progress report',
};

/** percentage with one decimal; zero denominator = null (shown as a dash, never NaN or Infinity) */
export const pct = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
export const round2 = (n: number) => Math.round(n * 100) / 100;
