# Security (threat model and controls) - draft, Phase 0; finalised in Phase 2 and audited in Phase 10

Date: 2026-10-14. No SOC 2 / ISO 27001 claims are made. This is a design-time model, not evidence of implementation.

## 1. Assets and data classes
| Class | Examples | Sensitivity |
|---|---|---|
| Learner/prospect PII | name, phone, email, notes, call history, consent | High (DPDP) |
| Financial | deals, payments, refunds, incentives | High |
| HR | reviews, PIPs, hiring, employee profile | High |
| Credentials/secrets | password hashes, sessions, provider keys | Critical |
| Business analytics | targets, forecasts, reports | Medium-High |
| Audit logs | actions | Integrity-critical |

## 2. Actors and trust boundaries
Internal users (5 roles + groups), malicious insider (e.g. executive probing others' leads), external attacker (credential stuffing, injection), compromised device, provider webhook sender (untrusted), AI provider (data recipient), uploaded files (untrusted), imported CSVs (untrusted). Boundaries: browser <-> web, web <-> API, API <-> DB/Redis/storage, worker <-> providers, API <-> AI provider.

## 3. Threats (STRIDE-oriented) and controls
| # | Threat | Control | OWASP Top 10 (2021) | Phase | Test |
|---|---|---|---|---|---|
| T1 | IDOR: user reads/edits another's lead, deal, HR record | Central policy layer, scope predicate in every query, 404 on miss, no trust in client IDs | A01 Broken Access Control | P2 | per-endpoint negative suite |
| T2 | Privilege escalation via role/permission edit | `users:role:assign` limited; audit; Founder/Admin only; segregation (Admin no HR/Finance) | A01 | P2 | role tests |
| T3 | Credential stuffing / brute force | argon2id, login rate limit + lockout, generic errors, optional MFA later | A07 Identification and Authentication Failures | P2 | lockout test |
| T4 | Session theft/fixation | HttpOnly, Secure, SameSite=Lax/Strict cookies, rotation on login, revoke on logout/deactivation, idle + absolute timeout | A07 | P2 | cookie flag test |
| T5 | CSRF | CSRF token (double submit or synchroniser) on mutations, SameSite, Origin check | A01/A05 | P2 | CSRF test |
| T6 | Injection (SQL/NoSQL/command) | Prisma parameterisation; no string-built SQL (raw SQL only via tagged templates); input validation Zod; CSV formula-injection escaping on export | A03 Injection | P1 | static grep + tests |
| T7 | XSS (notes, SOP bodies, imported data) | React escaping, no `dangerouslySetInnerHTML` without sanitiser (DOMPurify allowlist for rich SOP content), CSP | A03 | P1 | payload tests |
| T8 | SSRF (webhooks, file fetch, import URLs) | no server-side fetch of user URLs; provider URLs from config allowlist; egress restricted | A10 SSRF | P8 | test |
| T9 | Upload abuse (executables, traversal, zip bombs, polyglot) | allowlist + magic bytes, size/quota, safe keys, private bucket, scan hook, no inline serving, signed URLs, `Content-Disposition: attachment`, `nosniff` | A04/A05/A08 | P8 | abuse suite |
| T10 | Webhook forgery/replay | HMAC signature, timestamp window, nonce/event-id uniqueness store, constant-time compare | A08 Software and Data Integrity Failures | P8 | forgery/replay test |
| T11 | Data exfiltration via export | `*:export` permission, scope, rate limit, audit with row counts, signed short-lived links | A01/A09 | P5 | export audit test |
| T12 | Sensitive data in logs/errors | pino redaction (password, token, phone/email masking), safe error messages, no stack to client | A09 Logging and Monitoring Failures | P1 | log test |
| T13 | Secrets leakage | env-only, `.env.example` placeholders, secret scan in CI, no secrets in client bundle (`NEXT_PUBLIC_` review) | A02 Cryptographic Failures / A05 | P1 | CI scan |
| T14 | Insecure transport/storage | HTTPS/HSTS, TLS to DB/Redis in prod, managed at-rest encryption, bucket private | A02 | P10 | checklist |
| T15 | Vulnerable dependencies | pinned versions, `pnpm audit`, renovation process, SBOM optional | A06 Vulnerable and Outdated Components | P1/P10 | CI |
| T16 | Misconfiguration (CORS, headers) | strict CORS (no wildcard with credentials), CSP, X-Content-Type-Options, frame-ancestors, Referrer-Policy, Permissions-Policy | A05 Security Misconfiguration | P1 | header test |
| T17 | Insecure design: AI prompt injection / data leakage | AI flag off by default, server-side only, PII minimisation, untrusted-input handling, no write tools, usage log | A04 Insecure Design | P8 | injection fixtures |
| T18 | Audit tampering | append-only tables, DB role without UPDATE/DELETE, hash chain optional | A09 | P2 | grant test |
| T19 | Insider misuse of payments/incentives | separation of duties (recorder != verifier; requester != approver), audit, alerts | A04 | P4/P6 | SoD tests |
| T20 | Denial of service / expensive queries | rate limits, pagination caps, query timeouts, async heavy reports, import size limits | A04/A05 | P1 | load test |
| T21 | Reminder/event loss or duplication (integrity) | outbox + idempotency (ADR-003) | A04 | P3 | restart test |
| T22 | PWA cache leaking private data on shared device | ADR-004 | A02 | P1 | cache test |
| T23 | Cross-tenant leakage | organization_id on every query, tenant tests | A01 | P2 | cross-org test |
| T24 | Shared-VPS blast radius | isolated service names/ports, least-privilege DB/storage creds, backups before change (runbook) | A05 | P10 | runbook review |
| T25 | Privacy non-compliance (DPDP) | consent fields, retention policy (DEC-018), erasure/export workflow, minimisation, access logging; legal review | n/a | P10 | checklist |

## 4. Authentication and session design
argon2id (memory-hard params), password policy min 12 chars + breached-password check (optional), reset tokens single-use 30 min expiry hashed in DB, invite tokens expiring, session ids random 256-bit stored hashed, per-user max sessions, revoke-all on password change/deactivation, lockout 5 failures -> 15 min with audit event.

## 5. Authorization design
Permission keys `module:action` with scope (own/team/org/summary) per docs/permissions-matrix.md. Route enumeration test fails build if a route lacks a permission decorator. Admin gets no hr/finance keys by default.

## 6. Controls checklist (tick in Phase 10)
- [ ] All endpoints have permission + scope tests (A01)
- [ ] Cookies HttpOnly/Secure/SameSite; CSRF verified (A01/A07)
- [ ] Password hashing argon2id (A02/A07)
- [ ] Rate limits on auth/import/export/webhook (A04)
- [ ] Input validation everywhere, parameterised DB access (A03)
- [ ] CSP + headers tested against the real app (A05)
- [ ] CORS strict (A05)
- [ ] Secrets only via env, scan clean (A02/A05)
- [ ] TLS everywhere, HSTS (A02)
- [ ] Dependency audit no critical/high (A06)
- [ ] Webhook signature + replay protection (A08)
- [ ] Upload abuse suite passes (A04/A08)
- [ ] Audit logging verified for privileged actions (A09)
- [ ] Log redaction verified (A09)
- [ ] No SSRF surfaces (A10)
- [ ] Backups + restore tested (resilience)
- [ ] DPDP consent/retention/erasure process documented; legal review recorded
- [ ] Incident response plan below reviewed

## 7. Incident response (draft)
Roles: Incident lead (Founder-designated), tech lead, comms. Steps: detect (alerts/audit anomaly) -> contain (revoke sessions, rotate secrets, disable integration flag) -> assess (audit logs, scope of data) -> notify (DPDP: Data Protection Board and affected principals as required - confirm with counsel) -> remediate -> post-mortem within 5 working days -> record in known-issues/CHANGELOG. Contacts and thresholds to be filled by owner.

## 8. Retention, consent, deletion
See DEC-018. Consent captured on leads (status, timestamp, source). Opt-out honoured for messaging. Deletion = anonymise lead PII while keeping aggregates. Legal review required (NEEDS_DECISION row MS-SEC-022).

## 9. Out-of-scope claims
No SOC 2 / ISO certification claims; no guarantee of zero bugs.

## 10. Identity and API foundations - implementation notes (Phase 1/2 backend, Agent B)

Implemented in `apps/api` and verified by `apps/api/test/*.spec.ts` (see docs/phase-1-2-backend-report.md).

- **Sessions**: opaque 256-bit token in an HttpOnly cookie (`salesos_session`, Secure in production, SameSite=Lax by default, Strict configurable). Only the SHA-256 of the token is stored (`sessions.token_hash`). Idle expiry (org setting `sessionIdleMinutes`, default 30), absolute expiry (default 12 h), rotation every 15 min with a 60 s grace window for in-flight requests, revocation on logout, password reset, invite acceptance and user deactivation. Every request re-reads the user, roles and `is_active` from the DB (no trust in cached claims).
- **CSRF**: two layers. (1) Any unsafe request carrying an `Origin` header must match the CORS allow-list. (2) Authenticated unsafe requests need `x-csrf-token` = HMAC-SHA256(SESSION_SECRET, session family id). The token is stable across rotation, also exposed in the readable `salesos_csrf` cookie, `GET /auth/csrf` and `/auth/me`. Rejects are audited by status code only (never the token).
- **Passwords**: argon2id (m=19456 KiB, t=2, p=1). Policy: >=12 chars with upper, lower and digit. Unknown-user logins burn an equivalent hash so timing does not reveal accounts; every login failure returns the same `INVALID_CREDENTIALS` (also while locked).
- **Lockout**: 5 consecutive failures lock the account for 15 min (both configurable, DB-backed so it survives restarts and works across replicas). `auth.login_failed` and `auth.account_locked` are audited; unknown emails are logged (structured, redacted) but cannot be attached to an organization audit row. Per-IP throttling on auth routes is additional (Throttler, Redis storage in non-test environments).
- **Reset / invite tokens**: 256-bit random, only the SHA-256 is stored, single use enforced by an atomic `UPDATE ... WHERE used_at IS NULL AND expires_at > now()`, purpose-bound, a new request invalidates older ones, completion revokes all sessions. Forgot-password always answers 200. Email delivery is a provider interface (`EMAIL_PROVIDER`); the default stub writes a `notification.email.requested` outbox event and the worker logs "NOT sent". The outbox payload contains the link, so a real provider MUST scrub payload variables after sending; loggers redact `variables`, `link`, `token`, cookies and authorization headers.
- **Authorization**: global guard chain Throttler -> AuthGuard -> CsrfGuard -> PermissionsGuard. A route without `@Public()`, `@RequirePermission(...)`, `@RequireAnyPermission(...)` or `@Authenticated()` is denied (403) and `test/deny-by-default.spec.ts` fails the suite. `@Public` is restricted to an allow-list asserted by the same test. The permission catalogue mirrors docs/permissions-matrix.md exactly (`test/catalogue-matrix.spec.ts` fails on drift).
- **IDOR**: domain queries must use `AccessService.scopedWhere` / `assertRecordAccess`. They always pin `organization_id` from the session and return 404 (not 403) for out-of-scope records. `summary` scope is org-wide but callers must return the minimum-data projection.
- **Privilege-escalation guards (tightenings beyond the matrix)**: assigning FOUNDER_CEO, HR or FINANCE requires `users:role:assign-sensitive` (Founder only); nobody can change their own roles; the last active Founder cannot be deactivated or demoted; at most one primary role per user; delegations are limited to 90 days and cannot grant a scope above the creator's own hierarchy. These are flagged NEEDS_DECISION in the report.
- **Audit**: `audit_logs` is append-only. A PostgreSQL trigger (`prisma/sql/guards.sql`, applied at API bootstrap, seed and test setup) rejects UPDATE and DELETE; the service exposes create only. Audited: login success/failure/lockout, logout, password reset, invite acceptance, user create/update/deactivate/reactivate, role changes, hierarchy (ownership) changes, team and membership changes, org settings (policy) changes, delegations, session revocation. The read endpoint is scoped by `audit:view` (org / team actors).
- **Transport and headers**: Helmet with `default-src 'none'` and `frame-ancestors 'none'` for the API (Swagger relaxes only when docs are enabled), HSTS in production, strict CORS allow-list (a `*` origin is rejected at boot because cookies are credentialed), `x-powered-by` removed, request id on every response.
- **Rate limiting**: `@nestjs/throttler` global limit plus tighter auth-route limits; Redis-backed storage when `THROTTLE_STORAGE=redis` (fails open on Redis outage because lockout is DB-backed).
- **Config**: Zod-validated environment; boot fails with a readable error on missing/weak values (short SESSION_SECRET, wildcard CORS, placeholder secret in production).
- **Bootstrap vs demo data**: `pnpm db:seed` only bootstraps org + owner + roles from env (`BOOTSTRAP_ADMIN_*`, password never in the repo). `pnpm db:seed:demo` refuses to run when `NODE_ENV=production`; every seeded record is labelled `[DEMO]`; demo passwords are deterministic and documented only in README as dev-only.

## Platform controls added in Phase 8 (Agent F)

- **Integration secrets**: AES-256-GCM with a key from `PLATFORM_ENCRYPTION_KEY` (required in production), write-only API fields, never returned, audit metadata records field names only (tests: `apps/api/test/platform/deliveries.spec.ts`).
- **Webhooks**: HMAC-SHA256 over the raw body, constant-time compare, +-300 s window, `(provider, event_id)` replay store, tenant resolved from the verifying secret, uniform `401` for every verification failure.
- **Files**: see docs/file-storage-policy.md "Implementation status". Signed URLs are bearer links (<= 5 min); downloads re-check authorisation; payment-proof downloads are audited.
- **AI**: OFF by default, keys server-side only, untrusted-text neutralisation + delimiting, PII redaction before any provider call, strict output schemas, per-user rate limit, usage/failure logging, no write path to payments/permissions/incentives.
- **Notifications**: own-only reads (IDOR returns 404), same-origin action links only (enforced on write and in the UI), SSE scoped to the authenticated user and capped per user.


## Exports (Phase 5)
Server-side `reports:export` + report permission + scope on create AND again when a queued file is generated; requester-only authorised download (`Cache-Control: private, no-store`), 72 h retention, row caps, CSV/XLSX formula-injection neutralisation (`= + - @ TAB CR` prefixed with `'`), audit of create/complete/download/fail with filters and row counts (no PII values in the audit metadata). KPI cache keys contain a hash of the resolved scope, never only a role name. See docs/analytics-report.md sections 5 and 7.

## Phase 10 review (Agent K)
The controls checklist above is superseded by `docs/security-review.md` (findings with severity/status/test evidence, residual risks, and what was NOT tested). Boxes are deliberately not ticked here: tick them only against the evidence listed there.
