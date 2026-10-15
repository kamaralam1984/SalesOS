import { Prisma } from '@prisma/client';
import { money } from '../../../revenue/calc';
import type { KpiImpl, KpiCtx } from '../types';
import { median, num, ownerIn, pctStr } from '../sql';
import { D, dec, meta } from './helpers';

const sat = (ctx: KpiCtx, kinds: string[]) => Prisma.sql`s.organization_id = ${ctx.organizationId}::uuid AND s.kind::text = ANY(${kinds}::text[]) AND s.responded_at >= ${ctx.window.from}::timestamptz AND s.responded_at < ${ctx.window.to}::timestamptz${ownerIn(ctx.scope, 's.owner_id')}${ctx.filters.programId ? Prisma.sql` AND s.program_id = ${ctx.filters.programId}::uuid` : Prisma.empty}`;

export const CX_001: KpiImpl = {
  meta: meta({
    id: 'KPI-CX-001',
    name: 'Learner satisfaction (CSAT)',
    group: 'CX',
    unit: 'SCORE',
    source: 'JD KPI Customer Experience',
    definition: 'Mean CSAT (1-5) of learner responses in the range; the share satisfied (4-5) and NPS are reported alongside. Fewer than 5 responses are flagged with a caution.',
    numerator: 'Sum of CSAT scores in the range',
    denominator: 'Number of CSAT responses',
    window: 'Responses given in the date range',
    exclusions: 'Enrolment-experience and NPS responses (reported separately)',
    tables: ['satisfaction_responses'],
    rounding: '1 decimal place',
    owner: 'Student Success / Team Lead',
    refresh: 'On request',
    zeroDenominator: 'No responses -> null (dash)',
    formula: 'mean(score)',
    implementation: "SQL on satisfaction_responses WHERE kind='CSAT'; NPS = %9-10 minus %0-6 over kind='NPS'",
    requires: 'satisfaction:view',
    filters: ['teamId', 'ownerId', 'programId'],
    cacheTtlSeconds: 60,
  }),
  async compute(ctx) {
    const [r] = await ctx.prisma.$queryRaw<Array<Record<string, number | null>>>(Prisma.sql`SELECT count(*)::int AS n, coalesce(sum(s.score), 0)::int AS total, (count(*) FILTER (WHERE s.score >= 4))::int AS satisfied FROM satisfaction_responses s WHERE ${sat(ctx, ['CSAT'])}`);
    const [p] = await ctx.prisma.$queryRaw<Array<Record<string, number | null>>>(Prisma.sql`SELECT count(*)::int AS n, (count(*) FILTER (WHERE s.score >= 9))::int AS promoters, (count(*) FILTER (WHERE s.score <= 6))::int AS detractors FROM satisfaction_responses s WHERE ${sat(ctx, ['NPS'])}`);
    const n = num(r?.n);
    const nps = num(p?.n);
    return {
      value: n === 0 ? null : dec(D(num(r?.total)).div(n), 1),
      numerator: String(num(r?.total)),
      denominator: String(n),
      nullReason: n === 0 ? 'ZERO_DENOMINATOR' : undefined,
      note: n === 0 ? 'No CSAT responses in this range' : null,
      caution: n > 0 && n < ctx.config.csatMinSample ? `Only ${n} response${n === 1 ? '' : 's'}: below the minimum sample of ${ctx.config.csatMinSample}, treat as indicative` : null,
      breakdown: { responses: n, satisfiedPct: pctStr(num(r?.satisfied), n), nps: nps === 0 ? null : Math.round(((num(p?.promoters) - num(p?.detractors)) / nps) * 100), npsResponses: nps },
    };
  },
};

