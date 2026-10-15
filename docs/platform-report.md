# Platform report (Phase 8 + Phase 9 data model) - Agent F

Scope: notifications, channel adapters / deliveries / webhooks, files, AI copilot (flag, default OFF), companion devices, provider call events.
Code: `packages/platform-core` (framework-free core shared by API and worker), `apps/api/src/modules/{notifications,files,integrations,ai,devices}`,
`apps/worker/src/jobs/platform`, `prisma/schema/platform.prisma`, web `(app)/notifications`, `(app)/files`, `(app)/admin/{integrations,ai,files}`, `features/{notifications,files,ai}`, `nav/notifications.ts`.
Tests: `apps/api/test/platform/*.spec.ts`, `apps/worker/test/platform.spec.ts`, web `src/features/{notifications,files,ai}/*.test.tsx`, Playwright `apps/web/e2e/platform-journeys.spec.ts`.

## 1. Contracts for other agents (stable; read this first)

### 1.1 Raising a notification (any domain)

Three equivalent ways, pick the one that fits:

1. **API, inside your transaction** (preferred for request-driven alerts):
   ```ts
   constructor(private readonly notifications: NotificationService) {}   // global module, import nothing
   await this.prisma.$transaction(async (tx) => {
     ...business change...
     await this.notifications.notify(tx, {
       organizationId, type: 'complaint.escalated', roles: ['SALES_TEAM_LEAD', 'FOUNDER_CEO'],   // or userId / userIds / role
       entity: { type: 'complaint', id }, dedupeKey: `complaint.escalated:${id}`,
       actionUrl: `/cx/complaints/${id}`, title: 'Complaint escalated', body: '...',
     });
   });
   ```
   `NotifyRequest`/`NotifyResult` are in `@salesos/shared-types` (`events/platform.ts`). Never throws for per-recipient problems; throws `NotifyValidationError` for malformed requests (unknown type, missing `dedupeKey`, off-origin `actionUrl`).
2. **Outbox event** (decoupled, from any module or the worker): publish `notification.requested` (`PLATFORM_EVENTS.NOTIFICATION_REQUESTED`) with payload = `NotifyRequest` (JSON). The platform worker handler calls the same core. Use `idempotencyKey` = your dedupe key.
3. **CRM `NotificationPort`** (Agent D, `events/crm.ts`): `createCrmNotificationPort(prisma)` from `@salesos/platform-core` implements `send(CrmNotification)` on the platform notifier. Mapping `task.due|task.reminder -> follow_up.due`, `task.overdue -> follow_up.overdue`, `task.escalated -> follow_up.escalated`, `lead.unattended -> lead.no_next_action`, `lead.exception_raised -> lead.exception`. IN_APP result `DELIVERED` means "stored in the user's inbox"; EMAIL/WHATSAPP return `QUEUED` (never DELIVERED: only a verified provider callback produces DELIVERED). PUSH has no adapter -> `FAILED/NO_PUSH_ADAPTER`.

**Automatic subscriptions** (worker, `jobs/platform/events.ts`): the platform subscribes to domain events and raises notifications without the producer doing anything, resolving recipients from the payload (first present of `notifyUserIds[]`, `userId`, `ownerId`, `assignedToId`, `assigneeId`, `toUserId`, `requesterId`, `managerId`) and optional `notifyRoles[]`. Producers should put an explicit `notifyUserIds`/`notifyRoles` in the payload. Subscribed: `task.due|task.reminder|task.overdue|task.escalated`, `lead.unattended|lead.exception_raised`, `complaint.created|escalated|acknowledged|resolved`, `payment.recorded|verified|rejected|reversed`, `refund.requested|reviewed|approved|rejected|processed`, `handover.submitted|overdue|acknowledged|completed|info_requested`, `import.completed|import.failed`, `file.ready|file.failed`, `user.deactivated|user.roles_changed` (security), `notification.requested`.

Type catalogue (26 keys, `NOTIFICATION_TYPES`): follow_up.{due,overdue,escalated}, lead.{unassigned,no_next_action,exception}, target.{at_risk,milestone_missed}, review.pending, coaching.action_pending, complaint.{created,updated,escalated}, collection.status_changed, refund.status_changed, handover.{pending,overdue,update}, founder.action_item, import.{completed,failed}, file.{ready,failed}, security.event, system.delivery_failed, digest.summary. Add a type = add the key in shared-types AND `catalogue.ts`.

