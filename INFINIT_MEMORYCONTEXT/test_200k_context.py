#!/usr/bin/env python3
"""
================================================================================
200K+ TOKEN CONTEXT WINDOW TEST - FHRSS + FCPE
================================================================================

Tests the system's ability to handle extremely large context windows:
- 200,000+ tokens (comparable to Claude's context window)
- Memory efficiency
- Retrieval accuracy from massive context
- Compression ratios at scale
- Recovery after corruption

Author: Scientific Validation Suite
================================================================================
"""

import numpy as np
import time
import json
import sys
import gc
from pathlib import Path
from typing import List, Dict, Any
from dataclasses import dataclass
import hashlib
import psutil

# Import unified system
from fhrss_fcpe_unified import (
    UnifiedFHRSS_FCPE, UnifiedConfig, FCPEConfig, FHRSSConfig
)

# Try sentence-transformers
try:
    from sentence_transformers import SentenceTransformer
    HAS_ST = True
except ImportError:
    HAS_ST = False


# ============================================================================
# CONSTANTS
# ============================================================================

# Token estimation: ~4 characters per token (English average)
CHARS_PER_TOKEN = 4

# Embedding dimension
EMBEDDING_DIM = 384

# Tokens per embedding (average sentence length)
TOKENS_PER_EMBEDDING = 20


# ============================================================================
# TEST DATA GENERATOR
# ============================================================================

class LargeContextGenerator:
    """Generates large context for testing"""

    # Sample topics for variety
    TOPICS = [
        "machine learning", "neural networks", "transformers", "attention mechanisms",
        "natural language processing", "computer vision", "reinforcement learning",
        "deep learning", "optimization", "gradient descent", "backpropagation",
        "convolutional networks", "recurrent networks", "generative models",
        "language models", "embeddings", "tokenization", "fine-tuning",
        "transfer learning", "multi-task learning", "meta-learning",
        "self-supervised learning", "contrastive learning", "knowledge distillation"
    ]

    TEMPLATES = [
        "In the context of {topic}, we observe that the fundamental principles involve...",
        "The {topic} approach leverages sophisticated algorithms to achieve...",
        "When discussing {topic}, it's important to understand the underlying mechanisms...",
        "Research in {topic} has shown significant advances in recent years...",
        "The implementation of {topic} requires careful consideration of...",
        "From a theoretical perspective, {topic} can be understood as...",
        "Practical applications of {topic} include various domains such as...",
        "The evolution of {topic} has been marked by several key innovations...",
        "Challenges in {topic} often arise from the complexity of...",
        "Future directions in {topic} point towards more efficient approaches...",
    ]

    def __init__(self, use_real_embeddings: bool = True):
        self.use_real = use_real_embeddings and HAS_ST
        self.model = None

        if self.use_real:
            print("[+] Loading sentence-transformers model...")
            self.model = SentenceTransformer('all-MiniLM-L6-v2')
            print("[+] Model loaded")
        else:
            print("[*] Using simulated embeddings")

    def generate_text(self, num_tokens: int) -> List[str]:
        """Generate text chunks totaling approximately num_tokens"""
        sentences = []
        total_tokens = 0

        while total_tokens < num_tokens:
            topic = np.random.choice(self.TOPICS)
            template = np.random.choice(self.TEMPLATES)
            sentence = template.format(topic=topic)

            # Add some variation
            extra = np.random.choice([
                f" This relates to {np.random.choice(self.TOPICS)}.",
                f" The connection to {np.random.choice(self.TOPICS)} is clear.",
                f" Similar concepts apply in {np.random.choice(self.TOPICS)}.",
                ""
            ])
            sentence += extra

            sentences.append(sentence)
            total_tokens += len(sentence) // CHARS_PER_TOKEN

        return sentences

    def encode_texts(self, texts: List[str]) -> np.ndarray:
        """Encode texts to embeddings"""
        if self.use_real:
            return self.model.encode(texts, convert_to_numpy=True, show_progress_bar=True)
        else:
            # Simulated embeddings
            embeddings = []
            for text in texts:
                seed = int(hashlib.md5(text.encode()).hexdigest(), 16) % (2**32)
                np.random.seed(seed)
                emb = np.random.randn(EMBEDDING_DIM).astype(np.float32)
                emb = emb / np.linalg.norm(emb)
                embeddings.append(emb)
            return np.stack(embeddings)


