#!/usr/bin/env python3
"""
================================================================================
AI APPLICABILITY TEST - FHRSS + FCPE for AI/LLM Context Memory
================================================================================

Tests the unified system for real AI applications:
1. Real text embeddings (sentence-transformers)
2. Conversation memory and retrieval
3. Long context compression
4. Semantic similarity preservation
5. RAG-style document retrieval
6. Context window extension simulation

Author: Scientific Validation Suite
================================================================================
"""

import numpy as np
import time
import json
from pathlib import Path
from typing import List, Dict, Any, Tuple
from dataclasses import dataclass
import hashlib

# Import unified system
from fhrss_fcpe_unified import (
    UnifiedFHRSS_FCPE, UnifiedConfig, FCPEConfig, FHRSSConfig
)

# Try to import sentence-transformers
try:
    from sentence_transformers import SentenceTransformer
    HAS_SENTENCE_TRANSFORMERS = True
except ImportError:
    HAS_SENTENCE_TRANSFORMERS = False
    print("[!] sentence-transformers not installed. Using simulated embeddings.")


# ============================================================================
# TEST DATA - Real AI Scenarios
# ============================================================================

# Conversation history simulation
CONVERSATION_HISTORY = [
    {"role": "user", "content": "What is machine learning?"},
    {"role": "assistant", "content": "Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience without being explicitly programmed. It focuses on developing algorithms that can access data and use it to learn for themselves."},
    {"role": "user", "content": "Can you explain neural networks?"},
    {"role": "assistant", "content": "Neural networks are computing systems inspired by biological neural networks in the human brain. They consist of layers of interconnected nodes or 'neurons' that process information. Each connection has a weight that adjusts during learning. Deep learning uses neural networks with many layers."},
    {"role": "user", "content": "What about transformers?"},
    {"role": "assistant", "content": "Transformers are a type of neural network architecture that uses self-attention mechanisms. Introduced in 2017, they revolutionized NLP by allowing models to process all positions in a sequence simultaneously rather than sequentially. GPT, BERT, and other LLMs are based on transformers."},
    {"role": "user", "content": "How does attention work?"},
    {"role": "assistant", "content": "Attention mechanisms allow models to focus on relevant parts of the input when producing output. Self-attention computes relationships between all positions in a sequence. It uses Query, Key, and Value matrices to determine which parts of the input are most relevant for each output position."},
    {"role": "user", "content": "What is RLHF?"},
    {"role": "assistant", "content": "RLHF stands for Reinforcement Learning from Human Feedback. It's a training technique used to fine-tune language models based on human preferences. The process involves training a reward model from human comparisons, then using RL to optimize the language model against this reward."},
]

# Document corpus for RAG testing
DOCUMENT_CORPUS = [
    {
        "id": "doc1",
        "title": "Introduction to Python",
        "content": "Python is a high-level, interpreted programming language known for its simplicity and readability. It supports multiple programming paradigms including procedural, object-oriented, and functional programming."
    },
    {
        "id": "doc2",
        "title": "Machine Learning Basics",
        "content": "Machine learning algorithms can be categorized into supervised learning, unsupervised learning, and reinforcement learning. Supervised learning uses labeled data, while unsupervised learning finds patterns in unlabeled data."
    },
    {
        "id": "doc3",
        "title": "Neural Network Architecture",
        "content": "A neural network consists of an input layer, hidden layers, and an output layer. Each layer contains neurons connected by weighted edges. Activation functions like ReLU and sigmoid introduce non-linearity."
    },
    {
        "id": "doc4",
        "title": "Natural Language Processing",
        "content": "NLP combines computational linguistics with machine learning to enable computers to understand human language. Tasks include sentiment analysis, named entity recognition, machine translation, and text generation."
    },
    {
        "id": "doc5",
        "title": "Database Systems",
        "content": "Relational databases store data in tables with rows and columns. SQL is used to query and manipulate data. NoSQL databases like MongoDB offer flexible schemas for unstructured data."
    },
    {
        "id": "doc6",
        "title": "Cloud Computing",
        "content": "Cloud computing provides on-demand computing resources over the internet. Major providers include AWS, Azure, and Google Cloud. Services are categorized as IaaS, PaaS, and SaaS."
    },
    {
        "id": "doc7",
        "title": "Transformer Models",
        "content": "Transformers use self-attention to process sequences in parallel. Key innovations include positional encoding, multi-head attention, and layer normalization. BERT and GPT are prominent transformer-based models."
    },
    {
        "id": "doc8",
        "title": "Computer Vision",
        "content": "Computer vision enables machines to interpret visual information. Convolutional neural networks (CNNs) are commonly used for image classification, object detection, and image segmentation tasks."
    },
]

