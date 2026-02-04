#!/usr/bin/env python3
"""
Memory Handlers
===============

Business logic for BYON Memory Service.
Wraps FHRSS+FCPE system with typed memory categories.

Memory Types:
- CODE: Source code snippets with file/line metadata
- CONVERSATION: Chat messages with role
- FACT: Extracted facts with source reference

Features:
- Semantic similarity search via FCPE vectors
- Fault-tolerant storage via FHRSS XOR parity
- 100% recovery at 40% data loss
- Persistent storage with auto-load
"""

import os
import sys
import hashlib
import time
import json
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional, Union
from enum import Enum
from dataclasses import dataclass, asdict
import numpy as np

# Redis for caching (O5 optimization)
try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False

# Add parent path for fhrss_fcpe_unified import
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "INFINIT_MEMORYCONTEXT"))

from fhrss_fcpe_unified import (
    UnifiedFHRSS_FCPE,
    UnifiedConfig,
    FCPEConfig,
    FHRSSConfig,
    MultiScaleConfig,
    UnifiedConfigV3
)

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

# Try to import sentence-transformers for production-grade embeddings
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

    O1 Optimization: Upgraded from hash-based to neural embeddings.
    """

    def __init__(self, dim: int = 384, model_name: str = "all-MiniLM-L6-v2"):
        self.dim = dim
        self.model_name = model_name
        self.model = SentenceTransformer(model_name)
        logger.info(f"Loaded sentence-transformers model: {model_name}")

    def embed(self, text: str) -> np.ndarray:
        """Convert text to embedding vector"""
        if not text:
            return np.zeros(self.dim, dtype=np.float32)

        embedding = self.model.encode(text, normalize_embeddings=True)
        return embedding.astype(np.float32)

    def embed_batch(self, texts: List[str]) -> np.ndarray:
        """Embed multiple texts efficiently"""
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
        # Pre-compute random projection matrix
        np.random.seed(42)
        self.projection = np.random.randn(256, dim).astype(np.float32) / np.sqrt(256)

    def embed(self, text: str) -> np.ndarray:
        """Convert text to embedding vector"""
        if not text:
            return np.zeros(self.dim, dtype=np.float32)

        # Character frequency vector
        char_counts = np.zeros(256, dtype=np.float32)
        for char in text.encode('utf-8', errors='ignore')[:10000]:
            char_counts[char] += 1

        # Normalize
        norm = np.linalg.norm(char_counts)
        if norm > 0:
            char_counts /= norm

        # Project to embedding space
        embedding = char_counts @ self.projection

        # Add positional information
        words = text.split()[:100]
        for i, word in enumerate(words):
            word_hash = int(hashlib.md5(word.encode()).hexdigest(), 16) % self.dim
            embedding[word_hash] += (1.0 / (i + 1))

        # Normalize final
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding /= norm

        return embedding.astype(np.float32)

    def embed_batch(self, texts: List[str]) -> np.ndarray:
        """Embed multiple texts"""
        return np.stack([self.embed(t) for t in texts])


def create_embedder(dim: int = 384) -> 'SimpleEmbedder | ProductionEmbedder':
    """Factory function to create best available embedder"""
    if SENTENCE_TRANSFORMERS_AVAILABLE:
        try:
            return ProductionEmbedder(dim=dim)
        except Exception as e:
            logger.warning(f"Failed to load ProductionEmbedder: {e}, using fallback")
            return SimpleEmbedder(dim=dim)
    return SimpleEmbedder(dim=dim)


# ============================================================================
# REDIS CACHE (O5 optimization)
# ============================================================================

class MemoryCache:
    """
    Redis-based cache for memory search results.

    O5 Optimization: Reduces repeated semantic search overhead.
    Cache TTL: 5 minutes by default (configurable via env)
    """

    def __init__(self, redis_url: Optional[str] = None, ttl_seconds: int = 300):
        self.ttl = ttl_seconds
        self.enabled = False
        self.client: Optional[redis.Redis] = None
        self.cache_prefix = "byon:memory:cache:"

        if not REDIS_AVAILABLE:
            logger.warning("Redis not available, cache disabled")
            return

        redis_url = redis_url or os.environ.get("REDIS_URL", "redis://redis:6379/1")

        try:
            self.client = redis.from_url(redis_url, decode_responses=True)
            # Test connection
            self.client.ping()
            self.enabled = True
            logger.info(f"Redis cache enabled: {redis_url}")
        except Exception as e:
            logger.warning(f"Redis connection failed, cache disabled: {e}")
            self.client = None

    def _make_key(self, query: str, mem_type: str, top_k: int, threshold: float) -> str:
        """Generate cache key from query parameters"""
        key_data = f"{query}:{mem_type}:{top_k}:{threshold}"
        key_hash = hashlib.sha256(key_data.encode()).hexdigest()[:16]
        return f"{self.cache_prefix}{mem_type}:{key_hash}"

    def get(self, query: str, mem_type: str, top_k: int, threshold: float) -> Optional[List[Dict[str, Any]]]:
        """Get cached search results"""
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
        """Cache search results"""
        if not self.enabled or not self.client:
            return

        try:
            key = self._make_key(query, mem_type, top_k, threshold)
            self.client.setex(key, self.ttl, json.dumps(results))
            logger.debug(f"Cached {len(results)} results for {mem_type}")
        except Exception as e:
            logger.warning(f"Cache set error: {e}")

    def invalidate_type(self, mem_type: str) -> int:
        """Invalidate all cache entries for a memory type"""
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
        """Get cache statistics"""
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
    Provides typed storage and retrieval with FHRSS+FCPE backend.
    """

    def __init__(self, storage_path: str = "./memory_storage"):
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)

        # Initialize FHRSS+FCPE+MultiScale v3.0 system
        config = UnifiedConfigV3(
            fcpe=FCPEConfig(
                dim=384,
                num_layers=5,
                lambda_s=0.5,
                compression_method="weighted_attention"
            ),
            fhrss=FHRSSConfig(
                subcube_size=8,
                profile="FULL"
            ),
            multiscale=MultiScaleConfig(
                enabled=True,
                grid_size=(32, 32, 8),
                domain_radius=3.7,
                use_hexagonal_packing=True,
                enable_neighbor_recovery=True
            ),
            storage_path=str(self.storage_path / "fhrss_fcpe"),
            auto_persist=True
        )

        self.system = UnifiedFHRSS_FCPE(config)
        self.embedder = create_embedder(dim=384)

        # Redis cache (O5 optimization)
        cache_ttl = int(os.environ.get("MEMORY_CACHE_TTL", "300"))
        self.cache = MemoryCache(ttl_seconds=cache_ttl)

        # Type-specific metadata tracking
        self.type_index: Dict[MemoryType, List[int]] = {
            MemoryType.CODE: [],
            MemoryType.CONVERSATION: [],
            MemoryType.FACT: []
        }

        # Content cache for search results
        self.content_cache: Dict[int, Dict[str, Any]] = {}

        # Load existing type index
        self._load_type_index()

        logger.info(f"MemoryHandlers v3.0 initialized at {self.storage_path}")
        logger.info(f"  Contexts loaded: {len(self.system.contexts)}")
        logger.info(f"  Code entries: {len(self.type_index[MemoryType.CODE])}")
        logger.info(f"  Conversation entries: {len(self.type_index[MemoryType.CONVERSATION])}")
        logger.info(f"  Fact entries: {len(self.type_index[MemoryType.FACT])}")
        logger.info(f"  MultiScale: {self.system.multiscale is not None}")
        if self.system.multiscale:
            logger.info(f"  Domains: {len(self.system.multiscale.domains)}")
        logger.info(f"  Redis cache: {'enabled' if self.cache.enabled else 'disabled'}")

    # ========================================================================
    # STORE OPERATIONS
    # ========================================================================

    def store_code(self, code: str, file_path: str, line_number: int,
                   tags: List[str]) -> int:
        """Store code memory"""
        # Create embedding
        embedding = self.embedder.embed(code)

        # Metadata
        metadata = {
            "type": MemoryType.CODE.value,
            "file_path": file_path,
            "line_number": line_number,
            "tags": tags,
            "content_preview": code[:200],
            "content_hash": hashlib.sha256(code.encode()).hexdigest()[:16]
        }

        # Store in FHRSS+FCPE
        ctx_id = self.system.encode_context(
            embedding.reshape(1, -1),
            metadata=metadata
        )

        # Update index
        self.type_index[MemoryType.CODE].append(ctx_id)
        self.content_cache[ctx_id] = {"content": code, "metadata": metadata}
        self._save_type_index()

        # Invalidate cache for this type (O5)
        self.cache.invalidate_type(MemoryType.CODE.value)

        logger.debug(f"Stored code ctx_id={ctx_id}, file={file_path}")
        return ctx_id

    def store_conversation(self, content: str, role: str) -> int:
        """Store conversation memory"""
        embedding = self.embedder.embed(content)

        metadata = {
            "type": MemoryType.CONVERSATION.value,
            "role": role,
            "content_preview": content[:200],
            "content_hash": hashlib.sha256(content.encode()).hexdigest()[:16]
        }

        ctx_id = self.system.encode_context(
            embedding.reshape(1, -1),
            metadata=metadata
        )

        self.type_index[MemoryType.CONVERSATION].append(ctx_id)
        self.content_cache[ctx_id] = {"content": content, "metadata": metadata}
        self._save_type_index()

        # Invalidate cache for this type (O5)
        self.cache.invalidate_type(MemoryType.CONVERSATION.value)

        logger.debug(f"Stored conversation ctx_id={ctx_id}, role={role}")
        return ctx_id

    def store_fact(self, fact: str, source: str, tags: List[str]) -> int:
        """Store fact memory"""
        embedding = self.embedder.embed(fact)

        metadata = {
            "type": MemoryType.FACT.value,
            "source": source,
            "tags": tags,
            "content_preview": fact[:200],
            "content_hash": hashlib.sha256(fact.encode()).hexdigest()[:16]
        }

        ctx_id = self.system.encode_context(
            embedding.reshape(1, -1),
            metadata=metadata
        )

        self.type_index[MemoryType.FACT].append(ctx_id)
        self.content_cache[ctx_id] = {"content": fact, "metadata": metadata}
        self._save_type_index()

        # Invalidate cache for this type (O5)
        self.cache.invalidate_type(MemoryType.FACT.value)

        logger.debug(f"Stored fact ctx_id={ctx_id}, source={source}")
        return ctx_id

    # ========================================================================
    # SEARCH OPERATIONS
    # ========================================================================

    def search_code(self, query: str, top_k: int = 5,
                    threshold: float = 0.1) -> List[Dict[str, Any]]:
        """Search code memories (threshold lowered for semantic search)"""
        return self._search_by_type(query, MemoryType.CODE, top_k, threshold)

    def search_conversation(self, query: str, top_k: int = 5,
                           threshold: float = 0.1) -> List[Dict[str, Any]]:
        """Search conversation memories (threshold lowered for semantic search)"""
        return self._search_by_type(query, MemoryType.CONVERSATION, top_k, threshold)

    def search_facts(self, query: str, top_k: int = 5,
                    threshold: float = 0.1) -> List[Dict[str, Any]]:
        """Search fact memories (threshold lowered for semantic search)"""
        return self._search_by_type(query, MemoryType.FACT, top_k, threshold)

    def _search_by_type(self, query: str, mem_type: MemoryType,
                        top_k: int, threshold: float) -> List[Dict[str, Any]]:
        """Search memories of specific type"""
        if not self.type_index[mem_type]:
            return []

        # Check Redis cache first (O5 optimization)
        cached_results = self.cache.get(query, mem_type.value, top_k, threshold)
        if cached_results is not None:
            return cached_results

        # Embed query
        query_vec = self.embedder.embed(query)

        # Get all contexts of this type
        type_ctx_ids = set(self.type_index[mem_type])

        # Search using FHRSS+FCPE similarity
        all_similar = self.system.retrieve_similar(query_vec, top_k=len(type_ctx_ids))

        # Filter to type and threshold
        results = []
        for item in all_similar:
            if item['ctx_id'] in type_ctx_ids and item['similarity'] >= threshold:
                cached = self.content_cache.get(item['ctx_id'], {})
                results.append({
                    "ctx_id": item['ctx_id'],
                    "similarity": float(item['similarity']),  # Ensure JSON serializable
                    "content": cached.get("content", item['metadata'].get("content_preview", "")),
                    "metadata": item['metadata']
                })

                if len(results) >= top_k:
                    break

        # Cache results (O5 optimization)
        self.cache.set(query, mem_type.value, top_k, threshold, results)

        return results

    # ========================================================================
    # RECOVERY & STATS
    # ========================================================================

    def test_recovery(self, ctx_id: int, loss_percent: float) -> Dict[str, Any]:
        """Test FHRSS recovery for a context"""
        return self.system.test_recovery(ctx_id, loss_percent)

    def get_stats(self) -> Dict[str, Any]:
        """Get memory statistics (v3.0 with MultiScale)"""
        base_stats = self.system.get_stats()

        stats = {
            "version": base_stats.get('version', '3.0.0'),
            "num_contexts": base_stats['num_contexts'],
            "by_type": {
                "code": len(self.type_index[MemoryType.CODE]),
                "conversation": len(self.type_index[MemoryType.CONVERSATION]),
                "fact": len(self.type_index[MemoryType.FACT])
            },
            "fcpe_dim": base_stats['fcpe_dim'],
            "fhrss_profile": base_stats['fhrss_profile'],
            "fhrss_overhead": base_stats['fhrss_overhead'],
            "total_storage_mb": base_stats['total_storage_mb'],
            "storage_path": str(self.storage_path),
            "cache": self.cache.get_stats()
        }

        # Add MultiScale stats if enabled
        if base_stats.get('multiscale_enabled'):
            ms = base_stats.get('multiscale', {})
            stats["multiscale"] = {
                "enabled": True,
                "domains": ms.get('domains', 0),
                "capacity_bytes": ms.get('capacity_bytes', 0),
                "hexagonal_packing": ms.get('hexagonal_packing', False),
                "avg_neighbors": ms.get('avg_neighbors', 0)
            }

        return stats

    # ========================================================================
    # PERSISTENCE
    # ========================================================================

    def _save_type_index(self):
        """Save type index to disk"""
        import json
        index_path = self.storage_path / "type_index.json"

        data = {
            "code": self.type_index[MemoryType.CODE],
            "conversation": self.type_index[MemoryType.CONVERSATION],
            "fact": self.type_index[MemoryType.FACT]
        }

        with open(index_path, 'w') as f:
            json.dump(data, f)

    def _load_type_index(self):
        """Load type index from disk"""
        import json
        index_path = self.storage_path / "type_index.json"

        if not index_path.exists():
            return

        try:
            with open(index_path, 'r') as f:
                data = json.load(f)

            self.type_index[MemoryType.CODE] = data.get("code", [])
            self.type_index[MemoryType.CONVERSATION] = data.get("conversation", [])
            self.type_index[MemoryType.FACT] = data.get("fact", [])

            # Rebuild content cache from FHRSS+FCPE metadata
            for ctx_id, ctx in self.system.contexts.items():
                if ctx_id not in self.content_cache:
                    self.content_cache[ctx_id] = {
                        "content": ctx.metadata.get("content_preview", ""),
                        "metadata": ctx.metadata
                    }

            logger.info(f"Loaded type index: {len(self.type_index[MemoryType.CODE])} code, "
                       f"{len(self.type_index[MemoryType.CONVERSATION])} conversation, "
                       f"{len(self.type_index[MemoryType.FACT])} fact")

        except Exception as e:
            logger.warning(f"Failed to load type index: {e}")
