import type { Prisma } from '@prisma/client';
import { syncLeadExceptions, syncLeadNextAction } from '@salesos/crm-core';
import { allocate, forecastBounds, periodBounds, stageWeightedForecast, FORECAST_METHOD } from '../../modules/revenue/calc';
import { ensureRevenueGuards } from '../../modules/revenue/revenue-guards';
import { addDaysStr, atIST, dateOnly, DAY, FIRST, HOUR, intoWorkingHours, istDay, istDow, LAST, MIN, rng, uuid } from './shared';
import type { Ctx, Person } from './setup';

/**
 * 1 Sep 2026 -> now. One simulation drives leads, calls, tasks, status history, events, deals, payments and refunds so every dashboard
 * (computed from these tables) tells the same story. Labels: createKey `sample-m1:*`, e-mails `@example.invalid`, events at location `sample-m1`.
 */
export const START_DAY = '2026-09-01';
const PRICE: Record<string, number> = { CBAX: 49999, MCA_X: 149999, MCA_ELITE_X: 499999 };
type CallOutcome = 'CONNECTED' | 'NO_ANSWER' | 'BUSY' | 'SWITCHED_OFF' | 'CALLBACK' | 'FAILED' | 'WON' | 'LOST';
type Interest = 'LOW' | 'MEDIUM' | 'HIGH';

interface SimCall { id: string; at: Date; outcome: CallOutcome; durationSeconds: number; notes: string; interest?: Interest; objection?: string; taskId?: string }
interface SimTask { id: string; type: 'CALL' | 'CALLBACK' | 'FOLLOW_UP' | 'DEMO'; title: string; due: Date; createdAt: Date; doneAt?: Date; priority: 'NORMAL' | 'HIGH' }
interface SimHist { at: Date; from: string | null; to: string; cat: 'OPEN' | 'WON' | 'LOST' | 'NURTURE'; source: 'CALL' | 'EVENT' | 'MANUAL'; byUser: boolean; reason?: string; callId?: string }
interface EventRow { id: string; type: 'WEBINAR' | 'DEMO'; startsAt: Date; teamId: string | null }

const NOTES_CONNECTED = ['Spoke to the learner, goals clear (wants to start coaching practice).', 'Asked about fees and batch timing; shared programme outline on WhatsApp.', 'Working professional, evenings only. Interested in weekend batch.', 'Wants to speak with spouse before deciding.', 'Compared with another institute; sent our outcomes sheet.', 'Very keen, asked about EMI options.'];
const NOTES_NOANS = ['No answer, will retry in the evening.', 'Rang out, no pickup.', 'Phone busy, retry tomorrow.', 'Switched off, retry next working day.'];

