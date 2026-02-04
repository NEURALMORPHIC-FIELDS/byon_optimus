#!/usr/bin/env python3
"""
BYON Memory Service
===================

HTTP microservice wrapper for FHRSS+FCPE infinite memory system.

Provides REST API for:
- Store: code, conversation, fact memories
- Search: semantic similarity search
- Recovery: test FHRSS fault tolerance
- Stats: system statistics

CRITICAL:
- This service MUST be running for BYON orchestrator to start
- FHRSS provides 100% recovery at 40% data loss
- FCPE provides 73,000x compression for infinite context

Patent: FHRSS/OmniVault - Vasile Lucian Borbeleac - EP25216372.0
"""

import os
import sys
import json
import time
import hashlib
import logging
from pathlib import Path
from typing import Dict, Any, Optional, List

# Add parent path for fhrss_fcpe_unified import
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "INFINIT_MEMORYCONTEXT"))

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from collections import defaultdict
import numpy as np
import uvicorn

# Import handlers
from handlers import MemoryHandlers, MemoryType

# ============================================================================
# LOGGING (must be defined before prometheus imports use it)
# ============================================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger("byon-memory-service")

# Prometheus metrics (O4 optimization)
# Using custom registry to avoid collision errors on container restarts
PROMETHEUS_AVAILABLE = False
REGISTRY = None

try:
    from prometheus_client import (
        Counter, Histogram, Gauge,
        CollectorRegistry, generate_latest,
        CONTENT_TYPE_LATEST
    )
    PROMETHEUS_AVAILABLE = True
    logger.info("Prometheus client available, initializing metrics")
except ImportError:
    logger.warning("Prometheus client not available, metrics disabled")

# ============================================================================
# PROMETHEUS METRICS - CUSTOM REGISTRY
# ============================================================================
# Using custom CollectorRegistry to avoid collision errors on container restarts

REQUEST_COUNT = None
REQUEST_LATENCY = None
STORE_OPERATIONS = None
SEARCH_OPERATIONS = None
SEARCH_LATENCY = None
SEARCH_RESULTS = None
CONTEXTS_TOTAL = None
UPTIME_SECONDS = None
RATE_LIMIT_EXCEEDED = None

if PROMETHEUS_AVAILABLE:
    # Create custom registry to avoid collisions
    REGISTRY = CollectorRegistry()
    
    # Request metrics
    REQUEST_COUNT = Counter(
        'memory_service_requests_total',
        'Total number of requests',
        ['method', 'endpoint'],
        registry=REGISTRY
    )
    
    REQUEST_LATENCY = Histogram(
        'memory_service_request_duration_seconds',
        'Request latency in seconds',
        ['method', 'endpoint'],
        registry=REGISTRY
    )
    
    # Store operation metrics
    STORE_OPERATIONS = Counter(
        'memory_service_store_operations_total',
        'Total number of store operations',
        ['memory_type'],
        registry=REGISTRY
    )
    
    # Search operation metrics
    SEARCH_OPERATIONS = Counter(
        'memory_service_search_operations_total',
        'Total number of search operations',
        ['memory_type'],
        registry=REGISTRY
    )
    
    SEARCH_LATENCY = Histogram(
        'memory_service_search_duration_seconds',
        'Search operation latency in seconds',
        ['memory_type'],
        registry=REGISTRY
    )
    
    SEARCH_RESULTS = Histogram(
        'memory_service_search_results_count',
        'Number of search results returned',
        ['memory_type'],
        registry=REGISTRY
    )
    
    # Context metrics
    CONTEXTS_TOTAL = Gauge(
        'memory_service_contexts_total',
        'Total number of memory contexts',
        ['memory_type'],
        registry=REGISTRY
    )
    
    # Service uptime
    UPTIME_SECONDS = Gauge(
        'memory_service_uptime_seconds',
        'Service uptime in seconds',
        registry=REGISTRY
    )
    
    # Rate limiting
    RATE_LIMIT_EXCEEDED = Counter(
        'memory_service_rate_limit_exceeded_total',
        'Total number of rate limit exceeded errors',
        registry=REGISTRY
    )
    
    logger.info("Prometheus metrics initialized with custom registry")