export const CX_004: KpiImpl = {
  meta: meta({
    id: 'KPI-CX-004',
    name: 'Enrolment experience score',
    group: 'CX',
    unit: 'SCORE',
    source: 'JD KPI Customer Experience',
    definition: 'Mean enrolment-experience rating (1-5) collected within 7 days of enrolment; late responses are excluded and counted.',
    numerator: 'Sum of in-window ENROLMENT_EXPERIENCE scores in the range',
    denominator: 'Number of in-window responses',
    window: 'Responses given in the date range',
    exclusions: 'Responses later than 7 days after enrolment (outside_window, counted separately)',
    tables: ['satisfaction_responses'],
    rounding: '1 decimal place',
    owner: 'Student Success',
    refresh: 'On request',
    zeroDenominator: 'No in-window response -> null (dash)',
    formula: 'mean(score)',
    implementation: "SQL on satisfaction_responses WHERE kind='ENROLMENT_EXPERIENCE' AND NOT outside_window",
    requires: 'satisfaction:view',
    filters: ['teamId', 'ownerId', 'programId'],
    cacheTtlSeconds: 60,
  }),
  async compute(ctx) {
    const [r] = await ctx.prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`SELECT (count(*) FILTER (WHERE NOT s.outside_window))::int AS n, (coalesce(sum(s.score) FILTER (WHERE NOT s.outside_window), 0))::int AS total, (count(*) FILTER (WHERE s.outside_window))::int AS excluded FROM satisfaction_responses s WHERE ${sat(ctx, ['ENROLMENT_EXPERIENCE'])}`);
    const n = num(r?.n);
    const mean = n === 0 ? null : D(num(r?.total)).div(n);
    return {
      value: mean === null ? null : dec(mean, 1),
      numerator: String(num(r?.total)),
      denominator: String(n),
      nullReason: n === 0 ? 'ZERO_DENOMINATOR' : undefined,
      note: n === 0 ? 'No in-window enrolment-experience responses' : null,
      caution: n > 0 && n < ctx.config.csatMinSample ? `Only ${n} response${n === 1 ? '' : 's'}: below the minimum sample of ${ctx.config.csatMinSample}` : null,
      breakdown: { responses: n, excludedOutsideWindow: num(r?.excluded), scaledTo100: mean === null ? null : dec(mean.times(20), 0) },
    };
  },
};

export const CX_003: KpiImpl = {
  meta: meta({
    id: 'KPI-CX-003',
    name: 'Complaint resolution (%)',
    group: 'CX',
    unit: 'PERCENT',
    source: 'JD KPI Customer Experience',
    definition: 'Of the complaints opened in the range, the share resolved or closed by the end of the range; SLA adherence (resolved within SLA, DEC-017) and time to resolve are reported with it.',
    numerator: 'Complaints opened in the range that are RESOLVED or CLOSED with a resolution date before the range end',
    denominator: 'Complaints opened in the range',
    window: 'Complaints created in the date range',
    exclusions: 'Complaints closed as invalid/duplicate/spam',
    tables: ['complaints'],
    rounding: '1 decimal place; hours',
    owner: 'Student Success / Team Lead',
    refresh: 'On request',
    zeroDenominator: 'No complaint opened -> null (dash)',
    formula: 'resolved / opened x 100',
    implementation: "SQL on complaints: created_at in range AND NOT closed_as_invalid; resolved = status IN ('RESOLVED','CLOSED') AND coalesce(resolved_at, closed_at) < range end; SLA = resolved_within_sla",
    decisions: ['DEC-017'],
    requires: 'complaints:view',
    filters: ['teamId', 'ownerId'],
    cacheTtlSeconds: 60,
  }),
  async compute(ctx) {
    const rows = await ctx.prisma.$queryRaw<Array<{ resolved: boolean; sla: boolean | null; hours: number | null; breached: boolean }>>(Prisma.sql`
      SELECT (c.status IN ('RESOLVED','CLOSED') AND coalesce(c.resolved_at, c.closed_at) < ${ctx.window.to}::timestamptz) AS resolved,
             c.resolved_within_sla AS sla,
             extract(epoch FROM (coalesce(c.resolved_at, c.closed_at) - c.created_at)) / 3600.0 AS hours,
             (c.first_response_breached_at IS NOT NULL OR c.resolution_breached_at IS NOT NULL) AS breached
      FROM complaints c
      WHERE c.organization_id = ${ctx.organizationId}::uuid AND c.created_at >= ${ctx.window.from}::timestamptz AND c.created_at < ${ctx.window.to}::timestamptz AND NOT c.closed_as_invalid${ownerIn(ctx.scope, 'c.owner_id')}`);
    const opened = rows.length;
    const done = rows.filter((r) => r.resolved);
    const hours = done.map((r) => Number(r.hours)).filter((h) => Number.isFinite(h)).sort((a, b) => a - b);
    const withSla = done.filter((r) => r.sla !== null);
    return {
      value: pctStr(done.length, opened),
      numerator: String(done.length),
      denominator: String(opened),
      nullReason: opened === 0 ? 'ZERO_DENOMINATOR' : undefined,
      note: opened === 0 ? 'No complaints were opened in this range' : null,
      breakdown: {
        opened,
        resolved: done.length,
        stillOpen: opened - done.length,
        slaAdherencePct: pctStr(withSla.filter((r) => r.sla).length, withSla.length),
        meanHoursToResolve: hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null,
        medianHoursToResolve: median(hours) === null ? null : Math.round(median(hours)! * 10) / 10,
        slaBreached: rows.filter((r) => r.breached).length,
      },
    };
  },
};

