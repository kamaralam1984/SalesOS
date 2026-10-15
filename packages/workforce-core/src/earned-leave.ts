import { PLATFORM_EVENTS, WORKFORCE_EVENTS, type EarnedLeaveCreditedPayload } from '@salesos/shared-types';
import { resolveWorkforceConfig, type AttendanceStatusKey, type WorkforceConfig } from '@salesos/validation';
import { startOfLocalDay, type LeaveCover } from './attendance';
import { buildCalendar, type HolidayInput, type WorkCalendar } from './calendar';
import { addDays, eachDay, localDay, type Day } from './dates';
import { leaveCoverage, roundDays, type LeaveHalfDay } from './leave';
import { deriveClosedDayStatus } from './attendance';

/* ------------------------------------------------------------------ pure engine */

export type ElStatus = AttendanceStatusKey | 'NO_RECORD' | 'CARRY';

/** Outcome of one closed day for the Earned Leave counter. This list IS the explanation stored with every credit. */
export interface ElDayOutcome {
  date: Day;
  status: ElStatus;
  /** 1 = full eligible day, 0.5 = half, 0 = not counted */
  eligible: number;
  reason: string;
  /** where the status came from: an attendance record, derived from calendar/leave by the engine, or carried over from the previous period */
  source: 'RECORD' | 'DERIVED' | 'CARRY';
}

/**
 * Eligibility of one closed day. Order: before joining -> never; weekly off / approved holiday -> never (not a working day);
 * else the configured treatment of the status (COUNT 1 / HALF 0.5 / SKIP 0). A half-day approved leave on a day that would count
 * fully counts 0.5 (the employee worked half a day).
 */
export function evaluateDay(input: {
  config: Pick<WorkforceConfig, 'earnedLeave'>;
  calendar: WorkCalendar;
  day: Day;
  status: AttendanceStatusKey | null;
  source: 'RECORD' | 'DERIVED';
  joinDate?: Day | null;
  halfDayLeave?: boolean;
}): ElDayOutcome {
  const { config, calendar, day, status, source } = input;
  const base = { date: day, source };
  if (config.earnedLeave.countFromJoiningDate && input.joinDate && day < input.joinDate) return { ...base, status: status ?? 'NO_RECORD', eligible: 0, reason: 'BEFORE_JOINING' };
  if (!calendar.isWorkingDay(day)) return { ...base, status: status ?? (calendar.kindOf(day) as ElStatus), eligible: 0, reason: calendar.kindOf(day) === 'HOLIDAY' ? 'HOLIDAY' : 'WEEKLY_OFF' };
  if (!status) return { ...base, status: 'NO_RECORD', eligible: 0, reason: 'NO_RECORD' };
  const t = config.earnedLeave.treatment[status];
  if (t === 'SKIP') return { ...base, status, eligible: 0, reason: `SKIP_${status}` };
  if (t === 'HALF') return { ...base, status, eligible: 0.5, reason: `HALF_${status}` };
  if (input.halfDayLeave) return { ...base, status, eligible: 0.5, reason: 'HALF_DAY_LEAVE' };
  return { ...base, status, eligible: 1, reason: `COUNT_${status}` };
}

export interface ElState {
  processedThrough: Day | null;
  /** eligible days accumulated since the last credit (includes any carried remainder) */
  eligibleDays: number;
  periodStart: Day | null;
  creditsGiven: number;
  /** outcomes of the open period; sum(eligible) === eligibleDays */
  dayLog: ElDayOutcome[];
}

export interface ElCredit {
  /** 1-based sequence number of this credit for the employee (unique key suffix) */
  n: number;
  periodStart: Day;
  periodEnd: Day;
  /** eligible days that justified the credit (= requiredEligibleDays) */
  eligibleDays: number;
  /** remainder above the requirement, carried into the next period */
  carriedOut: number;
  days: ElDayOutcome[];
}

export const emptyElState = (): ElState => ({ processedThrough: null, eligibleDays: 0, periodStart: null, creditsGiven: 0, dayLog: [] });

