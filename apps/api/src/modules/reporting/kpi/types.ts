import type { PrismaClient } from '@prisma/client';
import type { Principal } from '../../../common/authz';
import type { PermissionKey } from '../../../common/authz/permissions.catalogue';
import type { MetricsService } from '../../revenue/metrics.service';

export type KpiUnit = 'PERCENT' | 'COUNT' | 'CURRENCY' | 'MINUTES' | 'HOURS' | 'DAYS' | 'SCORE' | 'RATIO';
export type KpiGroup = 'REV' | 'SAL' | 'PRD' | 'TEA' | 'PRO' | 'CX' | 'FND' | 'EXC';
export type FilterKey = 'teamId' | 'programId' | 'sourceId' | 'ownerId';
export const FILTER_KEYS: readonly FilterKey[] = ['teamId', 'programId', 'sourceId', 'ownerId'];
export type PeriodType = 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';

export const APPROVAL_STATUS = 'PROPOSED_DEFAULT_AWAITING_OWNER_APPROVAL' as const;

/** Static, serialisable description of a KPI (the dictionary row). */
export interface KpiMeta {
  id: string;
  name: string;
  group: KpiGroup;
  /** JD / Blueprint origin */
  source: string;
  unit: KpiUnit;
  /** short definition (tooltip) */
  definition: string;
  numerator: string;
  denominator: string;
  window: string;
  exclusions: string;
  /** tables read (dictionary "source tables") */
  tables: string[];
  rounding: string;
  owner: string;
  refresh: string;
  zeroDenominator: string;
  formula: string;
  /** exact implementation source (function / SQL summary), published in docs/kpi-dictionary.md */
  implementation: string;
  decisions: string[];
  approvalStatus: typeof APPROVAL_STATUS;
  /** additional domain permission required on top of kpi:view */
  requires: PermissionKey | null;
  /** minimum breadth of the viewer's scope; narrower viewers get status RESTRICTED (HR-grade aggregates) */
  minScope: 'org' | 'team' | 'own';
  /** filters this KPI honours; any other filter is reported as `ignored` */
  filters: FilterKey[];
  /** call KPIs name their data source */
  usesWindow: 'RANGE' | 'PERIOD' | 'POINT_IN_TIME';
  /** live cache TTL (seconds) when caching is enabled; undefined = never cached */
  cacheTtlSeconds?: number;
  isEstimate?: boolean;
}

export interface KpiScope {
  organizationId: string;
  level: 'org' | 'team' | 'own' | 'summary';
  /** null = whole organisation; otherwise the ONLY user ids whose records may be read */
  userIds: string[] | null;
  /** led/visible team ids (lead.team_id matching at team level) */
  teamIds: string[];
  /** true when filters narrowed the base scope (team / owner) */
  narrowed: boolean;
  /** per-person breakdowns allowed (false for summary scope) */
  detail: boolean;
}

export interface FilterInput {
  teamId?: string;
  programId?: string;
  sourceId?: string;
  ownerId?: string;
}

export interface DateWindow {
  startsOn: string;
  endsOn: string;
  from: Date;
  to: Date;
}

export interface PeriodInfo {
  type: PeriodType;
  startsOn: string;
  endsOn: string;
  label: string;
}

export interface KpiConfig {
  conversionWindowDays: number;
  attributionWindowDays: number;
  staleActivityDays: number;
  complianceActivityDays: number;
  newLeadGraceMinutes: number;
  sopNewJoinerGraceDays: number;
  excludeDemo: boolean;
  engagementFloor: number;
  csatMinSample: number;
  reconciliationMoneyTolerance: string;
  freshnessLiveSlaMinutes: number;
}

export const DEFAULT_KPI_CONFIG: KpiConfig = {
  conversionWindowDays: 60,
  attributionWindowDays: 30,
  staleActivityDays: 7,
  complianceActivityDays: 7,
  newLeadGraceMinutes: 60,
  sopNewJoinerGraceDays: 7,
  excludeDemo: false,
  engagementFloor: 5,
  csatMinSample: 5,
  reconciliationMoneyTolerance: '0.01',
  freshnessLiveSlaMinutes: 15,
};

export interface KpiCtx {
  prisma: PrismaClient;
  metrics: MetricsService;
  user: Principal;
  organizationId: string;
  scope: KpiScope;
  window: DateWindow;
  period: PeriodInfo;
  /** IST date "today" (or the requested asOf) */
  asOf: string;
  now: Date;
  filters: FilterInput;
  config: KpiConfig;
}

export type NullReason = 'ZERO_DENOMINATOR' | 'NO_TARGET' | 'NO_DATA' | 'NO_SNAPSHOT' | 'INSUFFICIENT_RESPONSES' | 'NOT_COMPUTABLE';

/** What a KPI implementation returns (values are strings: Decimal-safe, already rounded per the definition). */
export interface KpiComputed {
  value: string | null;
  numerator?: string | null;
  denominator?: string | null;
  nullReason?: NullReason;
  /** shown next to the number, e.g. "No target set" */
  note?: string | null;
  breakdown?: Record<string, unknown> | null;
  caution?: string | null;
  /** data source label (calls: MANUAL / PROVIDER mix) */
  dataSource?: string | null;
  /** currency of value/numerator/denominator when unit is CURRENCY (default INR) */
  currency?: string | null;
  /** the period/window the number really covers when it differs from the request (target KPIs use the target period) */
  effectiveRange?: { from: string; to: string };
  dataAsOf?: Date | null;
}

export type KpiStatus = 'OK' | 'NO_DATA' | 'FORBIDDEN' | 'RESTRICTED' | 'ERROR';

export interface KpiResult {
  id: string;
  name: string;
  unit: KpiUnit;
  currency: string | null;
  status: KpiStatus;
  value: string | null;
  numerator: string | null;
  denominator: string | null;
  nullReason: NullReason | null;
  note: string | null;
  dateRange: { from: string; to: string; timezone: 'Asia/Kolkata'; asOf: string };
  period: PeriodInfo;
  filters: { applied: Record<string, string>; ignored: string[]; scopeLevel: KpiScope['level']; narrowedByFilter: boolean };
  definition: { id: string; summary: string; approvalStatus: string; formula: string; zeroDenominator: string };
  breakdown: Record<string, unknown> | null;
  caution: string | null;
  dataSource: string | null;
  isEstimate: boolean;
  computedAt: string;
  freshness: { kind: 'LIVE' | 'CACHED'; computedAt: string; dataAsOf: string; ageSeconds: number; cadence: string };
}

export interface KpiImpl {
  meta: KpiMeta;
  compute(ctx: KpiCtx): Promise<KpiComputed>;
}
