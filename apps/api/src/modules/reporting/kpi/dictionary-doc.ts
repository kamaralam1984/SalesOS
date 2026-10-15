import { KPI_METAS } from './registry';
import type { KpiGroup, KpiMeta } from './types';

const GROUP_TITLES: Record<KpiGroup, string> = {
  REV: 'Revenue and targets',
  SAL: 'Sales and conversion',
  PRD: 'Productivity',
  TEA: 'Team',
  PRO: 'Process',
  CX: 'Customer experience',
  FND: 'Founder support',
  EXC: 'Blueprint exception metrics',
};

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/**
 * Renders docs/kpi-dictionary.md from the typed KPI registry, so the dictionary and the numbers cannot drift apart.
 * `test/analytics/dictionary-doc.spec.ts` fails when the committed file differs; regenerate with `pnpm --filter @salesos/api docs:kpi`.
 */
export function renderDictionary(metas: ReadonlyArray<KpiMeta> = KPI_METAS): string {
  const lines: string[] = [];
  lines.push('# KPI Dictionary (Phase 5, generated from the KPI registry)');
  lines.push('');
  lines.push('> GENERATED FILE. Source of truth: `apps/api/src/modules/reporting/kpi/defs/*.ts` and `registry.ts`. Edit the registry, then run `pnpm --filter @salesos/api docs:kpi`.');
  lines.push('> `apps/api/test/analytics/dictionary-doc.spec.ts` fails when this file is out of date.');
  lines.push('');
  lines.push('Finalised 2026-10-15 (Phase 5). **Owner-approval status: every formula is a "proposed default - awaiting owner approval"** (decision log DEC-003/004/005/009/010/017/020/023/024/026/028/030/036/037/038/039). The engine implements each default exactly as written here and some thresholds are configurable per organisation through `platform_settings` key `kpi` (see Configuration). Nothing here has been signed off by the business owner; a changed decision means a changed registry entry, a regenerated document and a re-run of the fixture tests.');
  lines.push('');
  lines.push('## Global rules');
  lines.push('');
  lines.push('- **One engine.** Every dashboard tile, report, export and Founder-report number is produced by `KpiService` (role-scoped). Dashboards never compute their own figures.');
  lines.push('- **Result contract.** Each result carries: `value`, `numerator`, `denominator`, `dateRange` (IST business dates), `period`, `currency`, `filters` (applied / ignored / scope level), `definition` (id, summary, formula, zero-denominator rule, approval status), `breakdown`, `caution`, `dataSource` (calls), `isEstimate`, `computedAt` and `freshness` (LIVE or CACHED, age, refresh cadence). Values are decimal strings already rounded per the definition.');
  lines.push('- **Zero denominator:** the API returns `value: null` with a `nullReason` (`ZERO_DENOMINATOR`, `NO_TARGET`, `NO_SNAPSHOT`, `INSUFFICIENT_RESPONSES`, `NO_DATA`) and the UI renders an em dash with the reason. Never NaN, Infinity or a fake 0% / 100%. Plain counts of nothing are a real 0.');
  lines.push('- **Scope.** Values are computed only over records the caller may see: `kpi:view` scope (own / team / org / summary) narrowed by the KPI\'s domain permission (`requires`). Filters (team, program, source, owner) are intersected with that scope and can only narrow it; an out-of-scope filter yields an empty scope, never wider data. `summary` scope (Finance, HR, Marketing, Student Success) gets organisation aggregates without per-person breakdowns. KPIs marked `minScope: org` (attrition, engagement, dashboard accuracy, reporting quality/timeliness) are not shown to team- or own-scope viewers.');
  lines.push('- **Money:** `NUMERIC`/Decimal end to end, INR explicit; revenue maths is reused from `modules/revenue/calc` (credit splits, adjustments, refunds); percentages 1 decimal unless stated.');
  lines.push('- **Time:** UTC storage, IST (Asia/Kolkata) day boundaries, Mon-Sat working days, `[from, to]` inclusive in IST. Target KPIs measure the target period containing `to` (month by default; quarter / fiscal year selectable) from period start to min(as-of, period end).');
  lines.push('- **Call data caveat:** calls are MANUAL in the MVP; call KPIs report the `source` mix (MANUAL / PROVIDER / DEVICE) and never merge call attempts with unique clients.');
  lines.push('- **Exclusions common to all:** merged-away duplicate leads, cancelled records, `[DEMO]` leads when `excludeDemo` is on (default on in production).');
  lines.push('- **Forecast accuracy** names its error metric: Accuracy = max(0, 1 - |F-A|/A) x 100 against the period-start snapshot, WAPE and bias alongside.');
  lines.push('- **Reconciliation:** `GET /reports/reconciliation` recomputes dashboard figures with independent SQL and compares them (KPI-PRO-002 evidence); a nightly scheduled run is stored in `kpi_reconciliation_runs`.');
  lines.push('');
  lines.push('## Configuration (per organisation, optional)');
  lines.push('');
  lines.push('`platform_settings` row with key `kpi`, JSON object; unknown keys are ignored, wrong types fall back to the default.');
  lines.push('');
  lines.push('| key | default | meaning |');
  lines.push('|---|---|---|');
  lines.push('| `conversionWindowDays` | 60 | lead conversion window from creation (DEC-009) |');
  lines.push('| `attributionWindowDays` | 30 | webinar / demo to sale attribution window (DEC-010) |');
  lines.push('| `staleActivityDays` | 7 | idle days after which a lead is "stale" (ageing) |');
  lines.push('| `complianceActivityDays` | 7 | activity recency required for CRM compliance (DEC-038) |');
  lines.push('| `newLeadGraceMinutes` | 60 | leads younger than this are not yet "eligible" for compliance |');
  lines.push('| `sopNewJoinerGraceDays` | 7 | users added this recently who have not acknowledged are not counted as required |');
  lines.push('| `excludeDemo` | false (true in production) | drop `[DEMO]` leads from lead KPIs |');
  lines.push('| `engagementFloor` | 5 | minimum responses per survey before an engagement score is shown |');
  lines.push('| `csatMinSample` | 5 | below this many responses a caution is shown |');
  lines.push('');
  lines.push('## Summary table');
  lines.push('');
  lines.push('| ID | KPI | Unit | Source | Owner | Refresh | Extra permission | Min scope | Approval status |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const m of metas) {
    lines.push(`| ${m.id} | ${cell(m.name)} | ${m.unit} | ${cell(m.source)} | ${cell(m.owner)} | ${cell(m.refresh)} | ${m.requires ? `\`${m.requires}\`` : '-'} | ${m.minScope} | proposed default - awaiting owner approval |`);
  }
  lines.push('');
  lines.push(`${metas.length} KPIs: the 33 dictionary KPIs (28 JD + 5 Blueprint exception metrics) plus KPI-REV-004 (enrolment achievement), KPI-SAL-006 (weekly forecast) and KPI-PRD-006/007/008 (call attempts, connected calls, unique clients called) so the Blueprint call metrics are individually addressable.`);
  lines.push('');
  lines.push('## Definitions');
  for (const g of Object.keys(GROUP_TITLES) as KpiGroup[]) {
    const list = metas.filter((m) => m.group === g);
    if (list.length === 0) continue;
    lines.push('');
    lines.push(`### ${GROUP_TITLES[g]}`);
    for (const m of list) {
      lines.push('');
      lines.push(`#### ${m.id} - ${m.name}`);
      lines.push('');
      lines.push(`- **Definition:** ${m.definition}`);
      lines.push(`- **Source:** ${m.source}`);
      lines.push(`- **Numerator:** ${m.numerator}`);
      lines.push(`- **Denominator:** ${m.denominator}`);
      lines.push(`- **Time window:** ${m.window}`);
      lines.push(`- **Exclusions:** ${m.exclusions}`);
      lines.push(`- **Source tables:** ${m.tables.join(', ')}`);
      lines.push(`- **Exact implementation:** ${m.implementation}`);
      lines.push(`- **Formula:** ${m.formula}`);
      lines.push(`- **Unit / rounding:** ${m.unit}; ${m.rounding}`);
      lines.push(`- **Zero-denominator behaviour:** ${m.zeroDenominator}`);
      lines.push(`- **Refresh cadence:** ${m.refresh}`);
      lines.push(`- **Owner:** ${m.owner}`);
      lines.push(`- **Access:** needs \`kpi:view\`${m.requires ? ` and \`${m.requires}\`` : ''}; minimum scope \`${m.minScope}\`; filters honoured: ${m.filters.length ? m.filters.join(', ') : 'none (organisation-wide by design)'}`);
      if (m.isEstimate) lines.push('- **Estimate:** yes. Shown with an "Estimate" label; never presented as a fact.');
      lines.push(`- **Decisions:** ${m.decisions.length ? m.decisions.join(', ') : 'none beyond the defaults above'}`);
      lines.push('- **Approval status:** proposed default - awaiting owner approval');
    }
  }
  lines.push('');
  return lines.join('\n');
}
