# Data retention, consent and privacy (DPDP notes)

Status: DRAFT for legal review. This document is an engineering description of what the system does and what the proposed defaults are (DEC-018, DEC-035, "default - awaiting owner approval"). It is **not legal advice**. The Digital Personal Data Protection Act 2023 (India) and any employment/consumer rules must be reviewed by qualified counsel before go-live (MS-SEC-020, NEEDS_DECISION).

## 1. Personal data inventory
| Data | Where | Who sees it | Notes |
|---|---|---|---|
| Lead / learner name, phone (E.164), email, city, preferred language, notes, call dispositions | `leads`, `lead_*`, `call_logs`, `tasks` | owner, hierarchy, Founder; scoped by the central policy layer | primary personal data |
| Consent status, timestamp, source | lead consent fields, `integrations/consent` records | CRM roles | needed before any messaging (providers are BLOCKED, DEC-013) |
| Payments, refunds (amounts, external refs, proof files) | revenue schema, files | Finance + approvers | financial record, long retention |
| Employee records (profile, reviews, PIPs, incentives, expectations) | people schema | HR/Founder/Team Lead/Manager by scope | employment data; no payroll/leave/attendance (MS-PPL-002) |
| Complaints and learner satisfaction | cx schema | CX/Student Success/managers by scope | |
| Files and (reserved) recordings | MinIO/S3 private bucket | signed URLs, 300 s | recordings are disabled (403 RECORDINGS_DISABLED) |
| Auth: argon2 password hashes, sessions, IP/user agent | identity schema, Redis | system | hashes are never returned by the API |
| Audit log | `audit_logs` (append-only) | Founder/Admin with `audit:view` | contains actor ids and entity ids; free text redacted of secrets |
| Application logs | stdout (pino JSON) | Ops | passwords, tokens, cookies and PII fields are redacted by the logger (apps/api/test/logging.spec.ts) |

## 2. Retention defaults (proposed, DEC-018/035)
| Category | Default | Automated today? |
|---|---|---|
| Active lead / learner | while active + 3 years after last activity, then anonymise | NO - manual procedure (section 5); no scheduled anonymiser exists |
| Lost / no-consent leads | 12 months | NO - manual |
| Call logs | 3 years | NO - manual |
| Audit logs | 7 years | n/a (append-only; never purged by the app) |
| Notifications | 90 days | partially: see apps/worker jobs (check `docs/platform-report.md`); verify before relying on it |
| Import files | 30 days | YES - file retention job soft-deletes after `retention_until`, purges objects after `purgeAfterDays` |
| Payment proofs | 7 years (financial records) | YES via file `retention_until` |
| Temp / rejected uploads | 7 days (file policy) | YES |
| Sessions | idle 30 min / absolute 12 h | YES |
| Backups | 14 daily + 8 weekly proposed (docs/backup-restore.md) | manual/cron via scripts/backup.sh |

Honest gap: only file-level retention is automated. Record-level anonymisation after the retention period is a **documented manual procedure** and is listed in docs/known-issues.md and the release notes.

## 3. Consent
- Consent is captured on the lead with timestamp and source (form, import, manual). Messaging channels (WhatsApp/SMS/email) are not enabled: no provider is approved (DEC-013), so consent is recorded but no outbound marketing is sent.
- Opt-out / DND is stored and honoured by reactivation rules (DEC-026) and by the provider interface.
- Learner satisfaction responses require `consentGiven=true` (POST /cx/satisfaction).
- Needs counsel: notice wording shown to the data principal, purpose limitation text, children/minor handling, consent withdrawal channel and SLA, grievance officer contact.

## 4. Data-subject requests (access/export, correction, erasure)
There is no self-service endpoint. The procedure is manual, audited and owner-approved:
1. Log the request (who, when, identity verification) in the incident/request register (ticket system). Respond within the period counsel specifies.
2. **Export:** an authorised Admin/Founder runs the lead export (`leads:export`, audited) filtered to the individual and adds call logs, tasks and consent history via the lead detail/timeline. Provide in CSV/XLSX over a secure channel.
3. **Correction:** edit through the normal lead update (history preserved in `lead_status_history` / audit).
4. **Erasure/anonymisation:** a DBA, with a verified fresh backup (`scripts/backup.sh`), runs a reviewed SQL transaction that nulls/replaces name, phone, email, notes and free text on the lead and dependent rows (call notes, task notes, complaint text, satisfaction comments, file objects in MinIO), keeps the row id and aggregates, and writes an `audit_logs` entry. Financial records are retained where law requires (tax/accounting) and are pseudonymised instead. The append-only/guard triggers (`prisma/sql/*guards.sql`) must be respected: run the change as a documented maintenance operation, never by dropping guards. A tested SQL template does not exist yet - it is a v1 gap (KI listed in release notes).
5. Backups still contain the data until they roll off (max 8 weeks proposed); state this in the response to the requester.
6. Record completion and evidence in the register.

## 5. Breach handling
See docs/incident-response.md section "Personal data breach". Under DPDP the Board and affected principals must be notified per the Act and rules; counsel decides timelines and content.

## 6. Security measures supporting privacy
Server-side authorisation and org scoping on every endpoint, IDOR-safe lookups, TLS in production (deploy/nginx), argon2 hashing, private storage with signed URLs, audit logging, log redaction, least-privilege DB roles (documented in docs/deployment-runbook.md; separate migrate/runtime/backup roles), no AI/third-party transfer unless an admin enables AI Copilot (off by default; PII minimised, server-side keys only). Cross-border transfer: depends on hosting choice (DEC-040) and AI provider choice - counsel to review.

## 7. Open items for the owner / legal (do not assume answered)
- Approve retention periods (DEC-018) and file retention (DEC-035).
- Name the grievance officer / data protection contact; approve notice and consent text.
- Decide hosting region (DEC-040) and processor agreements (hosting, object storage, any messaging/AI provider).
- Approve the erasure SQL template once written and tested.
- Confirm lawful basis for employee data held in the people module.
