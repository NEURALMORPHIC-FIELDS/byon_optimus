# FHRSS + FCPE v3.0: Infinite Context Memory System

**Multi-Scale Fault-Tolerant Infinite Context for AI/LLM Applications**

[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-Patent-red.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-3.0.0-green.svg)]()

## Overview

This repository implements a unified **FHRSS + FCPE v3.0** system with **Multi-Scale Spherical Domains** for infinite context memory with fault tolerance:

- **FHRSS** (Fractal-Holographic Redundant Storage System): XOR-based parity storage with 9 parity families
- **FCPE** (Fractal-Chaotic Persistent Encoding): 384-dim semantic compression for context embeddings
- **Multi-Scale Domains** (v3.0): Hexagonal-packed spherical domains with hierarchical recovery

## v3.0 New Features

| Feature | Description |
|---------|-------------|
| **Multi-Scale Domains** | 16 spherical domains with r_eff = 3.7 physics-based radius |
| **Hexagonal Packing** | Optimal space-filling with ~6 neighbors per domain |
| **Hierarchical Recovery** | Local → Neighbor → Global recovery strategy |
| **Realistic Loss Testing** | `inject_loss_realistic()` corrupts both data AND parity |

## Recovery Performance

### KNOWN Loss Scenario (RAID-like, position known)
| Loss Level | Recovery |
|------------|----------|
| 10% | 100% |
| 20% | 100% |
| 30% | 100% |
| **40%** | **100%** |

### REALISTIC Loss Scenario (data + parity corrupted)
| Loss Level | Similarity |
|------------|------------|
| 10% | ~99.8% |
| 20% | Degraded |
| 30%+ | Failed |

> **Note**: 100% recovery at 40% is achievable when loss positions are KNOWN (like RAID reconstructing from parity). With random corruption of BOTH data AND parity, recovery is limited to ~10% loss.

## Verified Performance

| Metric | Result |
|--------|--------|
| **Max Context Tested** | 2,000,000 tokens |
| **Recovery (Known Loss)** | 100% at 40% |
| **Recovery (Realistic)** | 99.8% at 10% |
| **Mega-Compression** | 73,000x |
| **Retrieval Accuracy** | 100% |
| **Encode Speed** | 350+ embeddings/sec |

### Comparison with Current AI Technologies

| Technology | Context Window | vs FHRSS+FCPE |
|------------|---------------|---------------|
| GPT-4 Turbo | 128K tokens | FHRSS = **15.6x more** |
| Claude 3.5 Sonnet | 200K tokens | FHRSS = **10x more** |
| Gemini 1.5 Pro | 1M tokens | FHRSS = **2x more** |
| **FHRSS+FCPE v3.0** | **2M+ tokens** | **Verified** |

## Installation

```bash
pip install numpy sentence-transformers psutil torch
```

## Quick Start (v3.0)

```python
from fhrss_fcpe_unified import UnifiedFHRSS_FCPE_MultiScale, UnifiedConfigV3
from fhrss_fcpe_unified import FCPEConfig, FHRSSConfig, MultiScaleConfig

# Initialize v3.0 system with Multi-Scale domains
config = UnifiedConfigV3(
    fcpe=FCPEConfig(dim=384, num_layers=5, lambda_s=0.5),
    fhrss=FHRSSConfig(subcube_size=8, profile="FULL"),
    multiscale=MultiScaleConfig(
        enabled=True,
        grid_size=(32, 32, 8),
        domain_radius=3.7,  # Physics-based r_eff
        use_hexagonal_packing=True,
        enable_neighbor_recovery=True
    )
)

system = UnifiedFHRSS_FCPE_MultiScale(config)

# Add context with semantic embedding
from sentence_transformers import SentenceTransformer
model = SentenceTransformer('all-MiniLM-L6-v2')

text = "Machine learning is a subset of artificial intelligence..."
embedding = model.encode(text)

ctx_id = system.encode_context(
    embedding.reshape(1, -1),
    metadata={'text': text}
)

# Retrieve similar contexts
query_emb = model.encode("What is AI?")
results = system.retrieve_similar(query_emb, top_k=5)

# Test REALISTIC recovery (both data + parity corrupted)
recovery = system.test_recovery(ctx_id, loss_percent=0.10)
print(f"Recovery Similarity: {recovery['cosine_similarity']:.4f}")
print(f"Realistic Test: {recovery['realistic_test']}")  # True in v3.0
```

