import { Prisma } from '@prisma/client';
import { getWorkingHours, workingMinutesBetween } from '@salesos/crm-core';
import type { KpiComputed, KpiCtx, KpiImpl } from '../types';
import { leadFilters, leadScope, median, notDemo, notMerged, num, ownerIn, pctStr, percentile } from '../sql';
import { meta } from './helpers';

const CONNECTED = Prisma.sql`('CONNECTED','WON','LOST','CALLBACK')`;
const EXCLUDED_LOST = Prisma.sql`('DUPLICATE_OR_INVALID','NOT_ELIGIBLE')`;

/** ------------------------------------------------------------------------------------------------ lead conversion */
export const SAL_001: KpiImpl = {
  meta: meta({
    id: 'KPI-SAL-001',
    name: 'Lead conversion (%)',
    group: 'SAL',
    unit: 'PERCENT',
    source: 'JD KPI Sales',
    definition: 'Of the eligible leads created in the date range (cohort), the share that reached WON within the conversion window (default 60 days from creation, DEC-009).',
    numerator: 'Distinct leads in the cohort with stage WON and won_at <= created_at + conversion window',
    denominator: 'Eligible leads created in the date range',
    window: 'Lead-created cohort; a separate "won in range" count is shown, labelled, as a secondary view',
    exclusions: 'Leads merged away; lost reasons DUPLICATE_OR_INVALID / NOT_ELIGIBLE; [DEMO] leads when excluded by configuration',
    tables: ['leads'],
    rounding: '1 decimal place',
    owner: 'Team Lead',
    refresh: 'On request (cohorts need maturity); org snapshot daily',
    zeroDenominator: 'Empty cohort -> null (dash)',
    formula: 'distinct won within window / eligible x 100',
    implementation: "SQL on leads: count(*) FILTER (stage_category='WON' AND won_at <= created_at + window) / count(*) with created_at in range, merged_into_id IS NULL, lost_reason NOT IN (...); lead scope = scopedWhere(leads)",
    decisions: ['DEC-009', 'DEC-006'],
    cacheTtlSeconds: 60,
  }),
  async compute(ctx) {
    const win = ctx.config.conversionWindowDays;
    const [row] = await ctx.prisma.$queryRaw<Array<{ den: number; num: number; matured: number }>>(Prisma.sql`
      SELECT count(*)::int AS den,
             (count(*) FILTER (WHERE l.stage_category = 'WON' AND l.won_at IS NOT NULL AND l.won_at <= l.created_at + make_interval(days => ${win}::int)))::int AS num,
             (count(*) FILTER (WHERE l.created_at <= ${ctx.now}::timestamptz - make_interval(days => ${win}::int)))::int AS matured
      FROM leads l
      WHERE l.organization_id = ${ctx.organizationId}::uuid AND l.created_at >= ${ctx.window.from}::timestamptz AND l.created_at < ${ctx.window.to}::timestamptz
        AND (l.lost_reason IS NULL OR l.lost_reason NOT IN ${EXCLUDED_LOST})${notMerged()}${notDemo(ctx)}${leadScope(ctx.scope)}${leadFilters(ctx.filters)}`);
    const [won] = await ctx.prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT count(*)::int AS n FROM leads l WHERE l.organization_id = ${ctx.organizationId}::uuid AND l.stage_category = 'WON' AND l.won_at >= ${ctx.window.from}::timestamptz AND l.won_at < ${ctx.window.to}::timestamptz${notMerged()}${notDemo(ctx)}${leadScope(ctx.scope)}${leadFilters(ctx.filters)}`);
    const den = num(row?.den);
    const n = num(row?.num);
    const matured = num(row?.matured);
    return {
      value: pctStr(n, den),
      numerator: String(n),
      denominator: String(den),
      nullReason: den === 0 ? 'ZERO_DENOMINATOR' : undefined,
      note: den === 0 ? 'No eligible leads were created in this range' : null,
      caution: den > 0 && matured < den ? `${den - matured} of ${den} leads have not yet completed the ${win}-day conversion window; the rate can still rise` : null,
      breakdown: { conversionWindowDays: win, matureLeads: matured, wonInRange: num(won?.n), wonInRangeNote: 'Secondary view: leads that became WON in the range regardless of when they were created' },
    };
  },
};

/** ------------------------------------------------------------------------------------------------ webinar / demo to sale */
async function eventToSale(ctx: KpiCtx, type: 'WEBINAR' | 'DEMO'): Promise<KpiComputed> {
  const days = ctx.config.attributionWindowDays;
  const [row] = await ctx.prisma.$queryRaw<Array<{ den: number; num: number; registered: number }>>(Prisma.sql`
    WITH att AS (
      SELECT ea.lead_id, max(coalesce(ea.joined_at, e.starts_at)) AS anchor
      FROM event_attendance ea JOIN events e ON e.id = ea.event_id
      WHERE ea.organization_id = ${ctx.organizationId}::uuid AND e.type = ${type}::"EventType" AND e.status <> 'CANCELLED'
        AND e.starts_at >= ${ctx.window.from}::timestamptz AND e.starts_at < ${ctx.window.to}::timestamptz
        AND ea.status IN ('ATTENDED','FOLLOWED_UP','CONVERTED','NOT_CONVERTED')
        ${ctx.filters.programId ? Prisma.sql`AND e.program_id = ${ctx.filters.programId}::uuid` : Prisma.empty}
      GROUP BY ea.lead_id)
    SELECT count(*)::int AS den,
           (count(*) FILTER (WHERE EXISTS (SELECT 1 FROM sales_records s WHERE s.lead_id = att.lead_id AND s.organization_id = ${ctx.organizationId}::uuid AND s.closed_at >= att.anchor AND s.closed_at < att.anchor + make_interval(days => ${days}::int))))::int AS num,
           0 AS registered
    FROM att JOIN leads l ON l.id = att.lead_id
    WHERE true${notMerged()}${notDemo(ctx)}${leadScope(ctx.scope)}${leadFilters({ sourceId: ctx.filters.sourceId })}`);
  const [reg] = await ctx.prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT count(DISTINCT ea.lead_id)::int AS n FROM event_attendance ea JOIN events e ON e.id = ea.event_id JOIN leads l ON l.id = ea.lead_id
    WHERE ea.organization_id = ${ctx.organizationId}::uuid AND e.type = ${type}::"EventType" AND e.starts_at >= ${ctx.window.from}::timestamptz AND e.starts_at < ${ctx.window.to}::timestamptz
      AND ea.status IN ('REGISTERED','ATTENDED','FOLLOWED_UP','CONVERTED','NOT_CONVERTED','NO_SHOW')${notMerged()}${leadScope(ctx.scope)}${leadFilters({ sourceId: ctx.filters.sourceId })}`);
  const den = num(row?.den);
  const n = num(row?.num);
  const label = type === 'WEBINAR' ? 'webinar' : 'demo';
  return {
    value: pctStr(n, den),
    numerator: String(n),
    denominator: String(den),
    nullReason: den === 0 ? 'ZERO_DENOMINATOR' : undefined,
    note: den === 0 ? `No ${label} attendees in this range` : null,
    breakdown: { attributionWindowDays: days, registeredOrAttendedLeads: num(reg?.n), anchor: `most recent attended ${label} start / join time` },
  };
}

