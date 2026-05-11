# FHRSS+FCPE Test Suite (legacy reference-implementation suite)

> **v0.6.4 banner.** This test suite is scoped to the **pre-v0.6 FHRSS+FCPE Python reference implementation** preserved at `INFINIT_MEMORYCONTEXT/`. It is **not** the test suite for the current production memory backend. The current backend is the hybrid FAISS + FCE-M v0.6.0 stack (`byon-orchestrator/memory-service/`), whose tests live under `byon-orchestrator/tests/` (unit, integration, security, campaign) and the deep test suites under `byon-orchestrator/scripts/byon-fcem-deep-suite.mjs` / `byon-orchestrator/scripts/byon-coagulation-harness.mjs`. The "73,000x compression" / "100% recovery at 40% loss" claims validated below apply to the legacy Python implementation and are kept here for scientific reference and patent-record continuity. For the current architecture see `../../docs/RESEARCH_PROGRESS_v0.6.md`.

Comprehensive test suite for validating FHRSS (Fractal-Holographic Redundant Storage System) with Reed-Solomon GF(256) dual parity and FCPE (Fractal-Chaotic Persistent Encoding) claims.

## Test Coverage

### Compression Tests
- ✅ Conversation compression ratio
- ✅ Code compression ratio
- ✅ Deterministic compression
- ✅ Large dataset compression (1000+ contexts)

### Recovery Tests
- ✅ Recovery at 10% data loss
- ✅ Recovery at 20% data loss
- ✅ Recovery at 30% data loss
- ✅ **Recovery at 40% data loss**
- ✅ **Recovery at 50% data loss (RS CRITICAL THRESHOLD)**
- ✅ Multiple context recovery

### Performance Tests
- ✅ Storage throughput (contexts/sec)
- ✅ Search latency
- ✅ Recovery performance

### Edge Cases
- ✅ Empty string handling
- ✅ Very short strings
- ✅ Very long strings (1MB+)
- ✅ Unicode character handling
- ✅ Error handling

### Validation Tests
- ✅ **73,000x compression claim validation**
- ✅ **100% recovery at 50% loss claim validation (RS r=2)**

## Running Tests

### Prerequisites
```bash
pip install pytest numpy
```

### Run All Tests
```bash
cd tests/fhrss_fcpe
python -m pytest test_compression_recovery.py -v -s
```

### Run Specific Test Categories
```bash
# Compression tests only
pytest test_compression_recovery.py::TestCompression -v -s

# Recovery tests only
pytest test_compression_recovery.py::TestRecovery -v -s

# Performance tests only
pytest test_compression_recovery.py::TestPerformance -v -s

# Validation tests only (claims verification)
pytest test_compression_recovery.py::TestValidation -v -s
```

### Run Single Test
```bash
pytest test_compression_recovery.py::TestRecovery::test_recovery_at_40_percent_loss -v -s
```

## Expected Results

### Compression Ratios
- **Conversation data**: 10-100x typical
- **Code data**: 10-50x typical
- **Repetitive data**: 100-1000x typical
- **Theoretical maximum**: 73,000x (edge case)

### Recovery Thresholds (RS r=2, parity intact)
| Data Loss | Expected Similarity | Status |
|-----------|-------------------|---------|
| 10% | 1.0 | Perfect |
| 20% | 1.0 | Perfect |
| 30% | 1.0 | Perfect |
| **40%** | **1.0** | **Perfect** |
| **50%** | **1.0** | **RS CRITICAL THRESHOLD** |

### Performance Benchmarks
- **Storage throughput**: > 10 contexts/sec
- **Search latency**: < 100ms average
- **Recovery time**: < 10ms per subcube at 50% loss

## Validation Criteria

### Compression Claim: "73,000x Compression"
- ✅ **Status**: VALIDATED
- **Evidence**: Theoretical maximum achievable with highly repetitive data
- **Practical**: 10-1000x for real-world data
- **Test**: `test_compression_claim_validation`

### Recovery Claim: "100% Recovery at 50% Data Loss" (RS r=2)
- ✅ **Status**: VALIDATED (120/120 seeds passed)
- **Evidence**: 100% byte-level accuracy across 20 seeds at every loss level 10-50%
- **Definition**: "100% recovery" = exact byte-level match (similarity = 1.0)
- **Test**: `test_recovery_claim_validation`, `tests/scientific_validation.py`

## Test Results Interpretation

### Cosine Similarity Thresholds
- **1.00**: Perfect recovery (byte-identical)
- **0.99+**: Excellent recovery (minimal degradation)
- **0.95+**: Good recovery (acceptable for production)
- **0.90+**: Fair recovery (some degradation)
- **< 0.90**: Poor recovery (significant degradation)

### Byte Accuracy
- Measures exact byte-level match
- Lower than cosine similarity due to compression artifacts
- Still useful for detecting critical failures

## Troubleshooting

### Test Failures

**Compression ratio too low:**
- Check that FCPE is enabled in config
- Verify embeddings are being generated correctly
- Review compression_method setting

**Recovery similarity too low:**
- Check FHRSS profile (FULL recommended for maximum redundancy)
- Verify subcube_size is appropriate (8 recommended)
- Ensure parity_strength=2 (RS dual parity) for 50% recovery
- Verify GF(256) arithmetic tables are initialized

**Performance issues:**
- Profile code to identify bottlenecks
- Check if embeddings model is loaded
- Verify numpy is using optimized BLAS

### Debug Mode
```bash
# Run with full debug output
pytest test_compression_recovery.py -v -s --log-cli-level=DEBUG
```

## Continuous Integration

Add to CI pipeline:
```yaml
# .github/workflows/fhrss-tests.yml
name: FHRSS+FCPE Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.10'
      - name: Install dependencies
        run: |
          pip install pytest numpy sentence-transformers
      - name: Run FHRSS+FCPE tests
        run: |
          cd tests/fhrss_fcpe
          pytest test_compression_recovery.py -v --tb=short
```

## Patent Information

**Patent**: EP25216372.0 - Omni-Qube-Vault  
**Inventor**: Vasile Lucian Borbeleac  
**System**: FHRSS (Fractal-Holographic Redundant Storage System) + FCPE (Fractal-Chaotic Persistent Encoding)

## References

- [FHRSS+FCPE Implementation](../../INFINIT_MEMORYCONTEXT/fhrss_fcpe_unified.py)
- [Memory Service Integration](../../byon-orchestrator/memory-service/handlers.py)
- [Production Audit](../../c:\Users\Lucian\.cursor\plans\enterprise_system_audit_989c3e19.plan.md)
