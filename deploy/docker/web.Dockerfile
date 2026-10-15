# SalesOS web (Next.js standalone) image. Build from the REPO ROOT:
#   docker build -f deploy/docker/web.Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://app.example.com/api/v1 -t salesos-web:<version> .
# NEXT_PUBLIC_API_URL is inlined at BUILD time (browser bundle + CSP connect-src): one image per public API origin.
ARG NODE_IMAGE=node:24.11.1-slim

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
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
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL=http://localhost:4100/api/v1
ARG ENABLE_STYLE_GUIDE=false
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_STANDALONE=1 NEXT_DIST_DIR=.next
RUN pnpm --filter @salesos/shared-types --filter @salesos/validation run build \
 && pnpm --filter @salesos/web run build

FROM ${NODE_IMAGE} AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 10001 salesos && useradd -u 10001 -g salesos -m -s /usr/sbin/nologin salesos
ENV NODE_ENV=production PORT=3100 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=salesos:salesos /repo/apps/web/.next/standalone /app
COPY --from=build --chown=salesos:salesos /repo/apps/web/.next/static /app/apps/web/.next/static
COPY --from=build --chown=salesos:salesos /repo/apps/web/public /app/apps/web/public
COPY --from=build --chown=salesos:salesos /repo/apps/web/messages /app/apps/web/messages
USER salesos
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=4s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/offline').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","apps/web/server.js"]
