import { Prisma } from '@prisma/client';
import { workingDays } from '../../../revenue/calc';
import { aggregateResponses, MIN_RESPONSES_FOR_RESULTS } from '../../../people/engagement/engagement.service';
import type { KpiImpl } from '../types';
import { ownerIn, num, pctStr } from '../sql';
import { callStats, followUpStats } from './crm';
import { revenueFacts, revenueFor } from './revenue-facts';
import { D, dec, meta } from './helpers';
import { money } from '../../../revenue/calc';

const SALES_ROLES = Prisma.sql`('SALES_TEAM_LEAD','SALES_MANAGER','SALES_EXECUTIVE')`;

/** ------------------------------------------------------------------------------------------------ team productivity */
export const TEA_003: KpiImpl = {
  meta: meta({
    id: 'KPI-TEA-003',
    name: 'Team productivity (calls per executive per working day)',
    group: 'TEA',
    unit: 'RATIO',
    source: 'JD KPI Team',
    definition: 'Shown as its components, never one hidden number: calls, follow-ups, conversions and revenue per executive (and calls per executive per working day as the headline).',
    numerator: 'Calls completed by the executives in scope in the range',
    denominator: 'Active executives (joined at least 7 days before the range ended) x working days (Mon-Sat) elapsed in the range',
    window: 'Date range in IST (default: current month, working days up to today)',
    exclusions: 'New joiners under 7 days; leave days are not tracked (HRMS out of scope, DEC-023); FAILED calls',
    tables: ['call_logs', 'tasks', 'leads', 'sales_records', 'sales_credits', 'users', 'user_role_assignments'],
    rounding: '1 decimal place',
    owner: 'Team Lead',
    refresh: 'On request',
    zeroDenominator: 'No active executive or no working day -> null (dash)',
    formula: 'calls / (executives x working days); components: follow-ups / executive, won leads / executive, revenue / executive',
    implementation: 'users JOIN user_role_assignments (SALES_EXECUTIVE, active); callStats() and followUpStats() restricted to those users; revenueActual() over them; workingDays()',
    decisions: ['DEC-023'],
    filters: ['teamId', 'ownerId'],
    cacheTtlSeconds: 60,
  }),
  async compute(ctx) {
    const cutoff = new Date(ctx.window.to.getTime() - 7 * 86_400_000);
    const execs = await ctx.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT u.id::text FROM users u JOIN user_role_assignments a ON a.user_id = u.id JOIN roles r ON r.id = a.role_id AND r.key = 'SALES_EXECUTIVE'
      WHERE u.organization_id = ${ctx.organizationId}::uuid AND u.is_active AND u.created_at <= ${cutoff}${ownerIn(ctx.scope, 'u.id')}`);
    const ids = execs.map((e) => e.id);
    const endDay = ctx.asOf < ctx.window.endsOn ? (ctx.asOf < ctx.window.startsOn ? ctx.window.startsOn : ctx.asOf) : ctx.window.endsOn;
    const wd = workingDays(ctx.window.startsOn, endDay);
    if (ids.length === 0 || wd === 0) return { value: null, nullReason: 'ZERO_DENOMINATOR', note: ids.length === 0 ? 'No active executives in scope' : 'No working day elapsed in this range', breakdown: { executives: ids.length, workingDays: wd } };
    const sub = { ...ctx, scope: { ...ctx.scope, userIds: ids, narrowed: true } };
    const [calls, follow, won, facts] = await Promise.all([
      callStats(sub),
      followUpStats(sub),
      ctx.prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*)::int AS n FROM leads l WHERE l.organization_id = ${ctx.organizationId}::uuid AND l.stage_category = 'WON' AND l.won_at >= ${ctx.window.from}::timestamptz AND l.won_at < ${ctx.window.to}::timestamptz AND l.assigned_to_id = ANY(${ids}::uuid[]) AND l.merged_into_id IS NULL`),
      revenueFacts(sub, ctx.window),
    ]);
    const revenue = revenueFor(facts, ctx.window, new Set(ids)).net;
    const n = ids.length;
    const per = (x: number) => dec(x / n, 1);
    const perDay = dec(calls.completed / (n * wd), 1);
    return {
      value: perDay,
      numerator: String(calls.completed),
      denominator: String(n * wd),
      currency: 'INR',
      breakdown: {
        executives: n,
        workingDays: wd,
        callsPerExecutivePerDay: perDay,
        callsPerExecutive: per(calls.completed),
        followUpsCompletedPerExecutive: per(follow.completed),
        conversionsPerExecutive: per(num(won[0]?.n)),
        revenuePerExecutive: money(D(revenue).div(n)),
        totals: { callsCompleted: calls.completed, followUpsCompleted: follow.completed, wonLeads: num(won[0]?.n), revenue: money(revenue) },
        index: null,
        indexNote: 'A single index is deliberately not computed: KRA targets are weekly and manual (kpi_assignments); the components above are the measure.',
      },
    };
  },
};