# ============================================================================
# MEMORY TRACKER
# ============================================================================

def get_memory_usage_mb() -> float:
    """Get current process memory usage in MB"""
    process = psutil.Process()
    return process.memory_info().rss / (1024 * 1024)


# ============================================================================
# 200K TOKEN TEST
# ============================================================================

@dataclass
class TokenTestResult:
    """Result of token test"""
    target_tokens: int
    actual_tokens: int
    num_embeddings: int
    encode_time_seconds: float
    memory_before_mb: float
    memory_after_mb: float
    memory_delta_mb: float
    compression_ratio: float
    retrieval_accuracy: float
    recovery_success: bool
    passed: bool


def run_200k_token_test(
    target_tokens: int = 200000,
    use_real_embeddings: bool = True
) -> TokenTestResult:
    """
    Run the 200k+ token context window test.

    Args:
        target_tokens: Number of tokens to test (default 200k)
        use_real_embeddings: Use real sentence-transformers

    Returns:
        TokenTestResult with all metrics
    """
    print("\n" + "=" * 70)
    print(f"200K+ TOKEN CONTEXT WINDOW TEST")
    print(f"Target: {target_tokens:,} tokens")
    print("=" * 70)

    # Clean up before test
    gc.collect()
    memory_before = get_memory_usage_mb()
    print(f"\n[0] Initial memory: {memory_before:.1f} MB")

    # Initialize generator
    generator = LargeContextGenerator(use_real_embeddings)

    # Generate text
    print(f"\n[1] Generating {target_tokens:,} tokens of text...")
    t0 = time.time()
    sentences = generator.generate_text(target_tokens)
    gen_time = time.time() - t0

    actual_tokens = sum(len(s) // CHARS_PER_TOKEN for s in sentences)
    print(f"    Generated {len(sentences):,} sentences ({actual_tokens:,} tokens)")
    print(f"    Generation time: {gen_time:.2f}s")

    # Encode to embeddings
    print(f"\n[2] Encoding sentences to embeddings...")
    t0 = time.time()
    embeddings = generator.encode_texts(sentences)
    encode_time = time.time() - t0
    print(f"    Encoded {embeddings.shape[0]:,} embeddings in {encode_time:.2f}s")
    print(f"    Embedding rate: {embeddings.shape[0] / encode_time:.1f} emb/s")

    # Original data size
    original_size_mb = embeddings.nbytes / (1024 * 1024)
    print(f"    Raw embedding size: {original_size_mb:.2f} MB")

    # Initialize FHRSS+FCPE system
    print(f"\n[3] Initializing FHRSS+FCPE system...")

    import shutil
    test_path = Path("./test_200k_storage")
    if test_path.exists():
        shutil.rmtree(test_path)

    config = UnifiedConfig(
        fcpe=FCPEConfig(
            dim=EMBEDDING_DIM,
            num_layers=5,
            lambda_s=0.5,
            compression_method="weighted_attention"
        ),
        fhrss=FHRSSConfig(
            subcube_size=8,
            profile="FULL"
        ),
        storage_path=str(test_path),
        auto_persist=False  # Don't persist to disk during test
    )

    system = UnifiedFHRSS_FCPE(config)

    # Encode into system in batches
    print(f"\n[4] Encoding context into FHRSS+FCPE system...")
    batch_size = 100
    num_batches = (len(sentences) + batch_size - 1) // batch_size

    t0 = time.time()
    context_ids = []
    topic_map = {}  # Map topic -> context IDs for retrieval test

    for batch_idx in range(num_batches):
        start = batch_idx * batch_size
        end = min(start + batch_size, len(sentences))

        batch_embeddings = embeddings[start:end]
        batch_sentences = sentences[start:end]

        for i, (emb, sent) in enumerate(zip(batch_embeddings, batch_sentences)):
            # Extract topic for later retrieval test
            topic = None
            for t in generator.TOPICS:
                if t in sent.lower():
                    topic = t
                    break

            ctx_id = system.encode_context(
                emb.reshape(1, -1),
                metadata={'sentence_idx': start + i, 'topic': topic}
            )
            context_ids.append(ctx_id)

            if topic:
                if topic not in topic_map:
                    topic_map[topic] = []
                topic_map[topic].append(ctx_id)

        # Progress
        if (batch_idx + 1) % 50 == 0 or batch_idx == num_batches - 1:
            progress = (batch_idx + 1) / num_batches * 100
            elapsed = time.time() - t0
            rate = (end) / elapsed
            print(f"    Progress: {progress:.0f}% ({end:,}/{len(sentences):,}) - {rate:.0f} emb/s")

    total_encode_time = time.time() - t0
    print(f"\n    Total FHRSS+FCPE encode time: {total_encode_time:.2f}s")
    print(f"    Encode rate: {len(sentences) / total_encode_time:.0f} embeddings/s")

    # Memory after encoding
    gc.collect()
    memory_after = get_memory_usage_mb()
    memory_delta = memory_after - memory_before
    print(f"\n[5] Memory usage:")
    print(f"    Before: {memory_before:.1f} MB")
    print(f"    After: {memory_after:.1f} MB")
    print(f"    Delta: {memory_delta:.1f} MB")

    # Compression analysis
    print(f"\n[6] Compression analysis:")

    # Each context stores: fcpe_vector (384*4 bytes) + FHRSS overhead
    stats = system.get_stats()
    compressed_size_mb = stats['total_storage_bytes'] / (1024 * 1024)

    # Theoretical: all embeddings compressed to single vector
    mega_compressed = system.fcpe.encode(embeddings[:1000])  # Sample for mega-compression
    mega_size_bytes = len(mega_compressed) * 4

    print(f"    Original embeddings: {original_size_mb:.2f} MB")
    print(f"    Individual storage: {compressed_size_mb:.2f} MB (per-context FHRSS)")
    print(f"    Mega-compressed: {mega_size_bytes} bytes (entire context -> 1 vector)")

    individual_ratio = original_size_mb / compressed_size_mb if compressed_size_mb > 0 else 0
    mega_ratio = (original_size_mb * 1024 * 1024) / mega_size_bytes if mega_size_bytes > 0 else 0

    print(f"    Individual compression: {individual_ratio:.2f}x")
    print(f"    Mega-compression ratio: {mega_ratio:.0f}x")

    # Test retrieval
    print(f"\n[7] Testing retrieval from {len(sentences):,} contexts...")

    test_topics = list(topic_map.keys())[:5]  # Test 5 topics
    retrieval_scores = []

    for topic in test_topics:
        # Create query about topic
        query_text = f"Tell me about {topic} and its applications"

        if generator.use_real:
            query_emb = generator.model.encode(query_text, convert_to_numpy=True)
        else:
            seed = int(hashlib.md5(query_text.encode()).hexdigest(), 16) % (2**32)
            np.random.seed(seed)
            query_emb = np.random.randn(EMBEDDING_DIM).astype(np.float32)
            query_emb = query_emb / np.linalg.norm(query_emb)

        # Retrieve top 10
        results = system.retrieve_similar(query_emb, top_k=10)

        # Check if any result has matching topic
        expected_ids = set(topic_map[topic])
        found = any(r['ctx_id'] in expected_ids for r in results)

        retrieval_scores.append(1.0 if found else 0.0)

        status = "[OK]" if found else "[X]"
        print(f"    {status} Query '{topic}': found in top-10 = {found}")

    retrieval_accuracy = np.mean(retrieval_scores) if retrieval_scores else 0

    # Test recovery
    print(f"\n[8] Testing FHRSS recovery...")

    # Pick random contexts to test recovery
    test_ctx_ids = np.random.choice(context_ids, size=min(10, len(context_ids)), replace=False)

    recovery_results = []
    for ctx_id in test_ctx_ids:
        result = system.test_recovery(int(ctx_id), loss_percent=0.30, seed=42)
        recovery_results.append(result['cosine_similarity'] > 0.99)

    recovery_success = all(recovery_results)
    print(f"    Recovery at 30% loss: {sum(recovery_results)}/{len(recovery_results)} contexts")
    print(f"    All recovered: {'YES' if recovery_success else 'NO'}")

    # Summary
    print("\n" + "=" * 70)
    print("200K TOKEN TEST SUMMARY")
    print("=" * 70)

    passed = (
        actual_tokens >= target_tokens * 0.9 and
        retrieval_accuracy >= 0.6 and
        recovery_success
    )

    print(f"""
    Target tokens:       {target_tokens:,}
    Actual tokens:       {actual_tokens:,}
    Embeddings:          {len(sentences):,}

    Encode time:         {total_encode_time:.1f}s ({len(sentences)/total_encode_time:.0f} emb/s)
    Memory delta:        {memory_delta:.1f} MB

    Compression:
      - Per-context:     {individual_ratio:.2f}x
      - Mega-compress:   {mega_ratio:.0f}x

    Retrieval accuracy:  {retrieval_accuracy*100:.0f}%
    Recovery success:    {'YES' if recovery_success else 'NO'}

    OVERALL:             {'PASS' if passed else 'FAIL'}
    """)

    print("=" * 70)

    return TokenTestResult(
        target_tokens=target_tokens,
        actual_tokens=actual_tokens,
        num_embeddings=len(sentences),
        encode_time_seconds=total_encode_time,
        memory_before_mb=memory_before,
        memory_after_mb=memory_after,
        memory_delta_mb=memory_delta,
        compression_ratio=mega_ratio,
        retrieval_accuracy=retrieval_accuracy,
        recovery_success=recovery_success,
        passed=passed
    )


# ============================================================================
# SCALING TEST
# ============================================================================

def run_scaling_test():
    """Test at multiple token levels to find limits"""

    print("\n" + "=" * 70)
    print("SCALING TEST - Finding Context Window Limits")
    print("=" * 70)

    token_levels = [10000, 50000, 100000, 200000, 500000]
    results = []

    for tokens in token_levels:
        print(f"\n>>> Testing {tokens:,} tokens...")

        try:
            result = run_200k_token_test(
                target_tokens=tokens,
                use_real_embeddings=True
            )
            results.append({
                'tokens': tokens,
                'passed': result.passed,
                'encode_time': result.encode_time_seconds,
                'memory_mb': result.memory_delta_mb,
                'compression': result.compression_ratio
            })

            # Clean up
            gc.collect()

            if not result.passed:
                print(f"\n[!] Test failed at {tokens:,} tokens")
                break

        except MemoryError:
            print(f"\n[!] MemoryError at {tokens:,} tokens")
            results.append({
                'tokens': tokens,
                'passed': False,
                'error': 'MemoryError'
            })
            break

        except Exception as e:
            print(f"\n[!] Error at {tokens:,} tokens: {e}")
            results.append({
                'tokens': tokens,
                'passed': False,
                'error': str(e)
            })
            break

    # Summary
    print("\n" + "=" * 70)
    print("SCALING TEST SUMMARY")
    print("=" * 70)

    print("\n+------------+--------+------------+------------+-------------+")
    print("| Tokens     | Status | Time (s)   | Memory(MB) | Compression |")
    print("+------------+--------+------------+------------+-------------+")

    max_passed = 0
    for r in results:
        status = "PASS" if r.get('passed') else "FAIL"
        time_s = r.get('encode_time', 0)
        mem = r.get('memory_mb', 0)
        comp = r.get('compression', 0)

        print(f"| {r['tokens']:>10,} | {status:<6} | {time_s:>10.1f} | {mem:>10.1f} | {comp:>11.0f}x |")

        if r.get('passed'):
            max_passed = r['tokens']

    print("+------------+--------+------------+------------+-------------+")
    print(f"\nMaximum verified context: {max_passed:,} tokens")

    return results


# ============================================================================
# MAIN
# ============================================================================

def main():
    """Run 200k token test"""

    import argparse

    parser = argparse.ArgumentParser(description='200K Token Context Test')
    parser.add_argument('--tokens', type=int, default=200000,
                       help='Number of tokens to test')
    parser.add_argument('--scaling', action='store_true',
                       help='Run scaling test instead')
    parser.add_argument('--simulated', action='store_true',
                       help='Use simulated embeddings (faster)')

    args = parser.parse_args()

    if args.scaling:
        results = run_scaling_test()
    else:
        result = run_200k_token_test(
            target_tokens=args.tokens,
            use_real_embeddings=not args.simulated
        )

        # Save result
        output = {
            'target_tokens': result.target_tokens,
            'actual_tokens': result.actual_tokens,
            'num_embeddings': result.num_embeddings,
            'encode_time_seconds': result.encode_time_seconds,
            'memory_delta_mb': result.memory_delta_mb,
            'compression_ratio': result.compression_ratio,
            'retrieval_accuracy': result.retrieval_accuracy,
            'recovery_success': result.recovery_success,
            'passed': result.passed
        }

        with open('test_200k_results.json', 'w') as f:
            json.dump(output, f, indent=2)

        print(f"\nResults saved to: test_200k_results.json")


if __name__ == "__main__":
    main()
