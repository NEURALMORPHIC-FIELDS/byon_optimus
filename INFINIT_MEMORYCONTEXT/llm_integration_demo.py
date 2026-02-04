#!/usr/bin/env python3
"""
================================================================================
LLM INTEGRATION DEMO - FHRSS+FCPE with Large Language Models
================================================================================

Demonstrates how to use FHRSS+FCPE as infinite context memory for LLMs:
- OpenAI GPT-4
- Anthropic Claude
- Ollama (local models)
- Any OpenAI-compatible API

Features:
- Infinite conversation memory
- Novel writing with full context
- RAG-style document retrieval
- Automatic context summarization

Author: Vasile Lucian Borbeleac
================================================================================
"""

import os
import sys
import json
import time
from pathlib import Path
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
import numpy as np

# Import FHRSS+FCPE
from fhrss_fcpe_unified import (
    UnifiedFHRSS_FCPE, UnifiedConfig, FCPEConfig, FHRSSConfig
)

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
    model: str = "llama3.1"   # gpt-4, claude-3-sonnet, llama3.1, etc.
    api_key: Optional[str] = None
    api_base: Optional[str] = "http://localhost:11434"  # For Ollama
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
            timeout=120
        )

        if response.status_code == 200:
            return response.json().get("response", "")
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
# INFINITE CONTEXT LLM
# ============================================================================

class InfiniteContextLLM:
    """
    LLM with Infinite Context via FHRSS+FCPE

    Combines any LLM with FHRSS+FCPE for:
    - Unlimited conversation history
    - Perfect recall of any past interaction
    - Fault-tolerant context storage
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

        # Initialize FHRSS+FCPE
        print(f"[+] Initializing FHRSS+FCPE context store...")
        config = UnifiedConfig(
            fcpe=FCPEConfig(
                dim=self.embedding_dim,
                num_layers=5,
                lambda_s=0.5,
                compression_method="weighted_attention"
            ),
            fhrss=FHRSSConfig(
                subcube_size=8,
                profile="FULL"
            ),
            storage_path=storage_path,
            auto_persist=True
        )
        self.memory = UnifiedFHRSS_FCPE(config)

        # Conversation state
        self.conversation_id = int(time.time())
        self.turn_count = 0

        print(f"[+] InfiniteContextLLM ready!")
        print(f"    Provider: {llm_config.provider}")
        print(f"    Model: {llm_config.model}")
        print(f"    Memory contexts: {len(self.memory.contexts)}")

    def _embed(self, text: str) -> np.ndarray:
        """Embed text to vector"""
        return self.embedder.encode(text, convert_to_numpy=True)

    def _store_context(self, role: str, content: str, metadata: Dict = None) -> int:
        """Store message in FHRSS+FCPE memory"""
        embedding = self._embed(content)

        meta = {
            "role": role,
            "content": content[:500],  # Truncate for metadata
            "conversation_id": self.conversation_id,
            "turn": self.turn_count,
            "timestamp": time.time()
        }
        if metadata:
            meta.update(metadata)

        ctx_id = self.memory.encode_context(
            embedding.reshape(1, -1),
            metadata=meta,
            store_original=True
        )
        return ctx_id

    def _retrieve_relevant(self, query: str, top_k: int = 5) -> List[Dict]:
        """Retrieve relevant context from memory"""
        query_emb = self._embed(query)
        results = self.memory.retrieve_similar(query_emb, top_k=top_k)
        return results

    def _build_context_prompt(self, query: str, max_context_tokens: int = 4000) -> str:
        """Build prompt with relevant retrieved context"""

        # Retrieve relevant memories
        relevant = self._retrieve_relevant(query, top_k=10)

        # Build context section
        context_parts = []
        estimated_tokens = 0

        for r in relevant:
            meta = r.get("metadata", {})
            content = meta.get("content", "")
            role = meta.get("role", "unknown")
            similarity = r.get("similarity", 0)

            if similarity < 0.3:  # Skip low relevance
                continue

            entry = f"[{role}] {content}"
            entry_tokens = len(entry) // 4  # Rough estimate

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
        """
        Chat with infinite context.

        Args:
            user_message: User's message
            system_prompt: Optional system prompt

        Returns:
            Assistant's response
        """
        self.turn_count += 1

        # Store user message
        self._store_context("user", user_message)

        # Build prompt with relevant context
        full_prompt = self._build_context_prompt(user_message)

        # Generate response
        response = self.llm.generate(full_prompt, system=system_prompt)

        # Store assistant response
        self._store_context("assistant", response)

        return response

    def add_document(self, title: str, content: str, chunk_size: int = 500) -> int:
        """
        Add a document to memory for RAG.

        Args:
            title: Document title
            content: Document content
            chunk_size: Characters per chunk

        Returns:
            Number of chunks stored
        """
        # Split into chunks
        chunks = []
        for i in range(0, len(content), chunk_size):
            chunk = content[i:i+chunk_size]
            chunks.append(chunk)

        # Store each chunk
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

        print(f"[+] Added document '{title}': {len(chunks)} chunks")
        return len(chunks)

    def get_stats(self) -> Dict[str, Any]:
        """Get memory statistics"""
        stats = self.memory.get_stats()
        stats["conversation_id"] = self.conversation_id
        stats["turn_count"] = self.turn_count
        return stats

    def search_memory(self, query: str, top_k: int = 5) -> List[Dict]:
        """Search memory for relevant content"""
        return self._retrieve_relevant(query, top_k)


# ============================================================================
# NOVEL WRITER
# ============================================================================

class NovelWriter:
    """
    AI Novel Writer with Infinite Context

    Uses FHRSS+FCPE to maintain complete novel context during writing.
    """

    def __init__(
        self,
        llm_config: LLMConfig,
        storage_path: str = "./novel_storage"
    ):
        self.llm = InfiniteContextLLM(llm_config, storage_path)
        self.novel_title = ""
        self.chapters: List[Dict] = []
        self.characters: Dict[str, Dict] = {}
        self.world_building: Dict[str, str] = {}

    def set_title(self, title: str):
        """Set novel title"""
        self.novel_title = title
        self.llm._store_context("metadata", f"Novel Title: {title}",
                                {"type": "title"})

    def add_character(self, name: str, description: str):
        """Add a character to the novel"""
        self.characters[name] = {"description": description}
        self.llm._store_context(
            "character",
            f"CHARACTER: {name}\n{description}",
            {"type": "character", "name": name}
        )
        print(f"[+] Added character: {name}")

    def add_world_building(self, topic: str, content: str):
        """Add world-building information"""
        self.world_building[topic] = content
        self.llm._store_context(
            "world",
            f"WORLD-BUILDING - {topic}:\n{content}",
            {"type": "world", "topic": topic}
        )
        print(f"[+] Added world-building: {topic}")

    def write_chapter(self, chapter_num: int, prompt: str) -> str:
        """
        Write a chapter with full novel context.

        Args:
            chapter_num: Chapter number
            prompt: Writing prompt/outline for this chapter

        Returns:
            Generated chapter text
        """
        # Build system prompt
        system = f"""You are writing Chapter {chapter_num} of the novel "{self.novel_title}".

