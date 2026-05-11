# Agent Worker Dockerfile
# Runtime: Node.js 22 with OpenClaw base

FROM node:22-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml ./
COPY package.json ./

# Copy shared modules (shared and shared/memory are separate workspace packages)
COPY shared/package.json ./shared/
COPY shared/ ./shared/

# Copy agent source
COPY agent-worker/package.json ./agent-worker/

# Install all dependencies from workspace root
RUN pnpm install --no-frozen-lockfile

# Copy agent source code
COPY agent-worker/ ./agent-worker/

# Build shared packages first, then agent
WORKDIR /app/shared
RUN pnpm build

WORKDIR /app/shared/memory
RUN pnpm build || true

WORKDIR /app/agent-worker
RUN pnpm build

# Production stage
FROM node:22-alpine AS production

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace config for runtime resolution
COPY pnpm-workspace.yaml ./
COPY package.json ./

# Copy root node_modules with .pnpm store (required for symlink resolution)
COPY --from=base /app/node_modules ./node_modules

# Copy built shared modules
COPY --from=base /app/shared/dist ./shared/dist
COPY --from=base /app/shared/package.json ./shared/
COPY --from=base /app/shared/node_modules ./shared/node_modules
COPY --from=base /app/shared/memory/dist ./shared/memory/dist
COPY --from=base /app/shared/memory/package.json ./shared/memory/
COPY --from=base /app/shared/memory/node_modules ./shared/memory/node_modules

# Copy built agent files
COPY --from=base /app/agent-worker/dist ./agent-worker/dist
COPY --from=base /app/agent-worker/package.json ./agent-worker/
COPY --from=base /app/agent-worker/node_modules ./agent-worker/node_modules

WORKDIR /app/agent-worker

# Create handoff directories
RUN mkdir -p /handoff/worker_to_auditor

# Environment
ENV NODE_ENV=production
ENV ROLE=worker

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "console.log('healthy')" || exit 1

CMD ["node", "dist/index.js"]
