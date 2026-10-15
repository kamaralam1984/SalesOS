import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOrgFixture, createOrg, createUser, createTestApp, loginAgent, type AuthedAgent, type OrgFixture, type TestApp } from '../helpers';

/** Area C: payroll register against a REAL Postgres (salesos_agentc_test). Aug 2026 has 26 working days (Mon-Sat, no holidays). */
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const P = '/workforce/payroll';
const UUID = '11111111-1111-4111-8111-111111111111';

let t: TestApp;
let fx: OrgFixture;
let founder: AuthedAgent, hr: AuthedAgent, finance: AuthedAgent, admin: AuthedAgent, a1: AuthedAgent, a2: AuthedAgent, mgr: AuthedAgent, b1: AuthedAgent, other: AuthedAgent;
let otherOrgUserId: string;
let otherHr: AuthedAgent;

async function fillMonth(userId: string, month: string, opts: { from?: string; except?: Record<string, 'ABSENT' | 'HALF_DAY' | 'UNPAID_LEAVE'> } = {}) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const rows = [];
  for (let d = 1; d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); d++) {
    const s = `${month}-${String(d).padStart(2, '0')}`;
    if (day(s).getUTCDay() === 0) continue; // Sunday = weekly off
    if (opts.from && s < opts.from) continue;
    rows.push({ organizationId: fx.org.id, userId, date: day(s), status: opts.except?.[s] ?? ('PRESENT' as const), source: 'SYSTEM' as const });
  }
  await t.prisma.attendanceRecord.createMany({ data: rows });
}
const structure = (userId: string, effectiveFrom: string, basic: string, extra: object[] = []) => ({
  userId,
  effectiveFrom,
  currency: 'INR',
  components: [{ key: 'BASIC', name: 'Basic', kind: 'EARNING', amount: basic }, ...extra],
  note: 'test',
});
const pf = { key: 'PF', name: 'Provident fund (manual)', kind: 'DEDUCTION', amount: '1000.00' };

beforeAll(async () => {
  t = await createTestApp();
  fx = await buildOrgFixture(t.prisma);
  [founder, hr, finance, admin, a1, a2, mgr, b1] = await Promise.all([fx.founder, fx.hr, fx.finance, fx.admin, fx.execA1, fx.execA2, fx.managerA, fx.execB1].map((u) => loginAgent(t.app, u)));
  const org2 = await createOrg(t.prisma);
  const f2 = await createUser(t.prisma, org2, { roles: ['FOUNDER_CEO'] });
  otherOrgUserId = f2.id;
  other = await loginAgent(t.app, f2);
  otherHr = await loginAgent(t.app, await createUser(t.prisma, org2, { roles: ['HR'] }));
  for (const [u, join] of [[fx.execA1, '2020-01-01'], [fx.execA2, '2026-08-17'], [fx.execB1, '2020-01-01']] as const) {
    await t.prisma.employeeProfile.create({ data: { organizationId: fx.org.id, userId: u.id, joinDate: day(join), employeeCode: `E-${u.id.slice(0, 6)}` } });
  }
  await fillMonth(fx.execA1.id, '2026-08', { except: { '2026-08-05': 'ABSENT' } });
  await fillMonth(fx.execA2.id, '2026-08', { from: '2026-08-17' });
  await fillMonth(fx.execA1.id, '2026-09');
  await fillMonth(fx.execA2.id, '2026-09');
});
afterAll(async () => { await t.close(); });