/**
 * Pure counter. `outcomes` must be the consecutive closed days after `state.processedThrough` in ascending order. When the counter
 * reaches `required` ONE credit is emitted for that period and the remainder is carried (as a synthetic CARRY entry) into the next.
 * Pure: the same inputs always give the same credits, and a processed day is never evaluated twice (`processedThrough`).
 */
export function advanceEarnedLeave(state: ElState, outcomes: ElDayOutcome[], required: number): { state: ElState; credits: ElCredit[] } {
  let s: ElState = { ...state, dayLog: [...state.dayLog] };
  const credits: ElCredit[] = [];
  for (const o of outcomes) {
    if (s.processedThrough && o.date <= s.processedThrough) continue; // never re-evaluate a processed day
    s.processedThrough = o.date;
    if (!s.periodStart) s.periodStart = o.date;
    s.dayLog.push(o);
    s.eligibleDays = roundDays(s.eligibleDays + o.eligible);
    while (s.eligibleDays >= required) {
      const carriedOut = roundDays(s.eligibleDays - required);
      const n = s.creditsGiven + 1;
      credits.push({ n, periodStart: s.periodStart ?? o.date, periodEnd: o.date, eligibleDays: required, carriedOut, days: s.dayLog });
      s = {
        processedThrough: o.date,
        eligibleDays: carriedOut,
        periodStart: addDays(o.date, 1),
        creditsGiven: n,
        dayLog: carriedOut > 0 ? [{ date: o.date, status: 'CARRY', eligible: carriedOut, reason: 'CARRIED_OVER', source: 'CARRY' }] : [],
      };
    }
  }
  return { state: s, credits };
}

/** Amount actually credited after the optional max balance cap. */
export function cappedCredit(creditDays: number, balance: number, maxBalance: number | null): number {
  if (maxBalance === null) return creditDays;
  return roundDays(Math.max(0, Math.min(creditDays, maxBalance - balance)));
}

/** Year-end expiry amount (policy literal: only when carry-forward is disabled, balance above `carryForwardMax`; null max = all carries). */
export function expiryAmount(config: Pick<WorkforceConfig, 'earnedLeave'>, balanceAtYearEnd: number): number {
  const el = config.earnedLeave;
  if (el.carryForwardEnabled || el.carryForwardMax === null) return 0;
  return roundDays(Math.max(0, balanceAtYearEnd - el.carryForwardMax));
}

/* ------------------------------------------------------------------ Prisma-transaction runner (API + worker) */

type Dec = { toString(): string };
const num = (v: Dec | number | null | undefined): number => (v == null ? 0 : Number(v.toString()));
const dayOf = (d: Date): Day => d.toISOString().slice(0, 10);
const dateOf = (d: Day): Date => new Date(`${d}T00:00:00.000Z`);

/** Minimal structural view of the Prisma transaction client used by the runner (a PrismaClient / Prisma.TransactionClient satisfies it via `asElDb`). */
export interface ElTx {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  user: { findFirst(args: Record<string, unknown>): Promise<{ id: string; isActive: boolean; createdAt: Date } | null> };
  employeeProfile: { findUnique(args: Record<string, unknown>): Promise<{ joinDate: Date | null; exitDate: Date | null } | null> };
  workforceSetting: { findUnique(args: Record<string, unknown>): Promise<{ config: unknown; version: number } | null> };
  earnedLeaveProgress: {
    findUnique(args: Record<string, unknown>): Promise<{ processedThrough: Date | null; eligibleDays: Dec; periodStart: Date | null; creditsGiven: number; dayLog: unknown } | null>;
    upsert(args: Record<string, unknown>): Promise<unknown>;
  };
  attendanceRecord: { findMany(args: Record<string, unknown>): Promise<Array<{ date: Date; status: AttendanceStatusKey }>> };
  leaveRequest: { findMany(args: Record<string, unknown>): Promise<Array<{ typeKey: string; startDate: Date; endDate: Date; halfDay: LeaveHalfDay; days: Dec; unpaidDays: Dec }>> };
  holiday: { findMany(args: Record<string, unknown>): Promise<Array<{ date: Date; name: string; kind: HolidayInput['kind']; status: HolidayInput['status'] }>> };
  leaveBalanceTxn: {
    aggregate(args: Record<string, unknown>): Promise<{ _sum: { amount: Dec | null } }>;
    create(args: Record<string, unknown>): Promise<{ id: string }>;
    findFirst(args: Record<string, unknown>): Promise<{ id: string } | null>;
  };
  outboxEvent: { createMany(args: Record<string, unknown>): Promise<{ count: number }> };
  auditLog: { create(args: Record<string, unknown>): Promise<unknown> };
}
export interface ElDb {
  $transaction<T>(fn: (tx: ElTx) => Promise<T>, options?: { timeout?: number; maxWait?: number }): Promise<T>;
}
/** Adapter used by the API (PrismaService) and the worker (PrismaClient): both structurally provide these delegates. */
export const asElDb = (prisma: unknown): ElDb => prisma as ElDb;

