#!/usr/bin/env python3
"""
Memory Handlers - FAISS-Optimized
=================================

Business logic for BYON Memory Service.
Uses FAISS IndexFlatIP directly for real cosine similarity search,
bypassing FCPE which has a known similarity collapse bug on single-vector inputs.

Memory Types:
- CODE: Source code snippets with file/line metadata
- CONVERSATION: Chat messages with role
- FACT: Extracted facts with source reference

Features:
- Real semantic similarity search via FAISS IndexFlatIP (cosine similarity)
- Per-type FAISS indices for efficient scoped search
- Persistent storage with auto-load/save
- Optional Redis cache layer

Patent: FHRSS/OmniVault - Vasile Lucian Borbeleac - EP25216372.0
"""

import os
import sys
import hashlib
import time
import json
import pickle
import logging
import threading
from pathlib import Path
from typing import Dict, List, Any, Optional, Union
from enum import Enum
from dataclasses import dataclass, asdict
import numpy as np

import faiss

# Redis for caching (O5 optimization)
try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False

logger = logging.getLogger("memory-handlers")

# ============================================================================
# MEMORY TYPES
# ============================================================================

class MemoryType(str, Enum):
    CODE = "code"
    CONVERSATION = "conversation"
    FACT = "fact"

# ============================================================================
# TEXT TO EMBEDDING (Production: sentence-transformers, Fallback: hash-based)
# ============================================================================

try:
    from sentence_transformers import SentenceTransformer
    SENTENCE_TRANSFORMERS_AVAILABLE = True
except ImportError:
    SENTENCE_TRANSFORMERS_AVAILABLE = False
    logger.warning("sentence-transformers not available, using fallback embedder")


class ProductionEmbedder:
    """
    Production-grade text embedder using sentence-transformers.
    Model: all-MiniLM-L6-v2 (384 dimensions, fast inference)
    Produces L2-normalized vectors for cosine similarity via inner product.
    """

    def __init__(self, dim: int = 384, model_name: str = "all-MiniLM-L6-v2"):
        self.dim = dim
        self.model_name = model_name
        self.model = SentenceTransformer(model_name)
        logger.info(f"Loaded sentence-transformers model: {model_name}")

    def embed(self, text: str) -> np.ndarray:
        """Convert text to L2-normalized embedding vector."""
        if not text:
            return np.zeros(self.dim, dtype=np.float32)

        embedding = self.model.encode(text, normalize_embeddings=True)
        return embedding.astype(np.float32)

    def embed_batch(self, texts: List[str]) -> np.ndarray:
        """Embed multiple texts efficiently."""
        if not texts:
            return np.zeros((0, self.dim), dtype=np.float32)

        embeddings = self.model.encode(texts, normalize_embeddings=True, batch_size=32)
        return embeddings.astype(np.float32)


class SimpleEmbedder:
    """
    Fallback deterministic text embedder.
    Uses character-level hashing for reproducible embeddings.
    Used when sentence-transformers is not available.
    """

    def __init__(self, dim: int = 384):
        self.dim = dim
        np.random.seed(42)
        self.projection = np.random.randn(256, dim).astype(np.float32) / np.sqrt(256)

    def embed(self, text: str) -> np.ndarray:
        if not text:
            return np.zeros(self.dim, dtype=np.float32)

        char_counts = np.zeros(256, dtype=np.float32)
        for char in text.encode('utf-8', errors='ignore')[:10000]:
            char_counts[char] += 1

        norm = np.linalg.norm(char_counts)
        if norm > 0:
            char_counts /= norm

        embedding = char_counts @ self.projection

        words = text.split()[:100]
        for i, word in enumerate(words):
            word_hash = int(hashlib.md5(word.encode()).hexdigest(), 16) % self.dim
            embedding[word_hash] += (1.0 / (i + 1))

        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding /= norm

        return embedding.astype(np.float32)

    def embed_batch(self, texts: List[str]) -> np.ndarray:
        return np.stack([self.embed(t) for t in texts])


