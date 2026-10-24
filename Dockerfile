# ------------------------------------------------------------------------------
# Stage 1: Base image with pnpm installed
# ------------------------------------------------------------------------------
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

# ------------------------------------------------------------------------------
# Stage 2: Dependencies and build
# ------------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app

# Copy workspace dependency manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/schema/package.json ./packages/schema/
COPY packages/live-connectors/package.json ./packages/live-connectors/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/edge-agent/package.json ./apps/edge-agent/

# Install dependencies strictly with frozen lockfile
RUN pnpm install --frozen-lockfile

# Copy full source repository
COPY . .

# Build all packages and applications (schema, web dist, api dist)
RUN pnpm -r build

# ------------------------------------------------------------------------------
# Stage 3: Production runner (minimal runtime, non-root user)
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0
ENV WEB_DIST_PATH=/app/apps/web/dist

# Create non-root system user and group
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

# Copy root workspace files and dependencies
COPY --from=builder --chown=appuser:nodejs /app/package.json ./package.json
COPY --from=builder --chown=appuser:nodejs /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules

# Copy shared workspace packages
COPY --from=builder --chown=appuser:nodejs /app/packages/schema ./packages/schema
COPY --from=builder --chown=appuser:nodejs /app/packages/live-connectors ./packages/live-connectors

# Copy web built static assets (served by API via @fastify/static)
COPY --from=builder --chown=appuser:nodejs /app/apps/web/dist ./apps/web/dist

# Copy API artifacts and dependencies
COPY --from=builder --chown=appuser:nodejs /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=appuser:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=appuser:nodejs /app/apps/api/node_modules ./apps/api/node_modules

# Run as non-root user
USER appuser

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/api/dist/index.js"]
