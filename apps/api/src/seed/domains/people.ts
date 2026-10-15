import type { SeedContext } from './types';
import { DEFAULT_COMPETENCIES } from '../../modules/people/performance/competencies';
import { ensureSopGuards } from '../../modules/sop/sop-guards';

/** people + SOP demo data. Owned by the people agent. Every record is labelled [DEMO]; safe to re-run. */
export async function seedPeople(ctx: SeedContext): Promise<void> {
  const { prisma, organizationId: orgId, userIds } = ctx;
  const id = (k: string) => userIds.get(k);
  const founder = id('founder');
  const teamlead = id('teamlead');
  const hr = id('hr');
  if (!founder || !teamlead || !hr) return; // demo users not present
  await ensureSopGuards(prisma);
  const today = new Date(new Date().toISOString().slice(0, 10));

  // Competency framework (JD key competencies)
  await prisma.reviewRubric.createMany({
    data: DEFAULT_COMPETENCIES.map((c, i) => ({ organizationId: orgId, key: c.key, name: c.name, description: c.description, indicators: c.indicators, sortOrder: i })),
    skipDuplicates: true,
  });

  // KPI / KRA definitions (reference the KPI dictionary; values are computed by the analytics phase)
  const kpis: Array<[string, string, 'KPI' | 'KRA', string, string]> = [
    ['revenue-achievement', 'Monthly revenue achievement (%)', 'KPI', '%', 'revenue.achievement_pct'],
    ['lead-conversion', 'Lead conversion %', 'KPI', '%', 'sales.lead_conversion_pct'],
    ['calls-completed', 'Calls completed', 'KPI', 'count', 'productivity.calls_completed'],
    ['followups-completed', 'Follow-ups completed', 'KPI', 'count', 'productivity.followups_completed'],
    ['crm-compliance', 'CRM compliance', 'KPI', '%', 'productivity.crm_compliance_pct'],
    ['sop-adoption', 'SOP adoption rate', 'KPI', '%', 'process.sop_adoption_pct'],
    ['coaching-hours', 'Coaching hours conducted', 'KPI', 'hours', 'team.coaching_hours'],
    ['pipeline-hygiene', 'Keep every lead attended and ageing monitored', 'KRA', '', ''],
    ['team-development', 'Develop Sales Managers and a second line of leaders', 'KRA', '', ''],
  ];
  for (const [key, name, kind, unit, dict] of kpis) {
    await prisma.kpiDefinition.upsert({ where: { organizationId_key: { organizationId: orgId, key } }, update: {}, create: { organizationId: orgId, key, name: `[DEMO] ${name}`, kind, unit: unit || null, dictionaryKey: dict || null } });
  }

  // SOPs: approved v1 each, plus a gap backlog
  const sops: Array<[string, string, string, string[]]> = [
    ['LEAD_HANDLING', 'Lead handling and first response', 'Respond to every new lead within the agreed window, log the first contact in the CRM, and qualify before booking a demo.', ['crm', 'response-time']],
    ['FOLLOW_UP_CADENCE', 'Follow-up cadence', 'Follow-ups are scheduled in the CRM at every touch; no lead is left without a next action.', ['follow-up']],
    ['WEBINAR_DEMO', 'Webinar and demo process', 'Confirm attendance, run the demo using the standard flow, and record the outcome the same day.', ['webinar', 'demo']],
    ['OBJECTION_HANDLING', 'Objection handling playbook', 'Acknowledge, clarify, respond with learner outcomes, and confirm resolution before moving on.', ['objections']],
    ['CLOSING_NEGOTIATION', 'Closing and negotiation', 'Summarise value, present the offer, handle price discussion within approved discount limits, and agree the payment step.', ['closing', 'negotiation']],
    ['HANDOVER_STUDENT_SUCCESS', 'Handover to Student Success', 'After payment, complete the handover note so Student Success can start the learner without re-asking basics.', ['handover']],
    ['WHATSAPP_TEMPLATE', 'WhatsApp communication templates', 'Use approved templates and keep the tone consistent; log important conversations in the CRM.', ['whatsapp']],
  ];
  for (const [category, title, body, tags] of sops) {
    const t = `[DEMO] ${title}`;
    const exists = await prisma.sopDocument.findFirst({ where: { organizationId: orgId, title: t } });
    if (exists) continue;
    const doc = await prisma.sopDocument.create({
      data: { organizationId: orgId, category: category as 'OTHER', title: t, summary: '[DEMO] sample playbook content for demonstration only.', ownerId: teamlead, isMandatory: true, audienceRoles: ['SALES_MANAGER', 'SALES_EXECUTIVE'], tags, createdById: teamlead },
    });
    const v = await prisma.sopVersion.create({
      data: { organizationId: orgId, documentId: doc.id, versionNumber: 1, title: t, body: `# ${t}\n\n[DEMO] ${body}\n\n## Steps\n1. Follow the process described above.\n2. Record the outcome in the CRM.\n3. Escalate blockers to your manager.\n`, changeSummary: 'Initial version', effectiveDate: today, status: 'APPROVED', createdById: teamlead, submittedAt: new Date(), approvedById: founder, approvedAt: new Date() },
    });
    // a couple of acknowledgements so adoption views show real (demo) data
    for (const k of ['manager.a', 'exec.a1', 'exec.a2']) {
      const uid = id(k);
      if (uid) await prisma.sopAcknowledgement.create({ data: { organizationId: orgId, versionId: v.id, documentId: doc.id, userId: uid } }).catch(() => undefined);
    }
  }
  if ((await prisma.processGap.count({ where: { organizationId: orgId } })) === 0) {
    await prisma.processGap.createMany({
      data: [
        { organizationId: orgId, kind: 'AUTOMATION', title: '[DEMO] Auto-create follow-up task after demo no-show', description: 'Currently created manually.', ownerId: teamlead, reportedById: teamlead, priority: 2 },
        { organizationId: orgId, kind: 'PROCESS_GAP', title: '[DEMO] No standard script for refund-risk conversations', ownerId: teamlead, reportedById: teamlead, priority: 3 },
      ],
    });
  }

  // Recognition programs
  for (const [key, name, kind] of [['top-performer', 'Top performer of the month', 'TOP_PERFORMER'], ['ownership-award', 'Ownership award', 'CULTURE'], ['learner-hero', 'Learner success hero', 'CULTURE']] as const) {
    await prisma.recognitionProgram.upsert({ where: { organizationId_key: { organizationId: orgId, key } }, update: {}, create: { organizationId: orgId, key, name: `[DEMO] ${name}`, kind, createdById: founder } });
  }

  // Incentive policy: structure only. [DEMO], DRAFT, zero rates: the Founder supplies real values (DEC-015).
  if ((await prisma.incentivePolicy.count({ where: { organizationId: orgId } })) === 0) {
    await prisma.incentivePolicy.create({
      data: {
        organizationId: orgId, versionNumber: 1, name: '[DEMO] Incentive policy structure (not approved, no real rates)', status: 'DRAFT', createdById: founder,
        notes: '[DEMO] Placeholder structure only. All rates are 0 until the Founder supplies and approves real values (DEC-015).',
        structure: { basis: 'COLLECTION', periodType: 'MONTH', slabMode: 'FLAT_ON_TOTAL', netOfRefunds: true, slabs: [{ minPct: 0, maxPct: 100, ratePct: 0 }, { minPct: 100, maxPct: null, ratePct: 0 }], gates: [], cap: null, clawbackWindowDays: 30, currency: 'INR' },
      },
    });
  }

  // Hiring criteria for the Sales Team Lead role (taken from the JD; editable in the UI)
  await prisma.hiringRoleProfile.upsert({
    where: { organizationId_roleKey: { organizationId: orgId, roleKey: 'SALES_TEAM_LEAD' } },
    update: { additionalCriteria: ['Proven track record of consistently achieving revenue targets', 'Experience working directly with Founders or senior leadership (preferred)'] },
    create: {
      organizationId: orgId, roleKey: 'SALES_TEAM_LEAD', title: 'Sales Team Lead', minEducation: "Bachelor's degree in Business, Marketing, Commerce, Management or a related discipline", preferredEducation: 'MBA preferred, not mandatory',
      minExperienceYears: 8, maxExperienceYears: 10, minTeamMgmtYears: 3, preferredIndustries: ['Coaching', 'Education', 'EdTech', 'Training'],
      requiredBackgrounds: ['Inside Sales', 'Counselling', 'Admissions', 'Sales Management'],
      additionalCriteria: ['Proven track record of consistently achieving revenue targets', 'Experience working directly with Founders or senior leadership (preferred)'], competencyKeys: DEFAULT_COMPETENCIES.map((c) => c.key), notes: 'From the Job Description; configurable.',
    },
  });

  // Onboarding templates + expectations
  if ((await prisma.onboardingTemplate.count({ where: { organizationId: orgId } })) === 0) {
    await prisma.onboardingTemplate.createMany({
      data: ['SALES_EXECUTIVE', 'SALES_MANAGER'].map((roleKey) => ({
        organizationId: orgId, roleKey, name: `[DEMO] ${roleKey === 'SALES_EXECUTIVE' ? 'Sales Executive' : 'Sales Manager'} onboarding`, probationDays: [30, 60, 90],
        items: [
          { title: 'CRM access and tool setup (Google Workspace, CRM)', category: 'TOOLS', dueDay: 2 },
          { title: 'Read and acknowledge all mandatory SOPs', category: 'ONBOARDING', dueDay: 5 },
          { title: 'Complete product and program training', category: 'TRAINING', dueDay: 10 },
          { title: 'Shadow three live calls', category: 'TRAINING', dueDay: 14 },
          { title: 'Meet the team and cross-functional contacts', category: 'CULTURE', dueDay: 7 },
        ],
      })),
    });
  }
  if ((await prisma.roleExpectation.count({ where: { organizationId: orgId } })) === 0) {
    await prisma.roleExpectation.createMany({
      data: [
        { organizationId: orgId, roleKey: 'SALES_EXECUTIVE', kind: 'OWNERSHIP', title: 'Own every lead you touch', body: 'No lead is left unattended; every conversation ends with a recorded next step.', createdById: founder },
        { organizationId: orgId, roleKey: 'SALES_MANAGER', kind: 'ACCOUNTABILITY', title: 'Accountable for team results', body: 'Review the team pipeline daily, coach weekly, and raise risks early with proposed solutions.', createdById: founder },
        { organizationId: orgId, roleKey: 'SALES_TEAM_LEAD', kind: 'ACCOUNTABILITY', title: 'Single point of accountability for sales', body: 'Own revenue, collection and enrolment targets and report to the Founder regularly.', createdById: founder },
      ],
    });
  }

  // Skills library (JD required skills) + one pulse survey
  if ((await prisma.resource.count({ where: { organizationId: orgId } })) === 0) {
    const skills: Array<[string, string[]]> = [
      ['Consultative selling fundamentals', ['consultative-selling']], ['Closing techniques', ['closing']], ['Revenue planning', ['revenue-planning']], ['Negotiation essentials', ['negotiation']],
      ['Objection handling drills', ['objection-handling']], ['Pipeline management', ['pipeline']], ['Forecasting basics', ['forecasting']], ['Sales strategy', ['strategy']],
      ['Coaching and mentoring', ['leadership', 'coaching']], ['Conflict resolution and influencing', ['leadership']], ['Presentation and written communication', ['communication']],
      ['CRM best practices', ['crm']], ['Google Workspace for sales teams', ['google-workspace']], ['Excel for sales reporting', ['excel']], ['Reading sales dashboards', ['dashboards']],
    ];
    await prisma.resource.createMany({ data: skills.map(([title, skillTags]) => ({ organizationId: orgId, title: `[DEMO] ${title}`, description: '[DEMO] placeholder entry; attach real material via the file service or a link.', type: 'ARTICLE' as const, skillTags, createdById: hr })) });
  }
  if ((await prisma.engagementSurvey.count({ where: { organizationId: orgId } })) === 0) {
    await prisma.engagementSurvey.create({
      data: { organizationId: orgId, title: '[DEMO] Monthly pulse', createdById: hr, questions: [{ id: 'q1', text: 'I understand what is expected of me this month.', type: 'SCALE_5' }, { id: 'q2', text: 'I get the coaching I need to improve.', type: 'SCALE_5' }, { id: 'q3', text: 'What one thing would help most?', type: 'TEXT' }] },
    });
  }

  // Coaching: one session + one 1:1 so the log is not empty in demo
  const m = id('manager.a');
  const e1 = id('exec.a1');
  if (m && e1 && (await prisma.coachingSession.count({ where: { organizationId: orgId } })) === 0) {
    await prisma.coachingSession.create({
      data: {
        organizationId: orgId, coachId: m, kind: 'COACHING', sessionDate: new Date(), durationMin: 45, topics: ['OBJECTION_HANDLING', 'CALL_QUALITY'], notes: '[DEMO] Reviewed two recorded calls and practised price objections.', noteVisibility: 'PARTICIPANTS', createdById: m,
        participants: { create: [{ userId: e1, organizationId: orgId }] }, actions: { create: [{ organizationId: orgId, ownerId: e1, title: '[DEMO] Practise the price-objection script on 5 calls', dueDate: new Date(Date.now() + 7 * 86_400_000), createdById: m }] },
      },
    });
    await prisma.oneOnOne.create({ data: { organizationId: orgId, managerId: m, employeeId: e1, status: 'HELD', scheduledFor: new Date(), durationMin: 30, agenda: '[DEMO] Weekly 1:1', sharedNotes: '[DEMO] Discussed weekly targets.', createdById: m } });
  }
}
