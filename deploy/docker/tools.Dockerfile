# One-off operations image: prisma migrate deploy, demo seed (staging only), migration-check. NOT a long-running service.
#   docker build -f deploy/docker/tools.Dockerfile -t salesos-tools:<version> .
ARG NODE_IMAGE=node:24.11.1-slim
FROM ${NODE_IMAGE}
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true COREPACK_HOME=/usr/local/share/corepack
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 10001 salesos && useradd -u 10001 -g salesos -m -s /usr/sbin/nologin salesos
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
COPY prisma prisma
COPY packages packages
COPY apps/api apps/api
RUN pnpm exec prisma generate --schema prisma/schema \
 && pnpm --filter @salesos/shared-types --filter @salesos/validation --filter @salesos/platform-core run build \
 && pnpm --filter @salesos/crm-core run build && pnpm --filter @salesos/cx-core run build \
 && chown -R salesos:salesos /repo
COPY --chown=salesos:salesos deploy/docker/tools-entrypoint.sh /usr/local/bin/salesos-tools
USER salesos
ENTRYPOINT ["/usr/local/bin/salesos-tools"]
CMD ["migrate"]
