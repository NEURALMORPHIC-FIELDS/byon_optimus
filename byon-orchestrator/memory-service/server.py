#!/usr/bin/env python3
"""
BYON Memory Service - FAISS-Optimized
=====================================

HTTP microservice wrapper for FAISS-based memory system.
Replaces the FCPE backend which had a similarity collapse bug.

Provides REST API for:
- Store: code, conversation, fact memories
- Search: real semantic similarity via FAISS IndexFlatIP
- Recovery: test endpoint (stub - FAISS uses disk persistence)
- Stats: system statistics

CRITICAL:
- This service MUST be running for BYON orchestrator to start
- Uses FAISS IndexFlatIP for real cosine similarity search
- sentence-transformers all-MiniLM-L6-v2 (384-dim, CPU)

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

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from collections import defaultdict
import numpy as np
import uvicorn

# Import handlers
from handlers import MemoryHandlers, MemoryType
from fcem_backend import FcemBackend

# ============================================================================
# LOGGING
# ============================================================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger("byon-memory-service")

# Prometheus metrics (O4 optimization)
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
    REGISTRY = CollectorRegistry()

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

    STORE_OPERATIONS = Counter(
        'memory_service_store_operations_total',
        'Total number of store operations',
        ['memory_type'],
        registry=REGISTRY
    )

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

    CONTEXTS_TOTAL = Gauge(
        'memory_service_contexts_total',
        'Total number of memory contexts',
        ['memory_type'],
        registry=REGISTRY
    )

    UPTIME_SECONDS = Gauge(
        'memory_service_uptime_seconds',
        'Service uptime in seconds',
        registry=REGISTRY
    )

    RATE_LIMIT_EXCEEDED = Counter(
        'memory_service_rate_limit_exceeded_total',
        'Total number of rate limit exceeded errors',
        registry=REGISTRY
    )

    logger.info("Prometheus metrics initialized with custom registry")

# ============================================================================
# RATE LIMITING
# ============================================================================

RATE_LIMIT_REQUESTS = int(os.environ.get("RATE_LIMIT_REQUESTS", "100"))
RATE_LIMIT_WINDOW = int(os.environ.get("RATE_LIMIT_WINDOW", "60"))

class RateLimiter:
    """Simple in-memory rate limiter with sliding window"""

    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: Dict[str, List[float]] = defaultdict(list)

    def is_allowed(self, client_id: str) -> bool:
        now = time.time()
        window_start = now - self.window_seconds
        self.requests[client_id] = [
            t for t in self.requests[client_id] if t > window_start
        ]
        if len(self.requests[client_id]) >= self.max_requests:
            return False
        self.requests[client_id].append(now)
        return True

    def get_remaining(self, client_id: str) -> int:
        now = time.time()
        window_start = now - self.window_seconds
        current = len([t for t in self.requests[client_id] if t > window_start])
        return max(0, self.max_requests - current)

rate_limiter = RateLimiter(RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW)

# ============================================================================
# FASTAPI APP
# ============================================================================

app = FastAPI(
    title="BYON Memory Service (FAISS-Optimized)",
    description="FAISS-based infinite memory API for BYON orchestrator",
    version="4.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS configuration
ALLOWED_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001,http://byon-ui:3001").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

# Rate limiting middleware
@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    client_ip = request.client.host if request.client else "unknown"
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        client_ip = forwarded_for.split(",")[0].strip()

    if request.url.path == "/health":
        return await call_next(request)

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
    version: str = "4.0.0"
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
    realistic_test: bool = False

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
fcem: Optional[FcemBackend] = None
start_time: float = 0

def get_handlers() -> MemoryHandlers:
    global handlers
    if handlers is None:
        raise HTTPException(status_code=503, detail="Memory service not initialized")
    return handlers


def get_fcem() -> FcemBackend:
    global fcem
    if fcem is None:
        raise HTTPException(status_code=503, detail="FCE-M backend not initialized")
    return fcem

# ============================================================================
# ROUTES
# ============================================================================

@app.on_event("startup")
async def startup():
    """Initialize memory handlers on startup"""
    global handlers, fcem, start_time

    storage_path = os.environ.get("MEMORY_STORAGE_PATH", "./memory_storage")

    logger.info("Initializing FAISS-optimized memory system...")
    handlers = MemoryHandlers(storage_path=storage_path)
    start_time = time.time()

    stats = handlers.get_stats()
    logger.info(f"Memory service ready. Backend: FAISS IndexFlatIP")
    logger.info(f"  Loaded {stats['num_contexts']} contexts.")

    backend_mode = os.environ.get("MEMORY_BACKEND", "hybrid").lower()
    fcem_enabled_env = os.environ.get("FCEM_ENABLED", "true").lower() == "true"
    fcem_enabled = backend_mode in {"hybrid", "fcem"} and fcem_enabled_env

    fcem = FcemBackend(
        enabled=fcem_enabled,
        storage_path=storage_path,
        advisory_mode=os.environ.get("FCEM_ADVISORY_MODE", "priority_only"),
        omega_enabled=os.environ.get("FCEM_OMEGA_ENABLED", "true").lower() == "true",
        reference_fields_enabled=os.environ.get(
            "FCEM_REFERENCE_FIELDS_ENABLED", "true"
        ).lower()
        == "true",
        multiperspectival_enabled=os.environ.get(
            "FCEM_MULTIPERSPECTIVAL_ENABLED", "true"
        ).lower()
        == "true",
        consolidate_every_n_events=int(
            os.environ.get("FCEM_CONSOLIDATE_EVERY_N", "5")
        ),
        # v0.6.4c — coherent-repeat dedup
        coherent_repeat_threshold=float(
            os.environ.get("FCEM_COHERENT_REPEAT_THRESHOLD", "0.92")
        ),
        coherent_history_size=int(
            os.environ.get("FCEM_COHERENT_HISTORY_SIZE", "20")
        ),
    )
    logger.info(
        "Memory backend mode: %s (FCE-M enabled=%s).", backend_mode, fcem.enabled
    )

@app.on_event("shutdown")
async def shutdown():
    """Save all memory stores on shutdown"""
    if handlers:
        handlers.save_all()
        logger.info("Memory stores saved on shutdown.")
    if fcem:
        fcem.persist()
        logger.info("FCE-M state persisted on shutdown.")

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
            "version": "4.0.0-faiss",
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

    elif action == "fce_state":
        return {"success": True, "state": get_fcem().state()}

    elif action == "fce_advisory":
        return {"success": True, "advisory": get_fcem().advisory()}

    elif action == "fce_priority_recommendations":
        return {
            "success": True,
            "recommendations": get_fcem().priority_recommendations(),
        }

    elif action == "fce_omega_registry":
        return {"success": True, "omega_registry": get_fcem().omega_registry()}

    elif action == "fce_reference_fields":
        return {
            "success": True,
            "reference_fields": get_fcem().reference_fields(),
            "events": get_fcem().reference_field_events(),
        }

    elif action == "fce_consolidate":
        return {"success": True, **get_fcem().consolidate()}

    elif action == "fce_assimilate_receipt":
        outcome = get_fcem().assimilate_receipt(
            order_id=request.get("order_id", ""),
            status=request.get("status", ""),
            based_on_evidence=request.get("based_on_evidence"),
            summary=request.get("summary"),
        )
        return {"success": True, **outcome}

    elif action == "fce_morphogenesis_report":
        return {
            "success": True,
            "report": get_fcem().morphogenesis_report(request.get("query")),
        }

    # ------------------------------------------------------------------
    # v0.6.6: Operator-Verified Facts (channel-gated write path)
    # ------------------------------------------------------------------
    elif action == "verified_fact_add":
        return await verified_fact_add(request)

    elif action == "verified_fact_revoke":
        return await verified_fact_revoke(request)

    elif action == "verified_fact_list":
        return await verified_fact_list(request)

    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    uptime = time.time() - start_time if start_time else 0

    if PROMETHEUS_AVAILABLE:
        UPTIME_SECONDS.set(uptime)

    return {
        "status": "healthy",
        "service": "byon-memory-service",
        "backend": "FAISS-IndexFlatIP",
        "uptime_seconds": uptime
    }


@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint"""
    if not PROMETHEUS_AVAILABLE:
        raise HTTPException(status_code=501, detail="Prometheus metrics not available")

    if handlers:
        stats = handlers.get_stats()
        CONTEXTS_TOTAL.labels(memory_type='code').set(stats['by_type']['code'])
        CONTEXTS_TOTAL.labels(memory_type='conversation').set(stats['by_type']['conversation'])
        CONTEXTS_TOTAL.labels(memory_type='fact').set(stats['by_type']['fact'])

    UPTIME_SECONDS.set(time.time() - start_time if start_time else 0)

    from starlette.responses import Response
    return Response(content=generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)

