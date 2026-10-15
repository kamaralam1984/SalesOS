# CoachEasily SalesOS

Sales CRM for CoachEasily (monorepo: pnpm workspaces, Node 24, TypeScript strict).

| Path | What |
|---|---|
| `apps/api` | NestJS REST API (`/api/v1`), Prisma, sessions/RBAC/audit/outbox |
| `apps/worker` | BullMQ worker: outbox dispatcher, event consumer, job registry |
| `apps/web` | Next.js app (see its own docs) |
| `packages/shared-types` | Role/permission/envelope/pagination types, domain event contracts |
| `packages/validation` | Zod schemas shared by API and web |
| `packages/ui` | Design system components |
| `prisma/schema/*.prisma` | Multi-file Prisma schema (one file per domain), `prisma/sql/guards.sql` DB guards |
| `docs/` | Architecture, permissions matrix, API catalogue, security, runbooks |

Docs worth reading first: `docs/architecture.md`, `docs/permissions-matrix.md`, `docs/security.md`, `docs/api-catalogue.md`, `docs/phase-1-2-backend-report.md` (rules for building new backend modules).

## Setup

Prerequisites: Node 24, pnpm 11, Docker.

```bash
docker compose up -d                   # salesos-postgres :5533, salesos-redis :6391, salesos-minio :9100
cp .env.example .env                   # edit DATABASE_URL (use your own database name) and SESSION_SECRET
docker exec salesos-postgres psql -U salesos -c 'CREATE DATABASE salesos_dev'   # if you use a dedicated DB
pnpm install
pnpm db:generate                       # prisma client
pnpm db:migrate                        # apply the committed migrations (prisma migrate deploy; safe to re-run). Quick dev alternative: pnpm db:push
BOOTSTRAP_ADMIN_EMAIL=you@example.com BOOTSTRAP_ADMIN_NAME="Your Name" BOOTSTRAP_ADMIN_PASSWORD='choose-a-strong-one' pnpm db:seed   # org + owner Founder + roles only; NO sample data
pnpm --filter @salesos/api dev         # API on http://localhost:4100  (docs: /api/docs)
pnpm --filter @salesos/worker dev      # outbox dispatcher + job processors
```

Generate a session secret with `openssl rand -base64 48`. `.env.example` contains placeholders only.

## Commands

| Command | Purpose |
|---|---|
| `pnpm lint` | ESLint (api, worker, packages, web) |
| `pnpm typecheck` | builds shared packages, generates the Prisma client, runs `tsc --noEmit` everywhere |
| `pnpm test` | unit + integration tests (real PostgreSQL + Redis, no DB mocks) |
| `pnpm build` | production build of every workspace |
| `pnpm db:validate` / `db:push` / `db:generate` / `db:seed` | Prisma helpers (schema folder `prisma/schema`) |
| `pnpm db:migrate` | `prisma migrate deploy` (migrations live in `prisma/schema/migrations`) |
| `pnpm db:guards:export` / `pnpm db:migration:build` | regenerate `prisma/sql/*.sql` from the TypeScript guards, then the consolidated migration (only before the first production deploy) |
| `pnpm migration-check` | proves the migrations on an EMPTY throwaway database: deploy, re-run is a no-op, no drift, guards and FKs enforced |
| `pnpm --filter @salesos/api permissions:matrix` | regenerates the per-role appendix of `docs/permissions-matrix.md` from the code catalogue |

### Tests

API tests run against the dedicated database `salesos_agentb_test` on the compose Postgres (override with `TEST_DATABASE_URL`); worker tests use `salesos_agentb_wtest` (`TEST_WORKER_DATABASE_URL`) and a random BullMQ prefix on Redis. The setup runs `prisma db push` itself; with `TEST_DB_MODE=migrate` it recreates the schema ONLY from the committed migrations (what CI does). Tests refuse to run against the database named exactly `salesos`. Create the two databases once:

```bash
docker exec salesos-postgres psql -U salesos -c 'CREATE DATABASE salesos_agentb_test'
docker exec salesos-postgres psql -U salesos -c 'CREATE DATABASE salesos_agentb_wtest'
```

## Bootstrap (no demo data) and optional demo seed

`pnpm db:seed` is production-safe: it creates only the organisation, one owner user with the FOUNDER_CEO role, and the role/permission catalogue. It never creates people, leads, deals or payments. Configure it with environment variables (never commit them): `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_PASSWORD` (min 10 chars), optional `BOOTSTRAP_ORG_NAME` (default `CoachEasily`) and `BOOTSTRAP_ORG_SLUG`. It is idempotent; an existing owner's password is only changed with `BOOTSTRAP_RESET_PASSWORD=true`.

`pnpm db:seed:demo` (developer/CI throw-away databases only) fills a separate `[DEMO]` organisation with fake users and records for UI development and E2E. It refuses `NODE_ENV=production`, non-local database hosts and databases that hold a real organisation. Never run it against the working database.

## API conventions (short)

- Prefix `/api/v1`; every JSON response is `{ data, meta, error }` (`meta.requestId` always present; `meta.pagination`, `meta.warnings` when relevant).
- Cookie session auth + `x-csrf-token` header on unsafe methods. Browser origins must be listed in `CORS_ORIGINS`.
- OpenAPI/Swagger UI at `/api/docs`, JSON at `/api/v1/openapi.json` (disabled in production unless `ENABLE_DOCS=true`).
- Health: `GET /api/v1/health` (liveness), `GET /api/v1/ready` (DB + Redis).

## CI

`.github/workflows/ci.yml`, job `verify`: install (frozen lockfile), prisma validate/generate, build of the shared packages (shared-types, validation, platform-core, crm-core, cx-core), generated-files check (permissions matrix, guard SQL, migration), `migration-check`, lint, typecheck, all test suites (api, worker, web; Postgres + Redis + MinIO services; databases built from migrations only), build, dependency audit and gitleaks. Job `e2e`: builds everything, creates the schema with `migrate deploy`, seeds the throw-away CI database with `db:seed:demo`, starts the built api + worker + web and runs the Playwright journeys (auth, CRM, revenue, people, CX, platform, integration).