export const SAL_002: KpiImpl = {
  meta: meta({
    id: 'KPI-SAL-002',
    name: 'Webinar-to-sale conversion (%)',
    group: 'SAL',
    unit: 'PERCENT',
    source: 'JD KPI Sales',
    definition: 'Distinct webinar attendees who bought within the attribution window (DEC-010: 30 days after the most recent attended webinar) as a share of distinct attendees of webinars held in the range.',
    numerator: 'Distinct attended leads with a sales_record closed within the attribution window after their most recent attended webinar',
    denominator: 'Distinct leads who attended webinars starting in the range',
    window: 'Webinars starting in the date range',
    exclusions: 'No-shows (reported separately as registration-to-attendance); cancelled webinars; sales not linked to an attendance; merged duplicates',
    tables: ['events', 'event_attendance', 'sales_records', 'leads'],
    rounding: '1 decimal place',
    owner: 'Team Lead / Marketing (consumer)',
    refresh: 'On request; org snapshot daily',
    zeroDenominator: 'No attendees -> null (dash)',
    formula: 'attributed sales / attendees x 100',
    implementation: "SQL: CTE att (event_attendance JOIN events type=WEBINAR, status IN ATTENDED/FOLLOWED_UP/CONVERTED/NOT_CONVERTED, anchor=max(coalesce(joined_at, starts_at))) + EXISTS(sales_records.closed_at in [anchor, anchor+window))",
    decisions: ['DEC-010'],
    filters: ['teamId', 'ownerId', 'programId', 'sourceId'],
    cacheTtlSeconds: 60,
  }),
  compute: (ctx) => eventToSale(ctx, 'WEBINAR'),
};

export const SAL_003: KpiImpl = {
  meta: meta({
    id: 'KPI-SAL-003',
    name: 'Demo-to-sale conversion (%)',
    group: 'SAL',
    unit: 'PERCENT',
    source: 'JD KPI Sales',
    definition: 'Distinct demo attendees who bought within the attribution window (DEC-010) as a share of distinct leads who attended a demo held in the range.',
    numerator: 'Distinct demo attendees with a sales_record closed within the attribution window after their most recent attended demo',
    denominator: 'Distinct leads who attended demos starting in the range',
    window: 'Demos starting in the date range',
    exclusions: 'No-shows, rescheduled-not-held, cancelled demos, merged duplicates',
    tables: ['events', 'event_attendance', 'sales_records', 'leads'],
    rounding: '1 decimal place',
    owner: 'Team Lead',
    refresh: 'On request; org snapshot daily',
    zeroDenominator: 'No demos held -> null (dash)',
    formula: 'attributed sales / demo attendees x 100',
    implementation: 'As KPI-SAL-002 with events.type=DEMO',
    decisions: ['DEC-010'],
    filters: ['teamId', 'ownerId', 'programId', 'sourceId'],
    cacheTtlSeconds: 60,
  }),
  compute: (ctx) => eventToSale(ctx, 'DEMO'),
};

