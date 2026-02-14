# Changelog

All notable changes to BYON Optimus will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-02-13

### Added
- **Reed-Solomon GF(256) Dual Parity** in FHRSS encoder
  - GF(256) arithmetic engine (log/exp tables, `gf_mul`, `gf_div`, `gf_pow`)
  - `FHRSSConfig.parity_strength = 2` (dual parity P1 + P2)
  - 2-erasure solver per line (was 1-erasure XOR only)
  - 100% deterministic recovery at 50% data loss (verified 120 seeds)
  - Overhead: 3.25x (FULL profile, r=2)
- **Scientific Validation Suite** (`tests/scientific_validation.py`)
  - 52 test assertions across 10 categories
  - 50/52 passed (96.2%)
  - Comprehensive 3-perspective report (`docs/SCIENTIFIC_VALIDATION_RS.md`)
- `damage_parity` flag on `inject_loss_realistic()` and `test_recovery()`

### Changed
- FHRSS encoder uses RS GF(256) by default (backward compatible with r=1)
- Recovery model defaults to parity-intact (matches reference repo)
- Updated all documentation to reflect RS capabilities
- Synced `byon-orchestrator/memory-service/fhrss_fcpe_unified.py`
- Updated `byon-system-knowledge.json` recovery/overhead claims

### Improved
- Repository structure: removed 12 root-level duplicate files
- `.gitignore`: added patterns for test outputs, benchmarks, runtime storage
- Added `pyproject.toml` and `__init__.py` for INFINIT_MEMORYCONTEXT package

### Added
- **🔐 Secure Vault** - Encrypted storage for sensitive data
  - GPG encryption (with AES-256-GCM fallback)
  - Human-in-the-loop approval (ask-always policy)
  - 30-second approval timeout
  - Desktop notifications for access requests
  - Complete audit trail
  - Rate limiting (10 accesses/hour per category)
  - Categories: credentials, keys, financial, documents, secrets
- AI-powered task processing in Worker agent
- Claude API integration (claude-3-haiku-20240307)
- TradingAPIClient for CoinGecko cryptocurrency data
- Comprehensive capability testing suite
- CAPABILITY_REPORT.md generation
- Copyright headers on all 84 TypeScript source files

### Changed
- Plan generator now supports async AI processing
- Enhanced task type detection (coding, analysis, planning, trading, general)
- Patent name updated to "Omni-Qube-Vault"

## [0.1.0] - 2026-02-04

### Added
- **Multi-Agent Control Protocol (MACP) v1.1**
  - Worker Agent (evidence gathering, plan generation)
  - Auditor Agent (validation, Ed25519 signing)
  - Executor Agent (air-gapped execution)

- **FHRSS+FCPE Memory System**
  - 73,000:1 compression ratio
  - Perpetual retention via holographic encoding
  - Semantic search capabilities
  - Global Memory Vitalizer (GMV) daemon

- **Protocol Documents**
  - EvidencePack (task analysis)
  - PlanDraft (proposed actions)
  - ApprovalRequest (user approval flow)
  - ExecutionOrder (signed commands)
  - JohnsonReceipt (execution results)

- **Security Features**
  - Ed25519 cryptographic signatures
  - Air-gapped Executor (network_mode: none)
  - JSON Schema validation for all documents
  - Secrets management via .env files

- **Docker Infrastructure**
  - Multi-stage Dockerfile with agent targets
  - docker-compose.yml with 7 services
  - Volume mounts for handoff and memory
  - Redis for message queuing

- **OpenClaw Gateway Integration**
  - Unified UI at localhost:3000
  - Optimus Dashboard tab
  - 20+ channel support (Telegram, Discord, WhatsApp, etc.)
  - BYON Proxy for API routing

- **Documentation**
  - README.md with quick start guide
  - INSTALL.md with detailed instructions
  - JOHNSON_PLAN.md protocol specification
  - GDPR_COMPLIANCE.md
  - PRIVACY_POLICY.md

### Security
- Executor runs in isolated network mode
- All execution orders require cryptographic signatures
- No secrets stored in code or images
- Proper .gitignore for sensitive files

### Known Issues
- API key limited to claude-3-haiku-20240307 model
- Trading data requires manual TradingAPIClient invocation
- Memory context not auto-populated in task processing

---

## Version History

| Version | Date       | Status      |
|---------|------------|-------------|
| 0.2.0   | 2026-02-13 | Current     |
| 0.1.0   | 2026-02-04 | Stable      |

---

**Patent:** EP25216372.0 - Omni-Qube-Vault - Vasile Lucian Borbeleac
