import { PrismaClient, type GoalStatus, type LeaveRequestStatus, type WorkTaskPriority, type WorkTaskStatus } from '@prisma/client';
import {
  addDays, addMonths, buildCalendar, computeGoalRisk, eachDay, goalProgressPct, goalTargetDate, localDay, resolveWorkConfig, type Day,
} from '@salesos/workforce-core';
import { runDayClose } from '../src/jobs/workforce/day-close';
import { runEarnedLeaveSweep } from '../src/jobs/workforce/earned-leave';

/**
 * DEV ONLY. Replaces ALL workforce data of an EXISTING organisation with one coherent SIMULATED year (join date -> today):
 * holidays, attendance, leave (requests, approval steps, balance ledger), Earned Leave (real engine), corrections, 45-day goals (+milestones,
 * updates), work tasks (+events, linked to goals), announcements, salary structures. Weekly offs / holidays / leave days / absences are
 * written by the real day-close job and Earned Leave credits by the real Earned Leave engine. Payroll runs are made afterwards by
 * apps/api/src/seed/sample-payroll-run.ts (real service). Texts carry "[sample data]".
 * To remove append-only history it disables the guard triggers of 5 tables INSIDE one transaction and verifies they are enabled again
 * before commit (dev database only; refuses non-local hosts and production).
 *   LOAD_DEMO_ORG_SLUG=coacheasily tsx scripts/sample-workforce-year.ts   (DATABASE_URL must be local)
 */
const TAG = ' [sample data]';
const day = (d: Day) => new Date(`${d}T00:00:00.000Z`);
const ist = (d: Day, hm: string) => new Date(`${d}T${hm}:00.000+05:30`);
const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
function rnd(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}
const pick = <T,>(arr: T[], seed: string): T => arr[Math.floor(rnd(seed) * arr.length) % arr.length]!;
const addHours = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);

interface Template { titles: string[]; target: number | null; unit: string | null; milestones: string[]; tasks: string[] }
const BY_ROLE: Record<string, Template> = {
  SALES_EXECUTIVE: { titles: ['Enrol 30 learners from assigned leads', 'Lift demo-to-enrolment conversion', 'Reactivate 40 cold leads'], target: 30, unit: 'enrolments', milestones: ['Call all new leads within 24 hours', 'Run 10 demo follow-ups', 'Close 15 enrolments'], tasks: ['Follow up with hot leads', 'Update CRM notes for yesterday calls'] },
  SALES_MANAGER: { titles: ['Team conversion to 18 percent', 'Clear the follow-up exception queue', 'Coach every executive twice'], target: 18, unit: '% conversion', milestones: ['Weekly call review with each executive', 'Fix the follow-up exception queue', 'Coach two executives'], tasks: ['Review team follow-up queue', 'Prepare weekly pipeline summary'] },
  SALES_TEAM_LEAD: { titles: ['Reach the quarterly revenue target', 'Improve forecast accuracy', 'Hire and onboard two executives'], target: 2500000, unit: 'INR collected', milestones: ['Finalise targets with managers', 'Close forecast gaps', 'Review pricing proposals'], tasks: ['Approve pending discount requests', 'Forecast review with managers'] },
  FOUNDER_CEO: { titles: ['Launch the next AI Sprint cohort', 'Review and approve Q targets', 'Expand the programme calendar'], target: null, unit: null, milestones: ['Approve programme calendar', 'Sign off sales targets', 'Review the weekly Founder report'], tasks: ['Review the weekly Founder report', 'Approve incentive policy'] },
  HR: { titles: ['Close open sales hires', 'Complete probation reviews on time', 'Refresh the onboarding checklist'], target: 3, unit: 'hires', milestones: ['Shortlist candidates', 'Complete interviews', 'Issue offers'], tasks: ['Schedule probation reviews', 'Update the onboarding checklist'] },
  FINANCE: { titles: ['Reconcile all collections for the month', 'Clear pending refunds', 'Close month-end on time'], target: null, unit: null, milestones: ['Verify pending payments', 'Process approved refunds', 'Close month-end reconciliation'], tasks: ['Verify pending payments', 'Reconcile refunds with the bank'] },
  MARKETING: { titles: ['Generate 600 qualified leads for the next webinar', 'Cut cost per lead by 15 percent', 'Launch two new landing pages'], target: 600, unit: 'leads', milestones: ['Publish landing page', 'Run two ad campaigns', 'Send three reminder mails'], tasks: ['Prepare webinar reminder content', 'Report ad spend and leads'] },
  OPERATIONS: { titles: ['Zero missed webinar and demo reminders', 'Standardise the ops checklist', 'Automate attendance exports'], target: null, unit: null, milestones: ['Audit reminder templates', 'Test reminder delivery', 'Publish the weekly ops checklist'], tasks: ['Check tomorrow webinar setup', 'Update the SOP checklist'] },
  COMMUNITY: { titles: ['Grow community engagement by 25 percent', 'Run four community events', 'Publish member success stories'], target: 25, unit: '% growth', milestones: ['Plan four community events', 'Respond to every new member', 'Share two success stories'], tasks: ['Post the weekly community digest', 'Welcome new members'] },
  STUDENT_SUCCESS: { titles: ['Onboard every new learner within 48 hours', 'Raise learner satisfaction', 'Resolve complaints within SLA'], target: null, unit: null, milestones: ['Review handover checklists', 'Call new learners', 'Collect first-week feedback'], tasks: ['Complete pending handovers', 'Follow up on open complaints'] },
  ADMIN: { titles: ['Keep system health checks green', 'Complete the quarterly access review', 'Verify backups monthly'], target: null, unit: null, milestones: ['Review audit log alerts', 'Check backups', 'Rotate access reviews'], tasks: ['Review audit alerts', 'Verify the nightly backup'] },
};
const PAY: Record<string, { basic: number; hra: number }> = {
  FOUNDER_CEO: { basic: 120000, hra: 40000 }, SALES_TEAM_LEAD: { basic: 60000, hra: 20000 }, SALES_MANAGER: { basic: 45000, hra: 15000 },
  SALES_EXECUTIVE: { basic: 25000, hra: 8000 }, HR: { basic: 32000, hra: 10000 }, FINANCE: { basic: 35000, hra: 11000 },
  MARKETING: { basic: 24000, hra: 8000 }, OPERATIONS: { basic: 26000, hra: 8000 }, COMMUNITY: { basic: 24000, hra: 8000 },
  STUDENT_SUCCESS: { basic: 24000, hra: 8000 }, ADMIN: { basic: 40000, hra: 12000 },
};