def create_embedder(dim: int = 384) -> 'SimpleEmbedder | ProductionEmbedder':
    """Factory function to create best available embedder."""
    if SENTENCE_TRANSFORMERS_AVAILABLE:
        try:
            return ProductionEmbedder(dim=dim)
        except Exception as e:
            logger.warning(f"Failed to load ProductionEmbedder: {e}, using fallback")
            return SimpleEmbedder(dim=dim)
    return SimpleEmbedder(dim=dim)


# ============================================================================
# FAISS MEMORY STORE (per-type index)
# ============================================================================

class FAISSMemoryStore:
    """
    Per-type FAISS-based memory store with metadata persistence.

    Uses IndexFlatIP on L2-normalized vectors = cosine similarity.
    This replaces the FCPE-based approach which had a similarity collapse bug
    where single-vector whitening produced identical encoded vectors.
    """

    def __init__(self, name: str, dim: int, storage_path: Path):
        self._name = name
        self._dim = dim
        self._storage_path = storage_path
        self._lock = threading.Lock()

        self._faiss_path = storage_path / f"faiss_{name}.bin"
        self._meta_path = storage_path / f"meta_{name}.pkl"

        self._metadata: Dict[int, Dict[str, Any]] = {}
        self._id_map: List[int] = []  # position -> ctx_id
        self._next_id = 0

        if self._faiss_path.exists() and self._meta_path.exists():
            self._load()
        else:
            self._index = faiss.IndexFlatIP(self._dim)
            logger.info(f"[{name}] Created new FAISS IndexFlatIP(dim={dim})")

    def _load(self):
        """Load FAISS index and metadata from disk."""
        try:
            self._index = faiss.read_index(str(self._faiss_path))
            with open(self._meta_path, "rb") as f:
                saved = pickle.load(f)
            self._metadata = saved["metadata"]
            self._id_map = saved["id_map"]
            self._next_id = saved["next_id"]
            logger.info(f"[{self._name}] Loaded {self._index.ntotal} vectors")
        except Exception as e:
            logger.warning(f"[{self._name}] Failed to load: {e}. Creating new index.")
            self._index = faiss.IndexFlatIP(self._dim)
            self._metadata = {}
            self._id_map = []
            self._next_id = 0

    def store(self, embedding: np.ndarray, metadata: Dict[str, Any]) -> int:
        """Store an embedding with metadata. Returns context ID."""
        vec = embedding.astype(np.float32).reshape(1, -1)
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm

        with self._lock:
            ctx_id = self._next_id
            self._next_id += 1
            self._index.add(vec)
            self._id_map.append(ctx_id)
            self._metadata[ctx_id] = metadata

        return ctx_id

    def search(self, query_embedding: np.ndarray, top_k: int = 5,
               threshold: float = 0.1) -> List[Dict[str, Any]]:
        """Search for similar entries. Returns list of {ctx_id, similarity, metadata}."""
        if self._index.ntotal == 0:
            return []

        vec = query_embedding.astype(np.float32).reshape(1, -1)
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm

        k = min(top_k, self._index.ntotal)

        with self._lock:
            scores, indices = self._index.search(vec, k)

        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx < 0 or idx >= len(self._id_map):
                continue
            ctx_id = self._id_map[idx]
            if score >= threshold:
                results.append({
                    "ctx_id": ctx_id,
                    "similarity": float(score),
                    "metadata": self._metadata.get(ctx_id, {}),
                })

        return results

    def save(self):
        """Persist index and metadata to disk."""
        with self._lock:
            faiss.write_index(self._index, str(self._faiss_path))
            with open(self._meta_path, "wb") as f:
                pickle.dump({
                    "metadata": self._metadata,
                    "id_map": self._id_map,
                    "next_id": self._next_id,
                }, f)
        logger.info(f"[{self._name}] Saved {self._index.ntotal} vectors")

    @property
    def count(self) -> int:
        return self._index.ntotal

    def get_context(self, ctx_id: int) -> Optional[Dict[str, Any]]:
        """Get metadata for a specific context ID."""
        return self._metadata.get(ctx_id)


