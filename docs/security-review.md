# Security review - Phase 10 (Agent K, 2026-10-15)

Scope: adversarial, evidence-based review of the code in this repository, run locally against databases `salesos_agentk*`. No deployment, no remote system, no external service was touched (only `pnpm audit` read the npm registry). **This is an internal review, not a penetration test, not an audit, and not a SOC 2 / ISO 27001 claim.** A clean result of a test below means "this specific check passed", not "no vulnerability exists".

New automated evidence lives in `apps/api/test/security/*.spec.ts` (+ `apps/worker/test/security-config.spec.ts`, web unit tests). See section 6 for the commands and real results.

## 1. Findings

Severity = my judgement of impact x likelihood in the intended deployment. Status: fixed (code change + regression test), accepted (documented risk), open (not fixed).

| ID | Sev | Finding | Status | Evidence / regression test |
|---|---|---|---|---|
| SEC-01 | Medium | Lead CSV export (`crm-core toCsv`) let `+1+1`, `-2+3` and similar through un-neutralised (rule excluded any `+/-` followed by a digit, to keep phone numbers readable) | fixed: a leading `+`/`-` is kept only when the whole cell is a plain number / phone | `security/injection.spec.ts` "lead CSV export", end-to-end `/leads/export` |
| SEC-02 | Medium | Open redirect in the web login `next` guard: `/\t/evil.example`, `/%09/evil.example`, `/%5C...` pass the old check and browsers strip TAB/CR/LF so they become `//evil.example` | fixed (`safeNextPath` rejects control chars, backslash, %00-%1f/%7f/%5c) | `apps/web/src/features/auth/roles.test.ts` |
| SEC-03 | Medium | Stored XSS vector: `z.string().url()` accepts `javascript:` / `data:` URLs; resource `url` and feedback `evidenceUrl` were rendered as `<a href>` | fixed: `httpUrlSchema` (http/https only, no credentials) on write; `safeHref()` on render for already-stored values (CSP `script-src` with nonce is a second layer) | `security/injection.spec.ts` "http(s)-only link fields"; `apps/web/src/lib/safe-url.test.ts` |
| SEC-04 | Medium | Production env validation was a single regex on `SESSION_SECRET`. Booting in production with the dev DB password, memory rate-limit counters, `http://` origins, Swagger on, a missing/weak `PLATFORM_ENCRYPTION_KEY`, or **no S3 variables (silent fallback to the dev MinIO endpoint and credentials)** was accepted | fixed: `productionChecks()` in `config/env.ts`, `storageConfigFromEnv()` refuses fallbacks in production, worker refuses the dev DB password | `security/env-hardening.spec.ts` (19 tests), `apps/worker/test/security-config.spec.ts` |
| SEC-05 | Medium | Only the 4 auth routes had specific rate limits. Imports, exports, uploads, downloads, AI calls, reconciliation had only the global 120/min/IP. When Redis was down the limiter **failed open** | fixed: `@Limited(kind)` on 16 expensive routes (env-tunable `THROTTLE_<KIND>_LIMIT`), Redis outage degrades to per-process counters | `security/rate-limits.spec.ts` (real Redis, 2 replicas share counters, 16 routes return 429, outage fallback) |
| SEC-06 | Medium | `/stream` (CRM SSE) had no per-user connection cap (each stream polls the DB every 3 s) and both SSE streams kept sending scoped data for up to 10 min after logout, deactivation or role change | fixed: cap 5/user (429), per-tick `SessionService.stillValid()` (family revoked/expired, user inactive, role set changed) ends the stream | `security/sse-session.spec.ts` |
| SEC-07 | Medium | No common-password check (policy was length 12 + classes only: `Password1234` was valid) | fixed: bundled deny-list + structural checks (sequences, repeats, glued common words, leet, name/e-mail context) shared by API and web. **Not a breached-password service** (no HIBP) | `security/auth-hardening.spec.ts` "password policy" |
| SEC-08 | Medium | Mass assignment: most Zod schemas strip unknown keys silently (safe but invisible); privileged keys (`organizationId`, `createdById`, `passwordHash`, ...) were accepted and ignored | hardened: `ZodPipe` answers 400 `FORBIDDEN_FIELD` when a privileged key is dropped by the schema; service-level enforcement of known fields (deal `ownerId`, stage, payment status/amount, refund status) asserted against the DB | `security/mass-assignment.spec.ts` |
| SEC-09 | Medium | Database: app ran as schema owner with DDL executed at every boot; `TRUNCATE audit_logs` was not blocked (row triggers do not fire for TRUNCATE); no least-privilege role | fixed: `prisma/sql/db-roles.sql` (migration role vs DML-only app role, append-only privileges on audit/money history), `DB_AUTO_DDL` default off in production + fail-closed guard verification at boot, statement-level TRUNCATE triggers (migration `20261015140000_security_hardening`) | `security/db-roles.spec.ts` (migrate as non-superuser, boot production API as app role, DDL/TRUNCATE/UPDATE denied, owner still blocked by triggers) |
| SEC-10 | Low | `forgot-password` timing: existing account skipped the argon2 burn that unknown accounts performed (measurable difference either way) | fixed: both paths burn one verify and are padded to a floor (`FORGOT_PASSWORD_MIN_MS`, default 400 ms) | `auth-hardening.spec.ts` "response time does not separate ..." (median within 150 ms, both >= 380 ms) |
| SEC-11 | Low | Session fixation hygiene: login with a session cookie already present did not revoke it | fixed: presented session revoked (`superseded_by_login`), new token/family always issued | `auth-hardening.spec.ts` "login while holding another session cookie", "attacker-planted cookie" |
| SEC-12 | Low | API CSP merged helmet defaults (`style-src 'unsafe-inline'`, `https:` font/style sources) instead of `default-src 'none'` only | fixed (`useDefaults:false`) | `db-roles.spec.ts` production headers |
| SEC-13 | Low | API responses had no `Cache-Control` (private data could be cached by shared devices/proxies) | fixed: `no-store` on `/api/v1` | `injection.spec.ts`, `db-roles.spec.ts` |
| SEC-14 | Low | Demo seed refused only `NODE_ENV=production` (CLI only; `seed()` itself unguarded). A dev-mode run against a real database would create users with publicly documented passwords | fixed: `assertSeedAllowed` (production, non-local DB host, or any non-demo organisation present) | `env-hardening.spec.ts` "demo seed" |
| SEC-15 | Low | AI prompt guard: `<<<<<<` style input could re-form a closing delimiter after single-pass stripping | fixed (loop until stable, strip runs of 3+) | `injection.spec.ts` "prompt injection" |
| SEC-16 | Low | Log redaction covered one nesting level and few field names | fixed (two levels, common credential names, signature/API-key headers) | `logging.spec.ts` |
| SEC-17 | Low | Notification `actionUrl` same-origin check allowed control characters (`/\t/evil`) | fixed in `platform-core notify.ts`; **no dedicated regression test** (covered by the UI-side `safeHref` of the notification item only) | - |
| SEC-18 | High (dev/CI) -> see note | `pnpm audit` before: 14 advisories incl. `next` 16.3.6 (high SSRF in Image optimizer + 5 moderate/low) | fixed for `next`/`eslint-config-next` (16.3.8, released 2026-09-30, `apps/web` + `packages/ui`; build + web tests re-run). **8 remain, see section 3** | `pnpm audit` before/after |
| SEC-19 | Low | API test-only: pre-existing `summary-leakage` sweep timed out (30 s) in the baseline run on a loaded machine | see section 6 | - |