# ============================================================================
# STORE HANDLERS
# ============================================================================

async def store_memory(request: Dict[str, Any]) -> Dict[str, Any]:
    """Store memory by type (v0.6.1: thread_id propagated to metadata)."""
    h = get_handlers()
    mem_type = request.get("type", "")
    data = request.get("data", {})
    thread_id = data.get("thread_id")
    channel = data.get("channel")

    if mem_type == "code":
        ctx_id = h.store_code(
            code=data.get("code", ""),
            file_path=data.get("file_path", ""),
            line_number=data.get("line_number", 0),
            tags=data.get("tags", []),
            thread_id=thread_id,
            channel=channel,
        )
    elif mem_type == "conversation":
        ctx_id = h.store_conversation(
            content=data.get("content", ""),
            role=data.get("role", "user"),
            thread_id=thread_id,
            channel=channel,
        )
    elif mem_type == "fact":
        ctx_id = h.store_fact(
            fact=data.get("fact", ""),
            source=data.get("source", ""),
            tags=data.get("tags", []),
            thread_id=thread_id,
            channel=channel,
            trust=data.get("trust"),
            disputed=data.get("disputed"),
            disputed_pattern=data.get("disputed_pattern"),
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unknown memory type: {mem_type}")

    if PROMETHEUS_AVAILABLE:
        STORE_OPERATIONS.labels(memory_type=mem_type).inc()

    # Mirror the event into FCE-M for morphogenetic accounting.
    # Best-effort: never fails the FAISS path.
    fce_outcome: Dict[str, Any] = {"fce_status": "disabled"}
    if fcem is not None and fcem.enabled:
        # v0.6.3: compute the embedding once and pass it to FCE as a numerical
        # field signature. This lets the FCE-Ω observer see real semantic
        # geometry (AR_t / κ_t / S_t) instead of label-only events.
        try:
            content_for_embedding = (
                data.get("code")
                if mem_type == "code"
                else (data.get("content") if mem_type == "conversation" else data.get("fact"))
            ) or ""
            embedding_vec = (
                h.embedder.embed(content_for_embedding).tolist()
                if content_for_embedding
                else None
            )
        except Exception:
            embedding_vec = None

        if mem_type == "code":
            fce_outcome = fcem.assimilate_event(
                "code",
                ctx_id,
                data.get("code", ""),
                {
                    "file_path": data.get("file_path", ""),
                    "line_number": data.get("line_number", 0),
                    "tags": data.get("tags", []),
                    "thread_id": data.get("thread_id"),
                },
                embedding=embedding_vec,
            )
        elif mem_type == "conversation":
            fce_outcome = fcem.assimilate_event(
                "conversation",
                ctx_id,
                data.get("content", ""),
                {
                    "role": data.get("role", "user"),
                    "thread_id": data.get("thread_id"),
                    "channel": data.get("channel"),
                },
                embedding=embedding_vec,
            )
        elif mem_type == "fact":
            fce_outcome = fcem.assimilate_event(
                "fact",
                ctx_id,
                data.get("fact", ""),
                {
                    "source": data.get("source", ""),
                    "tags": data.get("tags", []),
                    "thread_id": data.get("thread_id"),  # v0.6.2: thread-scoped FCE center for facts
                },
                embedding=embedding_vec,
            )

    return {
        "success": True,
        "ctx_id": ctx_id,
        "type": mem_type,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "fce": fce_outcome,
    }

# ============================================================================
# SEARCH HANDLERS
# ============================================================================

async def search_memory(request: Dict[str, Any]) -> Dict[str, Any]:
    """Search memory by type.

    v0.6.1: accepts `thread_id` and `scope` ("thread" | "global"). Default scope
    is "thread" — when thread_id provided, results are filtered to that thread.
    Cross-thread search requires explicit scope="global".
    """
    h = get_handlers()

    mem_type = request.get("type", "")
    query = request.get("query", "")
    top_k = request.get("top_k", 5)
    threshold = request.get("threshold", 0.1)
    thread_id = request.get("thread_id")
    scope = (request.get("scope") or "thread").lower()

    t0 = time.time()

    if mem_type == "code":
        results = h.search_code(query, top_k, threshold, thread_id=thread_id, scope=scope)
    elif mem_type == "conversation":
        results = h.search_conversation(query, top_k, threshold, thread_id=thread_id, scope=scope)
    elif mem_type == "fact":
        results = h.search_facts(query, top_k, threshold, thread_id=thread_id, scope=scope)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown memory type: {mem_type}")

    search_time_sec = time.time() - t0

    if PROMETHEUS_AVAILABLE:
        SEARCH_OPERATIONS.labels(memory_type=mem_type).inc()
        SEARCH_LATENCY.labels(memory_type=mem_type).observe(search_time_sec)
        SEARCH_RESULTS.labels(memory_type=mem_type).observe(len(results))

    return {
        "success": True,
        "results": results,
        "query": query,
        "scope": scope,
        "thread_id": thread_id,
        "search_time_ms": search_time_sec * 1000
    }

async def search_all_memory(request: Dict[str, Any]) -> Dict[str, Any]:
    """Search all memory types with v0.6.1 thread scoping."""
    h = get_handlers()

    query = request.get("query", "")
    top_k = request.get("top_k", 5)
    threshold = request.get("threshold", 0.1)
    thread_id = request.get("thread_id")
    scope = (request.get("scope") or "thread").lower()

    t0 = time.time()

    code_results = h.search_code(query, top_k, threshold, thread_id=thread_id, scope=scope)
    conv_results = h.search_conversation(query, top_k, threshold, thread_id=thread_id, scope=scope)
    fact_results = h.search_facts(query, top_k, threshold, thread_id=thread_id, scope=scope)

    search_time = (time.time() - t0) * 1000

    return {
        "success": True,
        "code": code_results,
        "conversation": conv_results,
        "facts": fact_results,
        "query": query,
        "scope": scope,
        "thread_id": thread_id,
        "search_time_ms": search_time
    }

# ============================================================================
# RECOVERY & STATS HANDLERS
# ============================================================================

async def test_recovery(request: Dict[str, Any]) -> Dict[str, Any]:
    """Test recovery capability (stub for FAISS backend)"""
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
        "realistic_test": result.get("realistic_test", False)
    }

