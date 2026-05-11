# FHRSS + FCPE v3.0-RS: Infinite Context Memory System

**Multi-Scale Fault-Tolerant Infinite Context for AI/LLM Applications**

[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-Patent-red.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-3.0.0--RS-green.svg)]()

## Overview

This repository implements a unified **FHRSS + FCPE v3.0-RS** system with **Multi-Scale Spherical Domains** and **Reed-Solomon GF(256) dual parity** for infinite context memory with fault tolerance:

- **FHRSS** (Fractal-Holographic Redundant Storage System): RS-enhanced parity storage with 9 parity families, 2 erasures corrected per line
- **FCPE** (Fractal-Chaotic Persistent Encoding): 384-dim semantic compression for context embeddings
- **Multi-Scale Domains** (v3.0): Hexagonal-packed spherical domains with hierarchical recovery

## v3.0-RS Upgrade

| Feature | Description |
|---------|-------------|
| **Reed-Solomon GF(256)** | Dual parity (P1 + P2) per line, corrects 2 erasures per line |
| **Multi-Scale Domains** | 16 spherical domains with r_eff = 3.7 physics-based radius |
| **Hexagonal Packing** | Optimal space-filling with ~4 neighbors per domain |
| **Deterministic Recovery** | 100% recovery at 50% random data loss, verified across 120 trials |

## Recovery Performance

### RS r=2 (Parity Intact) -- Verified with 20 seeds per level
| Loss Level | Recovery | Seeds Passed |
|------------|----------|-------------|
| 10% | **100%** | 20/20 |
| 20% | **100%** | 20/20 |
| 30% | **100%** | 20/20 |
| 40% | **100%** | 20/20 |
| 45% | **100%** | 20/20 |
| **50%** | **100%** | **20/20** |

### XOR r=1 Baseline (for comparison)
| Loss Level | Recovery | Seeds Passed |
|------------|----------|-------------|
| 10% | 100% | 10/10 |
| 40% | 100% | 10/10 |
| 50% | **52.7-100%** | **4/10** |

### Adversarial (data + parity both corrupted)
| Loss Level | Avg Accuracy |
|------------|-------------|
| 10% | 98.4% |
| 20% | 92.7% |
| 30% | 82.0% |
| 40% | 67.8% |

## Verified Performance

| Metric | Result |
|--------|--------|
| **Max Context Tested** | 2,000,000 tokens |
| **Recovery (RS r=2)** | 100% at 50% loss |
| **Recovery (Adversarial)** | 98.4% at 10% loss |
| **Mega-Compression** | 1,333x (FCPE) |
| **Retrieval Accuracy** | 100% |
| **Encode Speed** | 350+ embeddings/sec |
| **Overhead (FULL, r=2)** | 3.25x |

### Comparison with Current AI Technologies

| Technology | Context Window | vs FHRSS+FCPE |
|------------|---------------|---------------|
| GPT-4 Turbo | 128K tokens | FHRSS = **15.6x more** |
| Claude 3.5 Sonnet | 200K tokens | FHRSS = **10x more** |
| Gemini 1.5 Pro | 1M tokens | FHRSS = **2x more** |
| **FHRSS+FCPE v3.0-RS** | **2M+ tokens** | **Verified** |

## Installation

```bash
pip install numpy sentence-transformers psutil torch
```

## Quick Start (v3.0-RS)

```python
from fhrss_fcpe_unified import UnifiedFHRSS_FCPE_MultiScale, UnifiedConfigV3
from fhrss_fcpe_unified import FCPEConfig, FHRSSConfig, MultiScaleConfig

# Initialize v3.0-RS system with Reed-Solomon dual parity
config = UnifiedConfigV3(
    fcpe=FCPEConfig(dim=384, num_layers=5, lambda_s=0.5),
    fhrss=FHRSSConfig(
        subcube_size=8,
        profile="FULL",
        parity_strength=2  # RS dual parity (r=2)
    ),
    multiscale=MultiScaleConfig(
        enabled=True,
        grid_size=(32, 32, 8),
        domain_radius=3.7,
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

# Test RS recovery (parity intact = standard test per reference repo)
recovery = system.test_recovery(ctx_id, loss_percent=0.50)
print(f"Recovery Similarity: {recovery['cosine_similarity']:.4f}")
print(f"Parity Strength: {recovery['parity_strength']}")  # 2 = RS

# Test adversarial recovery (both data + parity corrupted)
recovery_adv = system.test_recovery(ctx_id, loss_percent=0.10, damage_parity=True)
print(f"Adversarial Recovery: {recovery_adv['cosine_similarity']:.4f}")
```