Verified-only (no defect found, test added or already present): deny-by-default on all 423 routes; 401 without session on all non-public routes; CSRF token required on all 222 state-changing routes (including multipart upload); foreign Origin refused on all of them (including public); prefix-match Origins refused; strict CORS (production: only configured https origin, preflight included); cross-organisation replay of ~every demo-org id against every parameterised route and verb never succeeds; list/detail visibility agree for Executive A1 vs Executive B1 / Manager B; lockout cannot be bypassed by e-mail case/whitespace/X-Forwarded-For; reset/invite tokens single-use, purpose-bound, newest-wins, expire, concurrency-safe, stored as hashes, links built from `APP_BASE_URL` only (Host header ignored), reset/deactivate revoke every session; login failures indistinguishable (wrong password / unknown / inactive / locked); no `dangerouslySetInnerHTML`/`innerHTML` anywhere in `apps/web/src`; SOP markdown renderer escapes script/img/svg/iframe payloads; no server-side fetch of a user-supplied URL (the only `fetch` calls are AI providers with hard-coded hosts) so no SSRF surface; SQL: 5004 requests with classic payloads over 139 GET routes produced no 5xx/DB error/delay, and a static test pins every `$queryRawUnsafe`/`Prisma.raw` use; file downloads `attachment` + `nosniff` + `no-store`, signed URL <= 300 s (existing suite); built Next app: per-request CSP nonce, every `<script>` carries the nonce, CSP differs per request, no secret strings in `.next` output.

