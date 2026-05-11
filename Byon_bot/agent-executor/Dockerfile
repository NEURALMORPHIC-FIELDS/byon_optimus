# Agent Executor Dockerfile
# Runtime: Node.js 22 + Python 3.11 with Jupyter Kernel
# IMPORTANT: This container runs with network_mode: none (AIR-GAPPED)

FROM node:22-alpine AS node-base

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
COPY agent-executor/package.json ./agent-executor/

# Install all dependencies from workspace root
RUN pnpm install --no-frozen-lockfile

# Copy agent source code
COPY agent-executor/ ./agent-executor/

# Build shared first, then agent
WORKDIR /app/shared
RUN pnpm build

WORKDIR /app/agent-executor
RUN pnpm build

# Production stage with Python for Jupyter
FROM python:3.11-slim AS production

# Install Node.js 22
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    corepack enable && corepack prepare pnpm@latest --activate && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Python dependencies for Jupyter kernel
RUN pip install --no-cache-dir \
    jupyter_client>=8.0.0 \
    ipykernel>=6.0.0 \
    pyzmq>=25.0.0 \
    pytest>=7.0.0 \
    pytest-json-report>=1.5.0

# Install IPython kernel
RUN python -m ipykernel install --user

WORKDIR /app

# Copy workspace config for runtime resolution
COPY pnpm-workspace.yaml ./
COPY package.json ./

# Copy root node_modules with .pnpm store (required for symlink resolution)
COPY --from=node-base /app/node_modules ./node_modules

# Copy built Node.js files
COPY --from=node-base /app/shared/dist ./shared/dist
COPY --from=node-base /app/shared/package.json ./shared/
COPY --from=node-base /app/shared/node_modules ./shared/node_modules
COPY --from=node-base /app/agent-executor/dist ./agent-executor/dist
COPY --from=node-base /app/agent-executor/package.json ./agent-executor/
COPY --from=node-base /app/agent-executor/node_modules ./agent-executor/node_modules

WORKDIR /app/agent-executor

# Create directories
RUN mkdir -p /handoff/auditor_to_executor \
             /handoff/executor_to_worker \
             /project \
             /tmp/kernel

# Environment
ENV NODE_ENV=production
ENV ROLE=executor
ENV PYTHONUNBUFFERED=1

# No health check needed - AIR-GAPPED container
# Runs only when triggered by execution order

# Security: Run as non-root user
RUN useradd -m -s /bin/bash executor
RUN chown -R executor:executor /app /handoff /project /tmp/kernel
USER executor

CMD ["node", "dist/index.js"]