# ----------------------------------------------------------------------
# v0.6.6: Operator-Verified Facts
#
# The VERIFIED_PROJECT_FACT trust tier exists since v0.6.5 in
# fact-extractor.mjs::classifyTrust, but until this release there was
# no production write path. v0.6.6 adds:
#
#   - verified_fact_add: only path that can set trust=VERIFIED_PROJECT_FACT.
#     Server REJECTS the call unless channel == "operator-cli" — there is
#     no conversational path to this tier. Requires non-empty evidence,
#     operator, subject, predicate, object.
#
#   - verified_fact_revoke: marks revoked=true + revoked_at + revoked_reason.
#     formatFactsForPrompt in fact-extractor.mjs filters revoked facts out
#     of recall blocks at the next TTL.
#
#   - verified_fact_list: read-only listing of all currently active
#     verified facts (optionally filtered by scope).
#
# These endpoints are intentionally low-magic: they piggy-back on the
# existing store_fact path and the inferTrustFromHit recall-time
# classifier. The trust tier propagates through fact-extractor.mjs unchanged.
# ----------------------------------------------------------------------

OPERATOR_CLI_CHANNEL = "operator-cli"

def _ensure_operator_channel(request: Dict[str, Any]) -> None:
    """Reject any verified-fact write that does not come from the operator CLI."""
    data = request.get("data", {}) or {}
    channel = data.get("channel") or request.get("channel")
    if channel != OPERATOR_CLI_CHANNEL:
        raise HTTPException(
            status_code=403,
            detail=(
                f"verified_fact_* writes require channel='{OPERATOR_CLI_CHANNEL}'. "
                f"Got channel={channel!r}. "
                "There is no conversational path to VERIFIED_PROJECT_FACT."
            ),
        )