# ============================================================================
# REDIS CACHE (O5 optimization)
# ============================================================================

class MemoryCache:
    """
    Redis-based cache for memory search results.
    Cache TTL: 5 minutes by default (configurable via env)
    """

    def __init__(self, redis_url: Optional[str] = None, ttl_seconds: int = 300):
        self.ttl = ttl_seconds
        self.enabled = False
        self.client: Optional['redis.Redis'] = None
        self.cache_prefix = "byon:memory:cache:"

        if not REDIS_AVAILABLE:
            logger.warning("Redis not available, cache disabled")
            return

        redis_url = redis_url or os.environ.get("REDIS_URL", "redis://redis:6379/1")

        try:
            self.client = redis.from_url(redis_url, decode_responses=True)
            self.client.ping()
            self.enabled = True
            logger.info(f"Redis cache enabled: {redis_url}")
        except Exception as e:
            logger.warning(f"Redis connection failed, cache disabled: {e}")
            self.client = None

    def _make_key(self, query: str, mem_type: str, top_k: int, threshold: float) -> str:
        key_data = f"{query}:{mem_type}:{top_k}:{threshold}"
        key_hash = hashlib.sha256(key_data.encode()).hexdigest()[:16]
        return f"{self.cache_prefix}{mem_type}:{key_hash}"

    def get(self, query: str, mem_type: str, top_k: int, threshold: float) -> Optional[List[Dict[str, Any]]]:
        if not self.enabled or not self.client:
            return None
        try:
            key = self._make_key(query, mem_type, top_k, threshold)
            cached = self.client.get(key)
            if cached:
                logger.debug(f"Cache hit for {mem_type} query")
                return json.loads(cached)
        except Exception as e:
            logger.warning(f"Cache get error: {e}")
        return None

    def set(self, query: str, mem_type: str, top_k: int, threshold: float,
            results: List[Dict[str, Any]]) -> None:
        if not self.enabled or not self.client:
            return
        try:
            key = self._make_key(query, mem_type, top_k, threshold)
            self.client.setex(key, self.ttl, json.dumps(results))
            logger.debug(f"Cached {len(results)} results for {mem_type}")
        except Exception as e:
            logger.warning(f"Cache set error: {e}")

    def invalidate_type(self, mem_type: str) -> int:
        if not self.enabled or not self.client:
            return 0
        try:
            pattern = f"{self.cache_prefix}{mem_type}:*"
            keys = list(self.client.scan_iter(match=pattern, count=100))
            if keys:
                deleted = self.client.delete(*keys)
                logger.debug(f"Invalidated {deleted} cache entries for {mem_type}")
                return deleted
        except Exception as e:
            logger.warning(f"Cache invalidate error: {e}")
        return 0

    def get_stats(self) -> Dict[str, Any]:
        if not self.enabled or not self.client:
            return {"enabled": False}
        try:
            info = self.client.info("stats")
            return {
                "enabled": True,
                "hits": info.get("keyspace_hits", 0),
                "misses": info.get("keyspace_misses", 0),
                "ttl_seconds": self.ttl
            }
        except Exception as e:
            return {"enabled": True, "error": str(e)}


# ============================================================================
# MEMORY HANDLERS
# ============================================================================

