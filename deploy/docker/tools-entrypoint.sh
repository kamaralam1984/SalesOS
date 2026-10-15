#!/bin/sh
# Operations entrypoint for salesos-tools. Usage: migrate | seed | seed-starter | seed-demo | status | resolve <args>
set -eu
cmd="${1:-migrate}"; [ $# -gt 0 ] && shift || true
case "$cmd" in
  migrate) exec pnpm exec prisma migrate deploy --schema prisma/schema ;;
  status)  exec pnpm exec prisma migrate status --schema prisma/schema ;;
  resolve) exec pnpm exec prisma migrate resolve --schema prisma/schema "$@" ;;
  seed)
    # Production-safe bootstrap: org + owner Founder + role catalogue only. Needs BOOTSTRAP_ADMIN_EMAIL/NAME/PASSWORD in env.
    exec pnpm --filter @salesos/api db:seed ;;
  seed-starter)
    # Reference catalogue named in the JD (AI Sprint, CBAX, MCA X, MCA Elite X, CoachEasily X app, Wealthy Coach Summit). No prices, leads or people. Idempotent.
    exec pnpm --filter @salesos/api db:seed:starter ;;
  seed-demo)
    # Demo seed refuses NODE_ENV=production by design. Only run this against throw-away dev/CI databases.
    if [ "${ALLOW_DEMO_SEED:-}" != "yes" ]; then echo "refusing: set ALLOW_DEMO_SEED=yes (throw-away environments only; never production)" >&2; exit 2; fi
    exec env NODE_ENV=development pnpm --filter @salesos/api db:seed:demo ;;
  *) echo "usage: migrate|seed|seed-starter|seed-demo|status|resolve" >&2; exit 2 ;;
esac