interface RefundCell { programId: string | null; enrolments: number; refunds: number; value: string }

async function refundCells(ctx: KpiCtx, from: Date, to: Date): Promise<Map<string, RefundCell>> {
  const credit = ctx.scope.userIds === null ? Prisma.empty : Prisma.sql` AND EXISTS (SELECT 1 FROM sales_credits c WHERE c.sales_record_id = s.id AND c.user_id = ANY(${ctx.scope.userIds}::uuid[]))`;
  const prog = ctx.filters.programId ? Prisma.sql` AND s.program_id = ${ctx.filters.programId}::uuid` : Prisma.empty;
  const enr = await ctx.prisma.$queryRaw<Array<{ program_id: string; n: number }>>(Prisma.sql`SELECT s.program_id::text, coalesce(sum(s.enrolments), 0)::int AS n FROM sales_records s WHERE s.organization_id = ${ctx.organizationId}::uuid AND s.closed_at >= ${from} AND s.closed_at < ${to}${credit}${prog} GROUP BY s.program_id`);
  const rp = ctx.filters.programId ? Prisma.sql` AND d.program_id = ${ctx.filters.programId}::uuid` : Prisma.empty;
  const ref = await ctx.prisma.$queryRaw<Array<{ program_id: string; n: number; val: Prisma.Decimal }>>(Prisma.sql`SELECT d.program_id::text, count(*)::int AS n, coalesce(sum(coalesce(r.approved_amount, r.amount)), 0) AS val FROM refunds r JOIN deals d ON d.id = r.deal_id WHERE r.organization_id = ${ctx.organizationId}::uuid AND r.requested_at >= ${from} AND r.requested_at < ${to} AND r.status::text IN ('APPROVED','PROCESSED','RECONCILED')${ownerIn(ctx.scope, 'r.owner_id')}${rp} GROUP BY d.program_id`);
  const out = new Map<string, RefundCell>();
  for (const e of enr) out.set(e.program_id, { programId: e.program_id, enrolments: num(e.n), refunds: 0, value: '0.00' });
  for (const r of ref) {
    const c = out.get(r.program_id) ?? { programId: r.program_id, enrolments: 0, refunds: 0, value: '0.00' };
    c.refunds = num(r.n);
    c.value = money(r.val);
    out.set(r.program_id, c);
  }
  return out;
}