/** ------------------------------------------------------------------------------------------------ attrition */
export const TEA_004: KpiImpl = {
  meta: meta({
    id: 'KPI-TEA-004',
    name: 'Attrition (%)',
    group: 'TEA',
    unit: 'PERCENT',
    source: 'JD KPI Team; DEC-037',
    definition: 'Sales-team exits in the range (voluntary and involuntary shown separately) as a percentage of average headcount ((start + end) / 2). Aggregate only; individual HR records are never exposed.',
    numerator: 'Sales-team members (Team Lead, Managers, Executives) whose exit date falls in the range, excluding internal transfers',
    denominator: 'Average headcount = (headcount at range start + at range end) / 2',
    window: 'Date range (month or rolling 12 months)',
    exclusions: 'Internal transfers (exit type TRANSFER); contractors; viewers below organisation scope cannot see it',
    tables: ['employee_profiles', 'users', 'user_role_assignments', 'roles'],
    rounding: '1 decimal place',
    owner: 'HR / Team Lead',
    refresh: 'Monthly',
    zeroDenominator: 'Average headcount 0 -> null (dash)',
    formula: 'exits / average headcount x 100',
    implementation: 'SQL on users LEFT JOIN employee_profiles (join = coalesce(join_date, created_at), exit = coalesce(exit_date, deactivated_at)); headcount at date d = join <= d AND (exit IS NULL OR exit > d)',
    decisions: ['DEC-037'],
    minScope: 'org',
    filters: ['teamId'],
    cacheTtlSeconds: 300,
  }),
  async compute(ctx) {
    const s = ctx.window.startsOn;
    const e = ctx.window.endsOn;
    const [r] = await ctx.prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`
      WITH b AS (
        SELECT u.id, coalesce(p.join_date, u.created_at::date) AS j, coalesce(p.exit_date, u.deactivated_at::date) AS x, p.exit_type::text AS xt
        FROM users u LEFT JOIN employee_profiles p ON p.user_id = u.id
        WHERE u.organization_id = ${ctx.organizationId}::uuid${ownerIn(ctx.scope, 'u.id')}
          AND EXISTS (SELECT 1 FROM user_role_assignments a JOIN roles r ON r.id = a.role_id WHERE a.user_id = u.id AND r.key IN ${SALES_ROLES}))
      SELECT (count(*) FILTER (WHERE x BETWEEN ${s}::date AND ${e}::date AND coalesce(xt, '') <> 'TRANSFER'))::int AS exits,
             (count(*) FILTER (WHERE x BETWEEN ${s}::date AND ${e}::date AND xt = 'VOLUNTARY'))::int AS voluntary,
             (count(*) FILTER (WHERE x BETWEEN ${s}::date AND ${e}::date AND coalesce(xt, '') NOT IN ('VOLUNTARY', 'TRANSFER')))::int AS involuntary,
             (count(*) FILTER (WHERE j <= ${s}::date AND (x IS NULL OR x > ${s}::date)))::int AS head_start,
             (count(*) FILTER (WHERE j <= ${e}::date AND (x IS NULL OR x > ${e}::date)))::int AS head_end
      FROM b`);
    const exits = num(r?.exits);
    const avg = (num(r?.head_start) + num(r?.head_end)) / 2;
    const value = avg > 0 ? pctStr(exits, avg) : null;
    return {
      value,
      numerator: String(exits),
      denominator: String(avg),
      nullReason: value === null ? 'ZERO_DENOMINATOR' : undefined,
      note: value === null ? 'Average headcount is zero for this range' : null,
      breakdown: { exits, voluntary: num(r?.voluntary), involuntary: num(r?.involuntary), headcountStart: num(r?.head_start), headcountEnd: num(r?.head_end), averageHeadcount: avg },
    };
  },
};

