
# SalesOS API image. Build from the REPO ROOT:
#   docker build -f deploy/docker/api.Dockerfile -t salesos-api:<version> .
ARG NODE_IMAGE=node:24.11.1-slim

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/validation/package.json packages/validation/
COPY packages/platform-core/package.json packages/platform-core/
COPY packages/crm-core/package.json packages/crm-core/
COPY packages/cx-core/package.json packages/cx-core/
COPY packages/workforce-core/package.json packages/workforce-core/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY prisma prisma
COPY packages packages
COPY apps/api apps/api
COPY apps/worker apps/worker
# V8 stops at ~1.25 GB in a memory-capped build container and tsc then aborts ("heap out of memory"); build step only, not in the image.
RUN export NODE_OPTIONS=--max-old-space-size=1800 \
 && pnpm exec prisma generate --schema prisma/schema \
 && pnpm --filter @salesos/shared-types --filter @salesos/validation --filter @salesos/platform-core run build \
 && pnpm --filter @salesos/crm-core run build && pnpm --filter @salesos/cx-core run build && pnpm --filter @salesos/workforce-core run build \
 && pnpm --filter @salesos/api run build
RUN pnpm --filter @salesos/api deploy --prod --legacy /out/api \
 && cp -r prisma /out/api/prisma
# The generated Prisma client lives in the pnpm virtual store, which `pnpm deploy` does not carry: copy it over (same version dir).
RUN set -e; src=$(ls -d /repo/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client); dst=$(ls -d /out/api/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client); \
    cp -r "$src"/. "$dst"/; grep -q "ROUND_HALF_UP\|PrismaClient" "$dst/index.js"; ls "$dst" | grep -q libquery_engine

FROM ${NODE_IMAGE} AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 10001 salesos && useradd -u 10001 -g salesos -m -s /usr/sbin/nologin salesos
ENV NODE_ENV=production PORT=4100
WORKDIR /app
COPY --from=build --chown=salesos:salesos /out/api /app
USER salesos
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=4s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","dist/main.js"]
