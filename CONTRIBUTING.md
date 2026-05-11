# Contributing to BYON Optimus

Thank you for your interest in contributing to BYON Optimus! This document provides guidelines for contributing to the project.

## Patent Notice

**IMPORTANT:** This project is protected by Patent EP25216372.0 (Omni-Qube-Vault). By contributing, you agree that your contributions will be subject to the project's proprietary license.

## Development Setup

### Prerequisites

- Node.js >= 18.0.0 (22.x recommended for Byon_bot)
- pnpm >= 9.0.0
- Docker & Docker Compose
- Python 3.11+ (for memory service)

### Local Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/byon-optimus.git
   cd byon-optimus
   ```

2. **Copy environment file:**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Install dependencies:**
   ```bash
   # Orchestrator
   cd byon-orchestrator
   npm install
   npm run build

   # Or use Docker
   docker-compose up -d
   ```

4. **Generate cryptographic keys:**
   ```bash
   cd byon-orchestrator
   npm run keygen
   ```

5. **Run tests:**
   ```bash
   npm test
   ```

## Project Structure

```
byon-optimus/
├── byon-orchestrator/    # Core TypeScript agents (Worker, Auditor, Executor)
├── Byon_bot/             # Multi-channel bot integration
├── openclaw-main/        # Communication gateway (20+ channels)
├── INFINIT_MEMORYCONTEXT/# FHRSS+FCPE memory system (Python)
├── handoff/              # Inter-agent communication (runtime)
├── memory/               # Persistent storage (runtime)
├── keys/                 # Cryptographic keys (gitignored)
└── project/              # Executor workspace (runtime)
```

## Code Style

### TypeScript
- Use strict mode (`"strict": true` in tsconfig.json)
- Follow ESLint rules defined in `eslint.config.mjs`
- Use ES Modules (`"type": "module"`)
- Add JSDoc comments for public APIs

### Python
- Follow PEP 8
- Use type hints
- Document with docstrings

### Commit Messages

Follow conventional commits:
```
type(scope): description

feat(worker): add AI-powered task processing
fix(auditor): correct signature verification
docs(readme): update installation instructions
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

## Pull Request Process

1. **Fork** the repository
2. **Create a branch:** `git checkout -b feature/your-feature`
3. **Make changes** and add tests
4. **Run linting:** `npm run lint`
5. **Run tests:** `npm test`
6. **Commit** with conventional commit message
7. **Push** and create Pull Request

### PR Checklist

- [ ] Tests pass locally
- [ ] Code follows style guide
- [ ] Documentation updated if needed
- [ ] No secrets or API keys committed
- [ ] Signed off on patent/license terms

## Architecture Guidelines

### MACP Protocol (Multi-Agent Control Protocol)

The system uses file-based handoffs between agents:

```
User Request → Worker → PlanDraft → Auditor → ExecutionOrder → Executor → Receipt
```

**Important principles:**
- Executor is air-gapped (`network_mode: none`)
- All execution orders require Ed25519 signatures
- Use JSON Schema validation for all documents
- Never skip the Auditor validation step

### Memory System (FAISS + FCE-M v0.6.0, hybrid)

Since v0.6.0 the memory subsystem is a **hybrid** of two distinct layers:

- **FAISS `IndexFlatIP`** with `sentence-transformers/all-MiniLM-L6-v2` 384-dim L2-normalized embeddings — semantic retrieval. Thread-scoped by default (v0.6.1, `scope: "thread"`); `scope: "global"` is opt-in for debug.
- **FCE-M v0.6.0** (BSD-3-Clause, vendored at `byon-orchestrator/memory-service/vendor/fce_m/`) — morphogenetic advisory layer that produces `OmegaRecord` (irreversible coagulation), `ReferenceField` (interpretation lens), residue signaling and advisory feedback. Operational level today: **2 of 4** (Morphogenetic Advisory Memory). Omega coagulation through the conversational loop is not reached at default thresholds (`θ_s=0.28`, `τ_coag=12`); see [`docs/RESEARCH_PROGRESS_v0.6.md`](docs/RESEARCH_PROGRESS_v0.6.md).

**Contributor rules for the memory subsystem:**
- Auditor MUST validate `EvidencePack.fce_context` via `validateFceContext` — it is enforced metadata-only (no `label`, `description`, `content`, `text`, `name`, `title`; hashed center IDs only; capped array sizes).
- FCE advisory is consumed by `applyFceRiskAdvisory` as a **risk factor**, not a verdict. Aligned ReferenceFields do not bypass approval.
- Never write raw conversation text into FCE-M; use the fact-extractor pipeline.
- Architecture / security / identity facts go SYSTEM-scope (`thread_id=null`, tag `__system__`); user preferences and project facts go thread-scoped.
- Query via the standard MemoryClient surface (`getFceMemoryContext`, `getMorphogenesisReport`, etc.) — do not poke `UnifiedMemoryStore` directly from outside `fcem_backend.py`.

## Security

- Never commit secrets, API keys, or private keys
- Use `.env` files (gitignored) for configuration
- Report vulnerabilities via SECURITY.md process
- Executor must remain network-isolated

## Questions?

- Open an issue for bugs or features
- Check existing documentation in `/docs`
- Review JOHNSON_PLAN.md for protocol details

## License

By contributing, you agree that your contributions will be licensed under the project's proprietary license. See [LICENSE](LICENSE) for details.

---

**Patent:** EP25216372.0 - Omni-Qube-Vault - Vasile Lucian Borbeleac
