#!/usr/bin/env python3
"""
================================================================================
LLM INTEGRATION - FAISS-Optimized Infinite Context
================================================================================

Provides infinite conversation memory for LLMs using FAISS IndexFlatIP
with sentence-transformers embeddings (all-MiniLM-L6-v2, 384-dim, CPU).

Replaces the FCPE-based approach which had a critical similarity collapse bug:
FCPE's whitening step collapses single-vector (1,384) inputs to identical
vectors, making all similarity scores equal. This fix bypasses FCPE entirely
and uses raw L2-normalized embeddings with FAISS inner product = cosine similarity.

Supports:
- Ollama (local models)
- OpenAI GPT-4
- Anthropic Claude
- Any OpenAI-compatible API

Author: Vasile Lucian Borbeleac
Patent: EP25216372.0 - OmniVault
================================================================================
"""

import os
import sys
import json
import time
import pickle
import threading
from pathlib import Path
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
import numpy as np

import faiss

# Embedding provider
try:
    from sentence_transformers import SentenceTransformer
    HAS_EMBEDDINGS = True
except ImportError:
    HAS_EMBEDDINGS = False
    print("[!] Install sentence-transformers: pip install sentence-transformers")

# LLM Providers
try:
    import openai
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False

try:
    import anthropic
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False


# ============================================================================
# CONFIGURATION
# ============================================================================

@dataclass
class LLMConfig:
    """LLM Configuration"""
    provider: str = "ollama"  # openai, anthropic, ollama
    model: str = "llama3.1"
    api_key: Optional[str] = None
    api_base: Optional[str] = "http://localhost:11434"
    temperature: float = 0.7
    max_tokens: int = 2000


# ============================================================================
# LLM PROVIDERS
# ============================================================================

class LLMProvider:
    """Base LLM Provider"""

    def __init__(self, config: LLMConfig):
        self.config = config

    def generate(self, prompt: str, system: str = None) -> str:
        raise NotImplementedError


class OpenAIProvider(LLMProvider):
    """OpenAI GPT Provider"""

    def __init__(self, config: LLMConfig):
        super().__init__(config)
        if not HAS_OPENAI:
            raise ImportError("Install openai: pip install openai")

        openai.api_key = config.api_key or os.getenv("OPENAI_API_KEY")
        self.client = openai.OpenAI()

    def generate(self, prompt: str, system: str = None) -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        response = self.client.chat.completions.create(
            model=self.config.model,
            messages=messages,
            temperature=self.config.temperature,
            max_tokens=self.config.max_tokens
        )
        return response.choices[0].message.content


