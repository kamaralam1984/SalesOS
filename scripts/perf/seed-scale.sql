-- Scale-up seed for load tests: adds anonymised leads/calls/tasks/deals/payments to an already demo-seeded DB (org = the demo org).
-- Usage: psql -v leads=55000 -v calls=220000 -v tasks=110000 -d <perf db> -f seed-scale.sql   (NEVER run against real data)
\set ON_ERROR_STOP on
CREATE TEMP TABLE _ctx AS SELECT (SELECT id FROM organizations ORDER BY "createdAt" LIMIT 1) AS org;
CREATE TEMP TABLE _execs AS SELECT u.id, row_number() OVER (ORDER BY u.email) - 1 AS n FROM users u JOIN user_role_assignments a ON a.user_id = u.id JOIN roles r ON r.id = a.role_id WHERE r.key = 'SALES_EXECUTIVE';
CREATE TEMP TABLE _progs AS SELECT id, row_number() OVER (ORDER BY code) - 1 AS n FROM programs;
CREATE TEMP TABLE _srcs AS SELECT id, row_number() OVER (ORDER BY name) - 1 AS n FROM lead_sources;
CREATE TEMP TABLE _newleads (id uuid, rn int);
WITH ins AS (
  INSERT INTO leads (id, organization_id, full_name, phone_e164, phone_raw, phone_valid, source_id, program_id, assigned_to_id, status, stage_category, next_action_at, won_value, won_at, lost_reason, last_activity_at, first_contact_at, assigned_at, created_at, updated_at, call_attempt_count, version)
  SELECT gen_random_uuid(), c.org, 'Perf Lead ' || lpad(g::text, 7, '0'), '+9170' || lpad(g::text, 8, '0'), '70' || lpad(g::text, 8, '0'), true,
         (SELECT id FROM _srcs WHERE n = g % (SELECT count(*) FROM _srcs)), (SELECT id FROM _progs WHERE n = g % (SELECT count(*) FROM _progs)),
         CASE WHEN g % 33 = 0 THEN NULL ELSE (SELECT id FROM _execs WHERE n = g % (SELECT count(*) FROM _execs)) END,
         CASE WHEN r < 0.12 THEN 'WON' WHEN r < 0.27 THEN 'LOST' ELSE (ARRAY['NEW','CONTACT_ATTEMPTED','CONNECTED','DEMO_ATTENDED'])[1 + (g % 4)] END,
         CASE WHEN r < 0.12 THEN 'WON'::"StageCategory" WHEN r < 0.27 THEN 'LOST'::"StageCategory" ELSE 'OPEN'::"StageCategory" END,
         CASE WHEN g % 3 = 0 THEN now() + ((g % 10) - 4) * interval '1 day' ELSE NULL END,
         CASE WHEN r < 0.12 THEN 25000 ELSE NULL END, CASE WHEN r < 0.12 THEN created + (g % 40) * interval '1 day' ELSE NULL END,
         CASE WHEN r >= 0.12 AND r < 0.27 THEN (ARRAY['PRICE','NO_RESPONSE','NOT_ELIGIBLE','BAD_TIMING'])[1 + (g % 4)] ELSE NULL END,
         now() - (g % 20) * interval '1 day', created + interval '30 minutes', created, created, created, 2, 1
  FROM _ctx c, (SELECT g, random() AS r, now() - (g % 180) * interval '1 day' - (g % 1440) * interval '1 minute' AS created FROM generate_series(1, :leads) g) s
  RETURNING id)
INSERT INTO _newleads SELECT id, row_number() OVER ()::int FROM ins;
INSERT INTO call_logs (id, organization_id, lead_id, user_id, source, direction, outcome, started_at, duration_seconds, created_at)
SELECT gen_random_uuid(), c.org, l.id, coalesce(l.assigned_to_id, (SELECT id FROM _execs WHERE n = 0)), 'MANUAL', 'OUTBOUND',
       (ARRAY['CONNECTED','NO_ANSWER','NO_ANSWER','BUSY','SWITCHED_OFF','CALLBACK','FAILED','CONNECTED'])[1 + (s.g % 8)]::"CallOutcome",
       l.created_at + (s.g % 30) * interval '1 day' + (s.g % 600) * interval '1 minute', 30 + s.g % 300, l.created_at