describe('salary structures (append-only, validated, Finance/HR only)', () => {
  it('validates money and shape strictly (400)', async () => {
    const bad = [
      structure(fx.execA1.id, '2026-01-01', '1000.123'),
      structure(fx.execA1.id, '2026-01-01', '0'),
      structure(fx.execA1.id, '2026-01-01', '-5'),
      { ...structure(fx.execA1.id, '2026-01-01', '1000'), components: [{ key: 'BASIC', name: 'x', kind: 'EARNING', amount: 1000 }] }, // JSON number refused
      { ...structure(fx.execA1.id, '2026-01-01', '1000'), components: [{ key: 'basic', name: 'x', kind: 'EARNING', amount: '10.00' }] },
      { ...structure(fx.execA1.id, '2026-01-01', '1000'), components: [{ key: 'PF', name: 'x', kind: 'DEDUCTION', amount: '10.00' }] }, // no earning
      { ...structure(fx.execA1.id, '2026-01-01', '1000'), components: [{ key: 'A', name: 'x', kind: 'EARNING', amount: '10.00' }, { key: 'A', name: 'y', kind: 'EARNING', amount: '10.00' }] },
      { ...structure(fx.execA1.id, '2026-02-30', '1000') },
      { ...structure(fx.execA1.id, '2026-01-01', '1000'), currency: 'rupee' },
    ];
    for (const b of bad) {
      const r = await finance.post(`${P}/structures`).send(b);
      expect(r.status, JSON.stringify(b)).toBe(400);
    }
  });

  it('creates versions, refuses a duplicate effective date, other-org employees are 404', async () => {
    const r = await finance.post(`${P}/structures`).send(structure(fx.execA1.id, '2026-01-01', '26000.00', [pf]));
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ userId: fx.execA1.id, effectiveFrom: '2026-01-01', currency: 'INR', monthlyEarnings: '26000.00', monthlyDeductions: '1000.00' });
    expect((await hr.post(`${P}/structures`).send(structure(fx.execA2.id, '2026-01-01', '26000.00'))).status).toBe(201);
    const dup = await finance.post(`${P}/structures`).send(structure(fx.execA1.id, '2026-01-01', '99999.00'));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('STRUCTURE_VERSION_EXISTS');
    expect((await finance.post(`${P}/structures`).send(structure(otherOrgUserId, '2026-01-01', '100.00'))).status).toBe(404);
    // a newer version for September
    expect((await finance.post(`${P}/structures`).send(structure(fx.execA1.id, '2026-09-01', '30000.00', [pf]))).status).toBe(201);
  });

  it('versions cannot be updated or deleted, even by SQL (append-only trigger)', async () => {
    await expect(t.prisma.salaryStructure.updateMany({ where: { userId: fx.execA1.id }, data: { note: 'tamper' } })).rejects.toThrow();
    await expect(t.prisma.salaryStructure.deleteMany({ where: { userId: fx.execA1.id } })).rejects.toThrow();
  });

  it('lists current structures and history; reads are limited to Founder/Finance/HR', async () => {
    const list = await hr.get(`${P}/structures?limit=100`);
    expect(list.status).toBe(200);
    const mine = list.body.data.find((x: { userId: string }) => x.userId === fx.execA1.id);
    expect(mine.current.effectiveFrom).toBe('2026-09-01'); // newest version effective on or before today (2026-10-15)
    expect(mine.upcomingVersions).toBe(0);
    const hist = await founder.get(`${P}/structures/${fx.execA1.id}`);
    expect(hist.body.data.versions.map((v: { effectiveFrom: string }) => v.effectiveFrom)).toEqual(['2026-09-01', '2026-01-01']);
    for (const who of [admin, mgr, a1]) expect((await who.get(`${P}/structures`)).status).toBe(403);
    expect((await a1.get(`${P}/structures/${fx.execA1.id}`)).status).toBe(403);
    expect((await finance.get(`${P}/structures/${UUID}`)).status).toBe(404);
    expect((await finance.get(`${P}/structures?limit=101`)).status).toBe(400);
  });

  it('no salary data in audit metadata', async () => {
    const rows = await t.prisma.auditLog.findMany({ where: { organizationId: fx.org.id, action: 'payroll.structure_created' } });
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toMatch(/26000|30000|1000\.00/);
  });
});