# ============================================================================
# RATE LIMITING
# ============================================================================

# Rate limit configuration
RATE_LIMIT_REQUESTS = int(os.environ.get("RATE_LIMIT_REQUESTS", "100"))  # requests
RATE_LIMIT_WINDOW = int(os.environ.get("RATE_LIMIT_WINDOW", "60"))  # seconds

class RateLimiter:
    """Simple in-memory rate limiter with sliding window"""

    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: Dict[str, List[float]] = defaultdict(list)

    def is_allowed(self, client_id: str) -> bool:
        """Check if request is allowed for given client"""
        now = time.time()
        window_start = now - self.window_seconds

        # Clean old requests
        self.requests[client_id] = [
            t for t in self.requests[client_id] if t > window_start
        ]

        # Check limit
        if len(self.requests[client_id]) >= self.max_requests:
            return False

        # Record request
        self.requests[client_id].append(now)
        return True

    def get_remaining(self, client_id: str) -> int:
        """Get remaining requests for client"""
        now = time.time()
        window_start = now - self.window_seconds
        current = len([t for t in self.requests[client_id] if t > window_start])
        return max(0, self.max_requests - current)

rate_limiter = RateLimiter(RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW)

# ============================================================================
# FASTAPI APP
# ============================================================================

app = FastAPI(
    title="BYON Memory Service",
    description="FHRSS+FCPE infinite memory API for BYON orchestrator",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS configuration - SECURITY HARDENED
# Only allow specific origins in production
ALLOWED_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001,http://byon-ui:3001").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,  # Disabled for security
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

# Rate limiting middleware
@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """Apply rate limiting to all requests"""
    # Get client identifier (IP address or forwarded header)
    client_ip = request.client.host if request.client else "unknown"
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        client_ip = forwarded_for.split(",")[0].strip()

    # Skip rate limiting for health checks
    if request.url.path == "/health":
        return await call_next(request)

    # Check rate limit
    if not rate_limiter.is_allowed(client_ip):
        logger.warning(f"Rate limit exceeded for {client_ip}")
        if PROMETHEUS_AVAILABLE:
            RATE_LIMIT_EXCEEDED.inc()
        return JSONResponse(
            status_code=429,
            content={
                "success": False,
                "error": "Rate limit exceeded. Please try again later.",
                "retry_after": RATE_LIMIT_WINDOW
            },
            headers={"Retry-After": str(RATE_LIMIT_WINDOW)}
        )

    # Add rate limit headers to response
    response = await call_next(request)
    remaining = rate_limiter.get_remaining(client_ip)
    response.headers["X-RateLimit-Limit"] = str(RATE_LIMIT_REQUESTS)
    response.headers["X-RateLimit-Remaining"] = str(remaining)
    response.headers["X-RateLimit-Reset"] = str(int(time.time()) + RATE_LIMIT_WINDOW)

    return response

# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class PingRequest(BaseModel):
    action: str = "ping"

class PingResponse(BaseModel):
    success: bool
    service: str = "byon-memory-service"
    version: str = "1.0.0"
    timestamp: str

class StoreCodeRequest(BaseModel):
    action: str = "store"
    type: str = "code"
    data: Dict[str, Any] = Field(..., description="code, file_path, line_number, tags")

class StoreConversationRequest(BaseModel):
    action: str = "store"
    type: str = "conversation"
    data: Dict[str, Any] = Field(..., description="content, role")

class StoreFactRequest(BaseModel):
    action: str = "store"
    type: str = "fact"
    data: Dict[str, Any] = Field(..., description="fact, source, tags")

class StoreResponse(BaseModel):
    success: bool
    ctx_id: int
    type: str
    timestamp: str

class SearchRequest(BaseModel):
    action: str = "search"
    type: str = Field(..., description="code, conversation, fact")
    query: str
    top_k: int = 5
    threshold: float = 0.1

class SearchAllRequest(BaseModel):
    action: str = "search_all"
    query: str
    top_k: int = 5
    threshold: float = 0.1

class SearchResult(BaseModel):
    ctx_id: int
    similarity: float
    content: str
    metadata: Dict[str, Any]

class SearchResponse(BaseModel):
    success: bool
    results: List[SearchResult]
    query: str
    search_time_ms: float

class SearchAllResponse(BaseModel):
    success: bool
    code: List[SearchResult]
    conversation: List[SearchResult]
    facts: List[SearchResult]
    query: str
    search_time_ms: float

class RecoveryTestRequest(BaseModel):
    action: str = "test_recovery"
    ctx_id: int
    loss_percent: float = Field(..., ge=0.0, le=1.0)

class RecoveryTestResponse(BaseModel):
    success: bool
    recovered: bool
    similarity: float
    hash_match: bool
    recovery_time_ms: float
    loss_percent: float
    realistic_test: bool = True  # v3.0: indicates parity was also corrupted

class StatsRequest(BaseModel):
    action: str = "stats"

class StatsResponse(BaseModel):
    success: bool
    num_contexts: int
    by_type: Dict[str, int]
    fcpe_dim: int
    fhrss_profile: str
    total_storage_mb: float
    uptime_seconds: float

# ============================================================================
# SERVICE STATE
# ============================================================================

handlers: Optional[MemoryHandlers] = None
start_time: float = 0

def get_handlers() -> MemoryHandlers:
    global handlers
    if handlers is None:
        raise HTTPException(status_code=503, detail="Memory service not initialized")
    return handlers

# ============================================================================
# ROUTES
# ============================================================================

@app.on_event("startup")
async def startup():
    """Initialize memory handlers on startup"""
    global handlers, start_time

    storage_path = os.environ.get("MEMORY_STORAGE_PATH", "./memory_storage")

    logger.info("Initializing FHRSS+FCPE memory system...")
    handlers = MemoryHandlers(storage_path=storage_path)
    start_time = time.time()

    stats = handlers.get_stats()
    logger.info(f"Memory service ready. Loaded {stats['num_contexts']} contexts.")

@app.post("/", response_model=Dict[str, Any])
async def handle_request(request: Dict[str, Any]):
    """
    Unified request handler.
    Routes based on 'action' field for compatibility with TypeScript client.
    """
    action = request.get("action", "")

    if action == "ping":
        return {
            "success": True,
            "service": "byon-memory-service",
            "version": "1.0.0",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }

    elif action == "store":
        return await store_memory(request)

    elif action == "search":
        return await search_memory(request)

    elif action == "search_all":
        return await search_all_memory(request)

    elif action == "test_recovery":
        return await test_recovery(request)

    elif action == "stats":
        return await get_stats()

    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    uptime = time.time() - start_time if start_time else 0

    # Update Prometheus uptime gauge
    if PROMETHEUS_AVAILABLE:
        UPTIME_SECONDS.set(uptime)

    return {
        "status": "healthy",
        "service": "byon-memory-service",
        "uptime_seconds": uptime
    }


@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint (O4 optimization)"""
    if not PROMETHEUS_AVAILABLE:
        raise HTTPException(status_code=501, detail="Prometheus metrics not available")

    # Update context gauges
    if handlers:
        stats = handlers.get_stats()
        CONTEXTS_TOTAL.labels(memory_type='code').set(stats['by_type']['code'])
        CONTEXTS_TOTAL.labels(memory_type='conversation').set(stats['by_type']['conversation'])
        CONTEXTS_TOTAL.labels(memory_type='fact').set(stats['by_type']['fact'])

    # Update uptime
    UPTIME_SECONDS.set(time.time() - start_time if start_time else 0)

    from starlette.responses import Response
    return Response(content=generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)

# ============================================================================
# STORE HANDLERS
# ============================================================================

async def store_memory(request: Dict[str, Any]) -> Dict[str, Any]:
    """Store memory by type"""
    h = get_handlers()
    mem_type = request.get("type", "")
    data = request.get("data", {})

    if mem_type == "code":
        ctx_id = h.store_code(
            code=data.get("code", ""),
            file_path=data.get("file_path", ""),
            line_number=data.get("line_number", 0),
            tags=data.get("tags", [])
        )
    elif mem_type == "conversation":
        ctx_id = h.store_conversation(
            content=data.get("content", ""),
            role=data.get("role", "user")
        )
    elif mem_type == "fact":
        ctx_id = h.store_fact(
            fact=data.get("fact", ""),
            source=data.get("source", ""),
            tags=data.get("tags", [])
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unknown memory type: {mem_type}")

    # Track Prometheus metrics (O4)
    if PROMETHEUS_AVAILABLE:
        STORE_OPERATIONS.labels(memory_type=mem_type).inc()

    return {
        "success": True,
        "ctx_id": ctx_id,
        "type": mem_type,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }

# ============================================================================
# SEARCH HANDLERS
# ============================================================================

async def search_memory(request: Dict[str, Any]) -> Dict[str, Any]:
    """Search memory by type"""
    h = get_handlers()

    mem_type = request.get("type", "")
    query = request.get("query", "")
    top_k = request.get("top_k", 5)
    threshold = request.get("threshold", 0.1)

    t0 = time.time()

    if mem_type == "code":
        results = h.search_code(query, top_k, threshold)
    elif mem_type == "conversation":
        results = h.search_conversation(query, top_k, threshold)
    elif mem_type == "fact":
        results = h.search_facts(query, top_k, threshold)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown memory type: {mem_type}")

    search_time_sec = time.time() - t0

    # Track Prometheus metrics (O4)
    if PROMETHEUS_AVAILABLE:
        SEARCH_OPERATIONS.labels(memory_type=mem_type).inc()
        SEARCH_LATENCY.labels(memory_type=mem_type).observe(search_time_sec)
        SEARCH_RESULTS.labels(memory_type=mem_type).observe(len(results))

    return {
        "success": True,
        "results": results,
        "query": query,
        "search_time_ms": search_time_sec * 1000
    }

async def search_all_memory(request: Dict[str, Any]) -> Dict[str, Any]:
    """Search all memory types"""
    h = get_handlers()

    query = request.get("query", "")
    top_k = request.get("top_k", 5)
    threshold = request.get("threshold", 0.1)

    t0 = time.time()

    code_results = h.search_code(query, top_k, threshold)
    conv_results = h.search_conversation(query, top_k, threshold)
    fact_results = h.search_facts(query, top_k, threshold)

    search_time = (time.time() - t0) * 1000

    return {
        "success": True,
        "code": code_results,
        "conversation": conv_results,
        "facts": fact_results,
        "query": query,
        "search_time_ms": search_time
    }

# ============================================================================
# RECOVERY & STATS HANDLERS
# ============================================================================

async def test_recovery(request: Dict[str, Any]) -> Dict[str, Any]:
    """Test FHRSS recovery capability"""
    h = get_handlers()

    ctx_id = request.get("ctx_id")
    loss_percent = request.get("loss_percent", 0.3)

    if ctx_id is None:
        raise HTTPException(status_code=400, detail="ctx_id is required")

    result = h.test_recovery(ctx_id, loss_percent)

    return {
        "success": True,
        "recovered": result["cosine_similarity"] > 0.99,
        "similarity": result["cosine_similarity"],
        "hash_match": result.get("hash_match", False),
        "recovery_time_ms": result["recovery_time_ms"],
        "loss_percent": loss_percent,
        "realistic_test": result.get("realistic_test", True)  # v3.0: parity also corrupted
    }

async def get_stats() -> Dict[str, Any]:
    """Get memory statistics"""
    h = get_handlers()
    stats = h.get_stats()

    return {
        "success": True,
        "num_contexts": stats["num_contexts"],
        "by_type": stats["by_type"],
        "fcpe_dim": stats["fcpe_dim"],
        "fhrss_profile": stats["fhrss_profile"],
        "total_storage_mb": stats["total_storage_mb"],
        "uptime_seconds": time.time() - start_time if start_time else 0
    }

# ============================================================================
# MAIN
# ============================================================================

def main():
    """Run the memory service"""
    host = os.environ.get("MEMORY_SERVICE_HOST", "0.0.0.0")
    port = int(os.environ.get("MEMORY_SERVICE_PORT", "8000"))

    logger.info(f"Starting BYON Memory Service on {host}:{port}")

    uvicorn.run(
        "server:app",
        host=host,
        port=port,
        reload=os.environ.get("MEMORY_SERVICE_RELOAD", "false").lower() == "true",
        log_level="info"
    )

if __name__ == "__main__":
    main()
