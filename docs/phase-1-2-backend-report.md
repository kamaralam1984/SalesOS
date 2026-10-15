# Phase 1 + 2 backend report (Agent B)

Scope: API foundation, worker skeleton, identity/RBAC/audit/outbox, shared packages, seed, CI. Date 2026-10-14/15.
Everything below is implemented; test results are in the "Verification" section (real runs).

## 1. Layout

```
apps/api/src
  main.ts, bootstrap.ts (configureApp shared with tests), app.module.ts
  config/            env.ts (Zod, fail fast), config.module.ts (APP_ENV token)
  common/
    http/            envelope.interceptor, all-exceptions.filter, request-id.middleware, zod.pipe, errors.ts (AppError), api-result.ts (ok())
    pagination/      pagination.ts (pageArgs / pageResult / clampLimit)
    authz/           decorators.ts, principal.ts, access.service.ts (scope + scopedWhere), session.service.ts, auth.guard, permissions.guard,
                     permissions.catalogue.ts + permissions/<domain>.ts (+ define.ts, index.ts)
    security/        csrf.guard, redis.module, redis-throttler.storage, request-context (AsyncLocalStorage: requestId/ip)
    audit/           audit.service.ts (AuditService, AUDIT_ACTIONS, AuditModule)
    outbox/          outbox.service.ts, email.provider.ts (EmailProvider contract + outbox stub)
    prisma/          prisma.service.ts, db-guards.ts (append-only trigger), index.ts (Tx type)
    health/ logging/ swagger.ts
  modules/<identity|crm|revenue|people|sop|cx|collaboration|reporting|notifications|files|integrations|ai|devices>/<name>.module.ts   (all imported in AppModule)
  seed/              seed.ts + domains/{crm,revenue,people,cx}.ts hooks
apps/api/test        *.spec.ts, helpers/ (test kit), global-setup.ts, setup-env.ts
apps/worker/src      main.ts, config.ts, queues.ts, outbox/{dispatcher,event-consumer}.ts, jobs/registry.ts, jobs/{platform,crm,revenue,people,cx,analytics}/index.ts
packages/shared-types  roles, envelope, pagination, permissions consts, auth DTOs, events/<domain>.ts
packages/validation    common (pagination), identity schemas
prisma/schema          base, identity, crm, revenue, people, cx, platform (.prisma); prisma/sql/guards.sql
```

## 2. How to add a backend module (domain agents)

1. Work only in `apps/api/src/modules/<domain>/` (the module class already exists and is imported by AppModule). Add controllers/services/providers to that `@Module({...})`. `PrismaService`, `AuditService`, `OutboxService`, `AccessService`, `SessionService` are global - inject them directly.
2. Add Prisma models to `prisma/schema/<domain>.prisma` (UUID PK, `organizationId`, `@db.Timestamptz(6)`, `@@map` snake_case). Relate to identity models with an FK in YOUR file and append the back-relation to the identity model with one atomic edit. Use `pnpm db:push` against your own DB; no migration files during parallel waves.
3. Permissions: edit only `apps/api/src/common/authz/permissions/<domain>.ts`. The matrix (docs/permissions-matrix.md) is canonical and the files are pre-seeded with its keys. `test/catalogue-matrix.spec.ts` fails if code and matrix diverge, so change the matrix and the file together (Agent A owns the matrix).
4. Every route MUST carry `@RequirePermission('key', ...)` (all listed keys required) or `@RequireAnyPermission(...)`; `@Public()` / `@Authenticated()` only with a documented reason (`@Public` additions require editing the allow-list in `deny-by-default.spec.ts`, i.e. a reviewed change).
5. Validate input with Zod from `packages/validation` (add `packages/validation/src/<domain>.ts` + export) via `@Body(new ZodPipe(schema))` / `@Query(new ZodPipe(schema))`.
6. Return plain data (the envelope interceptor wraps it) or `ok(data, { warnings, pagination })`. Throw `AppError(code, message, status)` / `notFound()` / `forbidden()` / `conflict()`; never return Prisma rows containing secrets.
7. Tests: use the kit in `apps/api/test/helpers` (section 8) and append a row for each endpoint to the table in `test/negative-authz.spec.ts` (the coverage test fails when an endpoint has no negative case).
8. Update `docs/api-catalogue.md` status and the traceability rows.

## 3. Authorization rules (binding)