/** ------------------------------------------------------------------------------------------------ engagement */
export const TEA_005: KpiImpl = {
  meta: meta({
    id: 'KPI-TEA-005',
    name: 'Team engagement score',
    group: 'TEA',
    unit: 'SCORE',
    source: 'JD KPI Team; DEC-024',
    definition: 'Mean of pulse-survey scale answers (1-5) scaled to 100. Responses are anonymous (no user reference is stored), so the score is organisation-wide and is suppressed below the anonymity floor (5 responses per survey).',
    numerator: 'Sum of all SCALE_5 answers of surveys that meet the floor, responded in the range',
    denominator: 'Number of those answers',
    window: 'Responses given in the date range (monthly by default)',
    exclusions: 'Surveys with fewer responses than the floor; text answers; viewers below organisation scope',
    tables: ['engagement_surveys', 'engagement_responses'],
    rounding: 'integer (0-100)',
    owner: 'HR / Team Lead',
    refresh: 'Monthly',
    zeroDenominator: 'Below the floor -> null (dash) with "insufficient responses"',
    formula: 'mean(answers) / 5 x 100',
    implementation: 'engagement_responses in the range grouped by survey; people aggregateResponses() enforces the anonymity floor; pooled mean',
    decisions: ['DEC-024'],
    requires: 'engagement:view',
    minScope: 'org',
    filters: [],
    cacheTtlSeconds: 300,
  }),
  async compute(ctx) {
    const surveys = await ctx.prisma.engagementSurvey.findMany({
      where: { organizationId: ctx.organizationId },
      include: { responses: { where: { respondedOn: { gte: new Date(`${ctx.window.startsOn}T00:00:00Z`), lte: new Date(`${ctx.window.endsOn}T00:00:00Z`) } }, select: { answers: true } } },
    });
    let total = 0;
    let n = 0;
    let responses = 0;
    let suppressed = 0;
    for (const s of surveys) {
      const answers = s.responses.map((x) => x.answers as Record<string, number | string>);
      if (answers.length === 0) continue;
      const agg = aggregateResponses(s.questions as never, answers, ctx.config.engagementFloor);
      if (agg === null) {
        suppressed += 1;
        continue;
      }
      responses += answers.length;
      const qs = s.questions as Array<{ id: string; type: string }>;
      for (const q of qs.filter((x) => x.type === 'SCALE_5')) {
        for (const a of answers) {
          const v = a[q.id];
          if (typeof v === 'number') {
            total += v;
            n += 1;
          }
        }
      }
    }
    if (n === 0) return { value: null, nullReason: 'INSUFFICIENT_RESPONSES', note: `Fewer than ${ctx.config.engagementFloor} responses: the score is hidden to protect anonymity`, breakdown: { surveysSuppressed: suppressed, floor: ctx.config.engagementFloor, defaultFloor: MIN_RESPONSES_FOR_RESULTS } };
    return { value: dec(D(total).div(n).div(5).times(100), 0), numerator: String(total), denominator: String(n), breakdown: { meanOf5: dec(D(total).div(n), 2), responses, surveysSuppressed: suppressed, floor: ctx.config.engagementFloor } };
  },
};