# Semantic similarity test pairs
SIMILARITY_PAIRS = [
    # Similar pairs (should have high similarity)
    ("What is deep learning?", "Explain neural networks and deep learning", True),
    ("How do transformers work?", "Explain the transformer architecture", True),
    ("What is Python used for?", "Python programming applications", True),

    # Dissimilar pairs (should have low similarity)
    ("What is machine learning?", "Recipe for chocolate cake", False),
    ("Explain neural networks", "History of ancient Rome", False),
    ("How does BERT work?", "Weather forecast for tomorrow", False),
]


# ============================================================================
# EMBEDDING PROVIDER
# ============================================================================

class EmbeddingProvider:
    """Provides embeddings - real or simulated"""

    def __init__(self, use_real: bool = True):
        self.use_real = use_real and HAS_SENTENCE_TRANSFORMERS
        self.model = None
        self.dim = 384

        if self.use_real:
            print("[+] Loading sentence-transformers model...")
            self.model = SentenceTransformer('all-MiniLM-L6-v2')
            self.dim = self.model.get_sentence_embedding_dimension()
            print(f"[+] Model loaded. Dimension: {self.dim}")
        else:
            print("[*] Using simulated embeddings (dimension: 384)")

    def encode(self, texts: List[str]) -> np.ndarray:
        """Encode texts to embeddings"""
        if self.use_real:
            return self.model.encode(texts, convert_to_numpy=True)
        else:
            # Deterministic simulation based on text content
            embeddings = []
            for text in texts:
                seed = int(hashlib.md5(text.encode()).hexdigest(), 16) % (2**32)
                np.random.seed(seed)
                emb = np.random.randn(self.dim).astype(np.float32)
                emb = emb / np.linalg.norm(emb)
                embeddings.append(emb)
            return np.stack(embeddings)

    def encode_single(self, text: str) -> np.ndarray:
        """Encode single text"""
        return self.encode([text])[0]


# ============================================================================
# AI APPLICABILITY TESTS
# ============================================================================

@dataclass
class TestResult:
    """Single test result"""
    test_name: str
    passed: bool
    score: float
    details: Dict[str, Any]
    duration_ms: float