export async function loadCrmAndRevenue(ctx: Ctx): Promise<{ summary: Record<string, unknown>; leadIdsOpen: string[] }> {
  const { prisma, org, u, execs } = ctx;
  const r = rng(Number(process.env.SAMPLE_SEED ?? 8));
  const NOW = new Date();
  const today = istDay(NOW);
  await ensureRevenueGuards(prisma);

  // reference data: drop the "[DEMO] " prefix on real product / channel names; keep what exists
  for (const s of await prisma.leadSource.findMany({ where: { organizationId: org, name: { startsWith: '[DEMO] ' } } })) await prisma.leadSource.update({ where: { id: s.id }, data: { name: s.name.slice(7) } });
  for (const p of await prisma.program.findMany({ where: { organizationId: org, name: { startsWith: '[DEMO] ' } } })) await prisma.program.update({ where: { id: p.id }, data: { name: p.name.slice(7) } });
  const sources = await prisma.leadSource.findMany({ where: { organizationId: org } });
  const programs = await prisma.program.findMany({ where: { organizationId: org, isActive: true } });
  const prog = (code: string) => programs.find((p) => p.code === code)!;
  const srcByType = (t: string) => sources.find((s) => s.type === t) ?? sources[0]!;
  const sourcePick = () => r.weighted([[srcByType('WEBSITE'), 25], [srcByType('CAMPAIGN'), 25], [srcByType('WEBINAR'), 25], [srcByType('REFERRAL'), 15], [srcByType('IMPORT'), 10]] as const);

  // ---- days ------------------------------------------------------------------------------------------------------
  const days: string[] = [];
  for (let d = START_DAY; d <= today; d = addDaysStr(d, 1)) if (istDow(atIST(d, 12)) !== 0) days.push(d);

  // ---- events: webinar every Saturday, demos Tue/Thu per team ---------------------------------------------------------
  const events: EventRow[] = [];
  const evRows: Prisma.CrmEventCreateManyInput[] = [];
  const mkEvent = (type: 'WEBINAR' | 'DEMO', day: string, h: number, title: string, teamId: string | null, hostId: string, programCode: string) => {
    const startsAt = atIST(day, h, 0);
    const id = uuid();
    events.push({ id, type, startsAt, teamId });
    evRows.push({ id, organizationId: org, type, title, programId: prog(programCode).id, startsAt, endsAt: new Date(startsAt.getTime() + 90 * MIN), hostId, teamId, capacity: type === 'WEBINAR' ? 200 : 40, location: 'sample-m1', status: startsAt < NOW ? 'COMPLETED' : 'SCHEDULED', createdById: u.marketing!.id });
  };
  for (let d = '2026-08-29'; d <= addDaysStr(today, 14); d = addDaysStr(d, 1)) {
    const dow = istDow(atIST(d, 12));
    const label = new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    if (dow === 6) mkEvent('WEBINAR', d, 17, `Free AI Sprint: live session (${label})`, null, u.teamlead!.id, 'AI_SPRINT');
    if (dow === 2 || dow === 4) {
      mkEvent('DEMO', d, 17, `CBAX product demo - Team Saurabh (${label})`, ctx.team.saurabh, u.saurabh!.id, 'CBAX');
      mkEvent('DEMO', d, 18, `CBAX product demo - Team Prachi (${label})`, ctx.team.prachi, u.prachi!.id, 'CBAX');
    }
  }
  const nextEvent = (type: 'WEBINAR' | 'DEMO', after: Date, teamId: string | null) => events.filter((e) => e.type === type && e.startsAt > after && (type === 'WEBINAR' || e.teamId === teamId)).sort((a, b) => +a.startsAt - +b.startsAt)[0];

  // ---- leads ---------------------------------------------------------------------------------------------------------
  const existingPhones = new Set((await prisma.lead.findMany({ where: { organizationId: org }, select: { phoneE164: true } })).map((l) => l.phoneE164));
  const usedPhones = new Set<string>();
  const phone = () => { for (;;) { const p = `9${r.int(100000000, 999999999)}`; if (!usedPhones.has(p) && !existingPhones.has(`+91${p}`)) { usedPhones.add(p); return p; } } };

  const L: Prisma.LeadCreateManyInput[] = [];
  const T: Prisma.TaskCreateManyInput[] = [];
  const C: Prisma.CallLogCreateManyInput[] = [];
  const H: Prisma.LeadStatusHistoryCreateManyInput[] = [];
  const A: Prisma.LeadAssignmentCreateManyInput[] = [];
  const AT: Prisma.EventAttendanceCreateManyInput[] = [];
  const N: Prisma.LeadNoteCreateManyInput[] = [];
  const openLeadIds: string[] = [];
  const wonLeads: Array<{ leadId: string; exec: Person; programCode: string; at: Date; n: number }> = [];
  const openDeals: Array<{ leadId: string; exec: Person; programCode: string; stage: 'NEGOTIATION' | 'PAYMENT_PENDING'; createdAt: Date }> = [];
  let eliteWon = 0;
  let seq = 0;

  const stat: Record<string, { leads: number; calls: number; connected: number; won: number; lost: number; tasksDone: number; tasksOnTime: number }> = {};
  for (const e of execs) stat[e.key] = { leads: 0, calls: 0, connected: 0, won: 0, lost: 0, tasksDone: 0, tasksOnTime: 0 };

  for (const exec of execs) {
    const mgr = ctx.managerOf(exec.key);
    const teamId = mgr.key === 'saurabh' ? ctx.team.saurabh : ctx.team.prachi;
    const s = exec.skill;
    const onTime = Math.min(0.96, 0.86 + (s - 1) * 0.25);
    for (const day of days) {
      const joinDay = exec.join;
      if (day < joinDay) continue;
      const n = (exec.leadRate ?? 1) < 1 ? r.weighted([[1, 50], [2, 40], [3, 10]] as const) : r.weighted([[2, 40], [3, 45], [4, 15]] as const);
      for (let i = 0; i < n; i++) {
        const createdAt = atIST(day, r.int(9, 17), r.int(0, 59));
        if (createdAt >= NOW) continue;
        seq += 1;
        const leadId = uuid();
        const fate = r.weighted([['WON', 0.085 * Math.pow(s, 1.6)], ['LATE', 0.04], ['MID', 0.2], ['LOST', 0.2 + (1 - s) * 0.1], ['NURTURE', 0.07], ['EARLY', 0.42]] as const);
        const sellable = fate === 'WON' || fate === 'LATE';
        let programCode = sellable ? r.weighted([['CBAX', 63], ['MCA_X', 32], ['MCA_ELITE_X', fate === 'WON' && eliteWon >= 1 ? 0 : 5]] as const) : r.weighted([['AI_SPRINT', 35], ['CBAX', 30], ['MCA_X', 15], ['MCA_ELITE_X', 5], ['COACHEASILY_X', 10], ['WC_SUMMIT', 5]] as const);
        const first = r.pick(FIRST);
        const last = r.pick(LAST);
        const fullName = `${first} ${last}`;
        const ph = phone();
        const src = sourcePick();
        const calls: SimCall[] = [];
        const hist: SimHist[] = [{ at: createdAt, from: null, to: 'NEW', cat: 'OPEN', source: 'MANUAL', byUser: false }];
        const tasks: SimTask[] = [];
        let status = 'NEW';
        let cat = 'OPEN' as 'OPEN' | 'WON' | 'LOST' | 'NURTURE';
        let lastActivity = createdAt;
        let wonAt: Date | null = null;
        let lostAt: Date | null = null;
        let lostReason: string | null = null;
        let interest: Interest | null = null;

        // first-contact task (response SLA 2h)
        const firstTask: SimTask = { id: uuid(), type: 'CALL', title: 'First contact', due: new Date(createdAt.getTime() + 2 * HOUR), createdAt, priority: 'NORMAL' };
        tasks.push(firstTask);

        let t = intoWorkingHours(new Date(createdAt.getTime() + r.int(20, 150) * MIN));
        let prevTask: SimTask | undefined = firstTask;
        let stopped = false;
        const doCall = (outcome: CallOutcome, at: Date, extra: Partial<SimCall> = {}) => {
          const c: SimCall = { id: uuid(), at, outcome, durationSeconds: outcome === 'CONNECTED' || outcome === 'WON' || outcome === 'LOST' || outcome === 'CALLBACK' ? r.int(150, 780) : r.int(0, 25), notes: outcome === 'CONNECTED' ? r.pick(NOTES_CONNECTED) : outcome === 'WON' ? 'Payment confirmed, enrolment done.' : outcome === 'LOST' ? 'Learner declined.' : r.pick(NOTES_NOANS), ...extra };
          if (prevTask && !prevTask.doneAt) { prevTask.doneAt = at; c.taskId = prevTask.id; }
          prevTask = undefined;
          calls.push(c);
          lastActivity = at;
          return c;
        };
        const followUp = (after: Date, kind: SimTask['type'], gapMinMs: number, gapMaxMs: number, priority: SimTask['priority'] = 'NORMAL') => {
          const next = intoWorkingHours(new Date(after.getTime() + gapMinMs + r.next() * (gapMaxMs - gapMinMs)));
          const late = !r.chance(onTime);
          const due = late ? new Date(next.getTime() - r.int(60, 600) * MIN) : new Date(next.getTime() + r.int(30, 1200) * MIN);
          const tk: SimTask = { id: uuid(), type: kind, title: kind === 'CALLBACK' ? 'Callback requested' : kind === 'DEMO' ? 'Demo reminder' : 'Follow-up call', due, createdAt: after, priority };
          tasks.push(tk);
          prevTask = tk;
          return next;
        };
        const move = (to: string, newCat: typeof cat, at: Date, source: SimHist['source'], callId?: string, reason?: string) => {
          hist.push({ at, from: status, to, cat: newCat, source, byUser: true, callId, reason });
          status = to; cat = newCat; lastActivity = at;
        };

        // no-answer attempts before the first real conversation
        const noAns = fate === 'EARLY' ? r.int(1, 4) : r.int(0, 2);
        for (let k = 0; k < noAns && !stopped; k++) {
          if (t > NOW) { stopped = true; break; }
          const c = doCall(r.weighted([['NO_ANSWER', 6], ['BUSY', 2], ['SWITCHED_OFF', 2]] as const), t);
          if (k === 0) move('CONTACT_ATTEMPTED', 'OPEN', t, 'CALL', c.id);
          t = followUp(t, c.outcome === 'BUSY' ? 'CALLBACK' : 'FOLLOW_UP', 0.5 * DAY, 2 * DAY);
        }
        const connectedPath: string[] = fate === 'EARLY' ? (noAns >= 1 && r.chance(0.4) ? [] : ['CONNECTED'])
          : fate === 'MID' ? ['CONNECTED', 'QUALIFIED', ...r.pick([[], ['WEBINAR_REGISTERED'], ['WEBINAR_REGISTERED', 'WEBINAR_ATTENDED'], ['DEMO_SCHEDULED']] as string[][])]
          : fate === 'LOST' ? ['CONNECTED', ...(r.chance(0.5) ? ['QUALIFIED'] : []), 'LOST']
          : fate === 'NURTURE' ? ['CONNECTED', 'NURTURE']
          : ['CONNECTED', 'QUALIFIED', ...(r.chance(0.5) ? ['WEBINAR_REGISTERED', 'WEBINAR_ATTENDED'] : ['DEMO_SCHEDULED', 'DEMO_ATTENDED']), 'PROPOSAL_NEGOTIATION', ...(fate === 'WON' || r.chance(0.5) ? ['PAYMENT_PENDING'] : []), ...(fate === 'WON' ? ['WON'] : [])];

        let attendWebinar: EventRow | undefined;
        let attendDemo: EventRow | undefined;
        for (const step of connectedPath) {
          if (stopped) break;
          if (step === 'WEBINAR_ATTENDED' || step === 'DEMO_ATTENDED') {
            const ev = step === 'WEBINAR_ATTENDED' ? attendWebinar : attendDemo;
            if (!ev) break;
            const when = new Date(ev.startsAt.getTime() + 70 * MIN);
            if (when > NOW) break;
            const attended = sellable || r.chance(0.75);
            const row: Prisma.EventAttendanceCreateManyInput = { organizationId: org, eventId: ev.id, leadId, status: attended ? 'ATTENDED' : 'NO_SHOW', registeredAt: new Date(ev.startsAt.getTime() - 3 * DAY), joinedAt: attended ? ev.startsAt : null, durationMinutes: attended ? r.int(40, 85) : null, source: 'MANUAL', updatedById: exec.id };
            const prevIdx = AT.findIndex((a) => a.eventId === ev.id && a.leadId === leadId);
            if (prevIdx >= 0) AT[prevIdx] = row; else AT.push(row);
            if (!attended) { lastActivity = when; break; }
            move(step, 'OPEN', when, 'EVENT');
            t = followUp(when, 'FOLLOW_UP', 4 * HOUR, 1.2 * DAY);
            continue;
          }
          if (t > NOW) { stopped = true; break; }
          if (step === 'LOST') {
            lostReason = r.weighted([['PRICE', 30], ['NOT_INTERESTED', 25], ['BAD_TIMING', 15], ['COMPETITOR', 10], ['NOT_ELIGIBLE', 8], ['LANGUAGE_MISMATCH', 5], ['OTHER', 7]] as const);
            const c = doCall('LOST', t, { objection: lostReason === 'PRICE' ? 'PRICE' : lostReason === 'COMPETITOR' ? 'COMPETITOR' : lostReason === 'BAD_TIMING' ? 'TIMING' : 'OTHER' });
            move('LOST', 'LOST', t, 'CALL', c.id, lostReason);
            lostAt = t;
            break;
          }
          if (step === 'WON') {
            const c = doCall('WON', t);
            move('WON', 'WON', t, 'CALL', c.id);
            wonAt = t;
            break;
          }
          const hi = ['QUALIFIED', 'WEBINAR_REGISTERED', 'DEMO_SCHEDULED', 'PROPOSAL_NEGOTIATION', 'PAYMENT_PENDING'].includes(step);
          interest = hi ? r.weighted([['HIGH', 6], ['MEDIUM', 3], ['LOW', 1]] as const) : r.weighted([['HIGH', 3], ['MEDIUM', 4], ['LOW', 3]] as const);
          const objection = step === 'PROPOSAL_NEGOTIATION' ? r.weighted([['PRICE', 5], ['TIMING', 2], ['NEED_APPROVAL', 2], ['COMPETITOR', 1]] as const) : r.chance(0.2) ? r.pick(['PRICE', 'TIMING', 'TRUST', 'NO_TIME'] as const) : undefined;
          const c = doCall(step === 'PAYMENT_PENDING' && r.chance(0.4) ? 'CALLBACK' : 'CONNECTED', t, { interest, objection });
          move(step, step === 'NURTURE' ? 'NURTURE' : 'OPEN', t, 'CALL', c.id);
          if (step === 'WEBINAR_REGISTERED') {
            const ev = nextEvent('WEBINAR', new Date(t.getTime() + 2 * HOUR), null);
            if (ev) { attendWebinar = ev; AT.push({ organizationId: org, eventId: ev.id, leadId, status: 'REGISTERED', registeredAt: t, source: 'MANUAL', updatedById: exec.id }); }
          }
          if (step === 'DEMO_SCHEDULED') {
            const ev = nextEvent('DEMO', new Date(t.getTime() + 20 * HOUR), teamId);
            if (ev) { attendDemo = ev; AT.push({ organizationId: org, eventId: ev.id, leadId, status: 'REGISTERED', registeredAt: t, source: 'MANUAL', updatedById: exec.id }); }
          }
          const nextIdx = connectedPath.indexOf(step) + 1;
          const nextStep = connectedPath[nextIdx];
          if (nextStep === 'WEBINAR_ATTENDED' || nextStep === 'DEMO_ATTENDED') { prevTask = undefined; t = new Date(t.getTime() + DAY); continue; }
          if (step === 'NURTURE') { t = followUp(t, 'FOLLOW_UP', 15 * DAY, 30 * DAY); break; }
          t = followUp(t, c.outcome === 'CALLBACK' ? 'CALLBACK' : 'FOLLOW_UP', step === 'PAYMENT_PENDING' ? 0.6 * DAY : 0.8 * DAY, step === 'PROPOSAL_NEGOTIATION' ? 3 * DAY : 2.5 * DAY, step === 'PAYMENT_PENDING' || step === 'PROPOSAL_NEGOTIATION' ? 'HIGH' : 'NORMAL');
        }

        // open leads keep being worked until now (a small share goes dormant on purpose => overdue + exception queues are not empty)
        if (cat === 'OPEN' && !stopped) {
          const dormant = r.chance(0.07);
          for (let guard = 0; guard < 40 && t <= NOW; guard++) {
            if (dormant && t.getTime() - createdAt.getTime() > 6 * DAY) break;
            const outcome = r.weighted([['CONNECTED', 40], ['NO_ANSWER', 35], ['BUSY', 10], ['SWITCHED_OFF', 8], ['CALLBACK', 7]] as const);
            const warm = outcome === 'CONNECTED' || outcome === 'CALLBACK';
            const c = doCall(outcome, t, warm ? { interest: r.weighted([['HIGH', 3], ['MEDIUM', 4], ['LOW', 2]] as const), objection: r.chance(0.2) ? r.pick(['PRICE', 'TIMING', 'TRUST', 'NO_TIME'] as const) : undefined } : {});
            if (warm && (status === 'NEW' || status === 'CONTACT_ATTEMPTED')) move('CONNECTED', 'OPEN', t, 'CALL', c.id);
            else if (status === 'NEW') move('CONTACT_ATTEMPTED', 'OPEN', t, 'CALL', c.id);
            t = followUp(t, outcome === 'BUSY' || outcome === 'CALLBACK' ? 'CALLBACK' : 'FOLLOW_UP', 1.5 * DAY, 4.5 * DAY);
          }
        }

        // finalise tasks: an open lead must hold exactly one open next action; terminal leads hold none
        const terminal = cat === 'WON' || cat === 'LOST';
        if (terminal) {
          const dangling = tasks.filter((x) => !x.doneAt && x !== firstTask);
          for (const x of dangling) tasks.splice(tasks.indexOf(x), 1);
        } else {
          const openTask = tasks.find((x) => !x.doneAt);
          if (!openTask) {
            const due = new Date(Math.max(lastActivity.getTime() + 2 * HOUR, NOW.getTime() + r.int(2, 60) * HOUR));
            tasks.push({ id: uuid(), type: 'FOLLOW_UP', title: 'Follow-up call', due, createdAt: lastActivity, priority: 'NORMAL' });
          } else if (openTask.due < lastActivity) openTask.due = new Date(lastActivity.getTime() + 3 * HOUR);
          // a task that was due in the past while the lead was last touched long ago stays open => overdue queue (honest)
          const op = tasks.find((x) => !x.doneAt)!;
          if (op.due > NOW && op.due.getTime() - NOW.getTime() > 5 * DAY && status !== 'NURTURE') op.due = new Date(NOW.getTime() + r.int(2, 70) * HOUR);
        }
        if (firstTask && !firstTask.doneAt && calls[0]) { firstTask.doneAt = calls[0].at; calls[0].taskId = calls[0].taskId ?? firstTask.id; }

        // lead row
        const connectedCalls = calls.filter((c) => ['CONNECTED', 'CALLBACK', 'WON', 'LOST'].includes(c.outcome));
        const trailingOff = (() => { let n = 0; for (let i = calls.length - 1; i >= 0 && calls[i]!.outcome === 'SWITCHED_OFF'; i--) n++; return n; })();
        if (fate === 'WON' && wonAt) { eliteWon += programCode === 'MCA_ELITE_X' ? 1 : 0; }
        if (fate === 'WON' && !wonAt && programCode === 'MCA_ELITE_X') programCode = 'MCA_X';
        const price = PRICE[programCode];
        const estimatedValue = price ?? [0, 15000, 25000, 40000][r.int(0, 3)]!;
        const emailAddr = r.chance(0.55) ? `${first}.${last}${seq}@example.invalid`.toLowerCase() : null;
        L.push({
          id: leadId, organizationId: org, fullName, phoneE164: `+91${ph}`, phoneRaw: ph, phoneValid: true,
          email: emailAddr, emailNormalized: emailAddr,
          sourceId: src.id, programId: prog(programCode).id, assignedToId: exec.id, teamId, status, stageCategory: cat, interestLevel: interest,
          estimatedValue, wonValue: wonAt ? price : null, wonAt, lostReason, lostAt, lostNote: lostReason ? 'Closed by the executive after the conversation.' : null,
          preferredLanguage: r.weighted([['English', 5], ['Hindi', 4], ['Marathi', 2]] as const), isKeyProspect: programCode === 'MCA_ELITE_X' && cat === 'OPEN',
          consentStatus: r.chance(0.85) ? 'GRANTED' : 'UNKNOWN', consentAt: createdAt, consentSource: 'sample-data',
          lastActivityAt: lastActivity, lastContactAt: connectedCalls.at(-1)?.at ?? null, firstContactAt: calls[0]?.at ?? null,
          callAttemptCount: calls.length, noAnswerCount: calls.filter((c) => c.outcome === 'NO_ANSWER').length, consecutiveSwitchedOff: trailingOff,
          assignedAt: createdAt, createKey: `sample-m1:${seq}`, createdById: mgr.id, createdAt, updatedAt: lastActivity,
        });
        stat[exec.key]!.leads += 1;
        if (cat === 'WON' && wonAt) { stat[exec.key]!.won += 1; wonLeads.push({ leadId, exec, programCode, at: wonAt, n: seq }); }
        if (cat === 'LOST') stat[exec.key]!.lost += 1;
        if (cat === 'OPEN' && (status === 'PROPOSAL_NEGOTIATION' || status === 'PAYMENT_PENDING')) openDeals.push({ leadId, exec, programCode, stage: status === 'PAYMENT_PENDING' ? 'PAYMENT_PENDING' : 'NEGOTIATION', createdAt: hist.find((h) => h.to === 'PROPOSAL_NEGOTIATION')?.at ?? lastActivity });
        if (!terminal) openLeadIds.push(leadId);

        A.push({ organizationId: org, leadId, fromUserId: null, toUserId: exec.id, changedById: mgr.id, method: 'MANUAL', reason: 'Assigned by the manager', createdAt });
        for (const h of hist) H.push({ organizationId: org, leadId, oldStatus: h.from, newStatus: h.to, oldCategory: null, newCategory: h.cat, changedById: h.byUser ? exec.id : mgr.id, source: h.source, reason: h.reason ?? null, callLogId: h.callId ?? null, createdAt: h.at });
        for (const tk of tasks) {
          const done = !!tk.doneAt;
          if (done) { stat[exec.key]!.tasksDone += 1; if (tk.doneAt! <= tk.due) stat[exec.key]!.tasksOnTime += 1; }
          T.push({ id: tk.id, organizationId: org, leadId, assignedToId: exec.id, createdById: tk.title === 'First contact' ? mgr.id : exec.id, teamId, type: tk.type, title: tk.title, dueAt: tk.due, status: done ? 'DONE' : 'OPEN', priority: tk.priority, completedAt: tk.doneAt ?? null, completedById: done ? exec.id : null, createdAt: tk.createdAt, updatedAt: tk.doneAt ?? tk.createdAt });
        }
        for (const c of calls) {
          stat[exec.key]!.calls += 1;
          if (['CONNECTED', 'CALLBACK', 'WON', 'LOST'].includes(c.outcome)) stat[exec.key]!.connected += 1;
          C.push({ id: c.id, organizationId: org, leadId, userId: exec.id, source: 'MANUAL', direction: 'OUTBOUND', outcome: c.outcome, startedAt: c.at, durationSeconds: c.durationSeconds, notes: c.notes, interestLevel: c.interest ?? null, objectionCategory: (c.objection as never) ?? null, taskId: c.taskId ?? null, createdAt: c.at });
        }
        if (r.chance(0.3) && connectedCalls[0]) N.push({ organizationId: org, leadId, authorId: exec.id, body: connectedCalls[0].notes, visibility: 'SHARED', createdAt: connectedCalls[0].at });
      }
    }
  }

  // ---- write CRM rows ------------------------------------------------------------------------------------------------------
  const batch = async <T,>(rows: T[], fn: (chunk: T[]) => Promise<unknown>, size = 1000) => { for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size)); };
  await batch(evRows, (c) => prisma.crmEvent.createMany({ data: c }));
  await batch(L, (c) => prisma.lead.createMany({ data: c }));
  await batch(T, (c) => prisma.task.createMany({ data: c }));
  await batch(C, (c) => prisma.callLog.createMany({ data: c }));
  await batch(H, (c) => prisma.leadStatusHistory.createMany({ data: c }));
  await batch(A, (c) => prisma.leadAssignment.createMany({ data: c }));
  await batch(N, (c) => prisma.leadNote.createMany({ data: c }));
  await batch(AT, (c) => prisma.eventAttendance.createMany({ data: c, skipDuplicates: true }));

  // ---- deals, sales, payments, refunds -----------------------------------------------------------------------------------------
  const D: Prisma.DealCreateManyInput[] = [];
  const DH: Prisma.DealStatusHistoryCreateManyInput[] = [];
  const SR: Prisma.SalesRecordCreateManyInput[] = [];
  const SC: Prisma.SalesCreditCreateManyInput[] = [];
  const P: Prisma.PaymentCreateManyInput[] = [];
  const PE: Prisma.PaymentEventCreateManyInput[] = [];
  const RF: Prisma.RefundCreateManyInput[] = [];
  const RE: Prisma.RefundEventCreateManyInput[] = [];
  const BL: Prisma.DealBlockerCreateManyInput[] = [];
  const teamOf = (e: Person) => (ctx.managerOf(e.key).key === 'saurabh' ? ctx.team.saurabh : ctx.team.prachi);
  const money = (n: number) => n.toFixed(2);
  const wonDeals: Array<{ id: string; owner: Person; amount: number; paid: number; at: Date; verifiedAll: boolean }> = [];
  let dealN = 0;
  let overdueSeen = 0; // at least one instalment is overdue so the collections follow-up queue is not empty
  for (const w of wonLeads) {
    dealN += 1;
    const amount = PRICE[w.programCode]!;
    const dealId = uuid();
    const mgr = ctx.managerOf(w.exec.key);
    D.push({ id: dealId, organizationId: org, leadId: w.leadId, programId: prog(w.programCode).id, ownerId: w.exec.id, teamId: teamOf(w.exec), stage: 'WON', dealType: 'NEW', amount: money(amount), closedAt: w.at, note: 'Closed won', createKey: `sample-m1:deal:${dealN}`, createdById: w.exec.id, createdAt: new Date(w.at.getTime() - 5 * DAY) });
    DH.push({ organizationId: org, dealId, oldStage: null, newStage: 'OPEN', changedById: w.exec.id, reason: 'Deal opened', createdAt: new Date(w.at.getTime() - 5 * DAY) }, { organizationId: org, dealId, oldStage: 'OPEN', newStage: 'WON', changedById: w.exec.id, reason: 'Closed won', createdAt: w.at });
    const recId = uuid();
    SR.push({ id: recId, organizationId: org, dealId, leadId: w.leadId, programId: prog(w.programCode).id, dealType: 'NEW', saleValue: money(amount), closedAt: w.at, createdById: w.exec.id });
    SC.push({ salesRecordId: recId, organizationId: org, userId: w.exec.id, sharePct: '100.00', amount: allocate(money(amount), [{ key: w.exec.key, pct: '100' }])[0]!.amount.toFixed(2) });

    const split = r.chance(amount >= 149999 ? 0.7 : 0.35);
    const parts = split ? [Math.round(amount / 2), amount - Math.round(amount / 2)] : [amount];
    let paid = 0;
    let verifiedAll = true;
    const ageDays = (NOW.getTime() - w.at.getTime()) / DAY;
    parts.forEach((amt, k) => {
      const payId = uuid();
      const isSecond = k === 1;
      const dueAt = new Date(w.at.getTime() + 21 * DAY); // second instalment falls due three weeks after the sale
      const paidAt = isSecond ? new Date(Math.min(dueAt.getTime() - r.int(0, 4) * DAY, NOW.getTime() - HOUR)) : new Date(w.at.getTime() + r.int(0, 3) * HOUR);
      const dueStr = istDay(dueAt);
      let status: 'EXPECTED' | 'RECORDED' | 'VERIFIED' | 'RECONCILED';
      if (isSecond) status = dueAt > NOW ? 'EXPECTED' : overdueSeen === 0 || !r.chance(0.55) ? (overdueSeen++, 'EXPECTED') : 'VERIFIED';
      else status = ageDays < 3 ? 'RECORDED' : ageDays > 14 && r.chance(0.5) ? 'RECONCILED' : 'VERIFIED';
      const recorded = status !== 'EXPECTED';
      const verified = status === 'VERIFIED' || status === 'RECONCILED';
      if (verified) paid += amt; else verifiedAll = false;
      const verifiedAt = verified ? new Date(paidAt.getTime() + r.int(2, 20) * HOUR) : null;
      P.push({
        id: payId, organizationId: org, dealId, ownerId: w.exec.id, teamId: teamOf(w.exec), status, amount: money(amt), expectedAmount: status === 'EXPECTED' ? money(amt) : null, dueDate: isSecond ? dateOnly(dueStr) : null,
        method: recorded ? r.weighted([['UPI', 6], ['BANK_TRANSFER', 3], ['CARD', 1]] as const) : null, provider: 'MANUAL', externalTransactionRef: recorded ? `SMP-UTR-${dealId.slice(0, 8)}-${k + 1}` : null,
        paidAt: recorded ? paidAt : null, recordedById: recorded ? mgr.id : null, recordedAt: recorded ? paidAt : null, verifiedById: verified ? u.finance!.id : null, verifiedAt,
        reconciledById: status === 'RECONCILED' ? u.finance!.id : null, reconciledAt: status === 'RECONCILED' ? new Date(verifiedAt!.getTime() + 2 * DAY) : null, statementRef: status === 'RECONCILED' ? 'Bank statement match' : null, note: 'Payment', createdAt: w.at,
      });
      PE.push({ organizationId: org, paymentId: payId, fromStatus: null, toStatus: status === 'EXPECTED' ? 'EXPECTED' : 'RECORDED', actorId: status === 'EXPECTED' ? mgr.id : mgr.id, actorRole: 'SALES_MANAGER', reason: 'Recorded', createdAt: status === 'EXPECTED' ? w.at : paidAt });
      if (verified) PE.push({ organizationId: org, paymentId: payId, fromStatus: 'RECORDED', toStatus: 'VERIFIED', actorId: u.finance!.id, actorRole: 'FINANCE', reason: 'Matched with bank credit', createdAt: verifiedAt! });
      if (status === 'RECONCILED') PE.push({ organizationId: org, paymentId: payId, fromStatus: 'VERIFIED', toStatus: 'RECONCILED', actorId: u.finance!.id, actorRole: 'FINANCE', reason: 'Reconciled with statement', createdAt: new Date(verifiedAt!.getTime() + 2 * DAY) });
    });
    wonDeals.push({ id: dealId, owner: w.exec, amount, paid, at: w.at, verifiedAll });
  }

  // open pipeline (negotiation / payment pending)
  for (const o of openDeals) {
    dealN += 1;
    const dealId = uuid();
    const amount = PRICE[o.programCode] ?? 49999;
    const high = amount >= 300000;
    D.push({ id: dealId, organizationId: org, leadId: o.leadId, programId: prog(o.programCode).id, ownerId: o.exec.id, teamId: teamOf(o.exec), stage: o.stage, dealType: 'NEW', amount: money(amount), expectedCloseOn: dateOnly(istDay(new Date(NOW.getTime() + r.int(2, 12) * DAY))), isHighValue: high, highValueFlaggedAt: high ? NOW : null, highValueThreshold: high ? '300000.00' : null, escalationLevel: high ? 1 : 0, note: 'Open deal', createKey: `sample-m1:deal:${dealN}`, createdById: o.exec.id, createdAt: o.createdAt });
    DH.push({ organizationId: org, dealId, oldStage: null, newStage: 'OPEN', changedById: o.exec.id, reason: 'Deal opened', createdAt: o.createdAt });
    DH.push({ organizationId: org, dealId, oldStage: 'OPEN', newStage: o.stage, changedById: o.exec.id, reason: 'Stage updated', createdAt: new Date(o.createdAt.getTime() + HOUR) });
    if (high) BL.push({ organizationId: org, dealId, kind: 'HIGH_VALUE', note: 'Auto-flagged high value deal', raisedById: o.exec.id, escalatedToIds: [u.teamlead!.id] });
  }

  // refunds: one processed, one approved, one requested (never above verified collections)
  const eligible = wonDeals.filter((d) => d.verifiedAll && d.paid >= d.amount);
  const old = eligible.filter((d) => (NOW.getTime() - d.at.getTime()) / DAY > 12);
  const recent = eligible.filter((d) => (NOW.getTime() - d.at.getTime()) / DAY < 8);
  const refundPlan: Array<[typeof eligible[number] | undefined, 'PROCESSED' | 'APPROVED' | 'REQUESTED', number]> = [[old[0], 'PROCESSED', 5000], [old[3] ?? old[1], 'APPROVED', 7500], [recent[0], 'REQUESTED', 5000]];
  for (const [d, st, amt] of refundPlan) {
    if (!d) continue;
    const mgr = ctx.managerOf(d.owner.key);
    const reqAt = new Date(Math.min(d.at.getTime() + 4 * DAY, NOW.getTime() - 6 * HOUR));
    const refundId = uuid();
    RF.push({
      id: refundId, organizationId: org, dealId: d.id, ownerId: d.owner.id, teamId: teamOf(d.owner), status: st, amount: money(amt), approvedAmount: st === 'REQUESTED' ? null : money(amt), processedAmount: st === 'PROCESSED' ? money(amt) : null,
      reasonCategory: 'LEARNER_REQUEST', reason: 'Learner could not continue due to a schedule clash', requestedById: d.owner.id, requestedByRole: 'SALES_EXECUTIVE',
      approvedById: st === 'REQUESTED' ? null : u.founder!.id, approvedByRole: st === 'REQUESTED' ? null : 'FOUNDER_CEO', approvedAt: st === 'REQUESTED' ? null : new Date(reqAt.getTime() + DAY),
      reviewedById: st === 'REQUESTED' ? null : mgr.id, reviewedByRole: st === 'REQUESTED' ? null : 'SALES_MANAGER', reviewedAt: st === 'REQUESTED' ? null : new Date(reqAt.getTime() + 6 * HOUR), reviewNote: st === 'REQUESTED' ? null : 'Checked with the learner', recommendation: st === 'REQUESTED' ? null : 'APPROVE',
      processedById: st === 'PROCESSED' ? u.finance!.id : null, processedByRole: st === 'PROCESSED' ? 'FINANCE' : null, processedAt: st === 'PROCESSED' ? new Date(reqAt.getTime() + 2 * DAY) : null, processMethod: st === 'PROCESSED' ? 'BANK_TRANSFER' : null, externalRef: st === 'PROCESSED' ? `SMP-RFND-${d.id.slice(0, 8)}` : null, createdAt: reqAt,
    });
    RE.push({ organizationId: org, refundId, fromStatus: null, toStatus: 'REQUESTED', actorId: d.owner.id, actorRole: 'SALES_EXECUTIVE', reason: 'Learner requested a refund', createdAt: reqAt });
  }

  await batch(D, (c) => prisma.deal.createMany({ data: c }));
  await batch(DH, (c) => prisma.dealStatusHistory.createMany({ data: c }));
  await batch(BL, (c) => prisma.dealBlocker.createMany({ data: c }));
  await batch(SR, (c) => prisma.salesRecord.createMany({ data: c }));
  await batch(SC, (c) => prisma.salesCredit.createMany({ data: c }));
  await batch(P, (c) => prisma.payment.createMany({ data: c }));
  await batch(PE, (c) => prisma.paymentEvent.createMany({ data: c }));
  await batch(RF, (c) => prisma.refund.createMany({ data: c }));
  await batch(RE, (c) => prisma.refundEvent.createMany({ data: c }));

  // ---- targets: Founder -> Team Lead -> Managers -> Executives for September and October -------------------------------
  const plan: Array<{ type: 'MONTH' | 'QUARTER' | 'YEAR'; anchor: string; setOn: string; grow: number }> = [
    { type: 'MONTH', anchor: '2026-09-15', setOn: '2026-08-25', grow: 1 },
    { type: 'MONTH', anchor: today, setOn: '2026-09-26', grow: 1.25 }, // October target is 25% higher than September
    { type: 'QUARTER', anchor: today, setOn: '2026-09-26', grow: 4 }, // Q4 = Oct 20L + Nov 20L + Dec 24L
    { type: 'YEAR', anchor: today, setOn: '2026-03-25', grow: 15 }, // FY 2026-27
  ];
  for (const { type, anchor, setOn, grow } of plan) {
    const b = periodBounds(type, anchor);
    const period = await prisma.targetPeriod.create({ data: { organizationId: org, type, label: b.label, startsOn: dateOnly(b.startsOn), endsOn: dateOnly(b.endsOn), createdById: u.founder!.id } });
    const mk = async (metric: 'REVENUE' | 'COLLECTION' | 'ENROLMENT', level: 'FOUNDER' | 'TEAM_LEAD' | 'MANAGER' | 'EXECUTIVE', owner: Person, amount: string, parentId: string | null) => {
      const t = await prisma.target.create({ data: { organizationId: org, periodId: period.id, metric, level, ownerUserId: owner.id, parentId, amount, originalAmount: amount, note: 'Monthly target', createdById: u.founder!.id, createdAt: new Date(setOn) } });
      await prisma.targetRevision.create({ data: { organizationId: org, targetId: t.id, seq: 0, oldAmount: null, newAmount: amount, reason: 'Initial monthly target', status: 'APPROVED', effectiveFrom: period.startsOn, proposedById: u.founder!.id, decidedById: u.founder!.id, decidedAt: new Date(setOn) } });
      return t;
    };
    // September weights per executive (rupees in lakh / enrolments); managers and the org target are the sums so the tree always adds up
    const W: Record<string, [number, number]> = { monica: [2.5, 3], sushma: [2.5, 3], sarika: [1.5, 2], iyyanar: [1.5, 2], rajat: [4, 3], simran: [4, 3] };
    for (const [metric, scale] of [['REVENUE', 1], ['COLLECTION', 0.8], ['ENROLMENT', 0]] as const) {
      const amt = (k: string) => (metric === 'ENROLMENT' ? Math.round(W[k]![1] * grow) : W[k]![0] * 100000 * grow * scale);
      const f = (n: number) => (metric === 'ENROLMENT' ? String(n) : n.toFixed(2));
      const sum = (keys: string[]) => keys.reduce((t, k) => t + amt(k), 0);
      const sKeys = ['monica', 'sushma', 'sarika', 'iyyanar'];
      const pKeys = ['rajat', 'simran'];
      const root = await mk(metric, 'FOUNDER', u.founder!, f(sum([...sKeys, ...pKeys])), null);
      const tl = await mk(metric, 'TEAM_LEAD', u.teamlead!, f(sum([...sKeys, ...pKeys])), root.id);
      const mS = await mk(metric, 'MANAGER', u.saurabh!, f(sum(sKeys)), tl.id);
      const mP = await mk(metric, 'MANAGER', u.prachi!, f(sum(pKeys)), tl.id);
      for (const k of sKeys) await mk(metric, 'EXECUTIVE', u[k]!, f(amt(k)), mS.id);
      for (const k of pKeys) await mk(metric, 'EXECUTIVE', u[k]!, f(amt(k)), mP.id);
    }
  }

  // ---- forecast (an ESTIMATE) for the current month -----------------------------------------------------------------------------
  const fb = forecastBounds('MONTH', today);
  const fkey = { organizationId: org, periodType: 'MONTH' as const, periodStart: dateOnly(fb.startsOn), scopeKey: 'ORG' };
  const forecast = await prisma.forecast.create({ data: { ...fkey, periodEnd: dateOnly(fb.endsOn), method: FORECAST_METHOD, params: {}, createdById: u.teamlead!.id } });
  const openD = await prisma.deal.findMany({ where: { organizationId: org, stage: { in: ['OPEN', 'NEGOTIATION', 'PAYMENT_PENDING'] } }, include: { lead: { select: { status: true } } } });
  const wonSum = await prisma.salesRecord.aggregate({ where: { organizationId: org, closedAt: { gte: dateOnly(fb.startsOn) } }, _sum: { saleValue: true } });
  const fr = stageWeightedForecast({ periodStart: fb.startsOn, periodEnd: fb.endsOn, asOf: today, bookedToDate: wonSum._sum.saleValue ?? 0n, deals: openD.map((d) => ({ id: d.id, ownerId: d.ownerId, amount: d.amount, stage: d.stage, leadStatus: d.lead.status, expectedCloseOn: d.expectedCloseOn ? d.expectedCloseOn.toISOString().slice(0, 10) : null })) });
  await prisma.forecastSnapshot.create({ data: { organizationId: org, forecastId: forecast.id, kind: 'PERIOD_START', takenById: u.teamlead!.id, total: fr.total, bookedToDate: fr.bookedToDate, weightedPipeline: fr.weightedPipeline, unweightedPipeline: fr.unweightedPipeline, breakdown: { byStage: fr.byStage, byOwner: fr.byOwner, unscheduled: fr.unscheduled, overdue: fr.overdue } as unknown as Prisma.InputJsonValue, inputs: { method: FORECAST_METHOD, asOf: today, sample: true } } });

  // ---- let the CRM engine derive next-action + exceptions for every open lead -----------------------------------------------------
  for (const id of openLeadIds) await prisma.$transaction(async (tx) => { await syncLeadNextAction(tx, id); await syncLeadExceptions(tx, id); }, { timeout: 30_000 });

  return {
    leadIdsOpen: openLeadIds,
    summary: { leads: L.length, calls: C.length, tasks: T.length, events: evRows.length, attendance: AT.length, deals: D.length, won: wonDeals.length, openDeals: openDeals.length, payments: P.length, refunds: RF.length, perExec: stat, wonByExec: Object.fromEntries(execs.map((e) => [e.key, wonDeals.filter((d) => d.owner.key === e.key).reduce((s, d) => s + d.amount, 0)])) },
  };
}