async def verified_fact_add(request: Dict[str, Any]) -> Dict[str, Any]:
    """Create a VERIFIED_PROJECT_FACT. Channel-gated.

    Required fields in `data`:
      - subject, predicate, object  (the canonical fact triple)
      - operator                    (who is asserting it)
      - evidence                    (free-text source citation)

    Optional:
      - scope        (default "global")
      - supersedes   (list of existing ctx_ids this overrides)
    """
    _ensure_operator_channel(request)
    h = get_handlers()
    data = request.get("data", {}) or {}

    subject = (data.get("subject") or "").strip()
    predicate = (data.get("predicate") or "").strip()
    obj = (data.get("object") or "").strip()
    operator = (data.get("operator") or "").strip()
    evidence = (data.get("evidence") or "").strip()
    scope = (data.get("scope") or "global").strip()
    supersedes = data.get("supersedes") or []

    missing = [k for k, v in {
        "subject": subject, "predicate": predicate, "object": obj,
        "operator": operator, "evidence": evidence,
    }.items() if not v]
    if missing:
        raise HTTPException(status_code=400, detail=f"verified_fact_add missing required fields: {missing}")

    fact_text = f"{subject} {predicate.replace('_', ' ')} {obj}"
    tags = [
        "verified_project_fact",
        subject.replace(" ", "_"),
        f"trust:VERIFIED_PROJECT_FACT",
        f"scope:{scope}",
        f"operator:{operator}",
    ]
    if supersedes:
        tags.extend([f"supersedes:{s}" for s in supersedes])

    # Store via the standard fact path so recall + trust inference work
    # unchanged. Verified facts go to thread_id=None (global scope) so the
    # operator-asserted truth is visible across all threads.
    ctx_id = h.store_fact(
        fact=fact_text,
        source=f"operator-verified:{operator}",
        tags=tags,
        thread_id=None,  # GLOBAL — verified facts are project-wide
        channel=OPERATOR_CLI_CHANNEL,
        trust="VERIFIED_PROJECT_FACT",
        disputed=False,
        disputed_pattern=None,
    )

    # Side-record provenance metadata for audit (read back via verified_fact_list)
    h.content_cache[ctx_id]["verified_metadata"] = {
        "operator": operator,
        "evidence": evidence,
        "scope": scope,
        "supersedes": supersedes,
        "created_at": time.time(),
        "revoked": False,
    }
    h._save_content_cache()

    return {
        "success": True,
        "ctx_id": ctx_id,
        "fact": fact_text,
        "trust": "VERIFIED_PROJECT_FACT",
        "operator": operator,
        "evidence": evidence,
        "scope": scope,
    }