/** ------------------------------------------------------------------------------------------------ coaching hours */
export const TEA_006: KpiImpl = {
  meta: meta({
    id: 'KPI-TEA-006',
    name: 'Coaching hours conducted',
    group: 'TEA',
    unit: 'HOURS',
    source: 'JD KPI Team',
    definition: 'Hours of recorded coaching sessions and held 1:1s in the range (date, coach and duration recorded).',
    numerator: 'Sum of coaching_sessions.duration_min plus one_on_ones.duration_min (HELD) in the range, divided by 60',
    denominator: 'n/a',
    window: 'Date range in IST (default: current month)',
    exclusions: 'Sessions without duration; cancelled and scheduled-but-not-held 1:1s; future-dated sessions',
    tables: ['coaching_sessions', 'one_on_ones'],
    rounding: '1 decimal place (hours)',
    owner: 'Team Lead',
    refresh: 'On request',
    zeroDenominator: 'n/a: zero shows 0.0',
    formula: 'sum(minutes) / 60',
    implementation: 'SQL: coaching_sessions (coach_id in scope) + one_on_ones HELD (manager_id in scope)',
    requires: 'coaching:view',
    filters: ['teamId', 'ownerId'],
    cacheTtlSeconds: 60,
  }),
  async compute(ctx) {
    const [c] = await ctx.prisma.$queryRaw<Array<{ mins: number; n: number }>>(Prisma.sql`SELECT coalesce(sum(duration_min), 0)::int AS mins, count(*)::int AS n FROM coaching_sessions WHERE organization_id = ${ctx.organizationId}::uuid AND duration_min > 0 AND session_date >= ${ctx.window.from}::timestamptz AND session_date < ${ctx.window.to}::timestamptz AND session_date <= ${ctx.now}::timestamptz${ownerIn(ctx.scope, 'coach_id')}`);
    const [o] = await ctx.prisma.$queryRaw<Array<{ mins: number; n: number }>>(Prisma.sql`SELECT coalesce(sum(duration_min), 0)::int AS mins, count(*)::int AS n FROM one_on_ones WHERE organization_id = ${ctx.organizationId}::uuid AND status = 'HELD' AND duration_min > 0 AND scheduled_for >= ${ctx.window.from}::timestamptz AND scheduled_for < ${ctx.window.to}::timestamptz AND scheduled_for <= ${ctx.now}::timestamptz${ownerIn(ctx.scope, 'manager_id')}`);
    const mins = num(c?.mins) + num(o?.mins);
    return { value: dec(mins / 60, 1), numerator: String(mins), breakdown: { coachingSessionMinutes: num(c?.mins), coachingSessions: num(c?.n), oneOnOneMinutes: num(o?.mins), oneOnOnesHeld: num(o?.n) } };
  },
};

/** ------------------------------------------------------------------------------------------------ SOP adoption */
export const PRO_001: KpiImpl = {
  meta: meta({
    id: 'KPI-PRO-001',
    name: 'SOP adoption rate (%)',
    group: 'PRO',
    unit: 'PERCENT',
    source: 'JD KPI Process',
    definition: 'Of the (user, mandatory SOP) pairs that are required today, the share where the user has acknowledged the CURRENT effective version. Acknowledgements of older versions never count.',
    numerator: 'Required pairs with an acknowledgement of the effective version',
    denominator: 'Active in-audience users x mandatory ACTIVE SOPs with an effective approved version',
    window: 'As at today (effective version = highest APPROVED with effective_date <= today)',
    exclusions: 'Optional SOPs; users added in the last 7 days who have not yet acknowledged (grace); inactive users',
    tables: ['sop_documents', 'sop_versions', 'sop_acknowledgements', 'users', 'user_role_assignments'],
    rounding: '1 decimal place',
    owner: 'Team Lead',
    refresh: 'On request; org snapshot daily',
    zeroDenominator: 'No mandatory SOP or no required user -> null (dash)',
    formula: 'acknowledged / required x 100',
    implementation: 'SQL CTE eff (DISTINCT ON document, highest approved effective version) x in-audience active users LEFT JOIN sop_acknowledgements (same maths as GET /sop/adoption, plus the new-joiner grace)',
    requires: 'sop:adoption:view',
    usesWindow: 'POINT_IN_TIME',
    filters: ['teamId', 'ownerId'],
    cacheTtlSeconds: 60,
  }),
  async compute(ctx) {
    const grace = new Date(ctx.now.getTime() - ctx.config.sopNewJoinerGraceDays * 86_400_000);
    const rows = await ctx.prisma.$queryRaw<Array<{ doc: string; title: string; required: number; acknowledged: number }>>(Prisma.sql`
      WITH eff AS (
        SELECT DISTINCT ON (d.id) d.id AS doc_id, d.title, d.audience_roles, v.id AS version_id
        FROM sop_documents d JOIN sop_versions v ON v.document_id = d.id AND v.status = 'APPROVED' AND (v.effective_date IS NULL OR v.effective_date <= ${ctx.asOf}::date)
        WHERE d.organization_id = ${ctx.organizationId}::uuid AND d.status = 'ACTIVE' AND d.is_mandatory
        ORDER BY d.id, v.version_number DESC),
      req AS (
        SELECT e.doc_id, e.title, e.version_id, u.id AS user_id, u.created_at
        FROM eff e JOIN users u ON u.organization_id = ${ctx.organizationId}::uuid AND u.is_active${ownerIn(ctx.scope, 'u.id')}
          AND (cardinality(e.audience_roles) = 0 OR EXISTS (SELECT 1 FROM user_role_assignments a JOIN roles r ON r.id = a.role_id WHERE a.user_id = u.id AND r.key = ANY(e.audience_roles))))
      SELECT req.doc_id::text AS doc, req.title,
             (count(*) FILTER (WHERE a.id IS NOT NULL OR req.created_at <= ${grace}))::int AS required,
             (count(a.id))::int AS acknowledged
      FROM req LEFT JOIN sop_acknowledgements a ON a.version_id = req.version_id AND a.user_id = req.user_id
      GROUP BY req.doc_id, req.title ORDER BY req.title`);
    const required = rows.reduce((a, r) => a + num(r.required), 0);
    const ack = rows.reduce((a, r) => a + num(r.acknowledged), 0);
    return {
      value: pctStr(ack, required),
      numerator: String(ack),
      denominator: String(required),
      nullReason: required === 0 ? 'ZERO_DENOMINATOR' : undefined,
      note: required === 0 ? 'No mandatory SOP requires acknowledgement from anyone in scope' : null,
      breakdown: { newJoinerGraceDays: ctx.config.sopNewJoinerGraceDays, perSop: rows.map((r) => ({ documentId: r.doc, title: r.title, required: num(r.required), acknowledged: num(r.acknowledged), adoptionPct: pctStr(num(r.acknowledged), num(r.required)) })) },
    };
  },
};