## 2. Authz sweep method

`test/security/route-matrix.spec.ts` drives the live router (`listRoutes`), so a new route is covered automatically. `idor-matrix.spec.ts` uses the `[DEMO]` organisation (every domain populated) as the victim and a Founder of another organisation as the attacker, sampling real ids per table against every parameterised route with every verb (writes use an empty body, so a 400 from validation can mask an authz gap on a write; the per-domain negative suites with valid bodies remain the primary evidence for writes).

## 3. Dependencies (real `pnpm audit` output, 2026-10-15)

Before: 14 vulnerabilities (1 low, 8 moderate, 3 high, 2 critical). After upgrading `next` to 16.3.8: **8 (4 moderate, 2 high, 2 critical)**:

| Package | Sev | Path | Used at runtime? | Disposition |
|---|---|---|---|---|
| tinypool 1.1.1 (2 advisories, prototype pollution -> RCE in `run()`) | critical | `vitest` (api, worker) | no, test runner only | open: needs vitest 4.x (major); never run on untrusted input |
| deepmerge-ts 7.1.5 | high | `prisma` CLI -> `@prisma/config` | no, CLI/build time | open: fixed upstream in a newer Prisma 6.x/7; track |
| braces 3.0.3 | high | `eslint-config-next` -> fast-glob | no, lint time | open: dev only |
| uuid 8.3.2 (buffer bounds, v3/v5/v6 with `buf`) | moderate | `exceljs` | yes (export), but exceljs does not call those APIs with a user buffer | accepted/open: track exceljs |
| vitest, @vitest/mocker | moderate | test | no | open (same as tinypool) |
| js-yaml 5.3.0 | moderate | `@nestjs/swagger` | only when Swagger is enabled (refused in production) | accepted |

No critical/high advisory affects the production runtime path as far as `pnpm audit` paths show, but these are open items, not a clean bill: upgrading vitest/Prisma needs an owner decision (major versions).

Licences: no new runtime packages were added by this review. Not scanned: transitive licence audit.

Secret scan: a **basic** pattern grep (AWS/OpenAI/Anthropic/Google/GitHub/Slack key shapes, PEM private keys, JWT shapes, plus generic `secret|password|token = "..."` assignments outside tests) over the repository excluding `node_modules`, build output, lockfile: **no hits**. `.env` is git-ignored and holds only the dev database URL. No gitleaks/trufflehog was downloaded or run (not allowed to run unvetted binaries); this grep is far weaker than those tools and cannot see history (the repository is not under git).

## 4. Data protection