export interface ElRunResult {
  status: 'OK' | 'DISABLED' | 'INACTIVE' | 'NOTHING_TO_PROCESS';
  processedThrough: Day | null;
  daysEvaluated: number;
  credits: Array<{ txnId: string; n: number; amount: number; periodStart: Day; periodEnd: Day; balanceAfter: number }>;
}

const lock = (tx: ElTx, key: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;

const typeBalance = async (tx: ElTx, organizationId: string, userId: string, typeKey: string, before?: Date): Promise<number> => {
  const agg = await tx.leaveBalanceTxn.aggregate({ where: { organizationId, userId, typeKey, ...(before ? { createdAt: { lt: before } } : {}) }, _sum: { amount: true } });
  return num(agg._sum.amount);
};

/**
 * Process every CLOSED day (before today in the business timezone) of one employee that the engine has not seen yet.
 * One transaction + a per-employee advisory lock: concurrent runs serialise, the second finds `processedThrough` advanced and does
 * nothing; the `EL:<userId>:<n>` unique key is the second line of defence, so a duplicate credit for a period cannot be written.
 */
export function runEarnedLeaveForUser(db: ElDb, input: { organizationId: string; userId: string; now?: Date; actorId?: string | null }): Promise<ElRunResult> {
  const now = input.now ?? new Date();
  return db.$transaction(
    async (tx) => {
      await lock(tx, `el:${input.userId}`);
      const { organizationId, userId } = input;
      const setting = await tx.workforceSetting.findUnique({ where: { organizationId } });
      const config = resolveWorkforceConfig(setting?.config);
      const policyVersion = setting?.version ?? 0;
      const empty = (status: ElRunResult['status']): ElRunResult => ({ status, processedThrough: null, daysEvaluated: 0, credits: [] });
      if (!config.earnedLeave.enabled) return empty('DISABLED');
      const user = await tx.user.findFirst({ where: { id: userId, organizationId }, select: { id: true, isActive: true, createdAt: true } });
      if (!user || !user.isActive) return empty('INACTIVE');
      const profile = await tx.employeeProfile.findUnique({ where: { userId }, select: { joinDate: true, exitDate: true } });
      const joinDay = profile?.joinDate ? dayOf(profile.joinDate) : localDay(user.createdAt, config.timezone);
      const exitDay = profile?.exitDate ? dayOf(profile.exitDate) : null;

      const row = await tx.earnedLeaveProgress.findUnique({ where: { userId } });
      const state: ElState = row
        ? { processedThrough: row.processedThrough ? dayOf(row.processedThrough) : null, eligibleDays: num(row.eligibleDays), periodStart: row.periodStart ? dayOf(row.periodStart) : null, creditsGiven: row.creditsGiven, dayLog: Array.isArray(row.dayLog) ? (row.dayLog as ElDayOutcome[]) : [] }
        : emptyElState();

      const today = localDay(now, config.timezone);
      const lastClosed = exitDay && exitDay < addDays(today, -1) ? exitDay : addDays(today, -1);
      const from = state.processedThrough ? addDays(state.processedThrough, 1) : config.earnedLeave.countFromJoiningDate ? joinDay : localDay(user.createdAt, config.timezone);
      if (from > lastClosed) return { status: 'NOTHING_TO_PROCESS', processedThrough: state.processedThrough, daysEvaluated: 0, credits: [] };

      const [records, leaves, holidayRows] = await Promise.all([
        tx.attendanceRecord.findMany({ where: { userId, date: { gte: dateOf(from), lte: dateOf(lastClosed) } }, select: { date: true, status: true } }),
        tx.leaveRequest.findMany({ where: { organizationId, userId, status: 'APPROVED', startDate: { lte: dateOf(lastClosed) }, endDate: { gte: dateOf(from) } } }),
        tx.holiday.findMany({ where: { organizationId, date: { gte: dateOf(from), lte: dateOf(lastClosed) } } }),
      ]);
      const calendar = buildCalendar(config, holidayRows.map((h) => ({ date: dayOf(h.date), name: h.name, kind: h.kind, status: h.status })));
      const byDay = new Map(records.map((r) => [dayOf(r.date), r.status]));
      const cover = new Map<Day, LeaveCover>();
      for (const l of leaves) {
        const paid = config.leave.types.find((t) => t.key === l.typeKey)?.isPaid ?? false;
        for (const [d, c] of leaveCoverage({ startDate: dayOf(l.startDate), endDate: dayOf(l.endDate), halfDay: l.halfDay, days: num(l.days), unpaidDays: num(l.unpaidDays) }, paid, calendar)) if (!cover.has(d)) cover.set(d, c);
      }

      const outcomes = eachDay(from, lastClosed).map((day) => {
        const rec = byDay.get(day);
        const c = cover.get(day) ?? null;
        const status = rec ?? deriveClosedDayStatus({ day, calendar, cover: c, autoMarkAbsent: config.attendance.autoMarkAbsent });
        return evaluateDay({ config, calendar, day, status, source: rec ? 'RECORD' : 'DERIVED', joinDate: joinDay, halfDayLeave: c?.kind === 'HALF' && !!rec });
      });

      const { state: next, credits } = advanceEarnedLeave(state, outcomes, config.earnedLeave.requiredEligibleDays);
      const typeKey = config.earnedLeave.leaveTypeKey;
      let balance = await typeBalance(tx, organizationId, userId, typeKey);
      const written: ElRunResult['credits'] = [];
      for (const c of credits) {
        const amount = cappedCredit(config.earnedLeave.creditDays, balance, config.earnedLeave.maxBalance);
        const balanceAfter = roundDays(balance + amount);
        const txn = await tx.leaveBalanceTxn.create({
          data: {
            organizationId, userId, typeKey, kind: 'CREDIT_EARNED', amount, balanceBefore: balance, balanceAfter,
            periodStart: dateOf(c.periodStart), periodEnd: dateOf(c.periodEnd), eligibleDays: c.eligibleDays,
            calculation: { rule: { requiredEligibleDays: config.earnedLeave.requiredEligibleDays, creditDays: config.earnedLeave.creditDays, maxBalance: config.earnedLeave.maxBalance }, eligibleDays: c.eligibleDays, carriedOut: c.carriedOut, capped: amount < config.earnedLeave.creditDays, days: c.days },
            uniqueKey: `EL:${userId}:${c.n}`, policyVersion, createdById: null,
            note: amount < config.earnedLeave.creditDays ? 'Credit limited by the maximum Earned Leave balance' : null,
          },
        });
        const payload: EarnedLeaveCreditedPayload = { organizationId, userId, txnId: txn.id, amount: String(amount), balanceAfter: String(balanceAfter), periodStart: c.periodStart, periodEnd: c.periodEnd };
        const events: Array<Record<string, unknown>> = [
          { eventType: WORKFORCE_EVENTS.EARNED_LEAVE_CREDITED, aggregateType: 'leave_balance_txn', aggregateId: txn.id, organizationId, payload, idempotencyKey: `${WORKFORCE_EVENTS.EARNED_LEAVE_CREDITED}:${txn.id}`, availableAt: now },
        ];
        if (amount > 0) {
          events.push({
            eventType: PLATFORM_EVENTS.NOTIFICATION_REQUESTED, aggregateType: 'leave_balance_txn', aggregateId: txn.id, organizationId, availableAt: now,
            payload: { organizationId, type: 'earned_leave.credited', userId, entity: { type: 'leave_balance_txn', id: txn.id }, dedupeKey: `earned_leave.credited:${txn.id}`, actionUrl: '/work/leave', title: 'Earned Leave credited' },
            idempotencyKey: `notification.requested:earned_leave.credited:${txn.id}`,
          });
        }
        await tx.outboxEvent.createMany({ data: events, skipDuplicates: true });
        await tx.auditLog.create({ data: { organizationId, actorId: input.actorId ?? null, action: 'earned_leave.credited', entityType: 'leave_balance_txn', entityId: txn.id, metadata: { userId, typeKey, n: c.n, periodStart: c.periodStart, periodEnd: c.periodEnd, eligibleDays: c.eligibleDays, amount, policyVersion } } });
        written.push({ txnId: txn.id, n: c.n, amount, periodStart: c.periodStart, periodEnd: c.periodEnd, balanceAfter });
        balance = balanceAfter;
      }

      const data = { processedThrough: dateOf(next.processedThrough!), eligibleDays: next.eligibleDays, periodStart: next.periodStart ? dateOf(next.periodStart) : null, creditsGiven: next.creditsGiven, dayLog: next.dayLog };
      await tx.earnedLeaveProgress.upsert({ where: { userId }, create: { organizationId, userId, ...data }, update: data });
      return { status: 'OK', processedThrough: next.processedThrough, daysEvaluated: outcomes.length, credits: written };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

/**
 * January expiry per policy (see `expiryAmount`): writes at most ONE `EXPIRY` row per employee per year (`EL-EXP:<userId>:<year>`).
 * Runs only during January; the amount is based on the balance at the start of the year.
 */
export function runEarnedLeaveYearEnd(db: ElDb, input: { organizationId: string; userId: string; now?: Date }): Promise<{ expired: number }> {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    await lock(tx, `el:${input.userId}`);
    const { organizationId, userId } = input;
    const setting = await tx.workforceSetting.findUnique({ where: { organizationId } });
    const config = resolveWorkforceConfig(setting?.config);
    const today = localDay(now, config.timezone);
    if (!config.earnedLeave.enabled || today.slice(5, 7) !== '01') return { expired: 0 };
    const year = today.slice(0, 4);
    const uniqueKey = `EL-EXP:${userId}:${year}`;
    const done = await tx.leaveBalanceTxn.findFirst({ where: { organizationId, uniqueKey }, select: { id: true } });
    if (done) return { expired: 0 };
    const typeKey = config.earnedLeave.leaveTypeKey;
    const atYearStart = await typeBalance(tx, organizationId, userId, typeKey, startOfLocalDay(`${year}-01-01`, config.timezone));
    const current = await typeBalance(tx, organizationId, userId, typeKey);
    const amount = Math.min(expiryAmount(config, atYearStart), Math.max(0, current));
    if (amount <= 0) return { expired: 0 };
    const txn = await tx.leaveBalanceTxn.create({
      data: { organizationId, userId, typeKey, kind: 'EXPIRY', amount: -amount, balanceBefore: current, balanceAfter: roundDays(current - amount), uniqueKey, policyVersion: setting?.version ?? 0, createdById: null, note: `Year-end expiry ${year}: balance above the carry-forward limit`, calculation: { year, balanceAtYearStart: atYearStart, carryForwardMax: config.earnedLeave.carryForwardMax } },
    });
    await tx.auditLog.create({ data: { organizationId, actorId: null, action: 'earned_leave.expired', entityType: 'leave_balance_txn', entityId: txn.id, metadata: { userId, typeKey, year, amount } } });
    return { expired: amount };
  });
}