/** ------------------------------------------------------------------------------------------------ calls */
export interface CallStats {
  attempts: number;
  completed: number;
  connected: number;
  uniqueClients: number;
  uniqueConnected: number;
  bySource: { MANUAL: number; PROVIDER: number; DEVICE: number };
}

export async function callStats(ctx: KpiCtx): Promise<CallStats> {
  const needLead = Boolean(ctx.filters.programId || ctx.filters.sourceId);
  const [r] = await ctx.prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`
    SELECT count(*)::int AS attempts,
           (count(*) FILTER (WHERE c.outcome <> 'FAILED'))::int AS completed,
           (count(*) FILTER (WHERE c.outcome IN ${CONNECTED}))::int AS connected,
           count(DISTINCT c.lead_id)::int AS unique_clients,
           (count(DISTINCT c.lead_id) FILTER (WHERE c.outcome IN ${CONNECTED}))::int AS unique_connected,
           (count(*) FILTER (WHERE c.source = 'MANUAL'))::int AS manual,
           (count(*) FILTER (WHERE c.source = 'PROVIDER'))::int AS provider,
           (count(*) FILTER (WHERE c.source = 'DEVICE'))::int AS device
    FROM call_logs c ${needLead ? Prisma.sql`JOIN leads l ON l.id = c.lead_id` : Prisma.empty}
    WHERE c.organization_id = ${ctx.organizationId}::uuid AND c.started_at >= ${ctx.window.from}::timestamptz AND c.started_at < ${ctx.window.to}::timestamptz
      ${ownerIn(ctx.scope, 'c.user_id')}${needLead ? leadFilters(ctx.filters) : Prisma.empty}`);
  return {
    attempts: num(r?.attempts),
    completed: num(r?.completed),
    connected: num(r?.connected),
    uniqueClients: num(r?.unique_clients),
    uniqueConnected: num(r?.unique_connected),
    bySource: { MANUAL: num(r?.manual), PROVIDER: num(r?.provider), DEVICE: num(r?.device) },
  };
}

