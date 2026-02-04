# OPEN_BYON Control UI Dockerfile
# Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac

FROM node:22-alpine

LABEL maintainer="BYON Team"
LABEL description="OPEN_BYON Control UI - Monitoring, Approvals, Memory Search"
LABEL patent="EP25216372.0"

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY server.js ./
COPY public/ ./public/

# Create non-root user for security
RUN addgroup -g 1001 -S byon && \
    adduser -S byon -u 1001 -G byon && \
    chown -R byon:byon /app

USER byon

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Start server
CMD ["node", "server.js"]
