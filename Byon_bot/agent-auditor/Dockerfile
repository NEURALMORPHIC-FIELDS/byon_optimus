# Agent Auditor Dockerfile
# Runtime: Node.js 22 with Ed25519 signing

FROM node:22-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml ./
COPY package.json ./

# Copy shared module
COPY shared/package.json ./shared/
COPY shared/ ./shared/

# Copy agent source
COPY agent-auditor/package.json ./agent-auditor/

# Install all dependencies from workspace root
RUN pnpm install --no-frozen-lockfile

# Copy agent source code
COPY agent-auditor/ ./agent-auditor/

# Build shared first, then agent
WORKDIR /app/shared
RUN pnpm build

WORKDIR /app/agent-auditor
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

# Copy built files
COPY --from=base /app/shared/dist ./shared/dist
COPY --from=base /app/shared/package.json ./shared/
COPY --from=base /app/shared/node_modules ./shared/node_modules
COPY --from=base /app/agent-auditor/dist ./agent-auditor/dist
COPY --from=base /app/agent-auditor/package.json ./agent-auditor/
COPY --from=base /app/agent-auditor/node_modules ./agent-auditor/node_modules

WORKDIR /app/agent-auditor

# Create handoff directories
RUN mkdir -p /handoff/worker_to_auditor \
             /handoff/auditor_to_user \
             /handoff/auditor_to_executor

# Create keys directory (for Ed25519 keys)
RUN mkdir -p /keys

# Environment
ENV NODE_ENV=production
ENV ROLE=auditor

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "console.log('healthy')" || exit 1

CMD ["node", "dist/index.js"]