const sourceLabel = (s: CallStats['bySource']) => {
  const parts = Object.entries(s).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`);
  return parts.length ? parts.join(', ') : 'MANUAL (no calls)';
};

const callMeta = {
  group: 'PRD' as const,
  unit: 'COUNT' as const,
  window: 'Date range in IST (default: current month); call time = call_logs.started_at',
  tables: ['call_logs', 'leads'],
  rounding: 'integer',
  owner: 'Team Lead / Manager',
  refresh: 'Near real time (computed on request)',
  zeroDenominator: 'n/a (count): zero calls shows 0',
  decisions: ['DEC-036'],
  filters: ['teamId', 'ownerId', 'programId', 'sourceId'] as Array<'teamId' | 'ownerId' | 'programId' | 'sourceId'>,
  cacheTtlSeconds: 30,
};

export const PRD_001: KpiImpl = {
  meta: meta({
    ...callMeta,
    id: 'KPI-PRD-001',
    name: 'Calls completed',
    source: 'JD KPI Productivity',
    definition: 'Call records by the owner in the range whose outcome is not FAILED. Call attempts, connected calls and unique clients called are reported separately and never merged. Data source (MANUAL / PROVIDER / DEVICE) is shown.',
    numerator: 'Count of call_logs with outcome <> FAILED in the range',
    denominator: 'n/a (count); per-day target comes from KRA assignments',
    exclusions: 'FAILED outcomes are attempts but not completed calls',
    formula: 'count',
    implementation: 'SQL on call_logs: count(*) FILTER (outcome <> FAILED); attempts = count(*); connected = outcome IN (CONNECTED, WON, LOST, CALLBACK); unique clients = count(DISTINCT lead_id)',
  }),
  async compute(ctx) {
    const s = await callStats(ctx);
    return { value: String(s.completed), numerator: String(s.completed), dataSource: sourceLabel(s.bySource), breakdown: { callAttempts: s.attempts, callsCompleted: s.completed, connectedCalls: s.connected, uniqueClientsCalled: s.uniqueClients, uniqueClientsConnected: s.uniqueConnected, bySource: s.bySource, note: 'Attempts and unique clients are different measures: 10 attempts can be 3 clients.' } };
  },
};

export const PRD_006: KpiImpl = {
  meta: meta({
    ...callMeta,
    id: 'KPI-PRD-006',
    name: 'Call attempts',
    source: 'Blueprint s8 (call attempts)',
    definition: 'Every call record in the range, whatever the outcome (including no answer and failed). Not the same as unique clients.',
    numerator: 'Count of call_logs in the range',
    denominator: 'n/a (count)',
    exclusions: 'None (attempts include FAILED)',
    formula: 'count',
    implementation: 'SQL on call_logs: count(*)',
  }),
  async compute(ctx) {
    const s = await callStats(ctx);
    return { value: String(s.attempts), numerator: String(s.attempts), dataSource: sourceLabel(s.bySource), breakdown: { bySource: s.bySource } };
  },
};

export const PRD_007: KpiImpl = {
  meta: meta({
    ...callMeta,
    id: 'KPI-PRD-007',
    name: 'Connected calls',
    source: 'Blueprint s8 (connected calls)',
    definition: 'Calls in the range where the client was reached: outcome CONNECTED, WON, LOST or CALLBACK.',
    numerator: 'Count of call_logs with outcome IN (CONNECTED, WON, LOST, CALLBACK)',
    denominator: 'Call attempts in the range (connect rate shown in the breakdown)',
    exclusions: 'NO_ANSWER, BUSY, SWITCHED_OFF and FAILED outcomes',
    formula: 'count',
    implementation: 'SQL on call_logs with outcome filter',
  }),
  async compute(ctx) {
    const s = await callStats(ctx);
    return { value: String(s.connected), numerator: String(s.connected), denominator: String(s.attempts), dataSource: sourceLabel(s.bySource), breakdown: { connectRatePct: pctStr(s.connected, s.attempts), uniqueClientsConnected: s.uniqueConnected } };
  },
};

export const PRD_008: KpiImpl = {
  meta: meta({
    ...callMeta,
    id: 'KPI-PRD-008',
    name: 'Unique clients called',
    source: 'JD KPI Productivity (unique clients vs attempts)',
    definition: 'Distinct leads called at least once in the range; separate from the number of attempts.',
    numerator: 'Count of distinct lead_id in call_logs in the range',
    denominator: 'Call attempts in the range (attempts per client shown in the breakdown)',
    exclusions: 'None',
    formula: 'count distinct',
    implementation: 'SQL on call_logs: count(DISTINCT lead_id)',
  }),
  async compute(ctx) {
    const s = await callStats(ctx);
    return { value: String(s.uniqueClients), numerator: String(s.uniqueClients), denominator: String(s.attempts), dataSource: sourceLabel(s.bySource), breakdown: { attemptsPerClient: s.uniqueClients ? Math.round((s.attempts / s.uniqueClients) * 10) / 10 : null } };
  },
};

/** ------------------------------------------------------------------------------------------------ follow-ups */
const FOLLOW_TYPES = Prisma.sql`('FOLLOW_UP','CALLBACK','DEMO','EMAIL')`;

export interface FollowUpStats {
  completed: number;
  due: number;
  onTime: number;
  late: number;
  overdueOpen: number;
}

export async function followUpStats(ctx: KpiCtx): Promise<FollowUpStats> {
  const needLead = Boolean(ctx.filters.programId || ctx.filters.sourceId);
  const [r] = await ctx.prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`
    SELECT (count(*) FILTER (WHERE t.status = 'DONE' AND t.completed_at >= ${ctx.window.from}::timestamptz AND t.completed_at < ${ctx.window.to}::timestamptz))::int AS completed,
           (count(*) FILTER (WHERE t.due_at >= ${ctx.window.from}::timestamptz AND t.due_at < ${ctx.window.to}::timestamptz AND t.status <> 'CANCELLED' AND (t.status = 'DONE' OR t.due_at < ${ctx.now}::timestamptz)))::int AS due,
           (count(*) FILTER (WHERE t.due_at >= ${ctx.window.from}::timestamptz AND t.due_at < ${ctx.window.to}::timestamptz AND t.status = 'DONE' AND t.completed_at <= t.due_at))::int AS on_time,
           (count(*) FILTER (WHERE t.due_at >= ${ctx.window.from}::timestamptz AND t.due_at < ${ctx.window.to}::timestamptz AND t.status = 'DONE' AND t.completed_at > t.due_at))::int AS late,
           (count(*) FILTER (WHERE t.due_at >= ${ctx.window.from}::timestamptz AND t.due_at < ${ctx.window.to}::timestamptz AND t.status = 'OPEN' AND t.due_at < ${ctx.now}::timestamptz))::int AS overdue_open
    FROM tasks t ${needLead ? Prisma.sql`JOIN leads l ON l.id = t.lead_id` : Prisma.empty}
    WHERE t.organization_id = ${ctx.organizationId}::uuid AND t.type IN ${FOLLOW_TYPES}
      AND ((t.due_at >= ${ctx.window.from}::timestamptz AND t.due_at < ${ctx.window.to}::timestamptz) OR (t.completed_at >= ${ctx.window.from}::timestamptz AND t.completed_at < ${ctx.window.to}::timestamptz))
      ${ownerIn(ctx.scope, 't.assigned_to_id')}${needLead ? leadFilters(ctx.filters) : Prisma.empty}`);
  return { completed: num(r?.completed), due: num(r?.due), onTime: num(r?.on_time), late: num(r?.late), overdueOpen: num(r?.overdue_open) };
}

export const PRD_002: KpiImpl = {
  meta: meta({
    id: 'KPI-PRD-002',
    name: 'Follow-ups completed',
    group: 'PRD',
    unit: 'COUNT',
    source: 'JD KPI Productivity',
    definition: 'Follow-up, callback, demo and email tasks completed in the range; the on-time share (completed on or before due / tasks due and judgeable) is reported with it.',
    numerator: 'Count of tasks (types FOLLOW_UP, CALLBACK, DEMO, EMAIL) with status DONE and completed_at in the range',
    denominator: 'Tasks due in the range (excluding cancelled and not-yet-due open tasks) for the on-time share',
    window: 'Date range in IST (default: current month)',
    exclusions: 'Cancelled tasks; CALL-type retry tasks and other task types',
    tables: ['tasks', 'leads'],
    rounding: 'integer; on-time share 1 decimal',
    owner: 'Manager',
    refresh: 'Near real time',
    zeroDenominator: 'On-time share is null (dash) when no task was due',
    formula: 'count; on time / (completed + overdue due in range)',
    implementation: "SQL on tasks: FILTER(status='DONE' AND completed_at in range); due cohort = due_at in range AND status<>'CANCELLED' AND (DONE OR due_at < now)",
    decisions: ['DEC-026'],
    cacheTtlSeconds: 30,
  }),
  async compute(ctx) {
    const s = await followUpStats(ctx);
    return { value: String(s.completed), numerator: String(s.onTime), denominator: String(s.due), breakdown: { completed: s.completed, dueInRange: s.due, completedOnTime: s.onTime, completedLate: s.late, overdueStillOpen: s.overdueOpen, onTimePct: pctStr(s.onTime, s.due) } };
  },
};

export const EXC_005: KpiImpl = {
  meta: meta({
    id: 'KPI-EXC-005',
    name: 'Follow-up compliance',
    group: 'EXC',
    unit: 'PERCENT',
    source: 'Blueprint s8',
    definition: 'Share of follow-up tasks due in the range that were completed on or before their due time.',
    numerator: 'Tasks completed on or before due among those due in the range',
    denominator: 'Eligible tasks due in the range (not cancelled; open tasks count once their due time has passed)',
    window: 'Date range in IST',
    exclusions: 'Cancelled tasks; open tasks not yet due',
    tables: ['tasks'],
    rounding: '1 decimal place',
    owner: 'Manager',
    refresh: 'Near real time',
    zeroDenominator: 'No task due -> null (dash)',
    formula: 'on-time completed / eligible due x 100',
    implementation: 'followUpStats()',
    decisions: ['DEC-026'],
    cacheTtlSeconds: 30,
  }),
  async compute(ctx) {
    const s = await followUpStats(ctx);
    return { value: pctStr(s.onTime, s.due), numerator: String(s.onTime), denominator: String(s.due), nullReason: s.due === 0 ? 'ZERO_DENOMINATOR' : undefined, note: s.due === 0 ? 'No follow-up tasks were due in this range' : null, breakdown: { late: s.late, overdueStillOpen: s.overdueOpen } };
  },
};

/** ------------------------------------------------------------------------------------------------ CRM compliance */
export const PRD_003: KpiImpl = {
  meta: meta({
    id: 'KPI-PRD-003',
    name: 'CRM compliance (%)',
    group: 'PRD',
    unit: 'PERCENT',
    source: 'JD KPI Productivity; DEC-038',
    definition: 'Share of active leads that have an owner, a scheduled next action (next_action_at or an open task), required fields (name plus a valid phone or e-mail) and activity within the threshold (default 7 days).',
    numerator: 'Eligible leads meeting all four conditions',
    denominator: 'Active (stage OPEN) leads in scope, created more than 60 minutes ago',
    window: 'Point in time (now)',
    exclusions: 'WON, LOST and NURTURE leads; leads created under an hour ago; merged duplicates',
    tables: ['leads', 'tasks'],
    rounding: '1 decimal place',
    owner: 'Team Lead',
    refresh: 'On request; org snapshot daily',
    zeroDenominator: 'No eligible lead -> null (dash)',
    formula: 'compliant / eligible x 100',
    implementation: "SQL on leads: stage_category='OPEN', created_at < now-60m, owner NOT NULL, (next_action_at NOT NULL OR EXISTS open task), name & (phone_valid E.164 or email), coalesce(last_activity_at, created_at) >= now-7d",
    decisions: ['DEC-038'],
    usesWindow: 'POINT_IN_TIME',
    cacheTtlSeconds: 30,
  }),
  async compute(ctx) {
    const [r] = await ctx.prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`
      WITH x AS MATERIALIZED (
        SELECT l.assigned_to_id IS NOT NULL AS has_owner,
               (l.next_action_at IS NOT NULL OR ot.lead_id IS NOT NULL) AS has_next,
               (btrim(l.full_name) <> '' AND ((l.phone_e164 IS NOT NULL AND l.phone_valid) OR l.email IS NOT NULL)) AS has_fields,
               (coalesce(l.last_activity_at, l.created_at) >= ${ctx.now}::timestamptz - make_interval(days => ${ctx.config.complianceActivityDays}::int)) AS recent
        FROM leads l LEFT JOIN (SELECT DISTINCT lead_id FROM tasks WHERE status = 'OPEN') ot ON ot.lead_id = l.id
        WHERE l.organization_id = ${ctx.organizationId}::uuid AND l.stage_category = 'OPEN'
          AND l.created_at < ${ctx.now}::timestamptz - make_interval(mins => ${ctx.config.newLeadGraceMinutes}::int)${notMerged()}${notDemo(ctx)}${leadScope(ctx.scope)}${leadFilters(ctx.filters)})
      SELECT count(*)::int AS eligible,
        (count(*) FILTER (WHERE has_owner AND has_next AND has_fields AND recent))::int AS compliant,
        (count(*) FILTER (WHERE NOT has_owner))::int AS no_owner,
        (count(*) FILTER (WHERE NOT has_next))::int AS no_next,
        (count(*) FILTER (WHERE NOT has_fields))::int AS missing_fields,
        (count(*) FILTER (WHERE NOT recent))::int AS stale
      FROM x`);
    const den = num(r?.eligible);
    const n = num(r?.compliant);
    return { value: pctStr(n, den), numerator: String(n), denominator: String(den), nullReason: den === 0 ? 'ZERO_DENOMINATOR' : undefined, note: den === 0 ? 'No eligible active leads' : null, breakdown: { activityThresholdDays: ctx.config.complianceActivityDays, failing: { noOwner: num(r?.no_owner), noNextAction: num(r?.no_next), missingRequiredFields: num(r?.missing_fields), noRecentActivity: num(r?.stale) }, note: 'A lead can fail more than one condition.' } };
  },
};

/** ------------------------------------------------------------------------------------------------ response time */
export const PRD_004: KpiImpl = {
  meta: meta({
    id: 'KPI-PRD-004',
    name: 'Response time (working minutes)',
    group: 'PRD',
    unit: 'MINUTES',
    source: 'JD KPI Productivity; DEC-039',
    definition: 'Median (P90 alongside) working-hours minutes from lead creation or assignment, whichever is later, to the first call attempt.',
    numerator: 'Median of working minutes to first attempt over leads that have been attempted',
    denominator: 'Leads created in the range that have at least one attempt (not-yet-responded count is shown)',
    window: 'Leads created in the date range',
    exclusions: 'Imported leads, reactivated leads, time outside working hours (Mon-Sat 09:00-19:00 IST by default)',
    tables: ['leads', 'call_logs'],
    rounding: 'whole minutes',
    owner: 'Manager',
    refresh: 'On request',
    zeroDenominator: 'No attempted lead -> null (dash)',
    formula: 'median(workingMinutesBetween(max(created, assigned), first_contact_at))',
    implementation: 'SQL selects leads (created/assigned/first_contact_at); crm-core workingMinutesBetween() with the org WORKING_HOURS rule; percentile in code',
    decisions: ['DEC-039', 'DEC-020'],
    cacheTtlSeconds: 60,
  }),
  async compute(ctx) {
    const rows = await ctx.prisma.$queryRaw<Array<{ created_at: Date; assigned_at: Date | null; first_contact_at: Date | null }>>(Prisma.sql`
      SELECT l.created_at, l.assigned_at, l.first_contact_at FROM leads l
      WHERE l.organization_id = ${ctx.organizationId}::uuid AND l.created_at >= ${ctx.window.from}::timestamptz AND l.created_at < ${ctx.window.to}::timestamptz
        AND l.import_job_id IS NULL AND l.reactivation_count = 0${notMerged()}${notDemo(ctx)}${leadScope(ctx.scope)}${leadFilters(ctx.filters)}
      LIMIT 200000`);
    const wh = await getWorkingHours(ctx.prisma as never, ctx.organizationId, null);
    const mins: number[] = [];
    let waiting = 0;
    for (const r of rows) {
      if (!r.first_contact_at) {
        waiting += 1;
        continue;
      }
      const start = r.assigned_at && r.assigned_at > r.created_at ? r.assigned_at : r.created_at;
      mins.push(r.first_contact_at <= start ? 0 : workingMinutesBetween(start, r.first_contact_at, wh));
    }
    mins.sort((a, b) => a - b);
    const med = median(mins);
    return {
      value: med === null ? null : String(Math.round(med)),
      numerator: med === null ? null : String(Math.round(med)),
      denominator: String(mins.length),
      nullReason: med === null ? 'ZERO_DENOMINATOR' : undefined,
      note: med === null ? 'No lead created in this range has been attempted yet' : null,
      breakdown: { medianMinutes: med, p90Minutes: percentile(mins, 90), notYetResponded: waiting, leadsInCohort: rows.length, workingHours: 'working minutes only (outside-hours time excluded)' },
    };
  },
};

/** ------------------------------------------------------------------------------------------------ lead ageing */
export const PRD_005: KpiImpl = {
  meta: meta({
    id: 'KPI-PRD-005',
    name: 'Lead ageing (stale leads)',
    group: 'PRD',
    unit: 'COUNT',
    source: 'JD KPI Productivity',
    definition: 'Active leads with no meaningful activity for more than the threshold (default 7 days). Age since creation and days since last activity are both reported, in buckets 0-1, 2-3, 4-7, 8-14 and 15+ days.',
    numerator: 'Active leads whose days since last activity (or creation if none) exceed the threshold',
    denominator: 'Active (stage OPEN) leads in scope',
    window: 'Point in time (now)',
    exclusions: 'WON, LOST, NURTURE leads; merged duplicates',
    tables: ['leads'],
    rounding: 'whole days',
    owner: 'Manager',
    refresh: 'Near real time',
    zeroDenominator: 'n/a: empty buckets show 0',
    formula: 'now - created_at; now - coalesce(last_activity_at, created_at)',
    implementation: 'SQL on leads with floor(epoch/86400) buckets and percentile_cont',
    decisions: [],
    usesWindow: 'POINT_IN_TIME',
    cacheTtlSeconds: 30,
  }),
  async compute(ctx) {
    const [r] = await ctx.prisma.$queryRaw<Array<Record<string, number | null>>>(Prisma.sql`
      WITH a AS (
        SELECT floor(extract(epoch FROM (${ctx.now}::timestamptz - l.created_at)) / 86400)::int AS created_days,
               floor(extract(epoch FROM (${ctx.now}::timestamptz - coalesce(l.last_activity_at, l.created_at))) / 86400)::int AS idle_days
        FROM leads l WHERE l.organization_id = ${ctx.organizationId}::uuid AND l.stage_category = 'OPEN'${notMerged()}${notDemo(ctx)}${leadScope(ctx.scope)}${leadFilters(ctx.filters)})
      SELECT count(*)::int AS total,
        (count(*) FILTER (WHERE idle_days > ${ctx.config.staleActivityDays}))::int AS stale,
        (count(*) FILTER (WHERE created_days <= 1))::int AS c0, (count(*) FILTER (WHERE created_days BETWEEN 2 AND 3))::int AS c1, (count(*) FILTER (WHERE created_days BETWEEN 4 AND 7))::int AS c2,
        (count(*) FILTER (WHERE created_days BETWEEN 8 AND 14))::int AS c3, (count(*) FILTER (WHERE created_days >= 15))::int AS c4,
        (count(*) FILTER (WHERE idle_days <= 1))::int AS i0, (count(*) FILTER (WHERE idle_days BETWEEN 2 AND 3))::int AS i1, (count(*) FILTER (WHERE idle_days BETWEEN 4 AND 7))::int AS i2,
        (count(*) FILTER (WHERE idle_days BETWEEN 8 AND 14))::int AS i3, (count(*) FILTER (WHERE idle_days >= 15))::int AS i4,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY created_days) AS med_created, percentile_cont(0.5) WITHIN GROUP (ORDER BY idle_days) AS med_idle
      FROM a`);
    const b = (p: string) => ['0-1', '2-3', '4-7', '8-14', '15+'].map((label, i) => ({ bucket: label, leads: num(r?.[`${p}${i}`]) }));
    return {
      value: String(num(r?.stale)),
      numerator: String(num(r?.stale)),
      denominator: String(num(r?.total)),
      breakdown: { staleThresholdDays: ctx.config.staleActivityDays, ageSinceCreationDays: b('c'), daysSinceLastActivity: b('i'), medianAgeDays: r?.med_created === null || r?.med_created === undefined ? null : Math.round(Number(r.med_created)), medianIdleDays: r?.med_idle === null || r?.med_idle === undefined ? null : Math.round(Number(r.med_idle)) },
    };
  },
};

/** ------------------------------------------------------------------------------------------------ exceptions */
export const EXC_001: KpiImpl = {
  meta: meta({
    id: 'KPI-EXC-001',
    name: 'Unassigned leads',
    group: 'EXC',
    unit: 'COUNT',
    source: 'Blueprint s8',
    definition: 'Active leads that have no current owner (an exception that must be visible).',
    numerator: 'Active (stage OPEN) leads with assigned_to_id IS NULL',
    denominator: 'n/a',
    window: 'Point in time (now)',
    exclusions: 'Terminal and nurture leads; merged duplicates',
    tables: ['leads'],
    rounding: 'integer',
    owner: 'Manager',
    refresh: 'Near real time',
    zeroDenominator: 'n/a: zero shows 0',
    formula: 'count',
    implementation: "SQL on leads: stage_category='OPEN' AND assigned_to_id IS NULL",
    usesWindow: 'POINT_IN_TIME',
    cacheTtlSeconds: 15,
  }),
  async compute(ctx) {
    const [r] = await ctx.prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*)::int AS n FROM leads l WHERE l.organization_id = ${ctx.organizationId}::uuid AND l.stage_category = 'OPEN' AND l.assigned_to_id IS NULL${notMerged()}${notDemo(ctx)}${leadScope(ctx.scope)}${leadFilters(ctx.filters)}`);
    return { value: String(num(r?.n)), numerator: String(num(r?.n)) };
  },
};