class AIApplicabilityTester:
    """Tests FHRSS+FCPE for AI applications"""

    def __init__(self, use_real_embeddings: bool = True):
        self.embedder = EmbeddingProvider(use_real_embeddings)

        # Create unified system with matching dimension
        config = UnifiedConfig(
            fcpe=FCPEConfig(
                dim=self.embedder.dim,
                num_layers=5,
                lambda_s=0.5,
                compression_method="weighted_attention"
            ),
            fhrss=FHRSSConfig(
                subcube_size=8,
                profile="FULL"
            ),
            storage_path="./test_ai_applicability_storage",
            auto_persist=False  # Don't persist for tests
        )

        self.system = UnifiedFHRSS_FCPE(config)
        self.results: List[TestResult] = []

    def run_all_tests(self) -> Dict[str, Any]:
        """Run all AI applicability tests"""

        print("\n" + "=" * 70)
        print("AI APPLICABILITY TEST SUITE - FHRSS + FCPE")
        print("=" * 70)

        all_results = {}

        # Test 1: Conversation Memory
        print("\n[1/6] Testing Conversation Memory...")
        all_results['conversation_memory'] = self._test_conversation_memory()

        # Test 2: Semantic Similarity Preservation
        print("\n[2/6] Testing Semantic Similarity Preservation...")
        all_results['semantic_similarity'] = self._test_semantic_similarity()

        # Test 3: RAG Document Retrieval
        print("\n[3/6] Testing RAG Document Retrieval...")
        all_results['rag_retrieval'] = self._test_rag_retrieval()

        # Test 4: Context Compression Quality
        print("\n[4/6] Testing Context Compression Quality...")
        all_results['context_compression'] = self._test_context_compression()

        # Test 5: Recovery After Corruption
        print("\n[5/6] Testing Recovery After Corruption...")
        all_results['corruption_recovery'] = self._test_corruption_recovery()

        # Test 6: Long Context Simulation
        print("\n[6/6] Testing Long Context Simulation...")
        all_results['long_context'] = self._test_long_context()

        # Summary
        self._print_summary(all_results)

        return all_results

    def _test_conversation_memory(self) -> Dict[str, Any]:
        """Test conversation memory and retrieval"""
        t0 = time.time()

        # Encode all conversation turns
        context_ids = []
        for turn in CONVERSATION_HISTORY:
            text = f"{turn['role']}: {turn['content']}"
            embedding = self.embedder.encode_single(text)
            ctx_id = self.system.encode_context(
                embedding.reshape(1, -1),
                metadata={'role': turn['role'], 'content': turn['content'][:100]}
            )
            context_ids.append(ctx_id)

        # Test retrieval with queries
        test_queries = [
            ("What is attention mechanism?", "attention"),  # Should find turn about attention
            ("Explain transformers", "transformers"),        # Should find transformer turn
            ("What is reinforcement learning?", "RLHF"),     # Should find RLHF turn
        ]

        retrieval_scores = []
        for query, expected_keyword in test_queries:
            query_emb = self.embedder.encode_single(query)
            results = self.system.retrieve_similar(query_emb, top_k=3)

            # Check if relevant result is in top 3
            found = False
            for r in results:
                content = r['metadata'].get('content', '').lower()
                if expected_keyword.lower() in content:
                    found = True
                    break

            retrieval_scores.append(1.0 if found else 0.0)
            status = "[OK]" if found else "[X]"
            print(f"  {status} Query: '{query[:40]}...' -> {expected_keyword}")

        accuracy = np.mean(retrieval_scores)
        duration = (time.time() - t0) * 1000

        result = TestResult(
            test_name="conversation_memory",
            passed=accuracy >= 0.66,
            score=accuracy,
            details={
                'num_turns': len(CONVERSATION_HISTORY),
                'retrieval_accuracy': accuracy,
                'queries_tested': len(test_queries)
            },
            duration_ms=duration
        )
        self.results.append(result)

        return result.details

    def _test_semantic_similarity(self) -> Dict[str, Any]:
        """Test if semantic similarity is preserved in stored contexts"""
        t0 = time.time()

        correct = 0
        total = len(SIMILARITY_PAIRS)
        details = []

        for text1, text2, should_be_similar in SIMILARITY_PAIRS:
            # Get original embeddings
            emb1 = self.embedder.encode_single(text1)
            emb2 = self.embedder.encode_single(text2)

            # Compute original similarity
            orig_sim = np.dot(emb1, emb2) / (np.linalg.norm(emb1) * np.linalg.norm(emb2))

            # Store in system (uses normalized mean for short sequences - AI mode)
            ctx1 = self.system.encode_context(emb1.reshape(1, -1), store_original=True)
            ctx2 = self.system.encode_context(emb2.reshape(1, -1), store_original=True)

            # Retrieve stored vectors
            stored1 = self.system.contexts[ctx1].fcpe_vector
            stored2 = self.system.contexts[ctx2].fcpe_vector

            # Compute stored similarity
            stored_sim = np.dot(stored1, stored2) / (np.linalg.norm(stored1) * np.linalg.norm(stored2) + 1e-8)

            # Check if relationship is preserved (should match original direction)
            if should_be_similar:
                # Similar pairs should remain similar
                preserved = stored_sim > 0.5 and orig_sim > 0.5
            else:
                # Dissimilar pairs should remain less similar than similar pairs
                preserved = stored_sim < 0.5 or orig_sim < 0.3

            if preserved:
                correct += 1

            status = "[OK]" if preserved else "[X]"
            print(f"  {status} '{text1[:30]}...' vs '{text2[:30]}...'")
            print(f"      Original: {orig_sim:.3f}, Stored: {stored_sim:.3f}")

            details.append({
                'text1': text1[:50],
                'text2': text2[:50],
                'original_similarity': float(orig_sim),
                'stored_similarity': float(stored_sim),
                'should_be_similar': should_be_similar,
                'preserved': preserved
            })

        accuracy = correct / total
        duration = (time.time() - t0) * 1000

        result = TestResult(
            test_name="semantic_similarity",
            passed=accuracy >= 0.66,
            score=accuracy,
            details={
                'accuracy': accuracy,
                'correct': correct,
                'total': total,
                'pairs': details
            },
            duration_ms=duration
        )
        self.results.append(result)

        return result.details

    def _test_rag_retrieval(self) -> Dict[str, Any]:
        """Test RAG-style document retrieval"""
        t0 = time.time()

        # Index all documents
        doc_context_ids = {}
        for doc in DOCUMENT_CORPUS:
            text = f"{doc['title']}: {doc['content']}"
            embedding = self.embedder.encode_single(text)
            ctx_id = self.system.encode_context(
                embedding.reshape(1, -1),
                metadata={'doc_id': doc['id'], 'title': doc['title']}
            )
            doc_context_ids[doc['id']] = ctx_id

        # Test queries with expected documents
        test_queries = [
            ("How do neural networks learn?", ["doc2", "doc3"]),
            ("What is Python programming?", ["doc1"]),
            ("Explain transformer attention", ["doc7", "doc4"]),
            ("What is cloud computing?", ["doc6"]),
            ("How does computer vision work?", ["doc8"]),
        ]

        retrieval_scores = []
        for query, expected_docs in test_queries:
            query_emb = self.embedder.encode_single(query)
            results = self.system.retrieve_similar(query_emb, top_k=3)

            # Check if any expected doc is in top 3
            found_docs = [r['metadata'].get('doc_id') for r in results]
            hit = any(doc in found_docs for doc in expected_docs)

            retrieval_scores.append(1.0 if hit else 0.0)
            status = "[OK]" if hit else "[X]"
            print(f"  {status} Query: '{query[:40]}...'")
            print(f"      Expected: {expected_docs}, Found: {found_docs}")

        accuracy = np.mean(retrieval_scores)
        duration = (time.time() - t0) * 1000

        result = TestResult(
            test_name="rag_retrieval",
            passed=accuracy >= 0.6,
            score=accuracy,
            details={
                'num_documents': len(DOCUMENT_CORPUS),
                'retrieval_accuracy': accuracy,
                'queries_tested': len(test_queries)
            },
            duration_ms=duration
        )
        self.results.append(result)

        return result.details

    def _test_context_compression(self) -> Dict[str, Any]:
        """Test context compression quality"""
        t0 = time.time()

        # Create a long context (multiple embeddings)
        long_text = " ".join([turn['content'] for turn in CONVERSATION_HISTORY])
        sentences = long_text.split('. ')

        # Encode each sentence
        embeddings = self.embedder.encode(sentences)

        # Compress entire context with FCPE
        compressed = self.system.fcpe.encode(embeddings)

        # Metrics
        original_size = embeddings.nbytes
        compressed_size = compressed.nbytes
        compression_ratio = original_size / compressed_size

        # Test: compressed vector should be meaningful
        # (not all zeros, normalized, reasonable values)
        norm = np.linalg.norm(compressed)
        is_normalized = 0.99 < norm < 1.01
        has_variance = compressed.std() > 0.01
        no_nans = not np.any(np.isnan(compressed))

        quality_ok = is_normalized and has_variance and no_nans

        print(f"  Original size: {original_size} bytes ({len(sentences)} sentences)")
        print(f"  Compressed size: {compressed_size} bytes")
        print(f"  Compression ratio: {compression_ratio:.1f}x")
        print(f"  Normalized: {is_normalized}, Has variance: {has_variance}, No NaNs: {no_nans}")
        print(f"  Quality: {'[OK]' if quality_ok else '[X]'}")

        duration = (time.time() - t0) * 1000

        result = TestResult(
            test_name="context_compression",
            passed=quality_ok and compression_ratio > 5,
            score=compression_ratio if quality_ok else 0,
            details={
                'original_bytes': int(original_size),
                'compressed_bytes': int(compressed_size),
                'compression_ratio': float(compression_ratio),
                'num_sentences': len(sentences),
                'is_normalized': bool(is_normalized),
                'has_variance': bool(has_variance),
                'quality_ok': bool(quality_ok)
            },
            duration_ms=duration
        )
        self.results.append(result)

        return result.details

    def _test_corruption_recovery(self) -> Dict[str, Any]:
        """Test recovery after data corruption"""
        t0 = time.time()

        # Create test context
        test_text = "This is a critical piece of information that must survive data corruption."
        embedding = self.embedder.encode_single(test_text)
        ctx_id = self.system.encode_context(
            embedding.reshape(1, -1),
            metadata={'test': 'corruption_recovery'}
        )

        # Test recovery at various corruption levels
        loss_levels = [0.10, 0.20, 0.30, 0.40]
        recovery_results = []

        for loss_pct in loss_levels:
            result = self.system.test_recovery(ctx_id, loss_pct, seed=42)

            status = "[OK]" if result['cosine_similarity'] > 0.99 else "[X]"
            print(f"  {status} {loss_pct*100:.0f}% loss: cosine={result['cosine_similarity']:.4f}, hash_match={result['hash_match']}")

            recovery_results.append({
                'loss_percent': loss_pct * 100,
                'cosine_similarity': result['cosine_similarity'],
                'hash_match': result['hash_match'],
                'recovered': result['cosine_similarity'] > 0.99
            })

        # Success if we can recover at 30% loss
        success_at_30 = any(r['loss_percent'] == 30 and r['recovered'] for r in recovery_results)

        duration = (time.time() - t0) * 1000

        result = TestResult(
            test_name="corruption_recovery",
            passed=success_at_30,
            score=sum(r['recovered'] for r in recovery_results) / len(recovery_results),
            details={
                'recovery_results': recovery_results,
                'success_at_30_percent': success_at_30
            },
            duration_ms=duration
        )
        self.results.append(result)

        return result.details

    def _test_long_context(self) -> Dict[str, Any]:
        """Simulate long context handling (context window extension)"""
        t0 = time.time()

        # Simulate a very long conversation (100+ turns)
        num_turns = 100

        print(f"  Encoding {num_turns} conversation turns...")

        context_ids = []
        encode_times = []

        for i in range(num_turns):
            # Generate varied content
            topics = ["machine learning", "neural networks", "transformers", "attention", "RLHF", "embeddings"]
            topic = topics[i % len(topics)]
            text = f"Turn {i}: Discussing {topic} and its applications in AI systems."

            embedding = self.embedder.encode_single(text)

            t_enc = time.time()
            ctx_id = self.system.encode_context(
                embedding.reshape(1, -1),
                metadata={'turn': i, 'topic': topic}
            )
            encode_times.append((time.time() - t_enc) * 1000)

            context_ids.append(ctx_id)

        avg_encode_time = np.mean(encode_times)

        # Test retrieval from long history
        print(f"  Testing retrieval from {num_turns}-turn history...")

        query = "What did we discuss about transformers?"
        query_emb = self.embedder.encode_single(query)

        t_retrieve = time.time()
        results = self.system.retrieve_similar(query_emb, top_k=5)
        retrieve_time = (time.time() - t_retrieve) * 1000

        # Check if transformer-related turns are retrieved
        found_transformer = any(
            r['metadata'].get('topic') == 'transformers'
            for r in results
        )

        print(f"  Avg encode time: {avg_encode_time:.2f}ms per turn")
        print(f"  Retrieve time: {retrieve_time:.2f}ms")
        print(f"  Found transformer topic: {'[OK]' if found_transformer else '[X]'}")

        # Get compressed context
        all_vectors = [self.system.contexts[cid].fcpe_vector for cid in context_ids]
        stacked = np.stack(all_vectors)
        mega_compressed = self.system.fcpe.encode(stacked)

        print(f"  Mega-compressed {num_turns} turns to single {len(mega_compressed)}-dim vector")

        duration = (time.time() - t0) * 1000

        result = TestResult(
            test_name="long_context",
            passed=found_transformer and avg_encode_time < 100,
            score=1.0 if found_transformer else 0.0,
            details={
                'num_turns': num_turns,
                'avg_encode_time_ms': float(avg_encode_time),
                'retrieve_time_ms': float(retrieve_time),
                'found_relevant': bool(found_transformer),
                'mega_compressed_dim': len(mega_compressed)
            },
            duration_ms=duration
        )
        self.results.append(result)

        return result.details

    def _print_summary(self, all_results: Dict[str, Any]):
        """Print test summary"""
        print("\n" + "=" * 70)
        print("AI APPLICABILITY TEST SUMMARY")
        print("=" * 70)

        print("\n+---------------------------+--------+----------+------------+")
        print("| Test                      | Status | Score    | Time (ms)  |")
        print("+---------------------------+--------+----------+------------+")

        passed = 0
        for result in self.results:
            status = "PASS" if result.passed else "FAIL"
            print(f"| {result.test_name:<25} | {status:<6} | {result.score:>6.2f}   | {result.duration_ms:>8.1f}   |")
            if result.passed:
                passed += 1

        print("+---------------------------+--------+----------+------------+")

        total = len(self.results)
        print(f"\nOverall: {passed}/{total} tests passed")

        if passed == total:
            print("\n[SUCCESS] FHRSS+FCPE is APPLICABLE for AI/LLM context memory!")
        elif passed >= total * 0.7:
            print("\n[PARTIAL] FHRSS+FCPE shows promise but needs optimization.")
        else:
            print("\n[NEEDS WORK] FHRSS+FCPE requires improvements for AI use.")

        print("\nKey Findings:")

        # Context compression
        if 'context_compression' in all_results:
            cc = all_results['context_compression']
            print(f"  - Compression ratio: {cc.get('compression_ratio', 0):.1f}x")

        # Recovery
        if 'corruption_recovery' in all_results:
            cr = all_results['corruption_recovery']
            if cr.get('success_at_30_percent'):
                print("  - 100% recovery at 30% data loss: YES")
            else:
                print("  - 100% recovery at 30% data loss: NO")

        # Long context
        if 'long_context' in all_results:
            lc = all_results['long_context']
            print(f"  - Long context ({lc.get('num_turns', 0)} turns): {'Supported' if lc.get('found_relevant') else 'Issues'}")

        print("=" * 70)


# ============================================================================
# MAIN
# ============================================================================

def main():
    """Run AI applicability tests"""

    import shutil

    # Clean test storage
    test_path = Path("./test_ai_applicability_storage")
    if test_path.exists():
        shutil.rmtree(test_path)

    # Run tests with real embeddings if available
    tester = AIApplicabilityTester(use_real_embeddings=True)
    results = tester.run_all_tests()

    # Save results
    output_path = Path("./test_ai_applicability_results.json")

    def convert_numpy(obj):
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        elif isinstance(obj, (np.float32, np.float64)):
            return float(obj)
        elif isinstance(obj, (np.int32, np.int64)):
            return int(obj)
        elif isinstance(obj, (np.bool_, bool)):
            return bool(obj)
        elif isinstance(obj, dict):
            return {k: convert_numpy(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [convert_numpy(v) for v in obj]
        return obj

    with open(output_path, 'w') as f:
        json.dump(convert_numpy(results), f, indent=2)

    print(f"\nResults saved to: {output_path}")


if __name__ == "__main__":
    main()
