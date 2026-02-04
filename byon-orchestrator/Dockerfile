# BYON Orchestrator Dockerfile
# ============================
#
# Multi-Agent Control Protocol (MACP v1.1) Orchestrator
# Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac
#
# Build with --target to select agent:
#   docker build --target worker -t byon-worker .
#   docker build --target auditor -t byon-auditor .
#   docker build --target executor -t byon-executor .
#
# For development:
#   docker build --target development -t byon-dev .

# ============================================
# Base Stage - Common Dependencies
# ============================================
FROM node:22-alpine AS base

# Labels
LABEL maintainer="BYON Team"
LABEL description="BYON Orchestrator - MACP v1.1"
LABEL version="1.0.0"
LABEL patent="EP25216372.0 - OmniVault"

# Install system dependencies
RUN apk add --no-cache \
    curl \
    python3 \
    make \
    g++

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json ./
COPY package-lock.json* ./

# Install all dependencies (dev included for build)
RUN npm ci

# Copy TypeScript config
COPY tsconfig.json ./

# Copy BYON config (used by CLI)
COPY byon-config.ts ./

# Copy source code
COPY src/ ./src/

# ============================================
# Build Stage
# ============================================
FROM base AS builder

# Build TypeScript to JavaScript
RUN npm run build

# Prune dev dependencies for smaller production image
RUN npm prune --production

# ============================================
# Development Stage
# ============================================
FROM base AS development

# Install tsx for hot reload
RUN npm install -g tsx

# Create all handoff directories
RUN mkdir -p /handoff/inbox \
    /handoff/worker_to_auditor \
    /handoff/auditor_to_user \
    /handoff/auditor_to_executor \
    /handoff/executor_to_worker

# Environment
ENV NODE_ENV=development
ENV LOG_LEVEL=debug

# Entry point for development (hot reload)
CMD ["npx", "tsx", "watch", "src/index.ts"]

# ============================================
# Production Base - Shared for all agents
# ============================================
FROM node:22-alpine AS production-base

# Install curl for health checks
RUN apk add --no-cache curl

WORKDIR /app

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# SECURITY: Create non-root user for all production agents
RUN addgroup -g 1001 -S byon && \
    adduser -S byon -u 1001 -G byon && \
    chown -R byon:byon /app

# Environment defaults
ENV NODE_ENV=production

# ============================================
# Worker Agent (A) - Evidence & Plan Builder
# ============================================
FROM production-base AS worker

# Create worker handoff directories with proper ownership
RUN mkdir -p /handoff/inbox \
    /handoff/worker_to_auditor \
    /handoff/executor_to_worker && \
    chown -R byon:byon /handoff

# Worker environment
ENV AGENT_ROLE=worker

# SECURITY: Run as non-root user
USER byon

# Health check - verifies agent is responsive
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3002/health || exit 1

# Expose health check port
EXPOSE 3002

# Run worker agent
CMD ["node", "dist/src/agents/worker/index.js"]

# ============================================
# Auditor Agent (B) - Validation & Approval
# ============================================
FROM production-base AS auditor

# Create auditor handoff directories with proper ownership
RUN mkdir -p /handoff/worker_to_auditor \
    /handoff/auditor_to_user \
    /handoff/auditor_to_executor \
    /keys && \
    chown -R byon:byon /handoff /keys

# Auditor environment
ENV AGENT_ROLE=auditor

# SECURITY: Run as non-root user
USER byon

# Health check - verifies agent is responsive
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3003/health || exit 1

# Expose health check port
EXPOSE 3003

# Run auditor agent
CMD ["node", "dist/src/agents/auditor/index.js"]

# ============================================
# Executor Agent (C) - AIR-GAPPED Execution
# ============================================
# SECURITY: This agent runs with network_mode: none
# NO API keys, NO external network access
FROM node:22-alpine AS executor

WORKDIR /app

# Copy ONLY essential files - minimal footprint for air-gap
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# Create executor handoff directories
RUN mkdir -p /handoff/auditor_to_executor \
    /handoff/executor_to_worker \
    /project \
    /keys

# Executor environment - NO API KEYS!
ENV NODE_ENV=production
ENV AGENT_ROLE=executor
ENV PROJECT_ROOT=/project
ENV MAX_ITERATIONS=10
ENV EXECUTION_TIMEOUT=1800000

# Security: Create non-root user
RUN addgroup -g 1001 -S byon && \
    adduser -S byon -u 1001 -G byon && \
    chown -R byon:byon /app /handoff /project

# Run as non-root for security
USER byon

# No health check - executor is triggered manually and runs air-gapped
# No HEALTHCHECK instruction

# Run executor agent
CMD ["node", "dist/src/agents/executor/index.js"]

# ============================================
# CLI Tool
# ============================================
FROM production-base AS cli

# CLI environment
ENV AGENT_ROLE=cli

# Run CLI
ENTRYPOINT ["node", "dist/src/cli/index.js"]