export const CX_002: KpiImpl = {
  meta: meta({
    id: 'KPI-CX-002',
    name: 'Refund reduction (like-for-like, %)',
    group: 'CX',
    unit: 'PERCENT',
    source: 'JD KPI Customer Experience',
    definition: 'Relative fall in the refund rate (approved refunds requested in the period / won enrolments in the same period) against the immediately preceding period of the same length, counting only programs that sold in both periods. Raw counts are secondary.',
    numerator: 'Previous like-for-like refund rate minus current rate (percentage points)',
    denominator: 'Previous like-for-like refund rate',
    window: 'The date range vs the preceding range of equal length',
    exclusions: 'REQUESTED/REVIEWED/REJECTED/WITHDRAWN refunds; programs with no enrolments in either period; chargebacks (not modelled)',
    tables: ['refunds', 'deals', 'sales_records', 'sales_credits'],
    rounding: '1 decimal place',
    owner: 'Team Lead',
    refresh: 'On request',
    zeroDenominator: 'Previous rate 0 or no enrolments -> null (dash)',
    formula: '(previous rate - current rate) / previous rate x 100, rate = approved refunds / won enrolments',
    implementation: "SQL: refunds JOIN deals (status APPROVED/PROCESSED/RECONCILED, by requested_at) and sales_records.enrolments per program for both windows; Σ over programs present in both",
    requires: 'refunds:view',
    filters: ['teamId', 'ownerId', 'programId'],
    cacheTtlSeconds: 60,
  }),
  async compute(ctx) {
    const len = ctx.window.to.getTime() - ctx.window.from.getTime();
    const prevFrom = new Date(ctx.window.from.getTime() - len);
    const [cur, prev] = await Promise.all([refundCells(ctx, ctx.window.from, ctx.window.to), refundCells(ctx, prevFrom, ctx.window.from)]);
    const programs = [...new Set([...cur.keys(), ...prev.keys()])];
    const names = programs.length ? await ctx.prisma.program.findMany({ where: { id: { in: programs } }, select: { id: true, name: true } }) : [];
    const nm = new Map(names.map((p) => [p.id, p.name]));
    const cells = programs.map((id) => {
      const c = cur.get(id);
      const p = prev.get(id);
      const lfl = (c?.enrolments ?? 0) > 0 && (p?.enrolments ?? 0) > 0;
      return { programId: id, program: nm.get(id) ?? null, likeForLike: lfl, current: { enrolments: c?.enrolments ?? 0, approvedRefunds: c?.refunds ?? 0, ratePct: c ? pctStr(c.refunds, c.enrolments) : null, value: c?.value ?? '0.00' }, previous: { enrolments: p?.enrolments ?? 0, approvedRefunds: p?.refunds ?? 0, ratePct: p ? pctStr(p.refunds, p.enrolments) : null, value: p?.value ?? '0.00' } };
    });
    const lfl = cells.filter((c) => c.likeForLike);
    const sumOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const curEnr = sumOf(lfl.map((c) => c.current.enrolments));
    const prevEnr = sumOf(lfl.map((c) => c.previous.enrolments));
    const curRef = sumOf(lfl.map((c) => c.current.approvedRefunds));
    const prevRef = sumOf(lfl.map((c) => c.previous.approvedRefunds));
    const curRate = curEnr > 0 ? (curRef / curEnr) * 100 : null;
    const prevRate = prevEnr > 0 ? (prevRef / prevEnr) * 100 : null;
    const base = { breakdown: { comparison: { previousFrom: prevFrom.toISOString(), previousTo: ctx.window.from.toISOString() }, currentRatePct: curRate === null ? null : dec(curRate, 1), previousRatePct: prevRate === null ? null : dec(prevRate, 1), likeForLikePrograms: lfl.length, cells, rawCounts: { currentApprovedRefunds: curRef, previousApprovedRefunds: prevRef, note: 'Secondary only: counts are not comparable across periods of different volume.' } } };
    if (prevRate === null || curRate === null || prevRate === 0) return { ...base, value: null, nullReason: 'ZERO_DENOMINATOR', note: prevRate === 0 ? 'The previous like-for-like refund rate was 0, so a reduction is not defined' : 'No program sold in both periods, so there is no like-for-like comparison' };
    return { ...base, value: dec(((prevRate - curRate) / prevRate) * 100, 1), numerator: dec(prevRate - curRate, 1), denominator: dec(prevRate, 1) };
  },
};