Behaviour: unique `(org, user, dedupeKey)` (repeat = `occurrences++`, no new row); per-user per-type per-channel preferences (`*` = all types; mandatory/CRITICAL types cannot be switched off in-app); quiet hours + working days (org config, user override, IANA timezone) hold EXTERNAL channels only (in-app is always stored; CRITICAL and `bypassQuietHours` rules bypass); digest: >= `digestThreshold` (5) unread non-critical rows of one type inside the window collapse into one `digest.summary` row. External channels (email/WhatsApp/SMS/calendar) are opt-in per user, need an enabled integration, and honour consent/opt-out; otherwise a `SUPPRESSED` delivery row with an error code is stored (visible in the admin log).

### 1.2 Files (`FileService`, global in the API)

```ts
files.createFromBuffer / the HTTP route POST /files (multipart, field `file`, optional `entityType`,`entityId`)
files.attach(user, fileId, entityType, entityId)        // POST /files/:id/attach
files.signedDownload(user, fileId)                      // GET  /files/:id/download-url  (<= 300 s) ; GET /files/:id/download streams after the same checks
```
**Scope inheritance**: a file is readable by (a) its uploader, (b) anyone who may access ANY entity it is attached to. Entity access is decided by a `FileEntityResolver` registered by the owning domain:
```ts
constructor(registry: FileAccessRegistry) {}
registry.register('lead', async ({ user, entityId, access }) => {           // access: 'read' | 'attach'
  const lead = await prisma.lead.findFirst({ where: { id: entityId, organizationId: user.organizationId } });
  return !!lead && (await accessService.canAccessRecord(user, 'leads:view', { organizationId: lead.organizationId, ownerId: lead.assignedToId, teamId: lead.teamId }));
});
```
Entity types without a registered resolver are NOT attachable (fail closed). Built-in resolvers: `user` (self or org-wide `users:view`). Agents D/E/CX/Revenue: register resolvers for `lead`, `deal`, `payment` (payment proofs: category `payment_proof` retention 7y), `handover`, `sop`, `import_job`, etc.
Other keys: `files:view` org/team/own/summary scope applies to the uploader filter when a file has no attachment; `summary` scope never lists files.
Events: `file.process_requested` (internal), `file.ready`, `file.failed`, `file.rejected` (payload `{ fileId, uploaderId, reason? }`; platform notifies the uploader). Import failures: publish `import.failed` / `import.completed` with `{ importJobId, userId|notifyUserIds, reason? }`.

### 1.3 Call events (`CallEventPort`) - Phase 9 data-model rule

`POST /integrations/telephony/webhook` (HMAC-signed) normalises provider events and calls `CallEventPort.ingest(ProviderCallEventInput)`. Default implementation stores a row in `provider_call_events` (`source` column = `PROVIDER`, unique per `provider_call_id`) and publishes outbox event `call.provider_event.received`. **Agent D** may provide its own implementation under the DI token `CALL_EVENT_PORT` (exported from `modules/integrations`) to write `call_logs` with `source = PROVIDER`; manual logs stay `source = MANUAL`; `DEVICE` is reserved for the (NO-GO) companion app. KPI code must filter on `source` explicitly and declare which source it counts.

### 1.4 AI context (`CrmContextProvider`)