## Repository Structure

```
INFINIT_MEMORYCONTEXT/
├── fhrss_fcpe_unified.py           # v3.0-RS unified system (RS + MultiScale)
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

### FHRSS Configuration (v3.0-RS)
- **Subcube Size**: 8x8x8 (512 bytes)
- **Profile**: FULL (9 parity families: X, Y, Z, DXYp, DXYn, DXZp, DXZn, DYZp, DYZn)
- **Parity**: Reed-Solomon GF(256) dual parity (r=2)
- **Lines per family**: m^2 = 64 (patent-compliant corrected geometry)
- **Erasures corrected**: 2 per line (vs 1 for XOR-only)
- **Overhead**: 3.25x (FULL profile, r=2)
- **Recovery**: 100% deterministic at 50% random loss

### Overhead by Profile

| Profile | Families | r=1 Overhead | r=2 Overhead |
|---------|----------|-------------|-------------|
| MINIMAL | 3 | 1.375x | 1.750x |
| MEDIUM | 4 | 1.500x | 2.000x |
| HIGH | 6 | 1.750x | 2.500x |
| FULL | 9 | 2.125x | **3.250x** |

### FCPE Configuration
- **Dimension**: 384 (matches MiniLM/sentence-transformers)
- **Layers**: 5 fractal encoding layers
- **Lambda**: 0.5 (optimized compression ratio)
- **Method**: Weighted attention pooling
- **Max Compression**: 1,333x

### Multi-Scale Domains (v3.0)
- **Grid Size**: 32x32x8 = 8,192 potential positions
- **Active Domains**: 16 (hexagonal packed)
- **Domain Radius**: r_eff = 3.7 (physics-based)
- **Packing**: Hexagonal (optimal 74% density)
- **Neighbors**: ~4 per domain (for hierarchical recovery)

## API Reference (v3.0-RS)

### Core Methods

```python
# Encode context
ctx_id = system.encode_context(vector, metadata)

# Retrieve similar
results = system.retrieve_similar(query_vector, top_k=5, threshold=0.5)

# Test recovery (RS, parity intact by default)
recovery = system.test_recovery(ctx_id, loss_percent=0.5)
# Returns: {
#   'loss_percent': 50.0,
#   'hash_match': True,
#   'cosine_similarity': 1.0,
#   'recovery_time_ms': 7.1,
#   'parity_strength': 2,
#   'parity_damaged': False
# }

# Test adversarial recovery (parity also corrupted)
recovery_adv = system.test_recovery(ctx_id, loss_percent=0.1, damage_parity=True)

# Get statistics
stats = system.get_stats()
# Returns: {
#   'version': '3.0.0',
#   'num_contexts': int,
#   'fcpe_dim': 384,
#   'fhrss_profile': 'FULL',
#   'fhrss_overhead': 3.25,
#   'multiscale_enabled': True,
#   'multiscale': {
#     'domains': 16,
#     'hexagonal_packing': True,
#     'avg_neighbors': 4.12
#   }
# }
```

## BYON Optimus Integration

FHRSS+FCPE v3.0-RS is integrated into BYON Optimus as the memory service:

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

## Scientific Validation

Full scientific validation report: [`docs/SCIENTIFIC_VALIDATION_RS.md`](../docs/SCIENTIFIC_VALIDATION_RS.md)

**52 test assertions** across 10 categories, **50 passed** (96.2%):
- GF(256) arithmetic: 5/5
- RS recovery (20 seeds, parity intact): 6/6
- XOR baseline comparison: 5/5
- Adversarial (parity damaged): 5/5
- Concentrated loss: 1/2 (50% contiguous = theoretical limit)
- FCPE quality: 4/4
- Overhead verification: 4/4
- Multi-scale domains: 2/2
- End-to-end pipeline: 12/13
- Edge cases: 6/6

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
| 3.0.0-RS | 2026 | Reed-Solomon GF(256) dual parity, 100% recovery at 50% loss |
| 3.0.0 | 2025 | Multi-Scale spherical domains, hexagonal packing, realistic loss testing |
| 2.0.0 | 2025 | Unified FHRSS+FCPE system |
| 1.0.0 | 2024 | Initial FHRSS implementation |

## Citation

```bibtex
@misc{fhrss_fcpe_v3rs_2026,
  author = {Borbeleac, Vasile Lucian},
  title = {FHRSS+FCPE v3.0-RS: Reed-Solomon Enhanced Multi-Scale Fault-Tolerant Infinite Context Memory},
  year = {2026},
  note = {Patent EP25216372.0}
}
```