type LeaveSpec = { userId: string; typeKey: 'CASUAL' | 'SICK' | 'UNPAID'; start: Day; end: Day; days: number; half: 'NONE' | 'FIRST_HALF'; status: LeaveRequestStatus; reason: string; mgr: string; createdAt: Date };

async function main() {
  const slug = process.env.LOAD_DEMO_ORG_SLUG;
  if (!slug) throw new Error('Set LOAD_DEMO_ORG_SLUG');
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run in production');
  const host = new URL(process.env.DATABASE_URL ?? '').hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) throw new Error(`Refusing non-local database host "${host}"`);
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findUniqueOrThrow({ where: { slug } });
    const orgId = org.id;
    const setting = await prisma.workforceSetting.findUnique({ where: { organizationId: orgId } });
    const config = resolveWorkConfig(setting?.config);
    const now = new Date();
    const today = localDay(now, config.timezone);

    // ------------------------------------------------------------------ reset (workforce tables only, this organisation)
    const guarded = ['attendance_corrections', 'leave_balance_txns', 'goal_updates', 'work_task_events', 'salary_structures'];
    const wipe = ['work_task_events', 'work_tasks', 'goal_updates', 'goal_milestones', 'goals', 'leave_approval_steps', 'leave_balance_txns', 'leave_requests', 'attendance_corrections', 'attendance_records', 'earned_leave_progress', 'payslips', 'payroll_runs', 'salary_structures', 'holidays', 'announcements'];
    await prisma.$transaction(async (tx) => {
      for (const t of guarded) await tx.$executeRawUnsafe(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
      for (const t of wipe) await tx.$executeRawUnsafe(`DELETE FROM ${t} WHERE organization_id = '${orgId}'::uuid`);
      for (const t of guarded) await tx.$executeRawUnsafe(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
      const off = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint n FROM pg_trigger WHERE tgrelid::regclass::text IN (${guarded.map((t) => `'${t}'`).join(',')}) AND NOT tgisinternal AND tgenabled = 'D'`);
      if (Number(off[0]?.n ?? 0) !== 0) throw new Error('guard triggers are not enabled again; aborting (transaction rolled back)');
    }, { timeout: 120_000 });

    const users = await prisma.user.findMany({
      where: { organizationId: orgId, isActive: true }, orderBy: { name: 'asc' },
      select: { id: true, name: true, managerId: true, roleAssignments: { select: { role: { select: { key: true } } } }, employeeProfileUser: { select: { joinDate: true } } },
    });
    const joinOf = new Map(users.map((u) => [u.id, (u.employeeProfileUser[0]?.joinDate?.toISOString().slice(0, 10) ?? addDays(today, -200)) as Day]));
    const roleOf = (u: (typeof users)[number]) => u.roleAssignments[0]?.role.key ?? 'ADMIN';
    const hr = users.find((u) => u.roleAssignments.some((r) => r.role.key === 'HR'));
    const founder = users.find((u) => u.roleAssignments.some((r) => r.role.key === 'FOUNDER_CEO'));
    if (!hr || !founder) throw new Error('Need one HR and one Founder user');
    const firstJoin = [...joinOf.values()].sort()[0]!;

    // ------------------------------------------------------------------ holidays (fixed-date only; moveable festivals are entered by HR)
    const fixed: Array<[string, string, 'NATIONAL' | 'REGIONAL']> = [['01-26', 'Republic Day', 'NATIONAL'], ['05-01', 'Maharashtra Day', 'REGIONAL'], ['08-15', 'Independence Day', 'NATIONAL'], ['10-02', 'Gandhi Jayanti', 'NATIONAL'], ['12-25', 'Christmas', 'NATIONAL']];
    const holidayRows = [2025, 2026].flatMap((y) => fixed.map(([md, name, kind]) => ({ date: `${y}-${md}` as Day, name: name + TAG, kind }))).filter((h) => h.date >= firstJoin && h.date <= addDays(today, 90));
    await prisma.holiday.createMany({ data: holidayRows.map((h) => ({ organizationId: orgId, date: day(h.date), name: h.name, kind: h.kind, location: 'India', status: 'APPROVED' as const, createdById: hr.id, approvedById: founder.id, approvedAt: now })) });
    const calendar = buildCalendar(config, holidayRows.map((h) => ({ date: h.date, name: h.name, kind: h.kind, status: 'APPROVED' as const })));

    // ------------------------------------------------------------------ employee profile details (simulated)
    let n = 0;
    for (const u of users) {
      n += 1;
      const join = joinOf.get(u.id)!;
      const dobYear = 1986 + Math.floor(rnd(`dob-year-${u.id}`) * 15);
      const dobMd = n === 3 ? addDays(today, 3).slice(5) : n === 8 ? addDays(today, 6).slice(5) : `${String(1 + Math.floor(rnd(`dob-m-${u.id}`) * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd(`dob-d-${u.id}`) * 28)).padStart(2, '0')}`;
      await prisma.employeeProfile.update({ where: { userId: u.id }, data: { employeeCode: `EMP-${String(n).padStart(3, '0')}`, workLocation: n % 3 === 0 ? 'Remote' : 'Mumbai', hrContactId: u.id === hr.id ? null : hr.id, dateOfBirth: day(`${dobYear}-${dobMd}`), shareBirthday: n % 2 === 0, probationMonths: 3, probationEndDate: day(addMonths(join, 3)) } });
    }

    // ------------------------------------------------------------------ leave requests across the year (caps keep every balance >= 0)
    const specs: LeaveSpec[] = [];
    users.forEach((u, i) => {
      const join = joinOf.get(u.id)!;
      const from = addDays(join, 12);
      if (from > addDays(today, 20)) return;
      const span = Math.max(20, Math.round((new Date(addDays(today, 25)).getTime() - new Date(from).getTime()) / 86_400_000));
      const mgr = u.managerId ?? founder.id;
      const taken = new Set<Day>();
      let casualLeft = 11;
      let sickLeft = 7;
      const place = (typeKey: LeaveSpec['typeKey'], k: number, want: number, half: boolean) => {
        let s = addDays(from, Math.floor(rnd(`lv-${u.id}-${typeKey}-${k}`) * span));
        for (let g = 0; g < 14 && (!calendar.isWorkingDay(s) || taken.has(s)); g++) s = addDays(s, 1);
        if (!calendar.isWorkingDay(s) || taken.has(s)) return;
        // consecutive working days only (weekly offs / holidays may sit inside the range); stop before a day another request already covers
        const wd: Day[] = [];
        for (let d = s, g = 0; g < 20 && wd.length < (half ? 1 : want); g++, d = addDays(d, 1)) {
          if (!calendar.isWorkingDay(d)) continue;
          if (taken.has(d)) break;
          wd.push(d);
        }
        if (wd.length === 0) return;
        const days = half ? 0.5 : wd.length;
        if (typeKey === 'CASUAL') { if (days > casualLeft) return; casualLeft -= days; }
        if (typeKey === 'SICK') { if (days > sickLeft) return; sickLeft -= days; }
        wd.forEach((d) => taken.add(d));
        const start = wd[0]!;
        const r = rnd(`st-${u.id}-${typeKey}-${k}`);
        let status: LeaveRequestStatus;
        if (start <= today) status = r < 0.82 ? 'APPROVED' : r < 0.92 ? 'REJECTED' : 'CANCELLED';
        else if (start <= addDays(today, 7)) status = r < 0.4 ? 'PENDING_HR' : r < 0.8 ? 'PENDING_MANAGER' : 'APPROVED';
        else status = r < 0.5 ? 'PENDING_MANAGER' : r < 0.8 ? 'APPROVED' : 'PENDING_HR';
        if (typeKey === 'UNPAID' && start <= today) status = 'APPROVED';
        const c = ist(addDays(start, -(2 + Math.floor(rnd(`cr-${u.id}-${k}`) * 4))), '10:00');
        specs.push({ userId: u.id, typeKey, start, end: wd[wd.length - 1]!, days, half: half ? 'FIRST_HALF' : 'NONE', status, mgr, createdAt: c > now ? addHours(now, -2 - k) : c, reason: pick(['Family function', 'Personal work', 'Fever', 'Doctor appointment', 'Travel', 'Festival'], `rs-${u.id}-${k}`) + TAG });
      };
      const nCasual = 3 + Math.floor(rnd(`nc-${u.id}`) * 4);
      for (let k = 0; k < nCasual; k++) place('CASUAL', k, 1 + Math.floor(rnd(`cs-${u.id}-${k}`) * 3), false);
      const nSick = 1 + Math.floor(rnd(`ns-${u.id}`) * 3);
      for (let k = 0; k < nSick; k++) place('SICK', k, 1 + Math.floor(rnd(`ss-${u.id}-${k}`) * 2), false);
      if (rnd(`hf-${u.id}`) < 0.5) place('CASUAL', 20, 1, true);
      if (i % 4 === 0) place('UNPAID', 30, 1 + Math.floor(rnd(`us-${u.id}`) * 2), false);
    });
    specs.sort((a, b) => (a.start < b.start ? -1 : 1));

    const leaveDays = new Map<string, Set<Day>>();
    const ledgerEvents = new Map<string, Array<{ at: Date; amount: number; kind: 'OPENING' | 'DEBIT_LEAVE'; reqId?: string; note: string }>>();
    const pushEv = (userId: string, typeKey: string, ev: { at: Date; amount: number; kind: 'OPENING' | 'DEBIT_LEAVE'; reqId?: string; note: string }) => {
      const k = `${userId}|${typeKey}`;
      (ledgerEvents.get(k) ?? ledgerEvents.set(k, []).get(k)!).push(ev);
    };
    for (const u of users) {
      const at = ist(joinOf.get(u.id)!, '09:00');
      pushEv(u.id, 'CASUAL', { at, amount: 12, kind: 'OPENING', note: 'Opening balance' + TAG });
      pushEv(u.id, 'SICK', { at, amount: 8, kind: 'OPENING', note: 'Opening balance' + TAG });
    }
    for (const s of specs) {
      const req = await prisma.leaveRequest.create({
        data: { organizationId: orgId, userId: s.userId, typeKey: s.typeKey, startDate: day(s.start), endDate: day(s.end), halfDay: s.half, days: s.days, unpaidDays: 0, reason: s.reason, status: s.status, cancelReason: s.status === 'CANCELLED' ? 'Plans changed' + TAG : null, createdAt: s.createdAt },
      });
      const mAt = new Date(Math.min(now.getTime() - 3_600_000, s.createdAt.getTime() + 4 * 3_600_000));
      const hAt = new Date(Math.min(now.getTime() - 1_800_000, s.createdAt.getTime() + 28 * 3_600_000));
      const step = (st: 'MANAGER' | 'HR', status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED', actorId: string | null, at: Date) =>
        prisma.leaveApprovalStep.create({ data: { organizationId: orgId, requestId: req.id, step: st, status, actorId: status === 'APPROVED' || status === 'REJECTED' ? actorId : null, comment: status === 'REJECTED' ? 'Team coverage needed' + TAG : null, decidedAt: status === 'APPROVED' || status === 'REJECTED' ? at : null, createdAt: s.createdAt } });
      if (s.status === 'APPROVED') { await step('MANAGER', 'APPROVED', s.mgr, mAt); await step('HR', 'APPROVED', hr.id, hAt); }
      else if (s.status === 'PENDING_MANAGER') { await step('MANAGER', 'PENDING', null, mAt); await step('HR', 'PENDING', null, hAt); }
      else if (s.status === 'PENDING_HR') { await step('MANAGER', 'APPROVED', s.mgr, mAt); await step('HR', 'PENDING', null, hAt); }
      else if (s.status === 'REJECTED') { await step('MANAGER', 'REJECTED', s.mgr, mAt); await step('HR', 'SKIPPED', null, hAt); }
      else { await step('MANAGER', 'SKIPPED', null, mAt); await step('HR', 'SKIPPED', null, hAt); }
      if (s.status === 'APPROVED') {
        if (s.start <= today) {
          const set = leaveDays.get(s.userId) ?? new Set<Day>();
          for (const d of eachDay(s.start, s.end)) if (calendar.isWorkingDay(d)) set.add(d);
          leaveDays.set(s.userId, set);
        }
        if (s.typeKey !== 'UNPAID') pushEv(s.userId, s.typeKey, { at: hAt, amount: -s.days, kind: 'DEBIT_LEAVE', reqId: req.id, note: 'Approved leave' + TAG });
      }
    }
    for (const [k, evs] of ledgerEvents) {
      const [userId, typeKey] = k.split('|') as [string, string];
      evs.sort((a, b) => a.at.getTime() - b.at.getTime());
      let bal = 0;
      for (const e of evs) {
        const before = bal;
        bal = Math.round((bal + e.amount) * 100) / 100;
        await prisma.leaveBalanceTxn.create({ data: { organizationId: orgId, userId, typeKey, kind: e.kind, amount: e.amount, balanceBefore: before, balanceAfter: bal, leaveRequestId: e.reqId ?? null, uniqueKey: e.kind === 'OPENING' ? `OPENING:${userId}:${typeKey}` : `LV-DEBIT:${e.reqId}`, createdById: hr.id, note: e.note, createdAt: e.at } });
      }
    }

    // ------------------------------------------------------------------ attendance (leave days are left for day-close to turn into ON_LEAVE / UNPAID_LEAVE / HALF_DAY)
    const halfLeaveDays = new Map<string, Set<Day>>();
    for (const s of specs) if (s.half === 'FIRST_HALF' && s.status === 'APPROVED' && s.start <= today) (halfLeaveDays.get(s.userId) ?? halfLeaveDays.set(s.userId, new Set()).get(s.userId)!).add(s.start);
    type Row = { organizationId: string; userId: string; date: Date; status: 'PRESENT' | 'LATE' | 'WFH' | 'HALF_DAY'; checkInAt: Date; checkOutAt: Date | null; workMinutes: number | null; source: 'SELF'; note: null };
    const rows: Row[] = [];
    for (const u of users) {
      const join = joinOf.get(u.id)!;
      const skip = leaveDays.get(u.id) ?? new Set<Day>();
      const lateP = 0.04 + rnd(`late-${u.id}`) * 0.14;
      const missP = 0.008 + rnd(`miss-${u.id}`) * 0.022;
      for (const d of calendar.workingDays(join, today)) {
        if (skip.has(d) || halfLeaveDays.get(u.id)?.has(d)) continue;
        const r = rnd(`att-${u.id}-${d}`);
        if (d === today) {
          if (rnd(`today-${u.id}`) < 0.3) continue;
          const t = 9 * 60 + 15 + Math.floor(rnd(`ci-${u.id}-${d}`) * 70);
          rows.push({ organizationId: orgId, userId: u.id, date: day(d), status: t > 10 * 60 + 15 ? 'LATE' : 'PRESENT', checkInAt: ist(d, hhmm(t)), checkOutAt: null, workMinutes: null, source: 'SELF', note: null });
          continue;
        }
        if (r < missP) continue; // a missed day: day-close marks it ABSENT
        const q = (r - missP) / (1 - missP);
        let status: Row['status'] = 'PRESENT';
        let inMin = 9 * 60 + 20 + Math.floor(rnd(`i-${u.id}-${d}`) * 50);
        let worked = 480 + Math.floor(rnd(`w-${u.id}-${d}`) * 70);
        if (q >= 0.965) { status = 'HALF_DAY'; worked = 230 + Math.floor(rnd(`h-${u.id}-${d}`) * 40); }
        else if (q >= 0.915) status = 'WFH';
        else if (q >= 1 - lateP - 0.07 && q < 0.915) { status = 'LATE'; inMin = 10 * 60 + 20 + Math.floor(rnd(`l-${u.id}-${d}`) * 40); }
        rows.push({ organizationId: orgId, userId: u.id, date: day(d), status, checkInAt: ist(d, hhmm(inMin)), checkOutAt: ist(d, hhmm(Math.min(23 * 60 + 59, inMin + worked))), workMinutes: worked, source: 'SELF', note: null });
      }
    }
    for (let i = 0; i < rows.length; i += 1000) await prisma.attendanceRecord.createMany({ data: rows.slice(i, i + 1000), skipDuplicates: true });

    // ------------------------------------------------------------------ the real day-close writes everything else
    const dc = await runDayClose(prisma, now, { fullHistory: true });

    // HR corrections of some system-marked absences (before the Earned Leave engine runs, so credits reflect them)
    const absents = await prisma.attendanceRecord.findMany({ where: { organizationId: orgId, status: 'ABSENT', source: 'SYSTEM' }, orderBy: [{ date: 'asc' }, { userId: 'asc' }] });
    let corrected = 0;
    for (const [i, rec] of absents.entries()) {
      if (i % 3 !== 0) continue;
      const d = rec.date.toISOString().slice(0, 10);
      await prisma.attendanceRecord.update({ where: { id: rec.id }, data: { status: 'PRESENT', source: 'HR', checkInAt: ist(d, '09:40'), checkOutAt: ist(d, '18:10'), workMinutes: 510, note: 'Corrected by HR' + TAG, version: 2 } });
      await prisma.attendanceCorrection.create({ data: { organizationId: orgId, recordId: rec.id, userId: rec.userId, date: rec.date, oldValue: { status: 'ABSENT' }, newValue: { status: 'PRESENT', checkInAt: ist(d, '09:40').toISOString() }, reason: 'Network outage, manager confirmed attendance' + TAG, correctedById: hr.id, createdAt: new Date(Math.min(now.getTime(), ist(addDays(d, 1), '11:00').getTime())) } });
      corrected += 1;
    }
    const el = await runEarnedLeaveSweep(prisma, now);

    // ------------------------------------------------------------------ announcements, salary structures
    const ann = [
      ['Welcome to SalesOS Work', 'Check in and out here, apply for leave, and track your 45-day goals and tasks.', [], -330, null],
      ['Leave policy: Manager then HR approval', 'Leave requests go to your manager first, then HR. Apply at least a day ahead where possible.', [], -300, null],
      ['Attendance reminder', 'Please check in before 10:15 and check out at the end of the day. Corrections need a manager note within 7 days.', [], -240, null],
      ['Holiday calendar updated', 'The fixed-date national holidays are approved. HR will add moveable festivals as they are confirmed.', [], -180, null],
      ['Mid-year goal review', 'Managers: please review 45-day goals with every team member this month.', ['SALES_MANAGER', 'SALES_TEAM_LEAD'], -120, -100],
      ['Payroll calendar', 'Payroll is prepared by Finance after month close, approved by the Founder and paid by Finance.', ['HR', 'FINANCE', 'FOUNDER_CEO'], -60, null],
      ['Earned Leave explained', 'You earn one Earned Leave day for every 20 eligible working days. See Leave > balances for the calculation.', [], -30, null],
      ['Quarterly review week', 'Managers: please complete 45-day goal reviews for your team this week.', ['SALES_MANAGER', 'SALES_TEAM_LEAD'], -5, 10],
    ] as const;
    await prisma.announcement.createMany({ data: ann.map(([title, body, roles, ago, exp]) => ({ organizationId: orgId, title: title + TAG, body, audienceRoles: [...roles], publishedAt: addHours(now, ago * 24), expiresAt: exp === null ? null : addHours(now, exp * 24), createdById: roles.length && roles[0] !== 'HR' ? founder.id : hr.id })) });
    let ssCount = 0;
    for (const [i, u] of users.entries()) {
      const p = PAY[roleOf(u)] ?? PAY['ADMIN']!;
      const join = joinOf.get(u.id)!;
      const comps = (f: number) => [{ key: 'BASIC', name: 'Basic', kind: 'EARNING', amount: (p.basic * f).toFixed(2) }, { key: 'HRA', name: 'House rent allowance', kind: 'EARNING', amount: (p.hra * f).toFixed(2) }, { key: 'PROF_TAX', name: 'Professional tax (manual)', kind: 'DEDUCTION', amount: '200.00' }];
      await prisma.salaryStructure.create({ data: { organizationId: orgId, userId: u.id, effectiveFrom: day(join), currency: 'INR', createdById: hr.id, note: 'Simulated salary structure' + TAG, components: comps(1), createdAt: ist(join, '10:00') } });
      ssCount += 1;
      if (join < '2026-02-01' && i % 3 !== 0) {
        await prisma.salaryStructure.create({ data: { organizationId: orgId, userId: u.id, effectiveFrom: day('2026-04-01'), currency: 'INR', createdById: hr.id, note: 'Simulated annual revision (+8%)' + TAG, components: comps(1.08), createdAt: ist('2026-03-25', '10:00') } });
        ssCount += 1;
      }
    }

    // ------------------------------------------------------------------ goals (45-day cycles back to the joining date) and tasks
    let goalCount = 0;
    let taskCount = 0;
    let eventCount = 0;
    for (const [i, u] of users.entries()) {
      const join = joinOf.get(u.id)!;
      const tpl = BY_ROLE[roleOf(u)] ?? BY_ROLE['ADMIN']!;
      const reviewerId = u.managerId ?? founder.id;
      const offset = 3 + Math.floor(rnd(`off-${u.id}`) * 35);
      const starts: Day[] = [];
      for (let k = 0; ; k++) {
        const s = addDays(today, -offset - 45 * k);
        if (k === 0 && s < join) { starts.push(join); break; }
        if (s < join) break;
        starts.push(s);
      }
      for (const [k, start] of starts.entries()) {
        const cycleNo = starts.length - k;
        const target = goalTargetDate(start, 45);
        const elapsed = Math.min(100, Math.round(((new Date(today).getTime() - new Date(start).getTime()) / 86_400_000 + 1) / 45 * 100));
        let status: GoalStatus = 'COMPLETED';
        let pct = 100;
        const rr = rnd(`gs-${u.id}-${k}`);
        if (k === 0) {
          const sc = i % 5;
          if (sc === 3 && elapsed >= 25) { status = 'PENDING_VERIFICATION'; pct = 100; }
          else if (sc === 1) { status = 'ACTIVE'; pct = Math.max(2, elapsed - 38); }
          else if (sc === 4 && elapsed >= 30) { status = 'COMPLETED'; pct = 100; }
          else { status = 'ACTIVE'; pct = Math.min(95, Math.max(3, Math.round(elapsed * (0.85 + rnd(`pg-${u.id}`) * 0.25)))); }
        } else if (k === 1) {
          if (i % 7 === 0) { status = 'ACTIVE'; pct = 55 + Math.floor(rnd(`ov-${u.id}`) * 30); }
          else if (i % 5 === 1) { status = 'PENDING_VERIFICATION'; pct = 100; }
        } else if (rr < 0.06) { status = 'CANCELLED'; pct = 25 + Math.floor(rnd(`cp-${u.id}-${k}`) * 35); }
        const tv = tpl.target;
        const current = tv ? Math.round(((tv * pct) / 100) * 100) / 100 : 0;
        const pctStored = tv ? goalProgressPct({ currentValue: current, targetValue: tv }) : pct;
        const risk = computeGoalRisk({ status, progressPct: pctStored, startDay: start, targetDay: target, today, atRiskGapPct: 20 });
        const lateDays = status === 'COMPLETED' || status === 'PENDING_VERIFICATION' ? Math.floor(rnd(`late-${u.id}-${k}`) * 9) - 5 : 0;
        const submitDay = addDays(target, lateDays);
        const submittedAt = status === 'COMPLETED' || status === 'PENDING_VERIFICATION' ? new Date(Math.min(now.getTime() - 3_600_000, ist(submitDay > today ? addDays(today, -1) : submitDay, '11:00').getTime())) : null;
        const verifiedAt = status === 'COMPLETED' && submittedAt ? new Date(Math.min(now.getTime() - 1_800_000, submittedAt.getTime() + (1 + Math.floor(rnd(`vd-${u.id}-${k}`) * 3)) * 86_400_000)) : null;
        const createdAt = ist(start, '10:00');
        const goal = await prisma.goal.create({
          data: {
            organizationId: orgId, ownerId: u.id, reviewerId, createdById: reviewerId, title: `${pick(tpl.titles, `gt-${u.id}-${k}`)} (cycle ${cycleNo})${TAG}`, description: 'Simulated goal.' + TAG,
            startDate: day(start), targetDate: day(target), cycleDays: 45, targetValue: tv, currentValue: current, unit: tpl.unit, progressPct: pctStored, status, risk,
            submittedAt, verifiedAt, verifiedById: verifiedAt ? reviewerId : null, createdAt,
          },
        });
        goalCount += 1;
        const doneM = Math.round((pctStored / 100) * tpl.milestones.length);
        await prisma.goalMilestone.createMany({ data: tpl.milestones.map((m, mi) => ({ organizationId: orgId, goalId: goal.id, title: m + TAG, dueDate: day(addDays(start, Math.round(((mi + 1) * 45) / (tpl.milestones.length + 1)))), done: mi < doneM, doneAt: mi < doneM ? new Date(Math.min(now.getTime() - 3_600_000, ist(addDays(start, Math.round(((mi + 1) * 40) / (tpl.milestones.length + 1))), '12:00').getTime())) : null, sortOrder: mi })) });
        const ups: Array<{ kind: 'PROGRESS' | 'COMMENT' | 'SUBMITTED' | 'VERIFIED' | 'RETURNED'; author: string; p: number | null; note: string; at: Date }> = [];
        const spanDays = Math.min(44, Math.round((new Date(today).getTime() - new Date(start).getTime()) / 86_400_000));
        if (spanDays >= 12 && status !== 'CANCELLED') ups.push({ kind: 'PROGRESS', author: u.id, p: Math.round(pctStored * 0.45), note: 'Midway update' + TAG, at: ist(addDays(start, Math.floor(spanDays * 0.4)), '18:00') });
        if (spanDays >= 24 && status !== 'CANCELLED') ups.push({ kind: 'PROGRESS', author: u.id, p: Math.round(pctStored * 0.8), note: 'Second update' + TAG, at: ist(addDays(start, Math.floor(spanDays * 0.75)), '18:00') });
        if (status === 'ACTIVE' && spanDays >= 2) ups.push({ kind: 'PROGRESS', author: u.id, p: pctStored, note: 'Latest progress' + TAG, at: ist(addDays(today, -1), '18:00') });
        if (status === 'CANCELLED') ups.push({ kind: 'COMMENT', author: reviewerId, p: pctStored, note: 'Cancelled: priorities changed' + TAG, at: ist(addDays(start, 30), '15:00') });
        if (submittedAt) ups.push({ kind: 'SUBMITTED', author: u.id, p: pctStored, note: 'Submitted for verification' + TAG, at: submittedAt });
        if (verifiedAt) ups.push({ kind: 'VERIFIED', author: reviewerId, p: pctStored, note: 'Verified' + TAG, at: verifiedAt });
        for (const up of ups) {
          if (up.at > now) continue;
          await prisma.goalUpdate.create({ data: { organizationId: orgId, goalId: goal.id, authorId: up.author, kind: up.kind, progressPct: up.p, currentValue: tv && up.p != null ? Math.round(((tv * up.p) / 100) * 100) / 100 : null, note: up.note, createdAt: up.at } });
        }

        // tasks linked to this goal (assigned by the reviewer), created through the cycle
        const plans: Array<{ title: string; offsetDays: number; dueDays: number; pr: WorkTaskPriority }> = [
          { title: tpl.tasks[0]!, offsetDays: 0, dueDays: 14, pr: 'HIGH' }, { title: tpl.tasks[1]!, offsetDays: 10, dueDays: 28, pr: 'MEDIUM' }, { title: 'Cycle review note', offsetDays: 20, dueDays: 40, pr: 'LOW' },
        ];
        for (const [ti, tp] of plans.entries()) {
          const created = addDays(start, tp.offsetDays);
          if (created > today) continue;
          const due = addDays(start, tp.dueDays);
          const dueAt = ist(due, '18:00');
          const old = due < today;
          let st: WorkTaskStatus;
          const tr = rnd(`ts-${u.id}-${k}-${ti}`);
          if (status === 'CANCELLED') st = ti === 0 ? 'COMPLETED' : 'CANCELLED';
          else if (status === 'COMPLETED' || (old && status !== 'ACTIVE')) st = tr < 0.04 ? 'REJECTED' : 'COMPLETED';
          else if (old) st = tr < 0.25 ? (tr < 0.12 ? 'IN_PROGRESS' : 'ACCEPTED') : 'COMPLETED';
          else st = (['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'REVIEW'] as const)[Math.floor(tr * 4) % 4]!;
          const createdAtT = ist(created, '10:00');
          const completedAt = st === 'COMPLETED' ? new Date(Math.min(now.getTime() - 3_600_000, ist(addDays(due, Math.floor(rnd(`tc-${u.id}-${k}-${ti}`) * 5) - 3), '17:00').getTime())) : null;
          await createTask({ title: tp.title, st, pr: tp.pr, assignee: u.id, assigner: reviewerId, createdAt: createdAtT, dueAt, completedAt, goalId: goal.id, project: null });
        }
      }
      // stand-alone recurring task every second month
      for (let m = 0; m < 12; m += 2) {
        const created = addDays(today, -30 * m - 20);
        if (created < join || created > today) continue;
        const due = addDays(created, 7);
        const completedAt = due < today ? new Date(Math.min(now.getTime() - 3_600_000, ist(addDays(due, -1 + Math.floor(rnd(`sa-${u.id}-${m}`) * 3)), '16:00').getTime())) : null;
        const st: WorkTaskStatus = completedAt ? 'COMPLETED' : (m === 0 && i % 2 === 0 ? 'ACCEPTED' : 'REVIEW');
        await createTask({ title: 'Monthly status note', st, pr: 'LOW', assignee: u.id, assigner: reviewerId, createdAt: ist(created, '10:00'), dueAt: ist(due, '18:00'), completedAt, goalId: null, project: 'Operations rhythm' });
      }
    }

    async function createTask(t: { title: string; st: WorkTaskStatus; pr: WorkTaskPriority; assignee: string; assigner: string; createdAt: Date; dueAt: Date; completedAt: Date | null; goalId: string | null; project: string | null }) {
      const row = await prisma.workTask.create({
        data: {
          organizationId: orgId, title: t.title + TAG, description: 'Simulated task.' + TAG, priority: t.pr, assignerId: t.assigner, assigneeId: t.assignee, dueAt: t.dueAt, status: t.st, goalId: t.goalId, project: t.project,
          evidence: t.st === 'COMPLETED' ? 'Done, notes in CRM' + TAG : null, completedAt: t.completedAt, createdAt: t.createdAt,
        },
      });
      const flow: WorkTaskStatus[] = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'REVIEW', 'COMPLETED'];
      const path: WorkTaskStatus[] = t.st === 'CANCELLED' ? ['ASSIGNED', 'CANCELLED'] : t.st === 'REJECTED' ? ['ASSIGNED', 'REJECTED'] : flow.slice(0, flow.indexOf(t.st) + 1);
      const endMs = t.completedAt ? t.completedAt.getTime() : Math.min(now.getTime() - 60_000, t.createdAt.getTime() + 4 * 86_400_000);
      const span = Math.max(3_600_000, endMs - t.createdAt.getTime());
      await prisma.workTaskEvent.create({ data: { organizationId: orgId, taskId: row.id, actorId: t.assigner, kind: 'CREATED', toStatus: 'ASSIGNED', createdAt: t.createdAt } });
      eventCount += 1;
      for (let s = 1; s < path.length; s++) {
        const at = new Date(t.createdAt.getTime() + Math.round((span * s) / (path.length - 1)) - (s === path.length - 1 ? 0 : 0));
        await prisma.workTaskEvent.create({ data: { organizationId: orgId, taskId: row.id, actorId: path[s] === 'COMPLETED' || path[s] === 'CANCELLED' ? t.assigner : t.assignee, kind: 'STATUS', fromStatus: path[s - 1], toStatus: path[s], createdAt: at } });
        eventCount += 1;
      }
      taskCount += 1;
    }

    console.log(JSON.stringify({ users: users.length, holidays: holidayRows.length, leaveRequests: specs.length, attendanceRowsWritten: rows.length, dayClose: dc, hrCorrections: corrected, earnedLeave: el, announcements: ann.length, salaryStructures: ssCount, goals: goalCount, tasks: taskCount, taskEvents: eventCount, from: firstJoin, today }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