* Audit: append-only by trigger (UPDATE/DELETE/TRUNCATE) for every role including the table owner, and by privilege for the app role (tested as non-superuser roles). Audit metadata is redacted per domain permission (existing). IP and user-agent are stored on sessions (personal data, retained with the session row).
* Retention jobs exist per decision log (worker `maintenance` test: expires files, prunes old rows, re-queues exports); the policy text is in `docs/data-retention-privacy.md` (owned by Agent L). I did not re-verify every retention class.
* Encryption: integration secrets AES-256-GCM (key from `PLATFORM_ENCRYPTION_KEY`, now rejected in production if missing/low entropy). TLS to Postgres/Redis/S3 is **configuration, not code**: use `sslmode=require` in `DATABASE_URL`, `rediss://`, https S3 endpoint; at-rest encryption is the provider/disk's job. Not tested.
* Roles: see `prisma/sql/db-roles.sql` header for the exact command. Run migrations with the migration role's URL and run the API/worker with the app role's URL; keep `DB_AUTO_DDL` unset in production.

## 5. Residual risks and NOT tested

Residual (accepted or open):
1. Account lockout is per-account, so an attacker can lock a known user out (availability trade-off; mitigated by 15 min auto-unlock and the per-IP login limit).
2. Rate limits are per client IP. Behind nginx/Cloudflare `TRUST_PROXY` must be correctly set (one hop) or all users share one bucket; if the proxy does not overwrite `X-Forwarded-For` the limit is spoofable. Per-user limits are not implemented.
3. Antivirus scanning is not active without ClamAV (KI-F-01). SVG/HTML/zip/exe are rejected by extension and content sniffing.
4. Password policy is a bundled list, not a breached-password service. No MFA.
5. A webhook request carrying a browser session cookie is rejected by CSRF (KI-F-06); harmless for real providers.
6. SSE role-change detection compares the role set per poll tick, but a permission-catalogue change needs a restart.
7. Remaining dependency advisories (section 3).
8. Prisma validation errors are logged server-side with their stack (can contain argument values); never returned to clients. Not changed.
9. The write half of the IDOR matrix uses empty bodies (see section 2).

Not tested / not claimed: real TLS termination, HSTS preload, HTTP/2 request smuggling at a reverse proxy, DDoS/volumetric limits, Redis/Postgres/MinIO network exposure on the VPS (Agent L's runbook), backup restore, secret rotation procedure, live AI-provider behaviour (KI-F-05), live email/SMS/WhatsApp providers (blocked DEC-013), the Android companion, clickjacking in real browsers (headers only), browser-level XSS execution (unit-level render tests only; no Playwright run), CSRF behaviour of the mobile companion, DPDP legal compliance (needs counsel), supply-chain integrity of installed packages, and any code added after this review.

## 6. Commands and results (all run from the repository root or app dirs, real output)

Recorded in the final report of Agent K and in `CHANGELOG.md`; the per-spec commands are:

```
cd apps/api && TEST_DB_MODE=migrate TEST_DATABASE_URL=postgresql://...salesos_agentk_test... pnpm exec vitest run test/security
cd apps/worker && pnpm exec vitest run test/security-config.spec.ts
cd apps/web && pnpm exec vitest run src/lib/safe-url.test.ts src/features/auth/roles.test.ts src/features/sop/markdown-xss.test.tsx
pnpm audit
```

## 7. Operator checklist introduced by this review

* Production env must set: strong `SESSION_SECRET`, `PLATFORM_ENCRYPTION_KEY`, `THROTTLE_STORAGE=redis`, https `CORS_ORIGINS` and `APP_BASE_URL`, `S3_*` (no defaults), app-role `DATABASE_URL`; the API refuses to start otherwise.
* Create roles with `prisma/sql/db-roles.sql`; run `prisma migrate deploy` as the migration role (new migration `20261015140000_security_hardening` must be applied before the API starts in production because boot-time DDL is off).
* Tune `THROTTLE_UPLOAD_LIMIT`, `THROTTLE_IMPORT_LIMIT`, `THROTTLE_EXPORT_LIMIT`, `THROTTLE_AI_LIMIT`, `THROTTLE_REPORT_LIMIT`, `THROTTLE_DOWNLOAD_LIMIT`, `THROTTLE_ADMIN_ACTION_LIMIT` to the office size (defaults per IP per minute: 60/10/20/30/20/120/30).