async def verified_fact_revoke(request: Dict[str, Any]) -> Dict[str, Any]:
    """Mark a previously-verified fact as revoked. Channel-gated."""
    _ensure_operator_channel(request)
    h = get_handlers()
    data = request.get("data", {}) or {}

    ctx_id = data.get("ctx_id")
    reason = (data.get("reason") or "").strip()
    operator = (data.get("operator") or "").strip()

    if ctx_id is None or not reason or not operator:
        raise HTTPException(
            status_code=400,
            detail="verified_fact_revoke requires data.ctx_id, data.reason, data.operator",
        )

    entry = h.content_cache.get(ctx_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"ctx_id {ctx_id} not found")

    md = entry.get("metadata", {})
    if md.get("trust") != "VERIFIED_PROJECT_FACT":
        raise HTTPException(
            status_code=400,
            detail=f"ctx_id {ctx_id} is not a VERIFIED_PROJECT_FACT (trust={md.get('trust')!r})",
        )

    # In-place metadata update: mark disputed, append __revoked__ tag, so the
    # recall path (inferTrustFromHit) downgrades it to DISPUTED_OR_UNSAFE and
    # formatFactsForPrompt hides it from the VERIFIED block.
    md["disputed"] = True
    md["disputed_pattern"] = "operator_revoked"
    md["trust"] = "DISPUTED_OR_UNSAFE"
    tags = list(md.get("tags") or [])
    if "__revoked__" not in tags:
        tags.append("__revoked__")
        tags.append("__disputed__")
        tags.append("trust:DISPUTED_OR_UNSAFE")
    md["tags"] = tags

    # Audit trail
    verified_md = entry.setdefault("verified_metadata", {})
    verified_md["revoked"] = True
    verified_md["revoked_at"] = time.time()
    verified_md["revoked_reason"] = reason
    verified_md["revoked_by"] = operator
    h._save_content_cache()

    return {
        "success": True,
        "ctx_id": ctx_id,
        "revoked": True,
        "revoked_by": operator,
        "revoked_reason": reason,
    }


