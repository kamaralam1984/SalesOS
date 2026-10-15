# Monitoring, logging and alerting

Status: implemented in code and tested by Agent L2 (see docs/reliability-evidence-l2.md). Alert thresholds below are PROPOSED defaults; tune them after two weeks of real traffic. No monitoring stack (Prometheus/Grafana/Alertmanager/Sentry server) is bundled or deployed by this repository: the endpoints, log format and rules here are what such a stack consumes.

## 1. Health and readiness
| Endpoint | Purpose | Behaviour |
|---|---|---|
| `GET /api/v1/health` | liveness (orchestrator restarts on failure) | 200 while the process serves HTTP; checks nothing external |
| `GET /api/v1/ready` (alias `/health/ready`) | readiness (load balancer removes the instance) | 200 only when PostgreSQL and Redis answer (3 s / 2 s timeouts); 503 with `details: {database, redis, worker}` otherwise. Also returns `worker: {status: ok|stale|unknown, instances, lastHeartbeatAgeSeconds}` (informational: a stopped worker does NOT make the API unready, background work queues in the outbox) |
| Worker `GET :WORKER_HEALTH_PORT/health` and `/ready` | optional, off unless `WORKER_HEALTH_PORT` is set; bind to the internal network only | `/ready` = DB + Redis reachable and heartbeat recent |
| Worker heartbeat | Redis key `<BULLMQ_PREFIX>:worker:heartbeat:<pid-id>`, refreshed every `WORKER_HEARTBEAT_MS` (10 s), TTL 30 s | surfaced by the API `/ready` and `/metrics`; disappears within 30 s of a crash or `kill -9` |

Verified behaviour (tests): Redis down -> API keeps serving login and authenticated reads, `/ready` 503; DB down -> `/health` 200, `/ready` 503, data calls fail with the error envelope (no hang), automatic recovery when the DB returns.

## 2. Metrics (`GET /metrics`, Prometheus text format 0.0.4)
Served at the root (not under `/api/v1`). Access: `Authorization: Bearer $METRICS_TOKEN` when the variable is set (min 16 chars); without a token it is **404 in production** and loopback-only elsewhere. The reverse proxy must not publish it (the nginx example returns 404 for `/metrics` on the public server block); scrape it over the internal network/loopback.

| Metric | Type | Meaning |
|---|---|---|
| `salesos_http_requests_total{method,route,status}` | counter | requests; `route` is the route template (low cardinality), `unmatched` for 404s |
| `salesos_http_request_duration_seconds{method,route}` | histogram | latency buckets 5 ms - 10 s |
| `salesos_http_requests_in_flight` | gauge | open requests |
| `salesos_dependency_up{dependency="database"|"redis"}` | gauge | 1/0 at scrape time |
| `salesos_outbox_pending`, `salesos_outbox_dead`, `salesos_outbox_oldest_pending_seconds` | gauge | outbox backlog / dead events / age of oldest due event |
| `salesos_worker_instances`, `salesos_worker_heartbeat_age_seconds` | gauge | live worker heartbeats; -1 = none |
| `salesos_process_*` | gauge | uptime, RSS, heap used, CPU seconds |

## 3. Structured logs
JSON, one object per line on stdout (pino). Collect with the platform log driver (docker `json-file`/journald) and ship to your log store. Fields:
- API: `level` (30 info, 40 warn, 50 error), `time` (epoch ms), `service` (`salesos-api`), `req.id` (= `x-request-id`, also returned to the client in the header and in `meta.requestId` of every envelope), `req.method`, `req.url` (path only, query strings are never logged), `res.statusCode`, `responseTime` (ms).
- Worker: `service: salesos-worker`, `eventId`, `type`, `attempt`, `err`.
- Redacted: cookies, authorization, CSRF header, `set-cookie`, `password`, `token`, `secret`, email `link`/`variables`.
- Correlate a user report: take the `requestId` from the error toast/response -> search `req.id`.

## 4. Error monitoring (optional, Sentry-compatible)
Set `SENTRY_DSN` (API and worker; no DSN is committed), optionally `SENTRY_ENVIRONMENT` and `RELEASE`. Unhandled 5xx errors, unhandled rejections and exhausted worker jobs are reported through a small built-in client (legacy store endpoint, 3 s timeout, failures swallowed). Only error name/message/stack, route template, status, request id, release and environment are sent: no bodies, headers, cookies, query strings or user identifiers. Empty/unset = disabled. To use the full `@sentry/node` SDK later, replace `common/observability/error-reporter.ts` (same interface).

## 5. Alert rules (examples, Prometheus syntax; PROPOSED thresholds)
```yaml
groups:
- name: salesos
  rules:
  - alert: SalesOSApiDown
    expr: up{job="salesos-api"} == 0
    for: 2m
    labels: {severity: page}
    annotations: {summary: "API unreachable / /metrics scrape failing"}
  - alert: SalesOSDependencyDown
    expr: salesos_dependency_up == 0
    for: 2m
    labels: {severity: page}
    annotations: {summary: "{{ $labels.dependency }} unreachable from the API"}
  - alert: SalesOSHigh5xxRate
    expr: sum(rate(salesos_http_requests_total{status=~"5.."}[5m])) / sum(rate(salesos_http_requests_total[5m])) > 0.02
    for: 10m
    labels: {severity: page}
  - alert: SalesOSSlowP95
    expr: histogram_quantile(0.95, sum by (le) (rate(salesos_http_request_duration_seconds_bucket[5m]))) > 1
    for: 15m
    labels: {severity: ticket}
    annotations: {summary: "p95 > 1 s (budget in docs/performance-budgets.md)"}
  - alert: SalesOSWorkerStopped
    expr: salesos_worker_heartbeat_age_seconds < 0 or salesos_worker_heartbeat_age_seconds > 60
    for: 3m
    labels: {severity: page}
    annotations: {summary: "No live worker: reminders, escalations, notifications are queueing in the outbox"}
  - alert: SalesOSOutboxBacklog
    expr: salesos_outbox_oldest_pending_seconds > 300
    for: 5m
    labels: {severity: page}
  - alert: SalesOSDeadEvents
    expr: salesos_outbox_dead > 0
    for: 15m
    labels: {severity: ticket}
    annotations: {summary: "Dead outbox events need replay (Admin > Failed jobs)"}
  - alert: SalesOSLoginFailureSpike
    expr: sum(rate(salesos_http_requests_total{route="/api/v1/auth/login",status="401"}[5m])) > 2
    for: 10m
    labels: {severity: ticket}
    annotations: {summary: "Possible credential stuffing; check lockouts and rate limiting"}
```
Host-level (node exporter / provider): disk > 80 %, memory > 90 %, Postgres connections > 80 % of `max_connections`, certificate expiry < 14 days, **backup job did not produce a verified dump in 26 h** (check the newest `*.dump.sha256` age) and "restore drill older than 100 days".

## 6. Dashboards (suggested panels)
Request rate and 5xx ratio; p50/p95/p99 per route; in-flight; dependency up; outbox pending/oldest/dead; worker heartbeat age; process RSS/CPU; login failures; backup age; DB size/connections (from the DB exporter).

## 7. What is NOT done
No external uptime probe, pager integration, log store, or APM is configured (needs hosting decision DEC-040). Metrics are per process (in-memory); with several API replicas Prometheus scrapes each. Business KPIs are intentionally not exported as metrics (they live in the KPI layer).
