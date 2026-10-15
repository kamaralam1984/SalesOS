import { CRM_KPIS } from './defs/crm';
import { CX_KPIS } from './defs/cx';
import { PEOPLE_KPIS } from './defs/people';
import { REVENUE_KPIS } from './defs/revenue';
import type { PermissionKey } from '../../../common/authz/permissions.catalogue';
import type { KpiImpl, KpiMeta } from './types';

/**
 * Domain permission each KPI additionally needs on top of `kpi:view` (docs/permissions-matrix.md). A viewer without it gets a
 * FORBIDDEN tile / 403; a viewer with it gets the narrower of the two scopes. Declared once, here, so the rule is auditable.
 */
const REQUIRES: Record<string, PermissionKey> = {
  'KPI-REV-001': 'targets:view', 'KPI-REV-003': 'targets:view', 'KPI-REV-004': 'targets:view', 'KPI-TEA-001': 'targets:view', 'KPI-TEA-002': 'targets:view',
  'KPI-REV-002': 'collections:view',
  'KPI-SAL-001': 'leads:view', 'KPI-EXC-001': 'leads:view', 'KPI-EXC-002': 'leads:view', 'KPI-EXC-004': 'leads:view', 'KPI-PRD-003': 'leads:view', 'KPI-PRD-004': 'leads:view', 'KPI-PRD-005': 'leads:view',
  'KPI-SAL-002': 'events:view', 'KPI-SAL-003': 'events:view',
  'KPI-SAL-004': 'deals:view',
  'KPI-SAL-005': 'forecasts:view', 'KPI-SAL-006': 'forecasts:view',
  'KPI-PRD-001': 'calls:view', 'KPI-PRD-006': 'calls:view', 'KPI-PRD-007': 'calls:view', 'KPI-PRD-008': 'calls:view', 'KPI-TEA-003': 'calls:view',
  'KPI-PRD-002': 'tasks:view', 'KPI-EXC-003': 'tasks:view', 'KPI-EXC-005': 'tasks:view',
};

const withRequires = (k: KpiImpl): KpiImpl => ({ ...k, meta: { ...k.meta, requires: k.meta.requires ?? REQUIRES[k.meta.id] ?? null } });

/** The typed KPI registry: single source of truth for definitions (docs/kpi-dictionary.md is generated from it). */
export const KPI_IMPLS: ReadonlyArray<KpiImpl> = [...REVENUE_KPIS, ...CRM_KPIS, ...PEOPLE_KPIS, ...CX_KPIS].map(withRequires).sort((a, b) => a.meta.id.localeCompare(b.meta.id));

export const KPI_MAP: ReadonlyMap<string, KpiImpl> = new Map(KPI_IMPLS.map((k) => [k.meta.id, k]));

export const KPI_METAS: ReadonlyArray<KpiMeta> = KPI_IMPLS.map((k) => k.meta);

/** The 33 dictionary KPIs (JD + Blueprint exception metrics) plus the extra Blueprint breakouts (see docs/kpi-dictionary.md). */
export const KPI_IDS: ReadonlyArray<string> = KPI_IMPLS.map((k) => k.meta.id);
