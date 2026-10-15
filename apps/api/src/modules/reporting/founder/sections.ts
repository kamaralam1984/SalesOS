import type { KpiResult, KpiUnit } from '../kpi/types';

/** The KPI ids that make up a Founder report, grouped into the four sections the report builder shows. */
export const FOUNDER_SECTIONS: ReadonlyArray<{ key: string; label: string; kpiIds: string[] }> = [
  { key: 'revenue', label: 'Revenue and collections vs target', kpiIds: ['KPI-REV-001', 'KPI-REV-002', 'KPI-REV-004', 'KPI-SAL-004', 'KPI-SAL-005', 'KPI-SAL-006'] },
  { key: 'funnel', label: 'Funnel and conversion', kpiIds: ['KPI-EXC-004', 'KPI-SAL-001', 'KPI-SAL-002', 'KPI-SAL-003'] },
  { key: 'team', label: 'Team performance and follow-up discipline', kpiIds: ['KPI-PRD-006', 'KPI-PRD-008', 'KPI-PRD-001', 'KPI-PRD-002', 'KPI-EXC-005', 'KPI-PRD-003', 'KPI-EXC-001', 'KPI-EXC-002', 'KPI-EXC-003', 'KPI-TEA-001', 'KPI-TEA-003', 'KPI-TEA-006', 'KPI-PRO-001'] },
  { key: 'customer', label: 'Customer experience (satisfaction, complaints, refunds)', kpiIds: ['KPI-CX-001', 'KPI-CX-002', 'KPI-CX-003', 'KPI-CX-004'] },
  { key: 'founder-support', label: 'Founder support (action items, reporting)', kpiIds: ['KPI-FND-001', 'KPI-FND-003', 'KPI-FND-002'] },
];

const UNIT_LABEL: Record<KpiUnit, string> = { PERCENT: '%', COUNT: '', CURRENCY: '', MINUTES: ' min', HOURS: ' h', DAYS: ' d', SCORE: '', RATIO: '' };

/** Human-readable value (the number always carries its unit) or null when it cannot be computed. */
export function formatKpiValue(r: Pick<KpiResult, 'value' | 'unit' | 'currency'>): string | null {
  if (r.value === null) return null;
  if (r.unit === 'CURRENCY') return `${r.currency ?? 'INR'} ${Number(r.value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${r.value}${UNIT_LABEL[r.unit]}`;
}

/** The note travelling with every number: window, freshness, definition status, why it is empty. */
export function kpiNote(r: KpiResult): string {
  const parts = [`${r.dateRange.from} to ${r.dateRange.to} (IST)`, `computed ${r.computedAt}`, `${r.id}: ${r.definition.approvalStatus === 'PROPOSED_DEFAULT_AWAITING_OWNER_APPROVAL' ? 'proposed default, awaiting owner approval' : r.definition.approvalStatus}`];
  if (r.status === 'FORBIDDEN' || r.status === 'RESTRICTED') parts.unshift(r.note ?? 'not available to you');
  else if (r.value === null && r.note) parts.unshift(r.note);
  if (r.caution) parts.push(r.caution);
  if (r.isEstimate) parts.push('estimate, not a fact');
  if (r.dataSource) parts.push(`source: ${r.dataSource}`);
  return parts.join('; ');
}