class MemoryHandlers:
    """
    Memory handlers for BYON orchestrator.

    Uses separate FAISS IndexFlatIP per memory type for real cosine similarity.
    This replaces the FCPE-based backend which had a critical bug:
    FCPE's whitening step collapses single-vector (1,384) inputs to identical
    vectors (mean=self, std=0→1.0, result=zeros), making all similarities equal.

    The fix: store L2-normalized embeddings directly in FAISS IndexFlatIP.
    Inner product on unit vectors = cosine similarity = real semantic ranking.
    """

    def __init__(self, storage_path: str = "./memory_storage"):
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)

        self._dim = 384

        # Separate FAISS index per memory type
        self.stores: Dict[MemoryType, FAISSMemoryStore] = {
            MemoryType.CODE: FAISSMemoryStore("code", self._dim, self.storage_path),
            MemoryType.CONVERSATION: FAISSMemoryStore("conversation", self._dim, self.storage_path),
            MemoryType.FACT: FAISSMemoryStore("fact", self._dim, self.storage_path),
        }

        # Embedder
        self.embedder = create_embedder(dim=self._dim)

        # Redis cache (O5 optimization)
        cache_ttl = int(os.environ.get("MEMORY_CACHE_TTL", "300"))
        self.cache = MemoryCache(ttl_seconds=cache_ttl)

        # Content cache for full text (metadata only stores previews)
        self.content_cache: Dict[int, Dict[str, Any]] = {}

        # Load existing content cache
        self._load_content_cache()

        logger.info(f"MemoryHandlers (FAISS-optimized) initialized at {self.storage_path}")
        for mt in MemoryType:
            logger.info(f"  {mt.value}: {self.stores[mt].count} entries")
        logger.info(f"  Redis cache: {'enabled' if self.cache.enabled else 'disabled'}")

    # ========================================================================
    # STORE OPERATIONS
    # ========================================================================

    def store_code(self, code: str, file_path: str, line_number: int,
                   tags: List[str]) -> int:
        """Store code memory."""
        embedding = self.embedder.embed(code)

        metadata = {
            "type": MemoryType.CODE.value,
            "file_path": file_path,
            "line_number": line_number,
            "tags": tags,
            "content_preview": code[:200],
            "content_hash": hashlib.sha256(code.encode()).hexdigest()[:16],
            "timestamp": time.time(),
        }

        ctx_id = self.stores[MemoryType.CODE].store(embedding, metadata)
        self.content_cache[ctx_id] = {"content": code, "metadata": metadata}

        # Invalidate cache for this type
        self.cache.invalidate_type(MemoryType.CODE.value)

        # Auto-save
        self.stores[MemoryType.CODE].save()
        self._save_content_cache()

        logger.debug(f"Stored code ctx_id={ctx_id}, file={file_path}")
        return ctx_id

    def store_conversation(self, content: str, role: str) -> int:
        """Store conversation memory."""
        embedding = self.embedder.embed(content)

        metadata = {
            "type": MemoryType.CONVERSATION.value,
            "role": role,
            "content_preview": content[:200],
            "content_hash": hashlib.sha256(content.encode()).hexdigest()[:16],
            "timestamp": time.time(),
        }

        ctx_id = self.stores[MemoryType.CONVERSATION].store(embedding, metadata)
        self.content_cache[ctx_id] = {"content": content, "metadata": metadata}

        self.cache.invalidate_type(MemoryType.CONVERSATION.value)
        self.stores[MemoryType.CONVERSATION].save()
        self._save_content_cache()

        logger.debug(f"Stored conversation ctx_id={ctx_id}, role={role}")
        return ctx_id

    def store_fact(self, fact: str, source: str, tags: List[str]) -> int:
        """Store fact memory."""
        embedding = self.embedder.embed(fact)

        metadata = {
            "type": MemoryType.FACT.value,
            "source": source,
            "tags": tags,
            "content_preview": fact[:200],
            "content_hash": hashlib.sha256(fact.encode()).hexdigest()[:16],
            "timestamp": time.time(),
        }

        ctx_id = self.stores[MemoryType.FACT].store(embedding, metadata)
        self.content_cache[ctx_id] = {"content": fact, "metadata": metadata}

        self.cache.invalidate_type(MemoryType.FACT.value)
        self.stores[MemoryType.FACT].save()
        self._save_content_cache()

        logger.debug(f"Stored fact ctx_id={ctx_id}, source={source}")
        return ctx_id

    # ========================================================================
    # SEARCH OPERATIONS
    # ========================================================================

    def search_code(self, query: str, top_k: int = 5,
                    threshold: float = 0.1) -> List[Dict[str, Any]]:
        """Search code memories."""
        return self._search_by_type(query, MemoryType.CODE, top_k, threshold)

    def search_conversation(self, query: str, top_k: int = 5,
                           threshold: float = 0.1) -> List[Dict[str, Any]]:
        """Search conversation memories."""
        return self._search_by_type(query, MemoryType.CONVERSATION, top_k, threshold)

    def search_facts(self, query: str, top_k: int = 5,
                    threshold: float = 0.1) -> List[Dict[str, Any]]:
        """Search fact memories."""
        return self._search_by_type(query, MemoryType.FACT, top_k, threshold)

    def _search_by_type(self, query: str, mem_type: MemoryType,
                        top_k: int, threshold: float) -> List[Dict[str, Any]]:
        """Search memories of specific type using FAISS direct."""
        store = self.stores[mem_type]
        if store.count == 0:
            return []

        # Check Redis cache first
        cached_results = self.cache.get(query, mem_type.value, top_k, threshold)
        if cached_results is not None:
            return cached_results

        # Embed query and search FAISS directly
        query_vec = self.embedder.embed(query)
        raw_results = store.search(query_vec, top_k, threshold)

        # Enrich with full content from content_cache
        results = []
        for item in raw_results:
            cached = self.content_cache.get(item['ctx_id'], {})
            results.append({
                "ctx_id": item['ctx_id'],
                "similarity": item['similarity'],
                "content": cached.get("content", item['metadata'].get("content_preview", "")),
                "metadata": item['metadata'],
            })

        # Cache results
        self.cache.set(query, mem_type.value, top_k, threshold, results)

        return results

    # ========================================================================
    # RECOVERY & STATS
    # ========================================================================

    def test_recovery(self, ctx_id: int, loss_percent: float) -> Dict[str, Any]:
        """
        Recovery test stub.

        FAISS IndexFlatIP does not have FHRSS fault tolerance.
        Recovery is handled at the persistence layer (disk backup).
        """
        return {
            "cosine_similarity": 1.0,
            "hash_match": True,
            "recovery_time_ms": 0.0,
            "realistic_test": False,
            "note": "FAISS-optimized backend uses disk persistence instead of FHRSS recovery"
        }

    def get_stats(self) -> Dict[str, Any]:
        """Get memory statistics."""
        total = sum(s.count for s in self.stores.values())

        # Calculate storage size
        total_bytes = 0
        for f in self.storage_path.iterdir():
            if f.is_file():
                total_bytes += f.stat().st_size

        return {
            "version": "4.0.0-faiss",
            "num_contexts": total,
            "by_type": {
                "code": self.stores[MemoryType.CODE].count,
                "conversation": self.stores[MemoryType.CONVERSATION].count,
                "fact": self.stores[MemoryType.FACT].count,
            },
            "fcpe_dim": self._dim,
            "fhrss_profile": "FAISS-IndexFlatIP",
            "fhrss_overhead": "1.0x (no encoding overhead)",
            "total_storage_mb": total_bytes / (1024 * 1024),
            "storage_path": str(self.storage_path),
            "backend": "FAISS IndexFlatIP (cosine similarity via inner product)",
            "cache": self.cache.get_stats(),
        }

    # ========================================================================
    # PERSISTENCE
    # ========================================================================

    def save_all(self):
        """Save all stores to disk."""
        for store in self.stores.values():
            store.save()
        self._save_content_cache()
        logger.info("All memory stores saved to disk")

    def _save_content_cache(self):
        """Save content cache to disk."""
        cache_path = self.storage_path / "content_cache.pkl"
        try:
            with open(cache_path, "wb") as f:
                pickle.dump(self.content_cache, f)
        except Exception as e:
            logger.warning(f"Failed to save content cache: {e}")

    def _load_content_cache(self):
        """Load content cache from disk."""
        cache_path = self.storage_path / "content_cache.pkl"
        if not cache_path.exists():
            return
        try:
            with open(cache_path, "rb") as f:
                self.content_cache = pickle.load(f)
            logger.info(f"Loaded content cache: {len(self.content_cache)} entries")
        except Exception as e:
            logger.warning(f"Failed to load content cache: {e}")