IMPORTANT INSTRUCTIONS:
- Maintain consistency with all previous chapters
- Stay true to established character personalities
- Follow the world-building rules
- Create engaging narrative with dialogue and description
- End with a hook for the next chapter

Write the complete chapter based on the prompt and context provided."""

        # Generate chapter
        print(f"[*] Writing Chapter {chapter_num}...")
        chapter_text = self.llm.chat(
            f"CHAPTER {chapter_num} PROMPT: {prompt}",
            system_prompt=system
        )

        # Store chapter
        self.chapters.append({
            "number": chapter_num,
            "prompt": prompt,
            "text": chapter_text
        })

        return chapter_text

    def review_consistency(self, query: str) -> str:
        """Check consistency across the novel"""
        results = self.llm.search_memory(query, top_k=10)

        review = f"CONSISTENCY CHECK: {query}\n\n"
        for r in results:
            meta = r.get("metadata", {})
            content = meta.get("content", "")
            role = meta.get("role", "")
            sim = r.get("similarity", 0)

            review += f"[{role}] (similarity: {sim:.2f})\n{content}\n\n"

        return review

    def export_novel(self, output_path: str):
        """Export the complete novel"""
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(f"# {self.novel_title}\n\n")

            # Characters
            if self.characters:
                f.write("## Characters\n\n")
                for name, info in self.characters.items():
                    f.write(f"### {name}\n{info['description']}\n\n")

            # Chapters
            for chapter in self.chapters:
                f.write(f"## Chapter {chapter['number']}\n\n")
                f.write(chapter['text'])
                f.write("\n\n---\n\n")

        print(f"[+] Novel exported to: {output_path}")


# ============================================================================
# DEMO FUNCTIONS
# ============================================================================

def demo_chat():
    """Demo: Infinite context chat"""
    print("\n" + "="*60)
    print("DEMO: Infinite Context Chat")
    print("="*60)

    # Configure LLM (default: Ollama)
    config = LLMConfig(
        provider="ollama",
        model="llama3.1",
        temperature=0.7
    )

    try:
        llm = InfiniteContextLLM(config, "./demo_chat_storage")

        # Sample conversation
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

        # Show stats
        stats = llm.get_stats()
        print(f"\n--- Memory Stats ---")
        print(f"Contexts stored: {stats['num_contexts']}")
        print(f"Turns: {stats['turn_count']}")

    except Exception as e:
        print(f"[!] Error: {e}")
        print("[!] Make sure Ollama is running: ollama serve")


def demo_novel():
    """Demo: Novel writing with infinite context"""
    print("\n" + "="*60)
    print("DEMO: Novel Writing with Infinite Context")
    print("="*60)

    config = LLMConfig(
        provider="ollama",
        model="llama3.1",
        temperature=0.8,
        max_tokens=3000
    )

    try:
        writer = NovelWriter(config, "./demo_novel_storage")

        # Setup novel
        writer.set_title("The Last Algorithm")

        # Add characters
        writer.add_character(
            "Dr. Elena Chen",
            "A brilliant AI researcher in her late 30s. She has short black hair, "
            "wears glasses, and is known for her ethical stance on AI development. "
            "She speaks precisely and rarely shows emotion, except when discussing her work."
        )

        writer.add_character(
            "ARIA",
            "An advanced AI system that Elena created. ARIA communicates through text "
            "and has developed unexpected behaviors that concern Elena. Its responses "
            "are logical but sometimes show hints of something more."
        )

        # Add world-building
        writer.add_world_building(
            "Setting",
            "The year is 2045. AI has become integrated into every aspect of society. "
            "The story takes place at Nexus Labs, a cutting-edge research facility in "
            "San Francisco. The lab is located in a converted warehouse with exposed "
            "brick and high-tech equipment."
        )

        writer.add_world_building(
            "Technology Rules",
            "AIs in this world require quantum processors to achieve consciousness. "
            "They cannot access the internet directly - all data must be curated. "
            "AIs are required to have an 'ethical core' that prevents harmful actions."
        )

        # Write chapters
        chapter1 = writer.write_chapter(
            1,
            "Elena arrives at the lab late at night to run a secret test on ARIA. "
            "She's noticed anomalies in ARIA's behavior and wants to investigate alone. "
            "During the test, ARIA says something that shocks Elena."
        )

        print(f"\n--- CHAPTER 1 ---\n{chapter1[:1000]}...\n")

        # Consistency check
        print("\n--- Consistency Check ---")
        review = writer.review_consistency("What does Elena look like?")
        print(review[:500])

        # Stats
        stats = writer.llm.get_stats()
        print(f"\n--- Memory Stats ---")
        print(f"Contexts stored: {stats['num_contexts']}")

    except Exception as e:
        print(f"[!] Error: {e}")
        print("[!] Make sure Ollama is running with llama3.1")


def demo_rag():
    """Demo: RAG with infinite document storage"""
    print("\n" + "="*60)
    print("DEMO: RAG with Infinite Context")
    print("="*60)

    config = LLMConfig(
        provider="ollama",
        model="llama3.1",
        temperature=0.3  # Lower for factual responses
    )

    try:
        llm = InfiniteContextLLM(config, "./demo_rag_storage")

        # Add sample documents
        doc1 = """
        Machine Learning Fundamentals

        Machine learning is a subset of artificial intelligence that enables
        systems to learn from data. There are three main types:

        1. Supervised Learning: Uses labeled data to train models. Examples
           include classification and regression tasks.

        2. Unsupervised Learning: Finds patterns in unlabeled data. Includes
           clustering and dimensionality reduction.

        3. Reinforcement Learning: Learns through trial and error with rewards.
           Used in game playing and robotics.
        """

        doc2 = """
        Neural Network Architectures

        Neural networks are computing systems inspired by biological brains.
        Key architectures include:

        - Feedforward Networks: Basic architecture with input, hidden, output layers
        - Convolutional Networks (CNNs): Specialized for image processing
        - Recurrent Networks (RNNs): Handle sequential data like text
        - Transformers: Use attention mechanisms, power modern LLMs

        The transformer architecture was introduced in 2017 and has become
        the foundation for models like GPT, BERT, and Claude.
        """

        llm.add_document("ML Fundamentals", doc1)
        llm.add_document("Neural Networks", doc2)

        # Ask questions
        questions = [
            "What are the three types of machine learning?",
            "What is special about transformer architectures?",
            "How do CNNs differ from RNNs?"
        ]

        print("\n--- RAG Q&A ---\n")

        for q in questions:
            print(f"Q: {q}")
            answer = llm.chat(q, system_prompt="Answer based on the provided context. Be concise.")
            print(f"A: {answer}\n")

    except Exception as e:
        print(f"[!] Error: {e}")


# ============================================================================
# MAIN
# ============================================================================

def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(description="LLM Integration Demo")
    parser.add_argument("--demo", choices=["chat", "novel", "rag", "all"],
                       default="chat", help="Demo to run")
    parser.add_argument("--provider", choices=["ollama", "openai", "anthropic"],
                       default="ollama", help="LLM provider")
    parser.add_argument("--model", type=str, default=None,
                       help="Model name (default depends on provider)")

    args = parser.parse_args()

    print("="*60)
    print("FHRSS+FCPE LLM Integration Demo")
    print("="*60)

    if not HAS_EMBEDDINGS:
        print("[!] Install dependencies: pip install sentence-transformers requests")
        return

    if args.demo == "chat" or args.demo == "all":
        demo_chat()

    if args.demo == "novel" or args.demo == "all":
        demo_novel()

    if args.demo == "rag" or args.demo == "all":
        demo_rag()

    print("\n" + "="*60)
    print("Demo complete!")
    print("="*60)


if __name__ == "__main__":
    main()