describe('payroll run lifecycle (August 2026)', () => {
  let runId: string;
  let slipA1: string;
  let slipA2: string;
  let adjId: string;

  it('a run for a month that has not ended can be created but never calculated (MONTH_NOT_ENDED)', async () => {
    const r = await finance.post(`${P}/runs`).send({ month: '2026-10' });
    expect(r.status).toBe(201);
    const c = await finance.post(`${P}/runs/${r.body.data.id}/calculate`).send({});
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe('MONTH_NOT_CLOSED');
    expect(c.body.error.details.reason).toBe('MONTH_NOT_ENDED');
    expect((await finance.post(`${P}/runs/${r.body.data.id}/cancel`).send({ reason: 'test cleanup' })).status).toBe(200);
  });

  it('validates the month and refuses a second live run for the same month', async () => {
    for (const month of ['2026-13', '26-08', '2026-8', '']) expect((await finance.post(`${P}/runs`).send({ month })).status).toBe(400);
    const r = await hr.post(`${P}/runs`).send({ month: '2026-08', note: 'August' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ month: '2026-08', status: 'DRAFT', monthWorkingDays: 26, statutoryDeductionsCalculated: false });
    runId = r.body.data.id;
    const dup = await finance.post(`${P}/runs`).send({ month: '2026-08' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('RUN_EXISTS');
  });

  it('refuses to calculate while a closed day has no attendance record or approved leave, listing the gaps', async () => {
    const gone = await t.prisma.attendanceRecord.findFirstOrThrow({ where: { userId: fx.execA1.id, date: day('2026-08-06') } });
    await t.prisma.attendanceRecord.delete({ where: { id: gone.id } });
    const c = await finance.post(`${P}/runs/${runId}/calculate`).send({});
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe('MONTH_NOT_CLOSED');
    expect(c.body.error.details.reason).toBe('DAYS_NOT_CLOSED');
    expect(c.body.error.details.employees[0]).toMatchObject({ userId: fx.execA1.id, days: ['2026-08-06'] });
    expect((await t.prisma.payslip.count({ where: { runId } }))).toBe(0); // nothing half-written
    expect((await t.prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe('DRAFT');
    await t.prisma.attendanceRecord.create({ data: { organizationId: fx.org.id, userId: fx.execA1.id, date: day('2026-08-06'), status: 'PRESENT', source: 'HR' } });
  });

  it('export / approve / pay are refused before calculation', async () => {
    expect((await hr.get(`${P}/runs/${runId}/export`)).status).toBe(409);
    const ap = await founder.post(`${P}/runs/${runId}/approve`).send({});
    expect(ap.status).toBe(409);
    expect(ap.body.error.code).toBe('INVALID_TRANSITION');
    expect((await finance.post(`${P}/runs/${runId}/mark-paid`).send({ reference: 'UTR-1234' })).status).toBe(409);
  });

  it('calculates exact Decimal payslips from CLOSED attendance only; employees without a structure get none', async () => {
    const c = await finance.post(`${P}/runs/${runId}/calculate`).send({});
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    const run = c.body.data;
    expect(run.status).toBe('CALCULATED');
    expect(run.payslips).toHaveLength(2);
    const s1 = run.payslips.find((s: { userId: string }) => s.userId === fx.execA1.id);
    const s2 = run.payslips.find((s: { userId: string }) => s.userId === fx.execA2.id);
    slipA1 = s1.id; slipA2 = s2.id;
    expect(s1).toMatchObject({ workingDays: 26, paidDays: '25.00', lossOfPayDays: '1.00', gross: '25000.00', totalDeductions: '961.54', net: '24038.46', currency: 'INR' });
    expect(s1.basis.lopDays).toEqual([{ date: '2026-08-05', fraction: '1.00', reason: 'ABSENT' }]);
    expect(s2).toMatchObject({ workingDays: 13, paidDays: '13.00', lossOfPayDays: '0.00', gross: '13000.00', net: '13000.00' });
    expect(s2.basis.employedFrom).toBe('2026-08-17');
    expect(run.payslips.some((s: { userId: string }) => s.userId === fx.execB1.id)).toBe(false);
    expect(run.totals).toEqual([{ currency: 'INR', gross: '38000.00', deductions: '961.54', adjustments: '0.00', net: '37038.46' }]);
    expect(JSON.stringify(run.payslips)).not.toMatch(/\bPF\b.*ESI|TDS/);
  });

  it('the run is visible only to Founder/Finance/HR; payslip reads are IDOR-safe', async () => {
    for (const who of [admin, mgr, a1, b1]) {
      expect((await who.get(`${P}/runs`)).status).toBe(403);
      expect((await who.get(`${P}/runs/${runId}`)).status).toBe(403);
    }
    expect((await other.get(`${P}/runs/${runId}`)).status).toBe(404);
    expect((await otherHr.post(`${P}/runs/${runId}/calculate`).send({})).status).toBe(404);
    expect((await finance.get(`${P}/runs/${UUID}`)).status).toBe(404);
    const list = await founder.get(`${P}/runs?limit=1`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1); // bounded page
    const all = await founder.get(`${P}/runs?status=CALCULATED`);
    expect(all.body.data.find((r: { month: string }) => r.month === '2026-08')).toMatchObject({ payslipCount: 2 });
    expect((await founder.get(`${P}/runs?status=NOPE`)).status).toBe(400);
    // before approval the employee sees nothing
    expect((await a1.get(`${P}/payslips/mine`)).body.data).toEqual([]);
    expect((await a1.get(`${P}/payslips/${slipA1}`)).status).toBe(404);
  });

  it('adjustments: validated, audited, bounded by non-negative net, recorded with who/why; removal recalculates', async () => {
    const url = `${P}/runs/${runId}/payslips/${slipA1}/adjustments`;
    for (const b of [{ label: 'x', kind: 'EARNING', amount: '1.234', reason: 'because' }, { label: 'x', kind: 'EARNING', amount: '0', reason: 'because' }, { label: 'x', kind: 'EARNING', amount: '10', reason: '' }, { label: 'x', kind: 'OTHER', amount: '10', reason: 'because' }]) {
      expect((await finance.post(url).send(b)).status).toBe(400);
    }
    const add = await finance.post(url).send({ label: 'Arrears', kind: 'EARNING', amount: '500.10', reason: 'July arrears' });
    expect(add.status).toBe(201);
    expect(add.body.data).toMatchObject({ gross: '25000.00', adjustmentsNet: '500.10', net: '24538.56' });
    adjId = add.body.data.adjustments[0].id;
    const tooBig = await finance.post(url).send({ label: 'Recovery', kind: 'DEDUCTION', amount: '999999.00', reason: 'too much' });
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.error.code).toBe('NEGATIVE_NET');
    expect((await finance.post(`${P}/runs/${runId}/payslips/${UUID}/adjustments`).send({ label: 'x', kind: 'EARNING', amount: '1', reason: 'foreign' })).status).toBe(404);
    // a slip of another run/org is not addressable through this run
    expect((await otherHr.post(url).send({ label: 'x', kind: 'EARNING', amount: '1', reason: 'foreign' })).status).toBe(404);
    const audit = await t.prisma.auditLog.findMany({ where: { organizationId: fx.org.id, action: 'payroll.adjustment_added' } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]!.metadata)).not.toMatch(/500/);
    const rem = await finance.delete(`${url}/${adjId}`);
    expect(rem.status).toBe(200);
    expect(rem.body.data).toMatchObject({ adjustmentsNet: '0.00', net: '24038.46' });
    expect((await finance.delete(`${url}/${adjId}`)).status).toBe(404);
    // keep one adjustment so the approval carries it
    const again = await finance.post(url).send({ label: 'Arrears', kind: 'EARNING', amount: '500.10', reason: 'July arrears' });
    expect(again.status).toBe(201);
  });

  it('recalculation (CALCULATED -> CALCULATED) re-reads attendance and keeps manual adjustments', async () => {
    await t.prisma.attendanceRecord.update({ where: { userId_date: { userId: fx.execA1.id, date: day('2026-08-07') } }, data: { status: 'UNPAID_LEAVE' } });
    const c = await hr.post(`${P}/runs/${runId}/calculate`).send({});
    expect(c.status).toBe(200);
    const s1 = c.body.data.payslips.find((s: { userId: string }) => s.userId === fx.execA1.id);
    expect(s1).toMatchObject({ lossOfPayDays: '2.00', paidDays: '24.00', gross: '24000.00', adjustmentsNet: '500.10', net: '23577.02' });
    await t.prisma.attendanceRecord.update({ where: { userId_date: { userId: fx.execA1.id, date: day('2026-08-07') } }, data: { status: 'PRESENT' } });
    const back = await hr.post(`${P}/runs/${runId}/calculate`).send({});
    expect(back.body.data.payslips.find((s: { userId: string }) => s.userId === fx.execA1.id)).toMatchObject({ gross: '25000.00', net: '24538.56' });
  });

  it('separation of duties: the preparer cannot approve; only the Founder holds the key', async () => {
    for (const who of [finance, hr, admin, mgr]) expect((await who.post(`${P}/runs/${runId}/approve`).send({})).status).toBe(403);
    await t.prisma.payrollRun.update({ where: { id: runId }, data: { createdById: fx.founder.id } });
    const sod = await founder.post(`${P}/runs/${runId}/approve`).send({});
    expect(sod.status).toBe(403);
    expect(sod.body.error.code).toBe('SEPARATION_OF_DUTIES');
    await t.prisma.payrollRun.update({ where: { id: runId }, data: { createdById: fx.finance.id } });
    expect((await t.prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe('CALCULATED');
  });

  it('a payslip with negative net pay blocks approval', async () => {
    await t.prisma.$executeRaw`UPDATE payslips SET net = -1 WHERE id = ${slipA2}::uuid`;
    const ap = await founder.post(`${P}/runs/${runId}/approve`).send({});
    expect(ap.status).toBe(422);
    expect(ap.body.error.code).toBe('NEGATIVE_NET');
    expect((await hr.post(`${P}/runs/${runId}/calculate`).send({})).status).toBe(200); // recalculation restores the figure
    expect((await t.prisma.payslip.findUniqueOrThrow({ where: { id: slipA2 } })).net.toFixed(2)).toBe('13000.00');
  });

  it('approve -> employees see only their own payslip; manager/admin/peers get 404; run is locked', async () => {
    const ap = await founder.post(`${P}/runs/${runId}/approve`).send({});
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    expect(ap.body.data).toMatchObject({ status: 'APPROVED', approved: { id: fx.founder.id } });
    const mine = await a1.get(`${P}/payslips/mine`);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({ id: slipA1, net: '24538.56', month: '2026-08', runStatus: 'APPROVED' });
    const one = await a1.get(`${P}/payslips/${slipA1}`);
    expect(one.status).toBe(200);
    expect(one.body.data.userName).toBe(fx.execA1.name);
    expect(one.body.data.organizationName).toContain('[TEST]');
    for (const who of [a2, mgr, admin, b1, other]) expect((await who.get(`${P}/payslips/${slipA1}`)).status).toBe(404);
    expect((await a2.get(`${P}/payslips/${slipA2}`)).status).toBe(200);
    expect((await hr.get(`${P}/payslips/${slipA1}`)).status).toBe(200);
    expect((await b1.get(`${P}/payslips/mine`)).body.data).toEqual([]);
    expect((await a1.get(`${P}/payslips/not-a-uuid`)).status).toBe(400);
    // locked
    const url = `${P}/runs/${runId}/payslips/${slipA1}/adjustments`;
    expect((await finance.post(url).send({ label: 'Late', kind: 'EARNING', amount: '1.00', reason: 'too late' })).body.error.code).toBe('RUN_LOCKED');
    expect((await finance.post(`${P}/runs/${runId}/calculate`).send({})).status).toBe(409);
    expect((await founder.post(`${P}/runs/${runId}/approve`).send({})).status).toBe(409);
  });

  it('a structure version may not be back-dated into an approved month', async () => {
    const r = await finance.post(`${P}/structures`).send(structure(fx.execA1.id, '2026-08-15', '50000.00'));
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('STRUCTURE_BACKDATED');
  });

  it('send-back returns the run to DRAFT with a reason and hides the payslips from employees again', async () => {
    expect((await founder.post(`${P}/runs/${runId}/send-back`).send({ reason: 'x' })).status).toBe(400);
    const sb = await founder.post(`${P}/runs/${runId}/send-back`).send({ reason: 'Check July arrears' });
    expect(sb.status).toBe(200);
    expect(sb.body.data.status).toBe('DRAFT');
    expect(sb.body.data.approved).toBeNull();
    expect((await a1.get(`${P}/payslips/${slipA1}`)).status).toBe(404);
    expect((await a1.get(`${P}/payslips/mine`)).body.data).toEqual([]);
    expect((await finance.post(`${P}/runs/${runId}/calculate`).send({})).status).toBe(200);
    expect((await founder.post(`${P}/runs/${runId}/approve`).send({})).status).toBe(200);
  });

  it('mark-paid needs Finance + a reference, records the external payout once, and then everything is final', async () => {
    expect((await hr.post(`${P}/runs/${runId}/mark-paid`).send({ reference: 'UTR-12345' })).status).toBe(403);
    expect((await finance.post(`${P}/runs/${runId}/mark-paid`).send({})).status).toBe(400);
    expect((await finance.post(`${P}/runs/${runId}/mark-paid`).send({ reference: 'ab' })).status).toBe(400);
    const paid = await finance.post(`${P}/runs/${runId}/mark-paid`).send({ reference: 'UTR-12345' });
    expect(paid.status).toBe(200);
    expect(paid.body.data).toMatchObject({ status: 'PAID', paymentReference: 'UTR-12345', paid: { id: fx.finance.id } });
    expect((await finance.post(`${P}/runs/${runId}/mark-paid`).send({ reference: 'UTR-99999' })).status).toBe(409);
    expect((await hr.post(`${P}/runs/${runId}/cancel`).send({ reason: 'too late' })).status).toBe(409);
    expect((await founder.post(`${P}/runs/${runId}/send-back`).send({ reason: 'too late' })).status).toBe(409);
    expect((await a1.get(`${P}/payslips/mine`)).body.data[0].runStatus).toBe('PAID');
  });

  it('concurrent approvals cannot both win (row lock + compare-and-set)', async () => {
    const r = await finance.post(`${P}/runs`).send({ month: '2026-09' });
    const id = r.body.data.id;
    expect((await finance.post(`${P}/runs/${id}/calculate`).send({})).status).toBe(200);
    // September uses the newer 30000 structure for execA1 (versioning by effective date)
    const run = await hr.get(`${P}/runs/${id}`);
    expect(run.body.data.payslips.find((s: { userId: string }) => s.userId === fx.execA1.id)).toMatchObject({ gross: '30000.00', paidDays: '26.00' });
    const results = await Promise.all([founder.post(`${P}/runs/${id}/approve`).send({}), founder.post(`${P}/runs/${id}/approve`).send({})]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(await t.prisma.payrollRun.findUniqueOrThrow({ where: { id } }).then((x) => x.version)).toBeGreaterThan(0);
    expect((await founder.post(`${P}/runs/${id}/cancel`).send({ reason: 'cancel in test' })).status).toBe(403);
    expect((await hr.post(`${P}/runs/${id}/cancel`).send({ reason: 'cancel in test' })).status).toBe(200);
    // a cancelled month is re-opened as a fresh DRAFT
    const re = await finance.post(`${P}/runs`).send({ month: '2026-09' });
    expect(re.status).toBe(201);
    expect(re.body.data.status).toBe('DRAFT');
    expect(re.body.data.id).toBe(id);
    expect(await t.prisma.payslip.count({ where: { runId: id } })).toBe(0);
  });

  it('every transition is audited and published to the outbox, without amounts', async () => {
    const audit = await t.prisma.auditLog.findMany({ where: { organizationId: fx.org.id, entityType: 'payroll_run' } });
    const actions = new Set(audit.map((a) => a.action));
    for (const a of ['payroll.run_created', 'payroll.run_calculated', 'payroll.run_approved', 'payroll.run_sent_back', 'payroll.run_paid', 'payroll.run_cancelled', 'payroll.adjustment_added', 'payroll.adjustment_removed']) expect(actions.has(a), a).toBe(true);
    expect(JSON.stringify(audit.map((a) => a.metadata))).not.toMatch(/24538|25000|38000|gross|net/i);
    const events = await t.prisma.outboxEvent.findMany({ where: { organizationId: fx.org.id, aggregateType: 'payroll_run' } });
    expect(new Set(events.map((e) => e.eventType))).toContain('payroll.calculated');
    expect(new Set(events.map((e) => e.eventType))).toContain('payroll.approved');
    expect(new Set(events.map((e) => e.eventType))).toContain('payroll.paid');
    expect(JSON.stringify(events.map((e) => e.payload))).not.toMatch(/24538|25000|38000/);
  });

  it('payslip rows cannot be reached across organisations, and amounts never leak into notifications', async () => {
    const n = await t.prisma.outboxEvent.findMany({ where: { organizationId: fx.org.id, eventType: 'notification.requested' } });
    expect(JSON.stringify(n.map((e) => e.payload))).not.toMatch(/\d{4,}\.\d{2}/);
  });
});

describe('audited CSV export', () => {
  it('exports the register for Founder/Finance/HR only, audited, formula-injection safe', async () => {
    await t.prisma.user.update({ where: { id: fx.execA2.id }, data: { name: '=HYPERLINK("http://evil.example","x")' } });
    const run = await t.prisma.payrollRun.findFirstOrThrow({ where: { organizationId: fx.org.id, month: '2026-08' } });
    for (const who of [a1, mgr, admin]) expect((await who.get(`${P}/runs/${run.id}/export?format=csv`)).status).toBe(403);
    expect((await other.get(`${P}/runs/${run.id}/export`)).status).toBe(404);
    expect((await hr.get(`${P}/runs/${run.id}/export?format=xlsx`)).status).toBe(400);
    const before = await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'export.created', entityType: 'payroll_run' } });
    const res = await hr.get(`${P}/runs/${run.id}/export?format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('payroll-2026-08.csv');
    expect(res.headers['cache-control']).toBe('no-store');
    const text = res.text;
    expect(text).toContain('Employee,Employee code,Month');
    expect(text).toContain('25000.00');
    expect(text).toContain('24538.56');
    expect(text).toContain('UTR-12345');
    expect(text).toContain(`"'=HYPERLINK(""http://evil.example"",""x"")"`);
    expect(text).not.toMatch(/(^|\n)=/);
    expect(await t.prisma.auditLog.count({ where: { organizationId: fx.org.id, action: 'export.created', entityType: 'payroll_run' } })).toBe(before + 1);
    const log = await t.prisma.auditLog.findFirstOrThrow({ where: { organizationId: fx.org.id, action: 'export.created', entityType: 'payroll_run' }, orderBy: { createdAt: 'desc' } });
    expect(log.metadata).toMatchObject({ kind: 'payroll_register', format: 'csv', month: '2026-08', rows: 2 });
  });
});

describe('Admin has no payroll data (DEC-032)', () => {
  it('Admin is refused on every payroll key route and sees no payslips of others', async () => {
    for (const [m, p] of [['get', '/structures'], ['get', '/runs'], ['get', '/runs/' + UUID]] as const) expect((await admin[m](`${P}${p}`)).status).toBe(403);
    expect((await admin.post(`${P}/runs`).send({ month: '2026-08' })).status).toBe(403);
    expect((await admin.get(`${P}/payslips/mine`)).body.data).toEqual([]);
  });
});