/** ------------------------------------------------------------------------------------------------ dashboard accuracy & timeliness */
export const PRO_002: KpiImpl = {
  meta: meta({
    id: 'KPI-PRO-002',
    name: 'Dashboard accuracy and timeliness',
    group: 'PRO',
    unit: 'PERCENT',
    source: 'JD KPI Process',
    definition: 'Accuracy: share of reconciliation checks (dashboard KPI vs an independent SQL recompute from the base tables) that matched within tolerance (0 for counts, 0.01 for money). Timeliness: minutes since the last completed run and whether it is within the 26 hour SLA.',
    numerator: 'Checks that passed in the runs of the range',
    denominator: 'Checks executed in the runs of the range (skipped checks are listed, not counted)',
    window: 'Reconciliation runs completed in the date range',
    exclusions: 'Skipped checks',
    tables: ['kpi_reconciliation_runs'],
    rounding: '1 decimal place; minutes',
    owner: 'Founder / Tech',
    refresh: 'Daily 03:00 IST (scheduler) and on demand via POST /reports/reconciliation/run',
    zeroDenominator: 'No run in the range -> null (dash) with "no reconciliation run yet"',
    formula: 'passed / executed x 100',
    implementation: 'ReconciliationService.run() persists kpi_reconciliation_runs; this KPI aggregates passed/total over runs in the range',
    minScope: 'org',
    filters: [],
    cacheTtlSeconds: 30,
  }),
  async compute(ctx) {
    const runs = await ctx.prisma.kpiReconciliationRun.findMany({ where: { organizationId: ctx.organizationId, ranAt: { gte: ctx.window.from, lt: ctx.window.to } }, orderBy: { ranAt: 'desc' }, select: { ranAt: true, totalChecks: true, passed: true, failed: true, skipped: true } });
    const last = await ctx.prisma.kpiReconciliationRun.findFirst({ where: { organizationId: ctx.organizationId }, orderBy: { ranAt: 'desc' }, select: { ranAt: true, failed: true } });
    const lagMinutes = last ? Math.round((ctx.now.getTime() - last.ranAt.getTime()) / 60_000) : null;
    const total = runs.reduce((a, r) => a + r.totalChecks, 0);
    const passed = runs.reduce((a, r) => a + r.passed, 0);
    const timeliness = { lastRunAt: last?.ranAt.toISOString() ?? null, lagMinutes, withinSla: lagMinutes === null ? null : lagMinutes <= 26 * 60, slaMinutes: 26 * 60, liveFreshnessSlaMinutes: ctx.config.freshnessLiveSlaMinutes };
    if (total === 0) return { value: null, nullReason: 'NO_DATA', note: 'No reconciliation run has completed in this range yet', breakdown: { runs: 0, timeliness } };
    return { value: pctStr(passed, total), numerator: String(passed), denominator: String(total), breakdown: { runs: runs.length, failedChecks: runs.reduce((a, r) => a + r.failed, 0), skippedChecks: runs.reduce((a, r) => a + r.skipped, 0), timeliness } };
  },
};

export const PEOPLE_KPIS: KpiImpl[] = [TEA_003, TEA_004, TEA_005, TEA_006, PRO_001, PRO_002];
