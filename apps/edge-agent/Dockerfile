# ConfigPlatform edge agent. Build from the repository root:
#   docker build -f apps/edge-agent/Dockerfile -t configplatform/edge-agent .
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

FROM base AS builder
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/schema/package.json ./packages/schema/
COPY packages/live-connectors/package.json ./packages/live-connectors/
COPY apps/edge-agent/package.json ./apps/edge-agent/
RUN pnpm install --frozen-lockfile --filter @config-platform/edge-agent...
COPY packages/schema ./packages/schema
COPY packages/live-connectors ./packages/live-connectors
COPY apps/edge-agent ./apps/edge-agent
RUN pnpm --filter @config-platform/edge-agent... build
# A self-contained copy of the agent and its production dependencies
RUN pnpm --filter @config-platform/edge-agent deploy --prod --legacy /out

FROM node:22-alpine AS runner
WORKDIR /agent
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 agent && adduser --system --uid 1001 --ingroup agent agent
COPY --from=builder --chown=agent:agent /out ./
USER agent
CMD ["node", "dist/index.js"]