/** ------------------------------------------------------------------------------------------------ Founder support */
export const FND_001: KpiImpl = {
  meta: meta({
    id: 'KPI-FND-001',
    name: 'Completion of action items (%)',
    group: 'FND',
    unit: 'PERCENT',
    source: 'JD KPI Founder Support',
    definition: 'Founder action items completed on or before their due date, as a share of the items due in the range (cancelled items excluded).',
    numerator: "Action items with status COMPLETED and completed_at <= due_at among those due in the range",
    denominator: 'Action items with due_at in the range, excluding CANCELLED',
    window: 'Items due in the date range',
    exclusions: 'Cancelled items',
    tables: ['action_items'],
    rounding: '1 decimal place',
    owner: 'Team Lead',
    refresh: 'Near real time',
    zeroDenominator: 'No item due -> null (dash)',
    formula: 'on-time completed / due x 100',
    implementation: "SQL on action_items: due_at in range AND status <> 'CANCELLED'; numerator status='COMPLETED' AND completed_at <= due_at",
    requires: 'action-items:view',
    filters: ['teamId', 'ownerId'],
    cacheTtlSeconds: 30,
  }),
  async compute(ctx) {
    const [r] = await ctx.prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`
      SELECT count(*)::int AS due, (count(*) FILTER (WHERE a.status = 'COMPLETED' AND a.completed_at <= a.due_at))::int AS on_time,
             (count(*) FILTER (WHERE a.status = 'COMPLETED' AND a.completed_at > a.due_at))::int AS late,
             (count(*) FILTER (WHERE a.status <> 'COMPLETED' AND a.due_at < ${ctx.now}::timestamptz))::int AS overdue
      FROM action_items a WHERE a.organization_id = ${ctx.organizationId}::uuid AND a.status <> 'CANCELLED' AND a.due_at >= ${ctx.window.from}::timestamptz AND a.due_at < ${ctx.window.to}::timestamptz${ownerIn(ctx.scope, 'a.owner_id')}`);
    const due = num(r?.due);
    return { value: pctStr(num(r?.on_time), due), numerator: String(num(r?.on_time)), denominator: String(due), nullReason: due === 0 ? 'ZERO_DENOMINATOR' : undefined, note: due === 0 ? 'No action item was due in this range' : null, breakdown: { completedLate: num(r?.late), overdueNotCompleted: num(r?.overdue) } };
  },
};