FROM _ctx c, (SELECT g, 1 + floor(random() * :leads)::int AS pick FROM generate_series(1, :calls) g) s
JOIN (SELECT n.rn, n.id, x.assigned_to_id, x.created_at FROM _newleads n JOIN leads x ON x.id = n.id) l ON l.rn = s.pick;
INSERT INTO tasks (id, organization_id, lead_id, assigned_to_id, type, title, due_at, status, completed_at, priority, created_at, updated_at)
SELECT gen_random_uuid(), c.org, l.id, coalesce(l.assigned_to_id, (SELECT id FROM _execs WHERE n = 0)), (ARRAY['FOLLOW_UP','CALLBACK','CALL','DEMO','EMAIL'])[1 + (s.g % 5)]::"TaskType", 'Follow up',
       l.created_at + (s.g % 120) * interval '1 day', CASE WHEN s.g % 4 = 0 THEN 'OPEN' ELSE 'DONE' END::"TaskStatus", CASE WHEN s.g % 4 = 0 THEN NULL ELSE l.created_at + (s.g % 120) * interval '1 day' END, 'NORMAL', l.created_at, l.created_at
FROM _ctx c, (SELECT g, 1 + floor(random() * :leads)::int AS pick FROM generate_series(1, :tasks) g) s
JOIN (SELECT n.rn, n.id, x.assigned_to_id, x.created_at FROM _newleads n JOIN leads x ON x.id = n.id) l ON l.rn = s.pick;
INSERT INTO deals (id, organization_id, lead_id, program_id, owner_id, stage, deal_type, amount, closed_at, created_by_id, created_at, updated_at, enrolments, version)
SELECT gen_random_uuid(), c.org, l.id, l.program_id, l.assigned_to_id, 'WON', 'NEW', 25000, l.won_at, l.assigned_to_id, l.created_at, l.created_at, 1, 1
FROM _ctx c, leads l JOIN _newleads n ON n.id = l.id WHERE l.stage_category = 'WON' AND l.assigned_to_id IS NOT NULL AND l.program_id IS NOT NULL;
INSERT INTO sales_records (id, organization_id, deal_id, lead_id, program_id, deal_type, sale_value, enrolments, closed_at, created_by_id)
SELECT gen_random_uuid(), d.organization_id, d.id, d.lead_id, d.program_id, 'NEW', 25000, 1, d.closed_at, d.owner_id FROM deals d JOIN _newleads n ON n.id = d.lead_id;
INSERT INTO sales_credits (id, sales_record_id, organization_id, user_id, share_pct, amount)
SELECT gen_random_uuid(), s.id, s.organization_id, d.owner_id, 100, 25000 FROM sales_records s JOIN deals d ON d.id = s.deal_id JOIN _newleads n ON n.id = d.lead_id;
INSERT INTO payments (id, organization_id, deal_id, owner_id, status, amount, provider, external_transaction_ref, verified_at, created_at, updated_at, version)
SELECT gen_random_uuid(), d.organization_id, d.id, d.owner_id, CASE WHEN random() < 0.1 THEN 'RECORDED' ELSE 'VERIFIED' END::"PaymentStatus", 25000, 'MANUAL', gen_random_uuid()::text, d.closed_at + interval '2 days', d.closed_at, d.closed_at, 1
FROM deals d JOIN _newleads n ON n.id = d.lead_id;
ANALYZE;
SELECT (SELECT count(*) FROM leads) leads, (SELECT count(*) FROM call_logs) calls, (SELECT count(*) FROM tasks) tasks, (SELECT count(*) FROM deals) deals, (SELECT count(*) FROM payments) payments;