Interface in shared-types (`getLeadContext`, `listLeadSignals`), DI token `CRM_CONTEXT_PROVIDER` (exported from `modules/ai`). Default: `NotAvailableCrmContextProvider` (returns `{available:false}` -> AI endpoints answer `insufficient data`). Agent D binds a real provider (it MUST apply the caller's scope). AI is OFF by default; CRM never imports the AI module.

### 1.5 Feature flags / settings (`platform_settings`)

`files` (limits/quotas/retention/TTL), `ai` (enabled, provider, model, rateLimitPerMinute, redactPii), `flags` (`devices.enabled`, `recordings.enabled`). All default OFF/safe.

## 2. Providers and DEC-013

Real email/WhatsApp/SMS/calendar/telephony providers are **BLOCKED (DEC-013)**: no provider, credentials, consent/DLT/template approval exists. Shipped: sandbox adapters (`sandbox-email|whatsapp|sms|calendar|telephony`) that accept a message and return a reference, and BlockedProvider stubs (`smtp`, `resend`, `whatsapp-cloud`, `sms-gateway`, `google-calendar`, `telephony-cloud`) that cannot be enabled and always fail `PROVIDER_BLOCKED`. Sandbox NEVER reports delivery; DELIVERED requires a verified webhook callback.

Delivery state machine (`packages/platform-core/src/delivery/state-machine.ts`, single writer `transitionDelivery`):
`QUEUED -> SENT (worker) | FAILED (worker) | CANCELLED (admin)`; `FAILED -> QUEUED (backoff retry) | DEAD_LETTER`; `DEAD_LETTER -> QUEUED (admin requeue)`; `SENT -> DELIVERED | FAILED` **only from a PROVIDER_CALLBACK**; `SUPPRESSED` at creation (not configured / no address / no consent / opted out). Retries: exponential backoff 30 s * 2^(n-1), cap 1 h, default 5 attempts, then dead-letter + admin notification (`system.delivery_failed`). Claim uses `FOR UPDATE SKIP LOCKED` + lease so a worker crash re-queues rows.

Webhooks: `X-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>." + rawBody)>`, +-300 s tolerance, constant-time compare over the RAW body, secret per integration (AES-256-GCM at rest, key `PLATFORM_ENCRYPTION_KEY`, never returned by any API). Replay protection: `(provider, event_id)` unique; same id + same payload = `200 {duplicate:true}` and no side effects; same id with a different payload = `409`. Org is identified by trying the enabled configs of the provider (no unauthenticated org id is trusted).

## 3. Files (see docs/file-storage-policy.md, "Implementation status")

Upload: `POST /files` multipart -> validate (name, extension, magic bytes, declared MIME, size, pixel header, quota) -> private object storage -> `file_assets` row `PENDING` + outbox `file.process_requested` in one transaction. The worker (`jobs/platform/files.ts`) scans and processes with bounded retries (the event consumer's exponential backoff); the last failed attempt sets `FAILED` (visible in `GET /files/:id`, the admin "Needs attention" tab and a `file.failed` notification) and `POST /files/:id/retry` re-queues it. A 15-minute sweeper re-queues files stuck in a non-terminal state (crash recovery). Retention/purge runs nightly.

Environment: `S3_ENDPOINT` (default `http://127.0.0.1:9100`), `S3_BUCKET` (default `salesos-<NODE_ENV>`; created on boot), `S3_ACCESS_KEY`/`S3_SECRET_KEY` (dev defaults are the compose MinIO credentials), `S3_PUBLIC_ENDPOINT` (host used inside presigned URLs when the browser reaches storage differently), `FILE_SCANNER` (`local` default | `clamd` | `none`), `CLAMAV_HOST`/`CLAMAV_PORT`.

## 4. AI Sales Copilot (OFF by default)

Flag: `platform_settings.ai.enabled` (default false) - with it off every Copilot route except `GET /ai/status` answers `404 AI_DISABLED` and the web `AiSuggestionPanel` renders nothing. The CRM never imports the AI module.

Pipeline (`modules/ai/ai.service.ts`): flag -> per-user rate limit (default 10/min, logged `RATE_LIMITED`) -> source (rep-entered text, or CRM history through `CrmContextProvider`, which enforces the caller's scope) -> **insufficient data** short-circuit (no provider call, nothing stored, usage logged) -> `neutralise` (instruction-like sentences replaced by a marker, our delimiters stripped) -> PII redaction (emails, URLs, phone, card/account, PAN/Aadhaar-like, IFSC, known names; setting `redactPii`) -> system prompt that declares NOTES untrusted and forbids actions -> provider adapter (`fake` deterministic local | `openai` | `gemini` | `anthropic`, keys only from `OPENAI_API_KEY`/`GEMINI_API_KEY`/`ANTHROPIC_API_KEY`, 25 s timeout) -> strict Zod output schema (unknown keys rejected, `502 AI_INVALID_OUTPUT`) -> `ai_suggestions` row (`DRAFT`, `sources` = origin, period, note count, call sources, redactions, warnings) + `ai_usage_logs` (outcome, latency, tokens, estimated cost). Provider failure/timeouts -> `503 AI_UNAVAILABLE` ("continue manually"), logged `FAILED`, nothing else is affected.
Review: `PATCH /ai/suggestions/:id` ACCEPT / EDIT (schema-validated) / REJECT, author only, one-shot, audited. Accepting records a decision; it never sends, saves to a lead, closes, approves or changes payments/incentives/permissions (there is no write path). Lead priority is rule-based (`priority.ts`: no owner, overdue tasks, no next action, stale contact, late stage, high value) and lists every factor.
Limits: defences were exercised against the deterministic provider; no live-LLM red-team; regex redaction misses free-form names/addresses; costs are estimates from a small price table.

## 5. Devices and provider call events

`devices` is a registry only (no Android code; go/no-go = NO-GO, DEC-036): `POST /devices/register` answers `403 DEVICES_DISABLED` until an admin sets `devices.enabled`; it requires the on-device disclosure acceptance, stores only a SHA-256 of the device id, starts `PENDING` until `POST /devices/:id/approve`, supports revoke by owner or admin, max 5 per user. `recordings.enabled` cannot be switched on through any API (DEC-014). Call-source rule: `MANUAL` (rep dispositions, CRM), `PROVIDER` (`provider_call_events.source`, via the signed telephony webhook + `CallEventPort`), `DEVICE` (reserved).

## 6. Import from an existing CRM (task 5)

Not built: DEC-012 default is greenfield + CSV import only; row MS-NOT-008 stays NEEDS_DECISION. The extension point is the existing CSV import (Agent D). A LeadSquared/Zoho/HubSpot column-mapping adapter would implement a `source-template -> LeadImportRow` mapper with dry-run; no decision to build it exists.

## 7. Running the stack for E2E (what was actually run)

```bash
export DATABASE_URL=postgresql://salesos:salesos_dev_only@127.0.0.1:5533/salesos_agentf?schema=public
pnpm db:push && pnpm db:generate && pnpm db:seed
# env for api + worker: REDIS_URL, BULLMQ_PREFIX=salesos-agentf, CORS_ORIGINS=http://localhost:3106, SESSION_SECRET=<32+ chars>,
#   S3_BUCKET=salesos-agentf, DELIVERY_BACKOFF_BASE_MS=300 DELIVERY_TICK_MS=1000 (fast retries for the demo), PORT=4106
node apps/api/dist/main.js                      # after pnpm --filter @salesos/api build
node apps/worker/dist/main.js                   # after pnpm --filter @salesos/worker build
NEXT_PUBLIC_API_URL=http://localhost:4106/api/v1 pnpm --filter @salesos/web exec next dev -p 3106
E2E_WEB_PORT=3106 E2E_API_PORT=4106 pnpm --filter @salesos/web exec playwright test e2e/platform-journeys.spec.ts
```
The worker is required: file processing, delivery sending and event-driven notifications all run there.

## 8. Other environment variables added

`PLATFORM_ENCRYPTION_KEY` (32 bytes, base64 or hex; REQUIRED in production; dev/test derive a key from `SESSION_SECRET`), `WEBHOOK_TOLERANCE_SECONDS` (300), `NOTIFICATION_STREAM_POLL_MS` (2000), `DELIVERY_BACKOFF_BASE_MS` (30000), `DELIVERY_TICK_MS` (5000), `PLATFORM_AUTO_NOTIFY_CRM_EVENTS` (default on; see reconcile list).

## 9. Decisions, deviations, reconcile list for the lead

1. **New workspace package `@salesos/platform-core`** (notify core, delivery state machine, providers, crypto, webhooks signature, file pipeline) shared by API and worker. Root `package.json` `build:packages` was edited to build it; `apps/api` and `apps/worker` `package.json`/`vitest.config.ts` got the dependency/alias. `busboy` (+types) added to the API; `sharp` to platform-core (and API dev for tests); `@aws-sdk/client-s3` + presigner to platform-core.
2. Shared files edited minimally: `apps/api/src/bootstrap.ts` (raw-body capture for the two webhook routes only), `apps/api/test/deny-by-default.spec.ts` (public allow-list: the two webhook routes), `apps/api/test/negative-authz.spec.ts` + `test/helpers/client.ts` (platform rows, PUT support), `apps/api/src/seed/seed.ts` (calls `seedPlatform`), `apps/web/src/components/shell/top-bar.tsx` (bell now imported from `features/notifications`), `apps/web/src/nav/registry.ts` (two extra domains), `packages/validation/src/index.ts`, `messages/{en,hi,mr}.json` (`platform` namespace + 4 nav keys), `docs/*` rows.
3. Prisma: no relations to identity models (plain uuid columns, org scoping enforced in code) so `identity.prisma` was not touched. Tables: notifications, notification_preferences, notification_user_settings, notification_org_config, notification_rules, notification_deliveries, notification_delivery_events, consent_records, integration_configs, webhook_events, provider_call_events, file_assets, file_attachments, recording_assets, ai_suggestions, ai_usage_logs, devices, platform_settings.
4. Webhook tenant resolution: the organisation is the one whose stored webhook secret verifies the signature (never a request value); the same secret verifying for two organisations is refused (ambiguous tenant).
5. Webhook replay semantics: identical event again = `200 {duplicate:true}` and no side effect (provider retries are harmless); same id with a different payload = `409 REPLAY_MISMATCH`; outside +-300 s = `401`.
6. SSE implementation re-queries the caller's own rows every 2 s instead of cross-process pub/sub (works for API-, worker- and test-created rows). CRM has its own `/api/v1/stream` for task events.
7. **Duplicate-alert risk (KI-F-04) - RESOLVED by the integration pass** (CRM worker uses `createCrmNotificationPort`, flag defaults to false): the CRM kept a separate in-app store. The lead should have the CRM worker call `setNotificationPort(createCrmNotificationPort(prisma))` and then set `PLATFORM_AUTO_NOTIFY_CRM_EVENTS=false`, or keep both surfaces. `createCrmNotificationPort` is exported from `@salesos/platform-core`.
8. Negative-authz: `test/negative-authz.spec.ts` compares ALL registered routes with its table, so it fails until every domain appended its rows (platform rows are in; other domains' are missing at time of writing). `apps/api/test/platform/negative-authz.spec.ts` covers the platform routes independently and passes.
9. Files with a `summary` scope (Finance/HR/...) never list files and can only read a file through an attached entity whose resolver allows them; ADMIN holds no `files:view` (matrix) so admins can delete/retry but not read file content.
10. `PLATFORM_ENCRYPTION_KEY` rotation: envelopes carry a key version prefix (`v1`); no re-encryption job exists yet.

## 10. Verification (real runs, 2026-10-15; DBs `salesos_agentf`, `_test`, `_wtest`; MinIO 127.0.0.1:9100; Redis 6391)

| Command | Result |
|---|---|
| `pnpm db:validate` / `pnpm db:push` (salesos_agentf) | valid / in sync; `pnpm db:generate` OK; `pnpm db:seed` OK (includes `[DEMO]` platform data) |
| `pnpm build:packages` | OK (shared-types, validation, platform-core, crm-core, cx-core) |
| `pnpm --filter @salesos/api test` (whole suite, all domains) | 53 files, **1457 passed**, 0 failed |
| Platform API tests only (`test/platform`) | 7 files, **227 passed** (files 45, notifications 20, ai 18, deliveries/webhooks/secrets 26, devices 6, platform negative-authz 95, plus pre-existing `platform.spec.ts` 17) |
| `pnpm --filter @salesos/worker test` (fresh `_wtest` DB) | 6 files, **57 passed** (`platform.spec.ts`: 12). Re-running the whole worker suite against a *reused* DB makes other agents' people/revenue specs fail (state they do not clean up); drop/recreate the wtest DB before a full run |
| Web unit tests, platform part (`src/features/{notifications,files,ai}`, i18n) | 5 files, **26 passed** (bell + SSE/polling, items/links, files widget, AI panel, integrations page, axe). Whole web suite at the last run: 298 passed, 6 failed in other agents' cx/revenue/sop tests |
| Playwright `e2e/platform-journeys.spec.ts` (real API + worker + MinIO + Postgres, Chromium) | **4 passed**: journey 14 (upload -> WebP -> download; abuse rejected; EICAR rejected; other team cannot see), journey 15 (outage -> dead letter -> admin alert -> retry -> SENT not delivered -> forged callback 401 -> signed callback DELIVERED -> replay no-op), notification centre (bell live mode, mark all read, preferences persist), axe on /files, /admin/integrations, /notifications |
| `pnpm lint` (api, worker, platform-core, shared-types, web platform files) | 0 errors in platform code. Remaining repo errors belong to other agents (`packages/validation/src/cx.ts` unused var, `apps/web/e2e/{crm,revenue}-journeys.spec.ts` `any`, CRM React-hooks lint) |
| `tsc --noEmit` api, worker, platform-core, web, ui | clean |
| `pnpm --filter @salesos/api build`, `worker build`, `next build` (isolated dist dir) | OK |

Gaps stated plainly: no real email/WhatsApp/SMS/calendar/telephony provider exists (DEC-013) so no real delivery was ever attempted; the ClamAV adapter and the OpenAI/Gemini/Anthropic adapters were not exercised against live services; iOS/Android clients do not exist; the one-click "Send test message" only reaches sandbox adapters.