async def verified_fact_list(request: Dict[str, Any]) -> Dict[str, Any]:
    """List active VERIFIED_PROJECT_FACT entries (revoked excluded by default)."""
    h = get_handlers()
    data = request.get("data", {}) or {}
    include_revoked = bool(data.get("include_revoked"))
    scope_filter = data.get("scope")

    out = []
    for ctx_id, entry in h.content_cache.items():
        md = entry.get("metadata", {})
        if md.get("trust") != "VERIFIED_PROJECT_FACT":
            # Revoked facts have their trust rewritten to DISPUTED_OR_UNSAFE.
            # Include them only when explicitly requested.
            if include_revoked and "__revoked__" in (md.get("tags") or []):
                pass
            else:
                continue

        vmd = entry.get("verified_metadata", {}) or {}
        if scope_filter and vmd.get("scope") != scope_filter:
            continue

        out.append({
            "ctx_id": ctx_id,
            "fact": entry.get("content", ""),
            "operator": vmd.get("operator"),
            "evidence": vmd.get("evidence"),
            "scope": vmd.get("scope"),
            "supersedes": vmd.get("supersedes", []),
            "created_at": vmd.get("created_at"),
            "revoked": vmd.get("revoked", False),
            "revoked_at": vmd.get("revoked_at"),
            "revoked_reason": vmd.get("revoked_reason"),
            "revoked_by": vmd.get("revoked_by"),
        })

    out.sort(key=lambda e: e.get("created_at") or 0, reverse=True)
    return {"success": True, "count": len(out), "facts": out}


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

    logger.info(f"Starting BYON Memory Service (FAISS-Optimized) on {host}:{port}")

    uvicorn.run(
        "server:app",
        host=host,
        port=port,
        reload=os.environ.get("MEMORY_SERVICE_RELOAD", "false").lower() == "true",
        log_level="info"
    )

if __name__ == "__main__":
    main()
