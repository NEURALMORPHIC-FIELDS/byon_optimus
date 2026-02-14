# BYON Memory Service Dockerfile
# ===============================
#
# FAISS-Optimized Memory Service (O2 Optimized: Multi-Stage Build)
# Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac
#
# Backend: FAISS IndexFlatIP (cosine similarity)
# Features:
#   - Real semantic search via sentence-transformers
#   - Per-type FAISS indices (code/conversation/fact)
#   - Persistent storage with auto-save
#
# Build:
#   docker build -t byon-memory-service .
#
# Run:
#   docker run -p 8000:8000 \
#     -v ./memory_storage:/app/memory_storage \
#     byon-memory-service

# ============================================================================
# STAGE 1: Builder - Install dependencies
# ============================================================================
FROM python:3.11-slim AS builder

WORKDIR /build

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy requirements first (for layer caching)
COPY requirements.txt .

# Install Python dependencies into venv
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# ============================================================================
# STAGE 2: Production - Minimal runtime image
# ============================================================================
FROM python:3.11-slim AS production

LABEL maintainer="BYON Team"
LABEL description="FAISS-optimized memory service for BYON orchestrator"
LABEL version="4.0.0"
LABEL patent="EP25216372.0 - OmniVault"
LABEL optimization="O2 multi-stage build"

# Set working directory
WORKDIR /app

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv

# Ensure venv is used
ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Copy memory service code
COPY server.py .
COPY handlers.py .

# Create storage directory and model cache directory
RUN mkdir -p /app/memory_storage /app/model_cache

# Create non-root user for security with proper home directory
RUN groupadd -r byon && useradd -r -g byon -d /app byon && \
    chown -R byon:byon /app

# Environment variables
ENV MEMORY_SERVICE_HOST=0.0.0.0
ENV MEMORY_SERVICE_PORT=8000
ENV MEMORY_STORAGE_PATH=/app/memory_storage
# Set HuggingFace cache directory to writable location
ENV HF_HOME=/app/model_cache
ENV TRANSFORMERS_CACHE=/app/model_cache
ENV SENTENCE_TRANSFORMERS_HOME=/app/model_cache

# Health check (using Python urllib, not curl)
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

# Expose port
EXPOSE 8000

# Run as non-root
USER byon

# Run server
CMD ["python", "server.py"]
