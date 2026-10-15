import type { PermissionKey } from '../../../common/authz/permissions.catalogue';
import type { KpiCtx, KpiResult } from '../kpi/types';

export type ReportKey = 'follow-ups' | 'conversions' | 'funnel' | 'revenue' | 'team-performance' | 'weekly-founder' | 'monthly-founder';
export const REPORT_KEYS: readonly ReportKey[] = ['follow-ups', 'conversions', 'funnel', 'revenue', 'team-performance', 'weekly-founder', 'monthly-founder'];

export type ColumnType = 'text' | 'int' | 'money' | 'pct' | 'number' | 'date';
export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}
export type Cell = string | number | boolean | null;
export type ReportRow = Record<string, Cell>;

export interface ReportParams {
  /** grouping dimension for conversions (source|program|owner) and revenue (program|owner) */
  by?: string;
}

export interface ReportDef {
  key: ReportKey;
  title: string;
  description: string;
  /** every permission must be held; the scope is the narrowest of them (first is the "view" permission) */
  requires: PermissionKey[];
  /** KPI ids whose definitions travel with the report */
  kpiIds: string[];
  /** rows are person-level: not returned to summary-scope viewers */
  personLevel: boolean;
  columns(params: ReportParams): ReportColumn[];
  run(ctx: KpiCtx, params: ReportParams, limit: number): Promise<{ rows: ReportRow[]; summary: Record<string, unknown>; kpis?: KpiResult[] }>;
}

export interface ReportResult {
  report: ReportKey;
  title: string;
  description: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  rowCount: number;
  truncated: boolean;
  rowLimit: number;
  summary: Record<string, unknown>;
  kpis: KpiResult[];
  meta: {
    dateRange: { from: string; to: string; timezone: 'Asia/Kolkata' };
    period: { type: string; startsOn: string; endsOn: string; label: string };
    currency: 'INR';
    filters: { applied: Record<string, string>; scopeLevel: string; narrowedByFilter: boolean; by?: string };
    definitions: Array<{ id: string; name: string; approvalStatus: string }>;
    computedAt: string;
    freshness: { kind: 'LIVE'; computedAt: string };
    detailWithheld: boolean;
  };
}