export const FND_002: KpiImpl = {
  meta: meta({
    id: 'KPI-FND-002',
    name: 'Quality of reporting (completeness %)',
    group: 'FND',
    unit: 'PERCENT',
    source: 'JD KPI Founder Support; DEC-028',
    definition: 'Mean completeness of the required sections (performance narrative, risks with solutions, opportunities, action-item review) of published Founder reports, with the Founder\'s own 1-5 rating shown alongside. Completeness is a proxy; the rating is the judgement.',
    numerator: 'Sum of completeness_pct of published first-version reports with a period in the range',
    denominator: 'Number of those reports',
    window: 'Reports whose period starts in the date range (trailing 3 months suggested)',
    exclusions: 'Drafts; correction versions (version > 1)',
    tables: ['founder_reports'],
    rounding: 'integer %',
    owner: 'Founder',
    refresh: 'On submit',
    zeroDenominator: 'No published report -> null (dash)',
    formula: 'mean(completeness_pct)',
    implementation: "SQL on founder_reports WHERE version_number=1 AND status='PUBLISHED'",
    decisions: ['DEC-028'],
    requires: 'founder-reports:view',
    minScope: 'org',
    filters: [],
    cacheTtlSeconds: 60,
  }),
  async compute(ctx) {
    const [r] = await ctx.prisma.$queryRaw<Array<Record<string, number | null>>>(Prisma.sql`
      SELECT count(*)::int AS n, coalesce(sum(completeness_pct), 0)::int AS total, avg(rating)::float AS rating, (count(rating))::int AS rated
      FROM founder_reports WHERE organization_id = ${ctx.organizationId}::uuid AND version_number = 1 AND status = 'PUBLISHED' AND period_start >= ${ctx.window.startsOn}::date AND period_start <= ${ctx.window.endsOn}::date`);
    const n = num(r?.n);
    return { value: n === 0 ? null : dec(D(num(r?.total)).div(n), 0), numerator: String(num(r?.total)), denominator: String(n), nullReason: n === 0 ? 'ZERO_DENOMINATOR' : undefined, note: n === 0 ? 'No published Founder report in this range' : null, breakdown: { reports: n, meanFounderRating: r?.rating === null || r?.rating === undefined ? null : Math.round(Number(r.rating) * 10) / 10, ratedReports: num(r?.rated), proxyNote: 'Completeness is a proxy for quality (DEC-028); the Founder rating is shown separately.' } };
  },
};

export const FND_003: KpiImpl = {
  meta: meta({
    id: 'KPI-FND-003',
    name: 'Timeliness of reporting (%)',
    group: 'FND',
    unit: 'PERCENT',
    source: 'JD KPI Founder Support',
    definition: 'Founder reports published on or before their due time (weekly: Monday 10:00 after the week; monthly: 3rd working day 10:00, DEC-028) as a share of the reports due in the range.',
    numerator: 'First-version reports with due_at in the range, already due, published on or before due_at',
    denominator: 'First-version reports with due_at in the range and due_at <= now',
    window: 'Reports due in the date range',
    exclusions: 'Correction versions; reports with approved deferral (not modelled)',
    tables: ['founder_reports'],
    rounding: '1 decimal place',
    owner: 'Founder',
    refresh: 'On submit',
    zeroDenominator: 'No report due -> null (dash)',
    formula: 'on-time / due x 100',
    implementation: "SQL on founder_reports WHERE version_number=1 AND due_at in range AND due_at <= now; on time = status='PUBLISHED' AND published_at <= due_at",
    decisions: ['DEC-028'],
    requires: 'founder-reports:view',
    minScope: 'org',
    filters: [],
    cacheTtlSeconds: 30,
  }),
  async compute(ctx) {
    const [r] = await ctx.prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`
      SELECT count(*)::int AS due, (count(*) FILTER (WHERE status = 'PUBLISHED' AND published_at <= due_at))::int AS on_time,
             (count(*) FILTER (WHERE status = 'PUBLISHED' AND published_at > due_at))::int AS late, (count(*) FILTER (WHERE status = 'DRAFT'))::int AS missing
      FROM founder_reports WHERE organization_id = ${ctx.organizationId}::uuid AND version_number = 1 AND due_at >= ${ctx.window.from}::timestamptz AND due_at < ${ctx.window.to}::timestamptz AND due_at <= ${ctx.now}::timestamptz`);
    const due = num(r?.due);
    return { value: pctStr(num(r?.on_time), due), numerator: String(num(r?.on_time)), denominator: String(due), nullReason: due === 0 ? 'ZERO_DENOMINATOR' : undefined, note: due === 0 ? 'No Founder report was due in this range' : null, breakdown: { late: num(r?.late), missingStillDraft: num(r?.missing) } };
  },
};

export const CX_KPIS: KpiImpl[] = [CX_001, CX_002, CX_003, CX_004, FND_001, FND_002, FND_003];