export const EXC_002: KpiImpl = {
  meta: meta({
    id: 'KPI-EXC-002',
    name: 'No-next-action leads',
    group: 'EXC',
    unit: 'COUNT',
    source: 'Blueprint s8',
    definition: 'Active leads without a scheduled next action (neither next_action_at nor an open task).',
    numerator: 'Active leads with next_action_at IS NULL and no OPEN task',
    denominator: 'n/a',
    window: 'Point in time (now)',
    exclusions: 'Terminal and nurture leads; merged duplicates',
    tables: ['leads', 'tasks'],
    rounding: 'integer',
    owner: 'Manager',
    refresh: 'Near real time',
    zeroDenominator: 'n/a: zero shows 0',
    formula: 'count',
    implementation: "SQL on leads with NOT EXISTS (tasks.status='OPEN')",
    usesWindow: 'POINT_IN_TIME',
    cacheTtlSeconds: 15,
  }),
  async compute(ctx) {
    const [r] = await ctx.prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT count(*)::int AS n FROM leads l WHERE l.organization_id = ${ctx.organizationId}::uuid AND l.stage_category = 'OPEN' AND l.next_action_at IS NULL AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.lead_id = l.id AND t.status = 'OPEN')${notMerged()}${notDemo(ctx)}${leadScope(ctx.scope)}${leadFilters(ctx.filters)}`);
    return { value: String(num(r?.n)), numerator: String(num(r?.n)) };
  },
};

export const EXC_003: KpiImpl = {
  meta: meta({
    id: 'KPI-EXC-003',
    name: 'Overdue tasks',
    group: 'EXC',
    unit: 'COUNT',
    source: 'Blueprint s8',
    definition: 'Open tasks whose due time has passed.',
    numerator: "Tasks with status OPEN and due_at < now",
    denominator: 'n/a',
    window: 'Point in time (now)',
    exclusions: 'Completed and cancelled tasks',
    tables: ['tasks', 'leads'],
    rounding: 'integer',
    owner: 'Manager',
    refresh: 'Near real time',
    zeroDenominator: 'n/a: zero shows 0',
    formula: 'count',
    implementation: "SQL on tasks: status='OPEN' AND due_at < now; owner scope on assigned_to_id",
    usesWindow: 'POINT_IN_TIME',
    cacheTtlSeconds: 15,
  }),
  async compute(ctx) {
    const needLead = Boolean(ctx.filters.programId || ctx.filters.sourceId);
    const [r] = await ctx.prisma.$queryRaw<Array<{ n: number; oldest: Date | null }>>(Prisma.sql`SELECT count(*)::int AS n, min(t.due_at) AS oldest FROM tasks t ${needLead ? Prisma.sql`JOIN leads l ON l.id = t.lead_id` : Prisma.empty} WHERE t.organization_id = ${ctx.organizationId}::uuid AND t.status = 'OPEN' AND t.due_at < ${ctx.now}::timestamptz${ownerIn(ctx.scope, 't.assigned_to_id')}${needLead ? leadFilters(ctx.filters) : Prisma.empty}`);
    return { value: String(num(r?.n)), numerator: String(num(r?.n)), breakdown: { oldestDueAt: r?.oldest ? r.oldest.toISOString() : null } };
  },
};

export const EXC_004: KpiImpl = {
  meta: meta({
    id: 'KPI-EXC-004',
    name: 'New leads',
    group: 'EXC',
    unit: 'COUNT',
    source: 'Blueprint s8',
    definition: 'Leads created in the date range.',
    numerator: 'Count of leads with created_at in the range',
    denominator: 'n/a',
    window: 'Date range in IST',
    exclusions: 'Merged duplicates; [DEMO] leads when excluded by configuration',
    tables: ['leads'],
    rounding: 'integer',
    owner: 'Manager',
    refresh: 'Near real time',
    zeroDenominator: 'n/a: zero shows 0',
    formula: 'count',
    implementation: 'SQL on leads: created_at in range',
    cacheTtlSeconds: 30,
  }),
  async compute(ctx) {
    const [r] = await ctx.prisma.$queryRaw<Array<{ n: number; unassigned: number }>>(Prisma.sql`SELECT count(*)::int AS n, (count(*) FILTER (WHERE l.assigned_to_id IS NULL))::int AS unassigned FROM leads l WHERE l.organization_id = ${ctx.organizationId}::uuid AND l.created_at >= ${ctx.window.from}::timestamptz AND l.created_at < ${ctx.window.to}::timestamptz${notMerged()}${notDemo(ctx)}${leadScope(ctx.scope)}${leadFilters(ctx.filters)}`);
    return { value: String(num(r?.n)), numerator: String(num(r?.n)), breakdown: { unassignedAtPresent: num(r?.unassigned) } };
  },
};

export const CRM_KPIS: KpiImpl[] = [SAL_001, SAL_002, SAL_003, PRD_001, PRD_002, PRD_003, PRD_004, PRD_005, PRD_006, PRD_007, PRD_008, EXC_001, EXC_002, EXC_003, EXC_004, EXC_005];