- **Never** accept organizationId / userId-owner / role / team from the client for authorization. The caller is `@CurrentUser() user: Principal` (rebuilt from the DB per request).
- **List queries**: `const where = { ...(await access.scopedWhere(user, { permission: 'leads:view', ownerField: 'assignedToId', teamField?: 'teamId' })), ...yourFilters }`. It always contains `organizationId` and restricts owners by the user's widest scope for that key (`own` -> self, `team` -> hierarchy + led teams + active delegations, `org` -> organization, `summary` -> organization but you MUST return a minimum-data projection; check `access.isSummaryOnly(user, key)`). If you need a top-level `OR`, combine with `AND: [scoped, { OR: [...] }]`.
- **Single records**: load with `findFirst({ where: { id, organizationId: user.organizationId } })` then `await access.assertRecordAccess(user, key, record && { organizationId: record.organizationId, ownerId: record.assignedToId, teamId: record.teamId })`. Out-of-scope and missing records both yield 404.
- **Writes**: check the action permission (`@RequirePermission`) AND the record scope. When assigning/reassigning, validate that the target user belongs to the same organization and (for team-scoped actors) is inside `access.visibleUsers(user).ids`.
- **Scope resolution helpers**: `access.resolveScope(user, key)`, `access.scopeLevel`, `access.has`, `access.visibleUsers(user)` -> `{ ids, teamIds, delegatedFrom, directReports }` (memoised per request), `access.canAccessRecord`. Hierarchy = `users.manager_id` subtree + members of teams the user leads (`teams.lead_user_id` or LEAD membership) + active delegations (delegator's subtree). Cross-org is always denied.
- **Sensitive keys** (hr:*, collections:*, refunds:*, incentives:*, pip:*, reviews:*, hiring:*, onboarding:*, succession:*, sales-adjustments:*) are flagged `sensitive` and the suite asserts ADMIN holds none.
- Role/permission mapping lives in code (authoritative, derived from the catalogue); tables `roles`, `permissions`, `role_permissions` are a mirror synced at API bootstrap/seed (`syncCatalogue`). Roles must exist in `roles` for `user_role_assignments` FKs - they do after the first API boot or seed.

## 4. Audit

`AuditService.recordTx(tx, { organizationId, actorId, action, entityType, entityId, metadata })` inside the business transaction (preferred) or `record(...)`. `requestId` and client IP are attached automatically (AsyncLocalStorage). The table is append-only at DB level. Reuse `AUDIT_ACTIONS` names where they exist (`ownership.changed`, `export.created`, ...). Never put secrets, tokens or full PII payloads in `metadata`. Audit exports, ownership changes, role changes, policy changes and privileged actions as required by the matrix.

## 5. Outbox, jobs, events

See `docs/outbox.md` for the full contract. Short version: `outbox.publish(tx, {...})` in the business transaction; worker domain files register `registry.onEvent(type, handler)` (idempotent) or `registry.processor({ queue, process })` / `registry.repeatable({...})`. Declare event names and payload interfaces in `packages/shared-types/src/events/<domain>.ts`. Only edit `apps/worker/src/jobs/<domain>/index.ts` (slots exist for crm, revenue, people, cx, platform, analytics).
**Event-subscriber contract for the CRM agent**: subscribe to `user.deactivated` (`IDENTITY_EVENTS.USER_DEACTIVATED`, payload `UserDeactivatedPayload`) and create reassignment-queue entries for every open lead/task owned by `payload.userId`, idempotently (key on `event.id`).

## 6. Pagination

Query: `paginationQuerySchema` (limit 1..100, default 25, optional `cursor`, optional `page`). Handler: `const rows = await prisma.x.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) }); return pageResult(rows, q);` (orderBy MUST end with the unique `id`). Result: `data` = items, `meta.pagination = { mode, limit, hasMore, nextCursor | page,total,totalPages }`. Cursor mode is default; send `page` for page mode (pass `total` as the third arg to `pageResult`).

## 7. Endpoints delivered

See docs/api-catalogue.md (status column). Auth: login, logout, me, csrf, sessions/revoke, password forgot/reset, invite/accept. Users: list/get/create/update/deactivate/reactivate/roles. Teams: list/create/delete + members list/add/remove. Delegations: list/create/revoke. Org settings: get/patch. Audit-logs: list. Permissions catalogue. Health: /health, /ready, /health/ready. Docs: /api/docs, /api/v1/openapi.json.

## 8. Test helper kit (`apps/api/test/helpers`)

| Helper | Purpose |
|---|---|
| `createTestApp({ extraControllers?, customize? })` | boots the real AppModule + `configureApp` (helmet, cookies, CORS, guards, envelope) on the test DB; returns `{ app, prisma, close }`. `extraControllers` mounts probe routes |
| `createOrg(prisma)`, `createUser(prisma, org, { roles, managerId?, isActive?, password?: null })`, `createTeam(...)`, `uniq()` | fixtures; all users share `TEST_PASSWORD` (one cached argon2 hash) |
| `buildOrgFixture(prisma)` | Founder -> TeamLead -> ManagerA(execA1,A2)/ManagerB(execB1,B2) + Admin, HR, Finance, teams A/B |
| `loginAgent(app, user)` -> `AuthedAgent` | real login; `.get/.post/.patch/.delete(path)` auto-prefix `/api/v1`, cookie jar, `x-csrf-token` and allowed `Origin` headers; `.postNoCsrf` |
| `anonymous(app)` | cookie-less client |
| `latestEmailToken(prisma, email)` | reads the reset/invite token from the outbox email stub |
| `listRoutes(app)` (`helpers/routes.ts`) | route + permission-metadata introspection |

Create your own users in your own org per test file (unique slug/email) - never truncate tables. Use a separate fixture org for cross-org assertions. The audit table cannot be cleaned (append-only) - do not try.
Mandatory per domain: cross-team, cross-org, exec-to-exec denial tests for each read/write endpoint, plus a row in the negative-authz table.

## 9. Verification (real runs, 2026-10-15)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | OK (lockfile up to date) |
| `pnpm db:validate` | valid |
| `pnpm db:push` (DB `salesos_agentb`) | in sync; `pnpm db:generate` OK (Prisma Client 6.19.3) |
| `pnpm lint` | 0 errors, 0 warnings in all workspaces |
| `pnpm typecheck` | OK in all 6 workspaces (incl. web, ui) |
| `pnpm --filter @salesos/api test` | 11 files, 136 tests passed |
| `pnpm --filter @salesos/worker test` | 1 file, 8 tests passed |
| `pnpm build` | OK (shared-types, validation, api, worker, web, ui); built API booted and answered `/ready` + `/api/docs`; built worker started |
| `pnpm test` (root) | stops at `@salesos/web`: "No test files found" (web agent has not added tests yet; not an Agent B failure) |

## 10. Decisions / deviations to reconcile (NEEDS_DECISION)

1. **Sensitive role assignment** (`users:role:assign-sensitive`, Founder only) is stricter than the matrix, where ADMIN has `users:role:assign`. Admin can assign any non-sensitive role; FOUNDER_CEO / HR / FINANCE need the Founder. Rationale: otherwise Admin can grant itself/colluders HR or payment access, contradicting DEC-032. Remove the key from `permissions/identity.ts` and the matrix if the owner prefers Admin to assign everything.
2. **Primary-role cardinality**: matrix says exactly one primary role; the API enforces *at most one* so secondary-only staff (Marketing, HR, ...) can exist without a sales role.
3. **`users:view` for TEAM LEAD is `org`** (matrix), so a Team Lead lists every user; team-scoped data keys (audit:view) still use the hierarchy.
4. **Delegations path**: `/delegations` (list/create/revoke) instead of `POST /users/:id/delegations`; delegator must be inside the creator's hierarchy (Founder: anyone), max 90 days.
5. **Settings path** is `/org/settings` (prompt) while api-catalogue.md listed `/settings`; catalogue updated.
6. `/api/v1/openapi.json` is disabled in production by default (`ENABLE_DOCS`) instead of auth-gated.
7. `auth:login` etc. are catalogue entries; public auth routes use `@Public()` with throttling rather than a permission check.
8. Email: provider interface + outbox stub only; real provider and scrubbing of payload links after send are a later task (see docs/security.md section 10).
9. Not built (catalogued, marked NOT_STARTED): `GET/PATCH /teams/:id`, `GET /audit-logs/export`, idempotency-key interceptor (table `idempotency_keys` exists, no consumer yet; domains with idempotent creates should implement against it), `settings:policy:approve` flow.
10. Migrations: only `db push` was used. `prisma/sql/guards.sql` (audit append-only trigger) must be included in the lead's consolidated migration. The API also applies it idempotently at boot.
11. The `email` column is globally unique (not per organization) so login needs only email + password. Revisit if multi-tenant SaaS is ever required.
12. Worker test DB is `salesos_agentb_wtest` (API: `salesos_agentb_test`); CI creates `salesos_ci` + `salesos_ci_wtest`.
