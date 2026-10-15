# ADR-001: Technology stack

- Status: Accepted (default; owner may revisit before Phase 1 lock)
- Date: 2026-10-14
- Deciders: Phase 0 agent per PHASE_PROMPTS section B.1 and docs/AGENT_CONVENTIONS.md

## Context
The Blueprint prescribes Next.js + NestJS + PostgreSQL/Prisma + Redis/BullMQ + SSE. The Master Spec ("CLAUDE (1).md") prescribes Next.js + Python FastAPI + SQLAlchemy/Alembic and permits reuse of an existing stack. The repository was empty of application code at the start of Phase 0 (greenfield; only docs, docker-compose.yml and infra). PHASE_PROMPTS B.1 states the greenfield default is a TypeScript monorepo and that an existing different stack must be reused with an ADR.

## Decision
- pnpm workspaces monorepo, Node 24, TypeScript strict.
- Web: Next.js App Router, Tailwind, shadcn-style components, Framer Motion, React Hook Form + Zod.
- API: NestJS (REST `/api/v1`), Prisma 6.x multi-file schema, PostgreSQL.
- Worker: BullMQ on Redis. Live updates: SSE.
- Storage: private S3/R2-compatible (MinIO in dev). Docker for dev/deploy.
- Shared packages: `shared-types`, `validation` (Zod), `ui`.
- Tests: Vitest/Jest + real Postgres test DB; Playwright E2E. ESLint + Prettier; `tsc --noEmit`.
- Pin exact dependency versions >= 2 weeks old; no rc/next/dev tags.

## Conflict resolution (Blueprint vs Master Spec)
| Topic | Blueprint | Master Spec | Resolution |
|---|---|---|---|
| API language | NestJS | FastAPI | NestJS (one language end to end; shared Zod schemas/types; Blueprint build prompts assume it) |
| ORM/migrations | Prisma | SQLAlchemy + Alembic | Prisma migrate; multi-file schema per domain (ADR-002) |
| Queue | Redis + BullMQ | Redis/worker generic | BullMQ |
| DB host | PostgreSQL | PostgreSQL (Neon if appropriate) | PostgreSQL; hosting undecided (DEC-040) |
| Roles | CEO/Manager/Salesperson | Founder/Team Lead/Manager/Executive/Admin | Five roles + secondary groups (Master Spec superset) |
| Charts | not specified | maintained charting lib | chosen in Phase 1 with accessible table fallback |

The Master Spec's own text says Python is a "recommended baseline", not a requirement; it also says not to migrate technology for preference. Since no existing stack exists, no migration is involved.

## Why
One language and shared validation reduce contract drift between UI/API/worker; Prisma gives typed access and migrations; NestJS modules map directly to the modular monolith; BullMQ is the Blueprint's reliability mechanism.

## Consequences
- Python/FastAPI-specific Master Spec instructions (SQLAlchemy, Alembic, Pydantic) are translated to Prisma/Zod equivalents.
- Prisma lacks some Postgres features (partial indexes, check constraints, RLS): add via raw SQL in migrations; consolidated by the lead at wave end.
- Decimal handling: Prisma Decimal (decimal.js) end to end; never JS number for money.
- If an existing different stack is later discovered, record a superseding ADR.

## Alternatives rejected
FastAPI + Next.js (two languages, duplicate validation); Django (not Blueprint); microservices (ADR-002).