class AnthropicProvider(LLMProvider):
    """Anthropic Claude Provider"""

    def __init__(self, config: LLMConfig):
        super().__init__(config)
        if not HAS_ANTHROPIC:
            raise ImportError("Install anthropic: pip install anthropic")

        self.client = anthropic.Anthropic(
            api_key=config.api_key or os.getenv("ANTHROPIC_API_KEY")
        )

    def generate(self, prompt: str, system: str = None) -> str:
        response = self.client.messages.create(
            model=self.config.model,
            max_tokens=self.config.max_tokens,
            system=system or "You are a helpful assistant.",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content[0].text


class OllamaProvider(LLMProvider):
    """Ollama Local Provider"""

    def __init__(self, config: LLMConfig):
        super().__init__(config)
        if not HAS_REQUESTS:
            raise ImportError("Install requests: pip install requests")

        self.api_base = config.api_base or "http://localhost:11434"

    def generate(self, prompt: str, system: str = None) -> str:
        full_prompt = prompt
        if system:
            full_prompt = f"{system}\n\n{prompt}"

        response = requests.post(
            f"{self.api_base}/api/generate",
            json={
                "model": self.config.model,
                "prompt": full_prompt,
                "stream": False,
                "options": {
                    "temperature": self.config.temperature,
                    "num_predict": self.config.max_tokens
                }
            },
            timeout=300
        )

        if response.status_code == 200:
            data = response.json()
            # Store raw Ollama metadata for the adapter
            self._last_raw_meta = {
                "eval_count": data.get("eval_count", 0),
                "prompt_eval_count": data.get("prompt_eval_count", 0),
                "eval_duration": data.get("eval_duration", 0),
                "prompt_eval_duration": data.get("prompt_eval_duration", 0),
                "load_duration": data.get("load_duration", 0),
                "total_duration": data.get("total_duration", 0),
            }
            return data.get("response", "")
        else:
            raise Exception(f"Ollama error: {response.text}")


def get_llm_provider(config: LLMConfig) -> LLMProvider:
    """Factory for LLM providers"""
    providers = {
        "openai": OpenAIProvider,
        "anthropic": AnthropicProvider,
        "ollama": OllamaProvider
    }

    if config.provider not in providers:
        raise ValueError(f"Unknown provider: {config.provider}")

    return providers[config.provider](config)


# ============================================================================
# FAISS MEMORY STORE
# ============================================================================

class FAISSContextStore:
    """
    FAISS-based context store for conversation memory.

    Uses IndexFlatIP on L2-normalized vectors = cosine similarity.
    Replaces FCPE which had a similarity collapse bug on single-vector inputs.
    """

    def __init__(self, dim: int, storage_path: str):
        self._dim = dim
        self._storage_path = Path(storage_path)
        self._storage_path.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

        self._faiss_path = self._storage_path / "faiss_index.bin"
        self._meta_path = self._storage_path / "metadata.pkl"

        self._metadata: Dict[int, Dict[str, Any]] = {}
        self._id_map: List[int] = []
        self._next_id = 0

        if self._faiss_path.exists() and self._meta_path.exists():
            self._load()
        else:
            self._index = faiss.IndexFlatIP(self._dim)

    def _load(self):
        try:
            self._index = faiss.read_index(str(self._faiss_path))
            with open(self._meta_path, "rb") as f:
                saved = pickle.load(f)
            self._metadata = saved["metadata"]
            self._id_map = saved["id_map"]
            self._next_id = saved["next_id"]
        except Exception:
            self._index = faiss.IndexFlatIP(self._dim)
            self._metadata = {}
            self._id_map = []
            self._next_id = 0

    def store(self, embedding: np.ndarray, metadata: Dict[str, Any]) -> int:
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

    def search(self, query_embedding: np.ndarray, top_k: int = 10,
               threshold: float = 0.3) -> List[Dict[str, Any]]:
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
            meta = self._metadata.get(ctx_id, {})
            if score >= threshold:
                results.append({
                    "ctx_id": ctx_id,
                    "similarity": float(score),
                    "metadata": meta,
                })

        return results

    def save(self):
        with self._lock:
            faiss.write_index(self._index, str(self._faiss_path))
            with open(self._meta_path, "wb") as f:
                pickle.dump({
                    "metadata": self._metadata,
                    "id_map": self._id_map,
                    "next_id": self._next_id,
                }, f)

    @property
    def num_contexts(self) -> int:
        return self._index.ntotal

    @property
    def contexts(self):
        """Compatibility property for code that checks len(self.memory.contexts)."""
        return self._metadata


# ============================================================================
# INFINITE CONTEXT LLM
# ============================================================================

class InfiniteContextLLM:
    """
    LLM with Infinite Context via FAISS Semantic Memory.

    Combines any LLM with FAISS IndexFlatIP for:
    - Unlimited conversation history
    - Real cosine similarity ranking (not collapsed FCPE scores)
    - Persistent memory across sessions
    - Semantic search across all history
    """

    def __init__(
        self,
        llm_config: LLMConfig,
        storage_path: str = "./infinite_context_storage",
        embedding_model: str = "all-MiniLM-L6-v2"
    ):
        # Initialize LLM
        self.llm = get_llm_provider(llm_config)
        self.llm_config = llm_config

        # Initialize embeddings
        if HAS_EMBEDDINGS:
            print(f"[+] Loading embedding model: {embedding_model}")
            self.embedder = SentenceTransformer(embedding_model)
            self.embedding_dim = self.embedder.get_sentence_embedding_dimension()
        else:
            raise ImportError("sentence-transformers required")

        # Initialize FAISS context store (replaces FHRSS+FCPE)
        print(f"[+] Initializing FAISS context store...")
        self.memory = FAISSContextStore(self.embedding_dim, storage_path)

        # Conversation state
        self.conversation_id = int(time.time())
        self.turn_count = 0

        print(f"[+] InfiniteContextLLM ready!")
        print(f"    Provider: {llm_config.provider}")
        print(f"    Model: {llm_config.model}")
        print(f"    Backend: FAISS IndexFlatIP (cosine similarity)")
        print(f"    Memory contexts: {self.memory.num_contexts}")

    def _embed(self, text: str) -> np.ndarray:
        """Embed text to L2-normalized vector."""
        return self.embedder.encode(text, normalize_embeddings=True,
                                     convert_to_numpy=True).astype(np.float32)

    def _store_context(self, role: str, content: str, metadata: Dict = None) -> int:
        """Store message in FAISS memory."""
        embedding = self._embed(content)

        meta = {
            "role": role,
            "content": content[:500],
            "conversation_id": self.conversation_id,
            "turn": self.turn_count,
            "timestamp": time.time()
        }
        if metadata:
            meta.update(metadata)

        ctx_id = self.memory.store(embedding, meta)
        return ctx_id

    def _retrieve_relevant(self, query: str, top_k: int = 5) -> List[Dict]:
        """Retrieve relevant context from FAISS memory."""
        query_emb = self._embed(query)
        results = self.memory.search(query_emb, top_k=top_k, threshold=0.3)
        return results

    def _build_context_prompt(self, query: str, max_context_tokens: int = 4000) -> str:
        """Build prompt with relevant retrieved context."""
        relevant = self._retrieve_relevant(query, top_k=10)

        context_parts = []
        estimated_tokens = 0

        for r in relevant:
            meta = r.get("metadata", {})
            content = meta.get("content", "")
            role = meta.get("role", "unknown")
            similarity = r.get("similarity", 0)

            entry = f"[{role}] (relevance: {similarity:.0%}) {content}"
            entry_tokens = len(entry) // 4

            if estimated_tokens + entry_tokens > max_context_tokens:
                break

            context_parts.append(entry)
            estimated_tokens += entry_tokens

        if context_parts:
            context_str = "\n---\n".join(context_parts)
            return f"""RELEVANT CONTEXT FROM MEMORY:
{context_str}

---
CURRENT QUERY: {query}"""
        else:
            return query

    def chat(self, user_message: str, system_prompt: str = None) -> str:
        """Chat with infinite context."""
        self.turn_count += 1

        # Store user message
        self._store_context("user", user_message)

        # Build prompt with relevant context
        full_prompt = self._build_context_prompt(user_message)

        # Generate response
        response = self.llm.generate(full_prompt, system=system_prompt)

        # Propagate raw Ollama metadata
        self._last_ollama_meta = getattr(self.llm, "_last_raw_meta", {})

        # Store assistant response
        self._store_context("assistant", response)

        # Auto-save after each turn
        self.memory.save()

        return response

    def add_document(self, title: str, content: str, chunk_size: int = 500) -> int:
        """Add a document to memory for RAG."""
        chunks = []
        for i in range(0, len(content), chunk_size):
            chunk = content[i:i+chunk_size]
            chunks.append(chunk)

        for i, chunk in enumerate(chunks):
            self._store_context(
                "document",
                chunk,
                metadata={
                    "title": title,
                    "chunk_index": i,
                    "total_chunks": len(chunks)
                }
            )

        self.memory.save()
        print(f"[+] Added document '{title}': {len(chunks)} chunks")
        return len(chunks)

    def get_stats(self) -> Dict[str, Any]:
        """Get memory statistics."""
        return {
            "num_contexts": self.memory.num_contexts,
            "backend": "FAISS IndexFlatIP",
            "embedding_dim": self.embedding_dim,
            "conversation_id": self.conversation_id,
            "turn_count": self.turn_count,
        }

    def search_memory(self, query: str, top_k: int = 5) -> List[Dict]:
        """Search memory for relevant content."""
        return self._retrieve_relevant(query, top_k)


# ============================================================================
# DEMO FUNCTIONS
# ============================================================================

def demo_chat():
    """Demo: Infinite context chat"""
    print("\n" + "="*60)
    print("DEMO: Infinite Context Chat (FAISS-Optimized)")
    print("="*60)

    config = LLMConfig(
        provider="ollama",
        model="llama3.1",
        temperature=0.7
    )

    try:
        llm = InfiniteContextLLM(config, "./demo_chat_storage")

        messages = [
            "Hello! My name is Alex and I'm working on a project about AI.",
            "The project involves natural language processing and machine learning.",
            "We're specifically looking at transformer architectures.",
            "Can you remind me what my name is and what I'm working on?"
        ]

        print("\n--- Starting Conversation ---\n")

        for msg in messages:
            print(f"USER: {msg}")
            response = llm.chat(msg)
            print(f"AI: {response}\n")

        stats = llm.get_stats()
        print(f"\n--- Memory Stats ---")
        print(f"Contexts stored: {stats['num_contexts']}")
        print(f"Backend: {stats['backend']}")
        print(f"Turns: {stats['turn_count']}")

    except Exception as e:
        print(f"[!] Error: {e}")
        print("[!] Make sure Ollama is running: ollama serve")


def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(description="LLM Integration Demo")
    parser.add_argument("--demo", choices=["chat", "all"],
                       default="chat", help="Demo to run")
    parser.add_argument("--provider", choices=["ollama", "openai", "anthropic"],
                       default="ollama", help="LLM provider")
    parser.add_argument("--model", type=str, default=None,
                       help="Model name")

    args = parser.parse_args()

    print("="*60)
    print("FAISS-Optimized LLM Integration Demo")
    print("="*60)

    if not HAS_EMBEDDINGS:
        print("[!] Install dependencies: pip install sentence-transformers requests faiss-cpu")
        return

    demo_chat()

    print("\n" + "="*60)
    print("Demo complete!")
    print("="*60)


if __name__ == "__main__":
    main()
