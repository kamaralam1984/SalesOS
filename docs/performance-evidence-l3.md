# Performance evidence (fork L3)

## Reproduce
1. `docker exec salesos-postgres psql -U salesos -c 'CREATE DATABASE salesos_agentl_perf'`; `prisma migrate deploy`; `NODE_ENV=development pnpm db:seed` (demo seed).
2. `docker exec -i salesos-postgres psql -U salesos -d salesos_agentl_perf -v leads=55000 -v calls=220000 -v tasks=110000 < scripts/perf/seed-scale.sql` (took 3 m 25 s on the loaded host). Result: 55,054 leads, 220,015 calls, 110,038 tasks, 6,420 deals, 6,417 payments.
3. Build the API (`tsc -p tsconfig.build.json --outDir dist-l3`), run `node dist-l3/main.js` on 4412 with relaxed throttles (THROTTLE_LIMIT/LOGIN_LIMIT/LOGIN_MAX_ATTEMPTS) and `DATABASE_URL` quoted (the `&` in `connection_limit=` otherwise backgrounds the shell line).
4. `API=http://127.0.0.1:4412/api/v1 DURATION=10 CONC=10 node scripts/perf/load.mjs [scenario,...]`.

## Run history (honest record)
- Run 1 (pre-fix, pool 9): lead list 40 rps p50 231-242 ms; dashboard-exec: 11 requests/12 s, p50 13.1 s (stampede); founder dashboard p50 4.4 s. First script version mis-parsed lead ids (400s), fixed.
- Full pass (pre-fix of calls bug): create-call 12 requests, p50 10.6 s, 33 % HTTP 500; API log: Prisma P2024 (pool timeout).
- Pool experiments (same build): connection_limit=25: 124 calls, 0 errors; limit 9: conc 4 and 8 fine (0 errors), conc 12 -> 16 % errors, p95 11 s. pg_stat_activity during conc 12: 7-8 of 9 connections `idle in transaction`, last statement `SELECT ... FROM leads` (inside the tx), i.e. the Node side was waiting on the pool for a non-tx query: `CrmSupport.managerOf` called from `calls.service.ts:214` inside `logTx`.
- After fix, pool 9: conc 12 -> 138 req, 0 errors, p50 698 ms; conc 24 -> 150 req, 0 errors, p50 1.44 s.

## EXPLAIN (ANALYZE, BUFFERS) excerpts
Exceptions/risk aggregate (org-wide, 55k leads), before:
```
Aggregate (actual time=264..264) Buffers: shared hit=82028
  Seq Scan on leads l (rows=55054) Buffers: hit=1836
  SubPlan 1: Index Only Scan using tasks_lead_id_status_idx on tasks t (loops=26729) Buffers: hit=80192
Execution Time: 335 ms
```
After (LEFT JOIN (SELECT DISTINCT lead_id FROM tasks WHERE status='OPEN') ot): Hash Left Join, Execution Time 119 ms.

Per-user task aggregate (exec scope): Bitmap Heap Scan via tasks_organization_id_assigned_to_id_status_due_at_idx, 12,208 rows scanned, 1,611 kept, 13.2 ms. With experimental indexes (dropped again): BitmapOr of two index scans, 5.3 ms.
Org-wide task aggregate: Parallel Seq Scan, 35 ms (95 ms uncached); indexes do not help (selectivity).
Org-wide calls in a 30-day window: Bitmap Index Scan on call_logs_org_started_idx, 32,236 rows, 53 ms. Per user: call_logs_org_user_started_idx, 3,802 rows, 6 ms.
Under concurrent load the same statements logged 135-750 ms in postgres (log_min_duration_statement), i.e. latency is dominated by host contention and per-request statement volume (~306 statements incl. parse/bind, 135 executes for a cold executive dashboard), not by missing indexes.

## Not tested / not done
- No run on an idle or production-sized host; no multi-instance API test; no worker under load; no soak test; SSE under load not tested.
- Web performance numbers (Lighthouse) are unreliable (see budgets file); no RUM.
- No automated regression test for the pool-starvation bug.
- A static scan found no other `this.prisma` use lexically inside `$transaction(async ...)` / `.tx(async ...)` callbacks, but helper functions called from transactions were not audited.
- Production-mode (NODE_ENV=production) API was not load tested.
