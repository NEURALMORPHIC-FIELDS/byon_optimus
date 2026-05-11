# Security Whitepaper
**BYON Optimus v1.0** | Patent: EP25216372.0 | Classification: CONFIDENTIAL

**Author:** Vasile Lucian Borbeleac
**Date:** 2026-02-07
**Document Version:** 1.0
**Protocol Version:** MACP v1.1 (Multi-Agent Control Protocol)

---

## Table of Contents

1. [Security Architecture Overview](#1-security-architecture-overview)
2. [Cryptographic Controls](#2-cryptographic-controls)
3. [Air-Gap Architecture](#3-air-gap-architecture)
4. [Access Control Model](#4-access-control-model)
5. [File-Based Handoff Security](#5-file-based-handoff-security)
6. [Policy Engine](#6-policy-engine)
7. [Docker Security](#7-docker-security)
8. [WFP Sentinel](#8-wfp-sentinel)
9. [Data Protection](#9-data-protection)
10. [Known Limitations and Mitigations](#10-known-limitations-and-mitigations)

---

## 1. Security Architecture Overview

### 1.1 Design Philosophy

BYON Optimus implements a defense-in-depth model where no single layer is responsible for security. The system is built around three principles:

- **Separation of Privilege:** Three agents (Worker, Auditor, Executor) each hold a distinct role. No agent can both plan and execute. No agent can both approve and execute.
- **Least Privilege:** Each agent has access only to the directories and network resources it needs. The Executor has no network access whatsoever.
- **Human Supremacy:** All execution requires explicit human approval. The system auto-denies when approval times out.

### 1.2 Trust Boundaries

The architecture defines four distinct trust boundaries:

```
                   TRUST BOUNDARY 1: External World
                   =================================
                          |
                   OpenClaw Gateway (rate-limited, CORS, HMAC)
                          |
                   TRUST BOUNDARY 2: Internal Network
                   =================================
                          |
             +------------+-----------+
             |                        |
          Worker (A)            Auditor (B)
          - reads inbox         - validates plans
          - builds plans        - signs orders (Ed25519)
          - NO execution        - HMAC-authed bridge
             |                        |
             +--- filesystem ---+-----+
                  handoff dirs       |
                                     |
                   TRUST BOUNDARY 3: Air-Gap
                   =================================
                                     |
                              Executor (C)
                              - network_mode: none
                              - verifies Ed25519 signature
                              - executes within constraints
                              - no API keys
                                     |
                   TRUST BOUNDARY 4: Host Kernel (Optional)
                   =================================
                                     |
                              WFP Sentinel
                              - kernel-level network filtering
                              - HMAC-authenticated IPC
```

**Boundary 1 (External to Gateway):** All external traffic enters through the OpenClaw Gateway. CORS is fail-closed (explicit allowlist via `BYON_CORS_ORIGINS`). Rate limiting is enforced at 60 requests/minute general and 10 requests/minute on approval endpoints. The gateway token (`OPENCLAW_GATEWAY_TOKEN`) is required for all API access.

**Boundary 2 (Gateway to Agents):** Communication between the gateway and the Auditor uses HMAC-SHA256 authentication (`BYON_BRIDGE_SECRET`). Signature verification uses constant-time comparison (`crypto.timingSafeEqual`) to prevent timing attacks.

**Boundary 3 (Agents to Executor):** The Executor runs with Docker `network_mode: none`, making the trust boundary enforced by the container runtime. The only input the Executor accepts is signed JSON files placed in `handoff/auditor_to_executor/`, verified against a trusted Ed25519 public key.

**Boundary 4 (Host Kernel, Optional):** The WFP Sentinel kernel driver operates below the Docker layer, filtering network traffic at the Windows Filtering Platform level. This boundary is optional and the system operates identically without it.

### 1.3 Agent Constraints

| Agent | Can Plan | Can Approve | Can Execute | Has Network | Has API Keys |
|-------|----------|-------------|-------------|-------------|--------------|
| Worker | Yes | No | No | Yes | Yes |
| Auditor | No | Yes (sign) | No | Yes | Yes |
| Executor | No | No | Yes | **No** | **No** |

---

## 2. Cryptographic Controls

### 2.1 Ed25519 Digital Signatures

**Purpose:** Ensure only Auditor-approved plans can be executed.

**Implementation:** The Auditor signs `ExecutionOrder` documents using Ed25519 (via Node.js `crypto` module with `generateKeyPairSync("ed25519")`). The Executor verifies the signature before executing any action.

**Signing process** (implemented in `byon-orchestrator/src/agents/auditor/signer.ts`):

1. The Auditor constructs the `ExecutionOrder` content (all fields except `signature` and `hash`).
2. The content is serialized to JSON with sorted keys (`JSON.stringify(content, Object.keys(content).sort())`).
3. A SHA256 hash is computed over the serialized content.
4. The hash is signed with the Auditor's Ed25519 private key.
5. The signature is stored as a structured `Ed25519Signature` object containing the algorithm identifier, public key, and base64-encoded signature.

**Verification process** (implemented in `byon-orchestrator/src/agents/executor/signature-verifier.ts`):

1. The Executor strips `signature` and `hash` from the order.
2. It recomputes the SHA256 hash over the remaining content (sorted keys).
3. If the hash does not match, the order is rejected as tampered.
4. The signature is verified against all trusted public keys using `crypto.verify()`.
5. The order age is checked against `max_order_age_minutes` (default: 60 minutes).
6. Resource constraints are validated against absolute limits (max iterations: 20, max timeout: 60 minutes, max memory: 4096 MB, max disk: 2048 MB).

**Key format:** Keys support both raw Ed25519 (32 bytes) and PKCS8/SPKI DER formats. Raw keys are automatically wrapped with the appropriate DER prefix before use.

**Key distribution:** Keys are generated via `pnpm keygen` or `scripts/setup-keys.sh`. The private key stays in the Auditor's container (`./keys` mounted read-write). The Executor receives only the public key (`./keys` mounted read-only).

### 2.2 HMAC-SHA256: Bridge Authentication

**Purpose:** Authenticate communication between the OpenClaw Gateway and the BYON Auditor.

**Implementation** (in `byon-orchestrator/src/integration/openclaw-bridge.ts`):

- The `BYON_BRIDGE_SECRET` environment variable contains the shared secret.
- Outgoing messages from the bridge are signed: the payload (excluding the `signature` field) is serialized to JSON, and an HMAC-SHA256 tag is computed and attached as the `signature` field.
- Incoming messages are verified by recomputing the HMAC over the payload and comparing using `crypto.timingSafeEqual()` to prevent timing side-channel attacks.
- If the signature is invalid, the message is rejected with an error.

### 2.3 HMAC-SHA256: Sentinel IPC Authentication

**Purpose:** Prevent spoofing on the named pipe between the TypeScript Sentinel Bridge and the C# kernel bridge.

**Implementation** (in `byon-orchestrator/src/integration/sentinel-bridge.ts`):

- The `ipcHmacSecret` configuration value (hex-encoded) is the shared secret between the TS bridge and C# bridge.
- For each `ExecutionIntent`, the bridge computes an HMAC-SHA256 tag over the serialized intent JSON (excluding the `ipcAuth` field) concatenated with a timestamp and monotonic sequence number: `JSON.stringify(intentWithoutAuth) + "|" + hmacTimestamp + "|" + sequence`.
- The resulting `IpcAuthentication` object contains the HMAC hex string, the timestamp, and the sequence number.
- The C# bridge must verify this HMAC before pushing rules to the kernel. Without a valid HMAC, the intent file is rejected.
- The monotonic sequence number prevents replay attacks on the IPC channel.

### 2.4 SHA256: Document Integrity

**Purpose:** Detect tampering of documents as they traverse the file-based handoff pipeline.

Every MACP v1.1 document (`EvidencePack`, `PlanDraft`, `ApprovalRequest`, `ExecutionOrder`, `JohnsonReceipt`) contains a `hash` field computed as:

```
SHA256(JSON.stringify(content, Object.keys(content).sort()))
```

The sorted-key serialization ensures deterministic hashing regardless of property insertion order. Each receiving agent recomputes and verifies the hash before processing.

The audit trail uses a hash chain where each entry references the hash of the previous entry, creating an immutable, tamper-evident log with calendar-based indexing.

### 2.5 Nonce and TTL: Anti-Replay

**Purpose:** Prevent replay attacks on approval requests.

**Implementation** (in `byon-orchestrator/src/agents/auditor/approval-manager.ts`):

- Each `ApprovalRequest` contains a `nonce` field: 16 random bytes hex-encoded (`crypto.randomBytes(16).toString("hex")`).
- Each request contains a `ttl_seconds` field set by risk level:
  - Low risk: 1800 seconds (30 minutes)
  - Medium risk: 900 seconds (15 minutes)
  - High risk: 600 seconds (10 minutes)
- The `ApprovalManager` maintains two sets: `usedNonces` (issued, not yet consumed) and `consumedNonces` (already used).
- When processing a decision:
  1. The nonce must exist in `usedNonces` (was issued by this manager).
  2. The nonce must NOT exist in `consumedNonces` (not already used).
  3. The TTL must not have elapsed since creation.
  4. The standard `expires_at` timestamp must not have passed.
- After successful processing, the nonce is moved from `usedNonces` to `consumedNonces`.
- Consumed nonces are periodically pruned to prevent unbounded growth (capped at 3x `max_pending_approvals`).

---

## 3. Air-Gap Architecture

### 3.1 Executor Isolation

The Executor (Agent C) runs with Docker `network_mode: none`, which removes all network interfaces from the container. This is a hard isolation enforced by the container runtime:

```yaml
# docker-compose.yml
byon-executor:
  network_mode: none
  environment:
    - AGENT_ROLE=executor
    # NO ANTHROPIC_API_KEY - executor is air-gapped!
```

**What the Executor cannot do:**
- Make HTTP/HTTPS requests
- Resolve DNS
- Connect to any TCP/UDP socket
- Reach any external service, database, or API
- Access the BYON memory service
- Access Redis

**What the Executor can do:**
- Read signed `ExecutionOrder` JSON files from `handoff/auditor_to_executor/` (read-only mount)
- Write `JohnsonReceipt` JSON files to `handoff/executor_to_worker/` (read-write mount)
- Modify files in the `project/` directory (read-write mount)
- Write to `/tmp` (100MB tmpfs)

### 3.2 Trust Anchor

The Ed25519 signature is the sole trust anchor for the Executor. Since the Executor has no network access:
- It cannot be remotely commanded.
- It cannot exfiltrate data.
- It cannot phone home.
- The only way to instruct it is to place a validly-signed JSON file in the handoff directory.

### 3.3 Constraint Enforcement

Even with a valid signature, the Executor enforces absolute resource limits defined in `signature-verifier.ts`:

| Constraint | Absolute Maximum |
|-----------|-----------------|
| `max_iterations` | 20 |
| `timeout_minutes` | 60 |
| `memory_limit_mb` | 4096 |
| `disk_limit_mb` | 2048 |

The Auditor sets tighter per-order constraints based on risk level:

| Risk Level | Max Iterations | Timeout | Memory | Disk |
|-----------|---------------|---------|--------|------|
| Low | 10 | 30 min | 1024 MB | 512 MB |
| Medium | 5 | 15 min | 512 MB | 256 MB |
| High | 3 | 10 min | 256 MB | 128 MB |

If any constraint in a signed order exceeds the absolute limits, the Executor rejects the order regardless of signature validity.

### 3.4 Healthcheck Limitation

Because the Executor has no network, it cannot use HTTP-based health checks. Instead, it uses a file-based healthcheck:

```yaml
healthcheck:
  test: ["CMD", "test", "-f", "/tmp/healthy"]
```

---

## 4. Access Control Model

### 4.1 Human-in-the-Loop

All execution requires explicit human approval. The system implements a strict approval workflow:

1. The Auditor creates an `ApprovalRequest` document with a summary of proposed actions, risk level, and security check results.
2. The request is sent to the user via the OpenClaw Gateway (multi-channel: web UI, WhatsApp, Telegram, Discord, etc.).
3. The user has three options: **Approve**, **Reject**, or **Modify Plan**.
4. If no response is received within the TTL (risk-dependent: 10-30 minutes), the request auto-expires and is treated as a rejection.
5. Low-risk plans may be auto-approved if configured (`auto_approve_low_risk: true`), but this is a configurable setting that can be disabled.

### 4.2 Vault Access Control

The Vault subsystem (`byon-orchestrator/src/vault/`) implements an "ask-always" policy:

- **All** vault access requires explicit user approval, regardless of the requesting agent or category.
- Approval requests have a 30-second timeout. If the user does not respond, access is denied.
- Desktop notifications are sent for every access request (Windows toast, macOS `osascript`, Linux `notify-send`).
- Every access attempt (approved or denied) is permanently logged in the audit trail.
- Rate limiting: maximum 10 accesses per hour per requester per category (configurable).
- Three policy modes are available:
  - `ask-always` (default): All categories require approval.
  - `read-only`: Can list entries but cannot read actual secret values.
  - `emergency`: Extended timeout (60 seconds), limited to credentials and keys, max 3 accesses per hour.

### 4.3 Rate Limiting

Rate limiting is applied at the OpenClaw Gateway proxy layer:

| Endpoint Category | Rate Limit |
|-------------------|-----------|
| General API (`/api/*`) | 60 requests per minute |
| Approval endpoints | 10 requests per minute |
| Vault access | 10 accesses per hour per requester per category |

### 4.4 CORS Policy

CORS is fail-closed. The `BYON_CORS_ORIGINS` environment variable must be explicitly set with an allowlist of permitted origins. If unset, CORS blocks all cross-origin requests. There is no wildcard (`*`) fallback.

### 4.5 Input Validation

- **URL parameters:** All URL parameters on API endpoints are validated against alphanumeric regex patterns. Non-conforming parameters are rejected.
- **Document structure:** Incoming messages on the bridge are validated for required fields (`message_id`, `content`, `content.text`) before processing.
- **Schema validation:** All MACP v1.1 documents are validated using Ajv (JSON Schema) at handoff read/write points. The `SchemaValidator` class (in `byon-orchestrator/src/validation/schema-validator.ts`) compiles JSON schemas for all five document types and validates structural integrity including field types, required properties, and format constraints (using `ajv-formats`).

---

## 5. File-Based Handoff Security

### 5.1 Architecture

Agents communicate exclusively through filesystem directories. There are no direct inter-agent network calls, no shared databases, and no message queues for agent-to-agent communication. (Redis is used for real-time event broadcasting to the UI, not for agent pipeline communication.)

The handoff directory structure:

```
handoff/
  inbox/                      # Gateway -> Worker (rw for gateway, rw for worker)
  worker_to_auditor/          # Worker -> Auditor (rw for worker, ro for auditor)
    archive/                  # Processed plans (rw for auditor)
  auditor_to_user/            # Auditor -> User (rw for auditor, ro for gateway)
  user_to_auditor/            # User -> Auditor (rw for gateway)
  auditor_to_executor/        # Auditor -> Executor (rw for auditor, ro for executor)
  executor_to_worker/         # Executor -> Worker (rw for executor, ro for worker)
  auditor_state/              # Auditor internal state (rw for auditor)
  sentinel/                   # WFP Sentinel state (rw for auditor and gateway)
    events/                   # Sentinel events
```

### 5.2 Mount Permissions

Docker volume mounts enforce read/write direction at the container level:

| Container | Directory | Mount Mode |
|-----------|-----------|-----------|
| Worker | `inbox/` | rw |
| Worker | `worker_to_auditor/` | rw |
| Worker | `executor_to_worker/` | **ro** |
| Auditor | `worker_to_auditor/` | **ro** |
| Auditor | `auditor_to_executor/` | rw |
| Auditor | `auditor_state/` | rw |
| Executor | `auditor_to_executor/` | **ro** |
| Executor | `executor_to_worker/` | rw |

The read-only mounts prevent upstream tampering: the Executor cannot modify its input, and the Auditor cannot modify what the Worker wrote.

### 5.3 Path Traversal Protection

The Policy Engine enforces forbidden path patterns using regex-based validation. Actions targeting paths outside whitelisted directories or matching forbidden patterns are rejected by the Auditor before signing.

### 5.4 Document Integrity

Every document written to a handoff directory includes a SHA256 hash. The receiving agent recomputes the hash and rejects the document if it does not match. For `ExecutionOrder` documents, the hash is additionally covered by the Ed25519 signature.

---

## 6. Policy Engine

### 6.1 Risk Assessment System

The Risk Assessment System (`byon-orchestrator/src/policy/risk-assessment.ts`) computes a composite risk score (0-100) from seven weighted factors:

| Factor | Weight | Description |
|--------|--------|-------------|
| File Deletions | 0.25 | Each deletion adds 40 points (capped at 100) |
| File Creations | 0.10 | Each creation adds 10 points (capped at 50) |
| Code Edits | 0.15 | Each modification adds 15 points (capped at 80) |
| Action Count | 0.15 | >10 actions = 80, >5 = 50, else count * 8 |
| Iterations | 0.10 | >5 iterations = 70, >3 = 40, else count * 10 |
| Rollback Capability | 0.10 | No rollback = 80, rollback possible = 20 |
| Target Sensitivity | 0.15 | Based on pattern matching against target paths |

Risk levels are determined by composite score:
- **Low:** score <= 20
- **Medium:** score <= 45
- **High:** score > 45

**Override rule:** Any plan containing a `shell_exec` action is automatically classified as **high** risk, regardless of the computed score.

### 6.2 Action Base Risk Scores

Each action type has an inherent base risk score:

| Action Type | Base Score |
|------------|-----------|
| `shell_exec` | 90 |
| `file_delete` | 80 |
| `file_write` | 40 |
| `file_modify` | 40 |
| `code_edit` | 35 |
| `file_create` | 20 |
| `build_run` | 15 |
| `lint_run` | 10 |
| `test_run` | 10 |

### 6.3 Sensitive Target Patterns

Target paths matching sensitive patterns receive additional risk scores:

| Pattern | Score | Description |
|---------|-------|-------------|
| `dockerfile` | 60 | Docker configuration |
| `database\|db.` | 55 | Database configuration |
| `security\|crypto` | 55 | Security code |
| `docker-compose` | 55 | Docker Compose |
| `package.json` | 50 | Package configuration |
| `.github/` | 50 | GitHub configuration |
| `auth\|authentication` | 50 | Authentication code |
| `server.(ts\|js)` | 45 | Server file |
| `.config.` | 45 | Configuration file |
| `tsconfig.json` | 40 | TypeScript configuration |
| `webpack\|vite\|rollup` | 40 | Bundler configuration |
| `index\|main\|app.(ts\|js)` | 35 | Entry point files |

### 6.4 Forbidden Paths

The Policy Engine rejects actions targeting system-critical paths. The forbidden path list includes:

- `/etc/` (Linux system configuration)
- `C:\Windows\System32\` (Windows system directory)
- Registry paths
- System boot directories
- Kernel module paths

### 6.5 Forbidden Patterns

Content and commands matching dangerous patterns are rejected:

- `eval()`, `exec()`
- `rm -rf`
- Pattern matching for shell injection attempts
- Obfuscated code patterns

---

## 7. Docker Security

### 7.1 Non-Root Containers

All BYON agent containers run as a non-root user:

```yaml
user: "1001:1001"
```

This prevents container escape attacks that rely on root privileges and limits the blast radius of any container compromise.

### 7.2 Security Options

The Executor container has additional security hardening:

```yaml
security_opt:
  - no-new-privileges:true
```

The `no-new-privileges` option prevents processes inside the container from gaining additional privileges via `setuid`/`setgid` binaries, `execve` with elevated capabilities, or similar mechanisms.

### 7.3 Resource Limits

Every container has explicit CPU and memory limits to prevent resource exhaustion attacks:

| Service | CPU Limit | Memory Limit | CPU Reservation | Memory Reservation |
|---------|----------|-------------|----------------|-------------------|
| Memory Service | 2 | 4 GB | 0.5 | 1 GB |
| Worker | 2 | 2 GB | 0.25 | 512 MB |
| Auditor | 2 | 2 GB | 0.25 | 512 MB |
| Executor | 2 | 2 GB | 0.5 | 512 MB |
| OpenClaw Gateway | 2 | 3 GB | 0.5 | 1 GB |
| Redis | 1 | 1536 MB | 0.25 | 512 MB |
| Watcher | 0.25 | 128 MB | 0.1 | 64 MB |
| Prometheus | 1 | 1 GB | 0.25 | 256 MB |
| Grafana | 1 | 512 MB | 0.1 | 128 MB |

### 7.4 Read-Only Mounts

The volume mount strategy enforces data flow direction:

- The Executor reads orders as `ro` and writes receipts as `rw` to a separate directory.
- Keys are mounted `ro` for the Executor and Worker, `rw` only for the Auditor (which generates them).
- Configuration files, documentation, and source code are mounted `ro` where possible.

### 7.5 Executor tmpfs

The Executor uses a size-limited tmpfs for temporary files:

```yaml
tmpfs:
  - /tmp:size=100M,mode=1777
```

This ensures temporary file usage cannot consume persistent disk and data does not persist after container restart.

### 7.6 Network Isolation

All services share the `byon-network` bridge network (subnet `172.28.0.0/16`) **except** the Executor, which has `network_mode: none`. The Executor is completely disconnected from all networks, including the Docker bridge. No `ports` mapping exists for the Executor.

### 7.7 Health Checks

All containers include health checks to enable automatic restart and dependency ordering:

- Network-capable containers use HTTP health endpoints (`/health`).
- The Executor uses file-based health checks (`test -f /tmp/healthy`).
- Memory Service health must pass before any agent starts (`condition: service_healthy`).
- Redis health must pass before Memory Service starts.

### 7.8 Required Environment Variables

Security-critical environment variables are enforced as required at compose startup:

```yaml
BYON_BRIDGE_SECRET=${BYON_BRIDGE_SECRET:?BYON_BRIDGE_SECRET must be set}
OPENCLAW_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN:?OPENCLAW_GATEWAY_TOKEN must be set}
REDIS_PASSWORD=${REDIS_PASSWORD:?REDIS_PASSWORD must be set}
GRAFANA_PASSWORD=${GRAFANA_PASSWORD:?GRAFANA_PASSWORD must be set}
```

If any of these are unset, Docker Compose will refuse to start, preventing deployments with missing secrets.

---

## 8. WFP Sentinel

### 8.1 Overview

The WFP (Windows Filtering Platform) Sentinel is an **optional** kernel-level network guard that provides defense below the Docker layer. It is not required for BYON Optimus to operate. The pipeline functions identically with or without it.

**Current scope (implemented):**
- Network traffic filtering at the kernel level via WFP
- Intent-based firewall rules with TTL-based auto-expiry
- HMAC-authenticated IPC between TypeScript bridge and C# kernel bridge
- Emergency freeze mechanism (blocks all non-essential network traffic)
- Essential services bypass list (loopback, Memory Service, Redis, Gateway, Prometheus)
- Five anomaly detection modules: behavioral, Fragmergent, exfiltration, burst, reputation

**[FUTURE] Planned scope (not yet implemented):**
- Filesystem minifilter driver (kernel-level file access control)
- Process creation callbacks (kernel-level process monitoring)
- Combined network + filesystem + process policy enforcement

### 8.2 Intent Architecture

The Sentinel bridge (`byon-orchestrator/src/integration/sentinel-bridge.ts`) translates ExecutionOrder actions into `EXECUTION_INTENT` JSON files:

1. The Auditor signs an `ExecutionOrder`.
2. The Sentinel Bridge extracts network permissions from the order's actions using heuristic mapping (`extractNetworkPermissions()`).
3. An `ExecutionIntent` file is generated with:
   - A unique intent ID (UUID)
   - A reference to the source `ExecutionOrder`
   - Network permissions (protocol, host, port, direction, rule type)
   - A creation timestamp and expiration timestamp (Unix epoch seconds)
   - An Ed25519 signature (via `@noble/ed25519`) over pipe-delimited data: `IntentId|OrderId|Action|Timestamp|ExpiresAt`
   - An optional HMAC-SHA256 IPC authentication block
4. The intent file is written to `handoff/auditor_to_executor/` as `{intentId}.intent.json`.
5. The C# bridge (`ByonWfpBridge.cs`) watches for these files, verifies the signature and HMAC, and pushes WFP filter rules to the kernel via IOCTL.

### 8.3 TTL and Auto-Expiry

All intents have a time-to-live:
- Default TTL: 300 seconds (5 minutes)
- Maximum TTL: 3600 seconds (1 hour, hard cap)
- Expired intents are automatically removed by the kernel driver.
- The bridge periodically cleans up expired intent files from the handoff directory.

### 8.4 Safety Guarantees

The Sentinel Bridge documents four safety guarantees:

| Guarantee | Description |
|-----------|-------------|
| G1: TTL Expiry | All intents have a maximum TTL. The kernel auto-expires stale rules. |
| G2: Human Freeze | The freeze command bypasses all intents. Humans can always halt all network traffic. |
| G3: Fail-Safe Deny | If the bridge fails or crashes, no new intents are generated. No intent = kernel blocks by default. |
| G4: Zero Dependency | The pipeline runs without sentinel. If sentinel is not installed, all bridge methods return defaults (null/empty). |

### 8.5 Emergency Freeze

The freeze mechanism blocks ALL outbound network traffic at the kernel level except essential services:

- Triggered via the UI, CLI, or the orchestrator bridge.
- Writes a `freeze-command.json` to the sentinel directory.
- The C# bridge reads the command and pushes a global block rule to the kernel.
- Essential services remain accessible during freeze: loopback (all ports), Memory Service (8001), Redis (6379), OpenClaw Gateway (3000), Prometheus (9090).
- Only a human can lift the freeze via an explicit `unfreeze` command.

### 8.6 HMAC-Authenticated IPC

The IPC channel between the TypeScript Sentinel Bridge and the C# kernel bridge is protected with HMAC-SHA256:

- A shared secret (hex-encoded) is established during setup and stored in the Vault.
- Each intent file includes an `ipcAuth` block with:
  - `hmac`: HMAC-SHA256 hex tag over the intent JSON + timestamp + sequence number
  - `hmacTimestamp`: Unix epoch seconds of HMAC computation
  - `hmacSequence`: Monotonically increasing counter (prevents replay)
- The C# bridge must verify the HMAC before pushing any rule to the kernel.
- If the HMAC is invalid or missing (when authentication is enabled), the intent is rejected.

### 8.7 Detection Modules

The Sentinel supports five detection modules (toggleable per-module):

| Module | Description |
|--------|-------------|
| Behavioral | Baseline network behavior profiling per application |
| Fragmergent | 8-dimensional anomaly detection with clarity/phase tracking |
| Exfiltration | Data exfiltration pattern detection |
| Burst | Connection burst detection |
| Reputation | Application reputation scoring (0-1000) |

### 8.8 Docker Integration

The Sentinel Bridge is defined as an optional Docker Compose service (currently commented out). When enabled:

```yaml
sentinel-bridge:
  environment:
    - SENTINEL_ENABLED=${SENTINEL_ENABLED:-false}
    - INTENT_TTL_SECONDS=${SENTINEL_INTENT_TTL:-300}
    - INTENT_MAX_TTL_SECONDS=3600
  user: "1001:1001"
  deploy:
    resources:
      limits:
        cpus: '0.5'
        memory: 256M
```

---

## 9. Data Protection

### 9.1 Vault Encryption

The Vault service (`byon-orchestrator/src/vault/service.ts`) provides encrypted storage for sensitive data:

- **Primary encryption:** GPG (if available with a configured key ID)
- **Fallback encryption:** AES-256-GCM using a key derived from `BYON_VAULT_KEY` environment variable
- **Integrity verification:** SHA256 checksum is computed before encryption and verified after decryption. If the checksum does not match after decryption, access is denied with a corruption warning.
- **Secure wipe:** After encryption, the plaintext data is securely wiped from memory via the `secureWipe()` function.
- **Categories:** Five vault categories: `credentials`, `keys`, `financial`, `documents`, `secrets`. Each category maps to a subdirectory within the vault path.

### 9.2 Credential Exclusion from Version Control

The `.gitignore` is comprehensively configured to prevent credential leaks:

**Cryptographic keys:**
```
keys/*
*.key
*.pem
*.pub
**/private.key
**/private.pem
**/auditor.private.*
**/executor.private.*
```

**Environment files:**
```
.env
.env.local
.env.*.local
*.env
```

**API credentials:**
```
**/credentials.json
**/service-account*.json
**/secrets.json
**/token.json
```

**OpenClaw credentials (WhatsApp sessions, tokens):**
```
openclaw-config/credentials/
```

**OpenClaw runtime state (auth tokens, device keys):**
```
openclaw-config/identity/device-auth.json
openclaw-config/devices/paired.json
openclaw-config/agents/main/sessions/*.jsonl
```

**Vault data:**
```
vault/*
vault/**/*.vault
vault/index.json
vault/audit.log
```

**Runtime handoff data:**
```
handoff/*
memory/*
```

### 9.3 Runtime State Isolation

Runtime state directories are excluded from version control:
- `handoff/*` (inter-agent communication files)
- `memory/*` (FHRSS+FCPE memory storage)
- `project/*` (working project files)
- `openclaw-config/workspace/*` (OpenClaw workspace)
- `redis-data/` (Redis persistence)

---

## 10. Known Limitations and Mitigations

### 10.1 WFP Sentinel Scope Limitations

**What WFP Sentinel does NOT cover (current implementation):**

| Gap | Description | Mitigation |
|-----|-------------|-----------|
| Filesystem monitoring | WFP operates at the network layer only. It cannot restrict file read/write operations at the kernel level. | [FUTURE] Filesystem minifilter driver planned. Currently mitigated by Docker volume mounts (ro/rw) and Policy Engine path validation. |
| Process control | WFP cannot prevent process creation or monitor process behavior. | [FUTURE] Process creation callbacks planned. Currently mitigated by Docker `no-new-privileges` and non-root user. |
| Registry access | WFP does not monitor Windows Registry access. | [FUTURE] Registry callback driver planned. Currently mitigated by Docker container isolation (registry is not accessible from Linux containers). |
| Memory inspection | WFP cannot inspect process memory for malicious payloads. | Out of scope. Mitigated by application-level input validation and Ajv schema enforcement. |

### 10.2 Docker/WSL2 Gap

On Windows hosts running Docker via WSL2, there is a gap between the WFP Sentinel (which operates in the Windows kernel) and the Docker containers (which run in the WSL2 Linux kernel):

- WFP filters network traffic at the Windows networking layer.
- Docker containers in WSL2 communicate through a virtual network adapter.
- **Some container-to-container traffic may not pass through WFP filters** if it is routed entirely within the WSL2 virtual network.
- **Mitigation:** The Executor's `network_mode: none` is enforced by Docker itself (at the Linux kernel level inside WSL2) and is not dependent on WFP. The air-gap is still effective.

### 10.3 Admin-Level Bypass Risks

An attacker with administrative or root access to the host can bypass security controls:

| Attack Vector | Impact | Mitigation |
|--------------|--------|-----------|
| Modify handoff files directly on disk | Could inject forged documents | Ed25519 signature on ExecutionOrders; SHA256 hashes on all documents. Forged orders without a valid signature will be rejected by the Executor. |
| Replace the Executor container image | Could run malicious code | Image integrity should be verified via Docker Content Trust. [FUTURE] Not currently enforced. |
| Read the Auditor's private key from disk | Could sign fraudulent orders | Key files should be protected with OS-level permissions. Consider HSM storage for production. [FUTURE] HSM integration not implemented. |
| Modify the WFP kernel driver | Could disable network filtering | Windows kernel code signing requirements prevent unsigned driver loading on secure boot systems. |
| Terminate Docker containers | Denial of service | `restart: unless-stopped` policy ensures automatic recovery. Monitoring via Prometheus/Grafana provides alerting. |

### 10.4 Operational Security Recommendations

1. **Rotate keys regularly.** Ed25519 key pairs, `BYON_BRIDGE_SECRET`, `BYON_VAULT_KEY`, `OPENCLAW_GATEWAY_TOKEN`, and `REDIS_PASSWORD` should be rotated on a schedule appropriate to the threat model.
2. **Monitor audit logs.** The immutable hash-chain audit trail should be reviewed regularly. Any hash chain break indicates tampering.
3. **Enable WFP Sentinel in production** for defense-in-depth, even though it is optional. The additional kernel-level filtering provides protection against container escape scenarios.
4. **Use GPG for vault encryption** rather than AES fallback when possible, as GPG provides better key management capabilities.
5. **Set `BYON_CORS_ORIGINS` explicitly.** Never rely on default behavior for CORS configuration.
6. **Review auto-approve settings.** The `auto_approve_low_risk` setting may be inappropriate for high-security environments. Consider requiring explicit approval for all risk levels.
7. **[FUTURE] Enable Docker Content Trust** to verify image integrity and prevent supply chain attacks.
8. **[FUTURE] Consider HSM integration** for Ed25519 private key storage in production environments.

### 10.5 Supply Chain Security

- An SBOM (Software Bill of Materials) is maintained at `docs/SBOM.json`.
- Node.js dependencies include security-focused packages: `eslint-plugin-security` for static analysis, `@noble/ed25519` for cryptographic operations (pure JS, no native binaries).
- Python dependencies for the memory service are pinned to specific versions.
- Docker base images use specific version tags (e.g., `redis:7-alpine`, `node:22-alpine`, `prom/prometheus:v2.48.0`).

---

## Appendix A: Document Flow with Cryptographic Controls

```
[User Request via OpenClaw]
        |
        | HMAC-SHA256 (BYON_BRIDGE_SECRET)
        v
    [Worker]
        |
        | SHA256 hash on EvidencePack + PlanDraft
        v
    [Auditor]
        |
        | 1. Policy validation (risk, paths, patterns)
        | 2. Human approval (nonce + TTL anti-replay)
        | 3. Ed25519 signature on ExecutionOrder
        | 4. SHA256 hash on ExecutionOrder (covered by signature)
        | 5. (Optional) HMAC-SHA256 on Sentinel intent
        v
    [Executor - Air-Gapped]
        |
        | 1. Ed25519 signature verification
        | 2. SHA256 hash verification
        | 3. Constraint validation
        | 4. Order age check
        v
    [Execute + JohnsonReceipt]
        |
        | SHA256 hash on JohnsonReceipt
        v
    [Worker + Audit Trail (hash chain)]
```

---

## Appendix B: Cryptographic Algorithms Summary

| Algorithm | Purpose | Library | Key Size |
|-----------|---------|---------|----------|
| Ed25519 | ExecutionOrder signing/verification | Node.js `crypto` (signer), `@noble/ed25519` (sentinel) | 256-bit (32-byte keys) |
| HMAC-SHA256 | Bridge authentication, IPC authentication | Node.js `crypto.createHmac` | Variable (recommended 256-bit) |
| SHA256 | Document hashing, hash chain audit trail, key fingerprints | Node.js `crypto.createHash` | 256-bit output |
| AES-256-GCM | Vault encryption (GPG fallback) | Node.js `crypto` | 256-bit |
| GPG | Vault encryption (primary) | System GPG binary | Variable (RSA/ECC) |

---

## Appendix C: Environment Variables (Security-Relevant)

| Variable | Purpose | Required |
|----------|---------|----------|
| `BYON_BRIDGE_SECRET` | HMAC-SHA256 shared secret for OpenClaw-Auditor bridge | Yes |
| `OPENCLAW_GATEWAY_TOKEN` | Authentication token for OpenClaw gateway API | Yes |
| `REDIS_PASSWORD` | Redis authentication | Yes |
| `GRAFANA_PASSWORD` | Grafana admin password | Yes |
| `BYON_VAULT_KEY` | AES-256-GCM encryption key for vault (fallback when GPG unavailable) | Conditional |
| `BYON_CORS_ORIGINS` | Explicit CORS origin allowlist | Recommended |
| `ANTHROPIC_API_KEY` | Claude API key (Worker and Auditor only, never Executor) | Yes |
| `AGENT_ROLE` | Selects agent code path (worker/auditor/executor) | Yes |

---

*This document is CONFIDENTIAL and proprietary to BYON Optimus. Unauthorized distribution is prohibited.*
*Patent: EP25216372.0 - Omni-Qube-Vault - Vasile Lucian Borbeleac*
