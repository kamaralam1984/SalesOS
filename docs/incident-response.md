# Incident response

Status: v1 draft. Owner names/phone numbers are placeholders to be filled by the business owner (not invented here).

## 1. Roles
| Role | Who (fill in) | Duty |
|---|---|---|
| Incident commander (IC) | Ops lead | owns the incident, decides rollback, communicates |
| Technical responder | on-call engineer | diagnose, mitigate, restore |
| Communications | Founder delegate | internal/customer messages |
| Privacy/legal contact | counsel / DPO | breach assessment and notifications |

## 2. Severity
| Sev | Definition | Response target (proposed) |
|---|---|---|
| SEV1 | Service down, data loss/corruption, confirmed breach, payments/refunds wrong | acknowledge 15 min, mitigate ASAP, 24x7 if hosting allows |
| SEV2 | Major feature broken (leads, follow-ups, dashboards), worker stalled, queue backlog growing | acknowledge 1 h (business hours) |
| SEV3 | Degraded/minor, workaround exists | next business day |

## 3. First 15 minutes (any incident)
1. Declare, assign IC, open a timeline log (UTC timestamps).
2. Check `/health` (liveness), `/ready` (DB + Redis + worker heartbeat), `/metrics` (see docs/monitoring.md) and container/service state. On a shared VPS look **only** at `salesos-*` units (`scripts/vps-inventory.sh` is read-only). Never restart unrelated services.
3. Capture evidence before changing anything: `docker logs --since 30m salesos-api salesos-worker`, request id of a failing call (`x-request-id` is returned on every response and is in every log line).
4. Decide: mitigate in place, roll back (docs/deployment-runbook.md "Rollback"), or restore (docs/backup-restore.md).

## 4. Playbooks
### API 5xx / not ready
`/ready` shows which dependency is down. DB down -> check Postgres container/service, disk space, connection limit; API recovers by itself when DB returns (verified by the DB-outage test). Redis down -> API stays up in degraded mode (rate-limit storage and cache degrade, queues pause); restore Redis, then confirm the worker heartbeat resumes.
### Worker stalled / queue backlog
Check worker heartbeat in `/ready`, BullMQ queue depth metrics, dead-letter queue (Admin > Failed jobs). Restart `salesos-worker` only. Unfinished outbox rows are re-dispatched (unique idempotent job ids, verified by the kill -9 test); retry DLQ jobs from the admin UI after fixing the cause.
### Bad release
Roll back the application image to the previous tag; migrations are expand/contract so the previous version still works (rehearsed, docs/deploy-evidence-l1.md). Do not run down-migrations in production.
### Data problem (wrong/deleted data)
Stop writes if needed, take a fresh backup, restore the backup into a *separate* DB (`scripts/restore-check.sh`), extract the affected rows, apply via reviewed SQL. Money totals must reconcile (nightly reconciliation job and the revenue reconciliation view) before closing.
### Suspected account compromise
Founder/Admin deactivates the user (revokes sessions), rotate `SESSION_SECRET` if session theft is suspected (logs everyone out), review `audit_logs` for the actor, check exports performed.
### Secret leak
Rotate the secret (DB password, S3 keys, `SESSION_SECRET`, `PLATFORM_ENCRYPTION_KEY` needs re-encryption of integration secrets - see runbook), invalidate sessions, scan git history, record in the incident log.
### Personal data breach
1. Contain (revoke access, rotate credentials). 2. Preserve evidence (logs, audit rows, backups). 3. Assess scope with the audit log and storage access logs: which data principals, which fields. 4. Engage counsel/DPO immediately: DPDP notification duties to the Data Protection Board and affected individuals are decided by counsel, not by this document. 5. Record the decision and the notifications sent.

## 5. Communication
Internal channel for the timeline; status updates to the Founder at least every 60 minutes for SEV1. Customer-facing wording is approved by the Founder/counsel.

## 6. After the incident
Blameless post-mortem within 5 working days: timeline, root cause, impact (data, money, learners), what detected it, what slowed us, actions with owners and dates, regression test added, `docs/known-issues.md` and CHANGELOG updated. Bugs follow the severity/owner/fix-version/regression-test rule (MS-GOV-013).

## 7. Drills
Quarterly: restore drill (`scripts/restore-check.sh`), rollback drill, alert test. Record dates in docs/backup-restore.md.