## Repository Structure

```
INFINIT_MEMORYCONTEXT/
├── fhrss_fcpe_unified.py           # v3.0 unified system with Multi-Scale
├── fhrss_v2.py                     # Legacy FHRSS v2.0 implementation
├── encoder.py                      # FCPE encoder interface
├── infinite_context_module.py      # Context memory module
├── test_ai_applicability.py        # AI use case tests
├── test_200k_context.py            # Large context tests
├── BENCHMARK_COMPARISON.md         # Technology comparison
├── LLM_INTEGRATION_GUIDE.md        # LLM integration guide
├── CREATIVE_WRITING_CAPABILITIES.md # Novel writing capabilities
└── README.md                       # This file
```

## Technical Specifications

### FHRSS Configuration (v3.0)
- **Subcube Size**: 8x8x8
- **Profile**: FULL (9 parity families: X, Y, Z, DXYp, DXYn, DXZp, DXZn, DYZp, DYZn)
- **Overhead**: 2.125x
- **Recovery (Known)**: 100% at 40% loss
- **Recovery (Realistic)**: ~99.8% at 10% loss

### FCPE Configuration
- **Dimension**: 384 (matches MiniLM/sentence-transformers)
- **Layers**: 5 fractal encoding layers
- **Lambda**: 0.5 (optimized compression ratio)
- **Method**: Weighted attention pooling

### Multi-Scale Domains (v3.0)
- **Grid Size**: 32x32x8 = 8,192 potential positions
- **Active Domains**: 16 (hexagonal packed)
- **Domain Radius**: r_eff = 3.7 (physics-based)
- **Packing**: Hexagonal (optimal 74% density)
- **Neighbors**: ~6 per domain (for hierarchical recovery)

## API Reference (v3.0)

### Core Methods

```python
# Encode context
ctx_id = system.encode_context(vector, metadata)

# Retrieve similar
results = system.retrieve_similar(query_vector, top_k=5, threshold=0.5)

# Test recovery (REALISTIC - corrupts both data AND parity)
recovery = system.test_recovery(ctx_id, loss_percent=0.1)
# Returns: {
#   'loss_percent': 10.0,
#   'hash_match': bool,
#   'cosine_similarity': float,
#   'recovery_time_ms': float,
#   'realistic_test': True
# }

# Get statistics
stats = system.get_stats()
# Returns: {
#   'version': '3.0.0',
#   'num_contexts': int,
#   'fcpe_dim': 384,
#   'fhrss_profile': 'FULL',
#   'multiscale_enabled': True,
#   'multiscale': {
#     'domains': 16,
#     'hexagonal_packing': True,
#     'avg_neighbors': 6.0
#   }
# }
```

## BYON Optimus Integration

FHRSS+FCPE v3.0 is integrated into BYON Optimus as the memory service:

```yaml
# docker-compose.yml
memory-service:
  build: ./byon-orchestrator/memory-service
  ports:
    - "8001:8000"
  environment:
    - MEMORY_STORAGE_PATH=/app/memory_storage
```

API Endpoints:
- `POST /` - Unified handler (action-based)
- `GET /health` - Health check
- `GET /metrics` - Prometheus metrics

## Patent Information

```
Patent: EP25216372.0 (FHRSS - Omni-Qube-Vault)
Author: Vasile Lucian Borbeleac
Status: Filed 2025
```

## License

Proprietary - See LICENSE file for details.

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 3.0.0 | 2025 | Multi-Scale spherical domains, hexagonal packing, realistic loss testing |
| 2.0.0 | 2025 | Unified FHRSS+FCPE system |
| 1.0.0 | 2024 | Initial FHRSS implementation |

## Citation

```bibtex
@misc{fhrss_fcpe_v3_2025,
  author = {Borbeleac, Vasile Lucian},
  title = {FHRSS+FCPE v3.0: Multi-Scale Fault-Tolerant Infinite Context Memory},
  year = {2025},
  note = {Patent EP25216372.0}
}
```
