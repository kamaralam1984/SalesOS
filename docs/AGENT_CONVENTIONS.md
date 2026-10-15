# Agent conventions (binding for every build agent)

Project root: `/home/kamar-alam/Project/Sales app` (NOT a git repo; do not run `git init`/commit).
Specs: `PHASE_PROMPTS.md` (sections A, B, C + the phase prompt), `CLAUDE (1).md` (master spec), Blueprint PDF, JD docx (`/home/kamar-alam/Downloads/Job_Description_Sales_Team_Lead_CoachEasily.docx`; text-extract with `python3 -I`+zipfile, XML strip).

## Machine safety
- This machine hosts UNRELATED projects/containers/services. Never stop, restart, remove, or modify anything not named `salesos-*`. Never touch system nginx/postgres/redis services, ports other than those below, or files outside the project root (scratch: the session scratchpad dir).
- Infra is already running (docker compose in project root): Postgres `127.0.0.1:5533` (user `salesos`, password `salesos_dev_only`), Redis `127.0.0.1:6391`, MinIO API `127.0.0.1:9100` (console 9101, user `salesos_minio`, pw `salesos_minio_dev_only`). Dev-only credentials; real secrets only via env.
- App ports: web `3100`, api `4100`. Parallel agents must use distinct ports for dev servers they start (api 4100+N, web 3100+N where N = your agent number) and kill only processes you started.
- Each agent uses its OWN database for tests/dev: create `salesos_<agentname>` (e.g. `createdb`-style via `docker exec salesos-postgres psql -U salesos -c 'CREATE DATABASE ...'`). Never run `migrate reset` or `db push --force-reset` on the shared `salesos` DB.

## Stack (fixed; ADR-001)
pnpm workspaces monorepo, Node 24, TypeScript strict.
- `apps/web` Next.js (App Router) + Tailwind + shadcn-style components + Framer Motion + React Hook Form + Zod.
- `apps/api` NestJS (REST, `/api/v1`), Prisma 6.x (multi-file schema in `prisma/schema/*.prisma`, one file per domain), PostgreSQL.
- `apps/worker` BullMQ on Redis. SSE for live updates.
- `packages/shared-types`, `packages/validation` (Zod), `packages/ui`.
- Tests: Vitest/Jest for api unit+integration (real Postgres test DB, no mocking the DB), Playwright for web E2E where feasible. Lint: ESLint + Prettier. Typecheck: `tsc --noEmit`.
Pin exact versions >= 2 weeks old; do NOT use rc/next/dev dist-tags.

## Shared-file discipline (parallel agents)
- Each agent owns its domain: `prisma/schema/<domain>.prisma`, `apps/api/src/modules/<domain>/`, `apps/web/src/app/(app)/<domain>/`, `apps/web/src/features/<domain>/`, `apps/worker/src/jobs/<domain>/`, `docs/<domain>-*.md`, tests under the same domain folders.
- Pre-created registry/slot files (module registry, nav registry, worker job registry, permission catalogue) exist so you edit ONLY your own slot file. Do not reformat or reorder other domains' content.
- Shared models (Organization, User, Team, Lead, ...) are owned by their phase. To relate to them add the FK + `@relation` in YOUR file and append the back-relation field to the owner's model with one small, atomic `Edit` (re-read the file right before editing; retry on mismatch). Never rewrite other domains' files wholesale.
- During parallel work use `prisma db push` against your own DB for iteration. Do NOT create migration files in parallel waves; the lead generates consolidated migrations at wave end (reconcile step). Keep `prisma validate` green.
- Never `pnpm add` in a way that rewrites the lockfile destructively while another agent installs; run `pnpm install --no-frozen-lockfile` and re-run if it conflicts. Prefer adding deps only to your own workspace package.json.

## Quality rules
- Server-side authorization on EVERY endpoint via the central policy layer (deny-by-default, org-scoped, IDOR-safe); negative authz tests per endpoint group.
- All money = Prisma Decimal + currency; UTC timestamps; UUID PKs; organization_id scope; audit logs for sensitive actions; idempotency where specified.
- Never show mock data as real; demo seed data must be labelled `[DEMO]`.
- UI: states for loading/empty/error/success/permission-denied; mobile-first; accessible; use the design tokens/components from `packages/ui` and `apps/web` shell. No excessive gradients/glow. Respect reduced motion.
- Done = code + tests + docs + traceability update (`docs/requirements-traceability.md`: set Status for rows you cover to IMPLEMENTED_UNTESTED or VERIFIED only if a test really ran and passed; BLOCKED/NEEDS_DECISION with reason otherwise).
- Report only real command results. Never claim an unrun test passed. Fix failures; do not suppress lint/type errors or skip tests.
- Business rules not decided: use the documented default from `docs/decision-log.md` (status "default – awaiting owner approval"), make it configurable, do not invent silently.

## Final report format (your last message)
Short: what you built, files/dirs touched, exact commands run + real pass/fail counts, requirements rows updated, known issues/BLOCKED items, anything the lead must reconcile (schema relations, registries, deps).
