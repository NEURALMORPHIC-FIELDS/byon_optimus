# WFP Semantic Guard + BYON Optimus: Integration Architecture

## Patent: EP25216372.0 - Omni-Qube-Vault | Author: Vasile Lucian Borbeleac

---

## 1. Executive Summary

This document defines the integration of WFP Semantic Guard (a Windows kernel-mode behavioral
network firewall) into the BYON Optimus multi-agent orchestration system as an **optional,
user-selectable, OS/kernel-level security layer**.

The integration creates a **dead-hand safety mechanism**: a last-resort human control point that
operates below the application layer, at the OS kernel boundary, ensuring that even if all
higher-level logic (Worker, Auditor, Executor) were fully compromised, the human operator
retains absolute authority to halt, freeze, or deny any system action that touches the
operating system.

**Design principle**: The system must evolve from "AI cannot act without human approval" (current)
to "AI cannot act against explicit human will, even if it circumvents its own safeguards" (target).

---

## 2. Current Security Stack (Without WFP Integration)

```
LAYER 7 - APPLICATION
  +-- OpenClaw Gateway (HMAC auth, rate limiting, CORS)
  +-- Worker Agent (plans, never executes)
  +-- Auditor Agent (validates, signs Ed25519, requires approval)
  +-- Policy Engine (forbidden paths/patterns, risk scoring, resource limits)
  +-- Schema Validation (Ajv, 5 document types)

LAYER 6 - CRYPTOGRAPHIC
  +-- Ed25519 signature chain (Auditor signs -> Executor verifies)
  +-- SHA-256 hash chain (tamper-evident audit trail)
  +-- AES-256-GCM / GPG vault encryption
  +-- Anti-replay nonces with TTL

LAYER 5 - ISOLATION
  +-- Docker network_mode: none (executor air-gap)
  +-- Read-only volume mounts (executor inputs)
  +-- Non-root user (1001:1001)
  +-- no-new-privileges security option
  +-- Resource limits (CPU, memory, disk)

LAYER 4 - APPLICATION-LEVEL ENFORCEMENT
  +-- Path traversal prevention (resolveSafePath)
  +-- Forbidden path blocking (isForbiddenPath)
  +-- shell_exec hard-disabled in handler
  +-- test_run/lint_run/build_run simulated only

LAYER 3 - OPERATING SYSTEM       <-- GAP: No enforcement here
LAYER 2 - KERNEL                  <-- GAP: No enforcement here
LAYER 1 - HARDWARE
```

**Critical gap**: Layers 3-4 are entirely application-level. If the Node.js process is
compromised (prototype pollution, dependency supply chain attack, memory corruption),
all application-level checks can be bypassed. There is no OS-level enforcement of:
- Which files the executor process can actually write
- Whether child processes can be spawned
- Whether network access is truly impossible (beyond Docker's network namespace)
- Whether the executor's resource limits are enforced at the kernel level

---

## 3. Proposed Security Stack (With WFP Integration)

```
LAYER 7 - APPLICATION
  +-- OpenClaw Gateway
  +-- Worker / Auditor / Executor agents
  +-- Policy Engine + Schema Validation

LAYER 6 - CRYPTOGRAPHIC
  +-- Ed25519 signature chain
  +-- SHA-256 hash chain + audit trail
  +-- AES-256-GCM vault

LAYER 5 - ISOLATION
  +-- Docker air-gap (executor)
  +-- Volume mount restrictions
  +-- User/privilege restrictions

LAYER 4 - APPLICATION ENFORCEMENT
  +-- Path/pattern checks, handler restrictions

LAYER 3 - OS SENTINEL (NEW)      <-- BYON Sentinel Bridge
  +-- BYON Sentinel Bridge (intent verification, freeze control)
  +-- Network Intent Generator (Ed25519-signed network permissions)
  +-- HMAC-authenticated IPC to kernel bridge
  +-- [NOT IMPLEMENTED] Filesystem Sentinel (requires File System Minifilter)
  +-- [NOT IMPLEMENTED] Process Sentinel (requires PsSetCreateProcessNotifyRoutineEx)

LAYER 2 - KERNEL SENTINEL (NEW)  <-- WFP kernel driver (NETWORK ONLY)
  +-- WFP Network Guard (ALE_AUTH_CONNECT_V4, intent-based authorization)
  +-- Fragmergent Brain (adaptive anomaly detection)
  +-- Per-process network policy enforcement
  +-- NOTE: WFP covers NETWORK ONLY. For full OS sentinel, future work
  +--   requires: File System Minifilter (IRP_MJ_CREATE/WRITE) +
  +--   Process Callbacks (PsSetCreateProcessNotifyRoutineEx)

LAYER 1 - HARDWARE
```

---

## 4. Component Architecture

### 4.1 Component Map

```
+------------------------------------------------------------------+
|  BYON WEB UI (Browser)                                           |
|  +-- Dashboard tab                                               |
|  +-- Approvals tab                                               |
|  +-- History tab                                                 |
|  +-- [NEW] Sentinel tab (WFP status, controls, explanations)    |
+------------------------------------------------------------------+
        |  HTTP/WS
        v
+------------------------------------------------------------------+
|  OPENCLAW GATEWAY (Node.js, port 3000)                          |
|  +-- /api/sentinel/status     (read Sentinel state)              |
|  +-- /api/sentinel/config     (read/write Sentinel config)       |
|  +-- /api/sentinel/events     (recent Sentinel events)           |
|  +-- /api/sentinel/freeze     (emergency freeze all execution)   |
|  +-- /api/sentinel/unfreeze   (resume after freeze)              |
+------------------------------------------------------------------+
        |
        v
+------------------------------------------------------------------+
|  BYON SENTINEL BRIDGE (TypeScript, runs alongside orchestrator) |
|                                                                  |
|  Responsibilities:                                               |
|  1. Generate EXECUTION_INTENT files from signed ExecutionOrders  |
|  2. Communicate with WFP driver via named pipe / IPC             |
|  3. Monitor Sentinel events and surface to UI                    |
|  4. Implement FREEZE/UNFREEZE commands                           |
|  5. Independent Ed25519 verification (second opinion)            |
|                                                                  |
|  Communication:                                                  |
|  - Reads: handoff/auditor_to_executor/*.json (watches)           |
|  - Writes: handoff/sentinel/ (intent files, freeze state)        |
|  - IPC: \\.\pipe\WfpGuardBridge (to kernel driver on Windows)    |
|  - IPC: /tmp/wfp-sentinel.sock (Unix socket on Linux)            |
+------------------------------------------------------------------+
        |
        | IOCTL / Named Pipe
        v
+------------------------------------------------------------------+
|  WFP SEMANTIC GUARD KERNEL DRIVER (wfp_guard.sys)               |
|                                                                  |
|  Active subsystems:                                              |
|  1. WFP Network Filter (ALE_AUTH_CONNECT_V4)                    |
|     - Per-process outbound connection authorization              |
|     - Intent-based allow/deny (only approved connections)        |
|  2. Fragmergent Brain (256 per-app behavioral profiles)          |
|     - 8-dimensional behavioral analysis                          |
|     - Adaptive anomaly detection                                 |
|     - Phase detection (equilibrium / fragmentation / emergence)  |
|  3. Reputation Engine                                            |
|     - Per-application trust score (0-1000)                       |
|     - Reputation decays toward neutral over time                 |
|  4. Intent Rule Store                                            |
|     - Ed25519-signed network permissions                         |
|     - Time-bounded (TTL-based expiration)                        |
|     - Specific: protocol + host + port + direction               |
+------------------------------------------------------------------+
```

### 4.2 Component Responsibilities Matrix

| Component | Creates | Verifies | Enforces | Reports |
|-----------|---------|----------|----------|---------|
| Auditor | ExecutionOrder (signed) | PlanDraft validity | Approval policy | Approval decisions |
| Sentinel Bridge | IntentFile | Ed25519 signature (2nd opinion) | Freeze state | Sentinel events |
| WFP Driver | Per-app profiles | Intent signatures | Network access | Block/allow events |
| Executor | JohnsonReceipt | ExecutionOrder signature | Path/handler policy | Execution results |

### 4.3 What Each Component CANNOT Do

| Component | Cannot |
|-----------|--------|
| Worker | Execute anything, bypass Auditor |
| Auditor | Execute anything, bypass human approval (for medium/high risk) |
| Executor | Access network, call APIs, spawn processes |
| Sentinel Bridge | Execute project actions, modify handoff files |
| WFP Driver | Be bypassed by non-admin user-mode processes (admin-level tampering requires OS policy hardening via Secure Boot + WDAC) |
| UI | Directly execute actions, bypass any security layer |

---

## 5. Control Flow: From User Request to Guarded Execution

### 5.1 Normal Flow (All Layers Healthy)

```
User: "Create file hello.py with print('hello')"
  |
  v
[1] OpenClaw Gateway receives message
  |
  v
[2] Worker builds EvidencePack + PlanDraft
    PlanDraft: { actions: [{ type: "file_create", target: "hello.py", content: "..." }] }
    Risk: LOW (single file create, no sensitive paths)
  |
  v
[3] Auditor validates plan
    - Forbidden paths: PASS (hello.py is not forbidden)
    - Forbidden patterns: PASS (print() is safe)
    - Risk score: 10 (LOW)
    - Policy: PASS
  |
  v
[4] Auditor requests human approval (or auto-approves if LOW + configured)
    User approves via UI / WhatsApp
  |
  v
[5] Auditor signs ExecutionOrder with Ed25519
    Order includes: actions, constraints, risk_level, hash, signature
  |
  v
[6] *** SENTINEL CHECKPOINT (NEW) ***
    Sentinel Bridge detects new order in handoff/auditor_to_executor/
    |
    +-- Independently verifies Ed25519 signature (different key store)
    +-- Checks FREEZE state (if frozen, blocks indefinitely)
    +-- Generates EXECUTION_INTENT with network permissions:
        { action: "file_create", network_permissions: [] }  // No network needed
    +-- Pushes intent to WFP driver (if on Windows)
    +-- Writes sentinel_clearance.json to handoff/sentinel/
    +-- Logs to Sentinel event stream
  |
  v
[7] Executor picks up order
    - Verifies Ed25519 signature (its own verification)
    - Checks sentinel_clearance exists (optional, configurable)
    - Executes: fs.writeFileSync("hello.py", "print('hello')")
  |
  v
[8] WFP Driver (if active, background)
    - Monitors executor process for any network attempts
    - No intent rules grant network access → BLOCK any network attempt
    - Behavioral profile: file_create with no network is normal → no anomaly
  |
  v
[9] Executor writes JohnsonReceipt to handoff/executor_to_worker/
    Receipt: { status: "success", changes_made: { files_created: ["hello.py"] } }
  |
  v
[10] Sentinel Bridge observes receipt, logs completion event
     UI updates: "Task completed successfully"
```

### 5.2 Attack Scenario: Compromised Executor

```
Attacker compromises executor's Node.js process via dependency exploit.
Attacker attempts to:
  (a) Write to /etc/passwd
  (b) Spawn a reverse shell
  (c) Exfiltrate data over network
  (d) Modify the audit trail
```

**Without WFP Sentinel** (current):
- (a) Blocked by Docker volume mounts (only /project is writable) ✓
- (b) Blocked by shell_exec handler returning failure... BUT if Node.js process itself
      is compromised, attacker can call child_process.exec() directly ✗
- (c) Blocked by Docker network_mode: none ✓ (strongest current protection)
- (d) Blocked by Docker volume mounts (audit trail not mounted) ✓

**With WFP Sentinel** (current implementation):
- (a) Blocked by Docker volume mounts ✓ (Sentinel filesystem monitor NOT YET IMPLEMENTED)
- (b) Blocked by Docker + WFP blocks reverse shell's network connection ✓✓
      (NOTE: WFP blocks the CONNECTION, not the process spawn itself.
       Process spawn prevention requires future minifilter/PsSetCreateProcessNotifyRoutineEx)
- (c) Blocked by Docker network_mode: none + WFP kernel-level block ✓✓
- (d) Blocked by Docker volume mounts ✓ (Sentinel file access monitoring NOT YET IMPLEMENTED)

**Key improvement**: Defense-in-depth for NETWORK layer. Even if Docker isolation is
somehow bypassed (container escape vulnerability), the WFP kernel driver provides an
independent, kernel-level network enforcement layer.

**Current limitation**: Sentinel currently covers network only. For full OS-level
protection, future implementation requires:
- **Filesystem**: File System Minifilter driver (IRP_MJ_CREATE/WRITE/SET_INFORMATION)
- **Process**: PsSetCreateProcessNotifyRoutineEx + ImageLoadNotify callbacks
- **Telemetry**: ETW providers for Sysmon-like event correlation

### 5.3 Attack Scenario: Compromised Auditor

```
Attacker compromises auditor, can sign arbitrary ExecutionOrders.
Attempts to sign an order that deletes critical files.
```

**Without WFP Sentinel**:
- Executor verifies signature → PASS (attacker has the private key)
- Executor checks forbidden paths → may catch some, misses others
- Order executes → damage done

**With WFP Sentinel**:
- Sentinel Bridge independently verifies signature → PASS (same key, can't help)
- BUT: Sentinel Bridge can enforce **additional policy checks** that are
  independent of the auditor's compromised logic:
  - Rate limiting: "No more than N file deletes per hour"
  - High-risk override: "All HIGH risk orders require Sentinel UI confirmation"
  - Anomaly detection: "This order pattern is unusual → FREEZE + alert user"
- User sees Sentinel alert in UI → can freeze all execution
- WFP driver sees unusual behavioral pattern from executor → may trigger
  Fragmergent anomaly detection

### 5.4 Emergency Freeze Flow

```
User clicks "FREEZE ALL EXECUTION" in Sentinel UI tab
  |
  v
[1] POST /api/sentinel/freeze
  |
  v
[2] Sentinel Bridge writes FROZEN state to handoff/sentinel/freeze.lock
    Sets in-memory freeze flag
  |
  v
[3] All pending intent clearances are revoked
    WFP driver receives CLEAR_INTENT_RULES command
    All future connection attempts by BYON processes are BLOCKED
  |
  v
[4] Executor (if running): continues current action but cannot:
    - Start new actions (Sentinel clearance missing)
    - Make network connections (WFP blocks all)
    - The current fs operation completes (atomic, cannot be interrupted)
  |
  v
[5] UI shows: "System frozen. No new executions will proceed.
    Current action (if any) will complete but nothing new will start.
    Review the situation and unfreeze when ready."
  |
  v
[6] User investigates via:
    - Sentinel events log (what triggered concern)
    - Audit trail (what happened)
    - Approval history (what was approved)
  |
  v
[7] User clicks "RESUME EXECUTION" with confirmation
    OR: User clicks "EMERGENCY SHUTDOWN" → stops all Docker services
```

---

## 6. Authority Flow: Who Can Override Whom

### 6.1 Authority Hierarchy (Highest to Lowest)

```
LEVEL 1 - HUMAN OPERATOR (absolute authority)
  Can: freeze, unfreeze, approve, reject, shutdown, reconfigure
  Cannot: be overridden by any automated system

LEVEL 2 - WFP KERNEL DRIVER (kernel authority, NETWORK ONLY)
  Can: block network connections, even from admin-level processes
  Cannot: be bypassed by non-admin user-mode code
  Limitation: admin can stop/uninstall driver, boot safe mode, alter boot chain
  Hardening: Secure Boot + WDAC + CI policies for admin-level tamper resistance
  Overridden by: Human operator (via UI or driver uninstall)

LEVEL 3 - SENTINEL BRIDGE (OS authority)
  Can: block intent clearances, freeze execution, alert user
  Cannot: execute project actions, override WFP driver
  Overridden by: Human operator, WFP driver (if driver blocks bridge's own traffic)

LEVEL 4 - AUDITOR (application authority)
  Can: sign/reject execution orders, enforce policy
  Cannot: execute actions, override Sentinel, override WFP
  Overridden by: Human operator, Sentinel Bridge, WFP Driver

LEVEL 5 - EXECUTOR (execution authority, most restricted)
  Can: perform fs operations on /project within signed order scope
  Cannot: access network, spawn processes, exceed constraints
  Overridden by: Everyone above

LEVEL 6 - WORKER (planning authority, least privileged for execution)
  Can: plan and propose actions
  Cannot: execute anything, sign orders, bypass any gate
  Overridden by: Everyone above
```

### 6.2 Override Rules

| Who | Can Override | How |
|-----|-------------|-----|
| Human | Everything | UI controls, driver uninstall, Docker stop |
| WFP Driver | All network access | Kernel-mode filtering, cannot be bypassed from user-mode |
| Sentinel Bridge | Executor (via clearance denial) | Withholds sentinel_clearance.json |
| Auditor | Executor (via signing denial) | Refuses to sign ExecutionOrder |
| Executor | Nothing | Least-privileged, can only act within signed scope |

### 6.3 Conflict Resolution

When authorities disagree:

| Scenario | Resolution | Principle |
|----------|------------|-----------|
| Auditor approves, Sentinel blocks | Sentinel wins | Lower layer has veto |
| Sentinel approves, WFP blocks | WFP wins | Kernel overrides user-mode |
| WFP approves, Human freezes | Human wins | Human is absolute authority |
| Auto-approve triggers, user rejects in Sentinel | User wins | Human overrides automation |

**Invariant**: No combination of automated decisions can override an explicit human denial.
This is the "dead-hand" guarantee.

---

## 7. Trust Boundaries

### 7.1 Trust Boundary Map

```
+-- TRUST BOUNDARY 0: Human ←→ System --------------------------+
|  The human communicates intent via UI.                          |
|  The system cannot fabricate human approval.                    |
|  Crossing requires: explicit user action (click, message)      |
+----------------------------------------------------------------+
        |
+-- TRUST BOUNDARY 1: Gateway ←→ Orchestration -----------------+
|  Messages enter the system.                                     |
|  Crossing requires: HMAC signature, rate limit pass             |
+----------------------------------------------------------------+
        |
+-- TRUST BOUNDARY 2: Worker ←→ Auditor ------------------------+
|  Plans are proposed.                                            |
|  Crossing requires: valid EvidencePack + PlanDraft structure    |
+----------------------------------------------------------------+
        |
+-- TRUST BOUNDARY 3: Auditor ←→ Executor ----------------------+
|  Execution is authorized.                                       |
|  Crossing requires: Ed25519 signature, human approval,          |
|                      valid nonce, unexpired TTL                 |
+----------------------------------------------------------------+
        |
+-- TRUST BOUNDARY 4: Executor ←→ Sentinel (NEW) ---------------+
|  Execution reaches OS boundary.                                 |
|  Crossing requires: Sentinel clearance, no freeze state,        |
|                      independent signature verification         |
+----------------------------------------------------------------+
        |
+-- TRUST BOUNDARY 5: Sentinel ←→ Kernel (NEW) -----------------+
|  Network operations attempt OS-level access.                    |
|  Crossing requires: active intent rule in WFP driver,           |
|                      HMAC-authenticated IPC from bridge,        |
|                      behavioral profile is non-anomalous,       |
|                      reputation above block threshold           |
|  NOTE: Currently covers NETWORK only. Filesystem/process        |
|        boundaries require future minifilter/callback drivers.   |
+----------------------------------------------------------------+
        |
+-- TRUST BOUNDARY 6: Kernel ←→ Hardware -----------------------+
|  Kernel executes CPU instructions, I/O operations.              |
|  Crossing requires: valid kernel-mode code, no IOMMU violation  |
+----------------------------------------------------------------+
```

### 7.2 What Each Boundary Prevents

| Boundary | Prevents |
|----------|----------|
| 0 | System fabricating user consent |
| 1 | Unauthorized external access, replay attacks |
| 2 | Unvalidated plans reaching the signer |
| 3 | Unsigned/expired/replayed orders reaching execution |
| 4 | Execution without independent OS-level verification |
| 5 | Network access without kernel-verified intent |
| 6 | Unauthorized hardware access (existing OS guarantee) |

---

## 8. Failure Modes and Safety Guarantees

### 8.1 Failure Mode Analysis

| Failure | Impact | Mitigation | Fail State |
|---------|--------|------------|------------|
| WFP driver crashes | No kernel-level network filtering | Driver auto-restarts; default-deny until healthy | SAFE (deny-all) |
| Sentinel Bridge crashes | No intent clearances generated | Executor waits indefinitely for clearance | SAFE (no execution) |
| Sentinel Bridge hangs | Clearances delayed | Watchdog timer; user can force-restart via UI | SAFE (delayed) |
| WFP driver not installed | No kernel protection (optional mode) | System operates with Layers 4-7 only | DEGRADED (documented) |
| Freeze state corrupted | System may be stuck frozen or stuck unfrozen | Dual-file verification + in-memory flag | SAFE (defaults to frozen if ambiguous) |
| Intent rules expire | Network connections blocked after TTL | Re-request intent on expiration; tasks may fail | SAFE (deny-all) |
| Ed25519 key mismatch | Sentinel rejects all orders | Alert user; fallback to Auditor-only verification | SAFE (no execution) |
| Host compromise | Attacker controls entire OS | Outside threat model; physical security required | N/A |

### 8.2 Safety Guarantees

**G1 - Fail-Closed**: Every component defaults to DENY when uncertain.
- WFP driver: `DefaultAction = BLOCK` when detection modules enabled
- Sentinel Bridge: no clearance = no execution
- Freeze state: ambiguous = frozen

**G2 - Human Override**: The human can always:
- Freeze all execution (immediate, no confirmation delay)
- Unfreeze (requires explicit confirmation)
- Disable Sentinel entirely (settings, reversible)
- Uninstall WFP driver (admin action, fully reversible)

**G3 - Independent Verification**: The Sentinel Bridge verifies Ed25519 signatures
using its own key store, independent of the Executor's verification. A compromised
Executor cannot trick the Sentinel into clearing an unsigned order.

**G4 - Temporal Isolation**: Intent rules have TTL. Even if a rule is granted,
it expires. Stale permissions cannot be exploited.

**G5 - Behavioral Anomaly Detection**: The Fragmergent Brain detects when a process
deviates from its established behavioral baseline. This catches novel attacks that
don't match known patterns.

**G6 - Non-Bypassable from Non-Admin User-Mode**: The WFP kernel driver operates at
Ring 0. No non-admin user-mode process (including a compromised executor or bridge) can
disable, reconfigure, or bypass the driver's filtering decisions. Admin-level tampering
resistance requires OS policy hardening (Secure Boot + WDAC + CI policies + TPM
attestation), which is outside the scope of this component.

**G7 - Audit Completeness**: Every Sentinel decision (allow, block, freeze, unfreeze)
is logged to both the Sentinel event stream and the BYON audit trail hash chain.

---

## 9. How WFP Sentinel Complements Existing BYON Security

### 9.1 Complementary, Not Redundant

| Existing Layer | Protects Against | WFP Sentinel Adds |
|----------------|------------------|--------------------|
| Ed25519 signatures | Forged execution orders | Independent 2nd verification at OS level + HMAC on IPC |
| Docker air-gap | Executor network access | Kernel-level network confirmation (defense-in-depth) |
| Forbidden paths | Writing to sensitive files | [FUTURE] File System Minifilter for OS-level monitoring |
| Forbidden patterns | Dangerous code in actions | Behavioral anomaly detection of actual network runtime |
| Risk scoring | Underestimating plan danger | Independent risk assessment at intent level |
| Approval flow | Unauthorized execution | Emergency freeze capability (faster than rejection) |
| Audit trail | Covering tracks | Kernel-level network logging (cannot be tampered from user-mode) |

### 9.2 The Defense-in-Depth Model

```
ATTACK: Dependency supply chain → compromised Node.js module in executor

Layer 4 (Application): Forbidden patterns check → MISS (not in action content)
Layer 5 (Docker): network_mode: none → BLOCKS outbound connections ✓
Layer 3 (Sentinel): Behavioral anomaly → DETECTS unusual process behavior ✓
Layer 2 (WFP Kernel): No intent rule for network → BLOCKS at kernel level ✓
Result: Attack contained by 3 independent layers
```

```
ATTACK: Auditor compromise → signs malicious order to delete database

Layer 6 (Crypto): Signature valid → PASS (attacker has the key)
Layer 4 (Application): Forbidden path check → MAY MISS (depends on path)
Layer 3 (Sentinel): Rate limit exceeded → BLOCKS (too many deletes/hour) ✓
Layer 3 (Sentinel): Anomaly alert → USER NOTIFIED ✓
Layer 0 (Human): User freezes system → ALL EXECUTION HALTED ✓
Result: Human remains final authority despite crypto bypass
```

---

## 10. Installation and Lifecycle

### 10.1 First-Run Decision Flow

During `pnpm setup:first-run` or first Docker Compose launch:

```
╔════════════════════════════════════════════════════════════════╗
║  BYON OPTIMUS - Security Configuration                       ║
╠════════════════════════════════════════════════════════════════╣
║                                                              ║
║  Choose your security level:                                 ║
║                                                              ║
║  [A] STANDARD SECURITY (Recommended for most users)          ║
║      ✓ Ed25519 signed execution orders                       ║
║      ✓ Human approval for all actions                        ║
║      ✓ Air-gapped executor (no network)                      ║
║      ✓ Full audit trail                                      ║
║      ✗ No OS-level kernel protection                         ║
║                                                              ║
║  [B] MAXIMUM SECURITY (For high-sensitivity environments)    ║
║      ✓ Everything in Standard, plus:                         ║
║      ✓ WFP Sentinel kernel driver (Windows)                  ║
║      ✓ Behavioral network analysis per process               ║
║      ✓ Independent signature verification                    ║
║      ✓ Emergency freeze capability                           ║
║      ✓ Kernel-level logging                                  ║
║      ⚠ Requires admin privileges for driver installation     ║
║      ⚠ May flag BYON processes in antivirus software         ║
║      ⚠ Slightly higher system resource usage                 ║
║                                                              ║
║  You can change this setting at any time from the dashboard. ║
╚════════════════════════════════════════════════════════════════╝
```

### 10.2 Enable/Disable Lifecycle

```
DISABLED (default)
    |
    | User selects "Maximum Security" in settings
    v
INSTALLING
    |
    | Driver installed, bridge started, intent store initialized
    v
MONITORING (passive mode - first 24 hours)
    |
    | Learning application baselines, no blocking
    v
ACTIVE (enforcing mode)
    |
    | User can toggle enforcement modules individually
    v
FROZEN (emergency)
    |
    | User freezes all execution
    | User unfreezes when ready
    v
ACTIVE (returns to enforcement)
    |
    | User disables in settings
    v
DISABLED
    |
    | User uninstalls driver (optional)
    v
UNINSTALLED
```

### 10.3 Uninstall Path

1. User navigates to Settings > Security > WFP Sentinel
2. Clicks "Disable WFP Sentinel"
3. System confirms: "This will remove kernel-level network protection.
   Your system will continue to be protected by Ed25519 signatures,
   Docker air-gap, and the approval flow."
4. Bridge service stops
5. Intent rules cleared from driver
6. Driver service stopped (remains installed for quick re-enable)
7. Full uninstall: "Remove WFP Sentinel Driver" → runs uninstall_driver.bat

---

## 11. UI/UX: Sentinel Tab Design

### 11.1 Tab Structure

```
[Dashboard] [Approvals] [History] [Sentinel]
                                      ^
                                  NEW TAB
```

### 11.2 Sentinel Tab Sections

**Section 1: Protection Status**
- Green/yellow/red indicator showing current protection level
- Plain English: "Your system is fully protected" / "Monitoring only" / "Protection paused"
- One-click FREEZE button (red, always visible)

**Section 2: What Sentinel Protects**
- "Sentinel watches every network connection your BYON agents make"
- "It learns what's normal and alerts you when something unusual happens"
- "Even if the AI agents were compromised, Sentinel prevents unauthorized access"

**Section 3: Recent Sentinel Events**
- Timeline of allow/block/anomaly events
- Each event in human language: "Worker connected to Anthropic API (normal)"
- Color-coded: green (normal), yellow (unusual), red (blocked)

**Section 4: Application Profiles**
- Per-process behavioral summary
- "Worker: 142 connections today, all to expected destinations"
- "Executor: 0 network connections (air-gapped as expected)"

**Section 5: Controls**
- Enable/disable individual detection modules
- Sensitivity slider (conservative → aggressive)
- "Learning mode" toggle (monitor without blocking)

---

## 12. Intent Metadata at the WFP Layer

### 12.1 What Should Be Reflected

| Metadata | At WFP Layer | Rationale |
|----------|-------------|-----------|
| Order ID | YES | Correlate network activity to specific execution orders |
| Action type | YES (simplified) | "file_create needs no network" vs "api_call needs HTTPS" |
| Target host/port | YES | Precise intent-based authorization |
| TTL/expiration | YES | Prevent stale permissions |
| Risk level | YES | Higher risk = stricter network policy |
| Ed25519 signature | YES | Kernel verifies intent authenticity |
| Plan content | NO | Too large for kernel structures, unnecessary |
| Source code | NO | Irrelevant at network layer |
| User identity | NO | Not meaningful at kernel level |
| Audit trail | NO | Maintained separately, not kernel's responsibility |

### 12.2 What Should NOT Be at WFP Layer

The WFP driver should NOT attempt to:
- Parse or understand the content of execution orders
- Make semantic decisions about code quality or safety
- Store conversation history or user preferences
- Communicate directly with external services

The driver's role is strictly: **"Is this specific network connection authorized
by a valid, signed, unexpired intent rule? Yes → PERMIT. No → BLOCK."**

---

## 13. Platform Considerations

### 13.1 Windows (Primary Target)

- WFP Semantic Guard is a native Windows kernel driver
- Full integration: kernel driver + WPF UI + BYON bridge
- Requires test signing mode for development, EV cert for production

**Docker Desktop / WSL2 Caveat**: On Windows, Docker Desktop typically runs containers
inside a WSL2 lightweight Linux VM. WFP on the Windows host operates at the host
networking stack and **cannot** enforce per-container or per-process policies inside the
WSL2 VM. This has the following implications:

| Deployment | WFP Enforcement Scope | Recommendation |
|------------|----------------------|----------------|
| Native Windows host processes | Full per-process enforcement ✓ | Sentinel covers gateway, worker, auditor running natively |
| Docker Desktop (WSL2 backend) | VM-level only, not per-container | Executor air-gap relies on Docker `network_mode: none`; Sentinel covers host-side agents only |
| Docker Desktop (Hyper-V backend) | NAT/vSwitch level, not per-container | Same as WSL2 — Sentinel is host-side only |
| Windows containers (process isolation) | Full per-process enforcement ✓ | Ideal for Sentinel, but less common |

**Recommended deployment model**: Run gateway, worker, and auditor as native Windows
processes (or Windows containers with process isolation) where WFP has full visibility.
Executor remains in Linux container with `network_mode: none` (Docker's own isolation).
Sentinel enforces network policy on the host-side agents that actually need network access.

### 13.2 Linux (Future)

- Equivalent: eBPF-based network filtering (XDP/TC hooks)
- Or: nftables with per-process filtering via cgroup matching
- Filesystem: fanotify for file access monitoring
- Process: seccomp-bpf for syscall filtering
- The Sentinel Bridge abstraction layer enables cross-platform support

### 13.3 macOS (Future)

- Network Extension framework (replaces deprecated NKE)
- Endpoint Security framework for process/file monitoring
- Same Bridge abstraction applies

### 13.4 Docker-Only Environments (Cloud/CI)

- WFP driver not applicable inside containers
- Alternative: AppArmor/SELinux profiles for executor container
- Sentinel Bridge can still provide intent verification without kernel driver
- Degraded but functional: Layers 3-7 without Layer 2

---

## 14. Summary: Security Properties Achieved

| Property | Without Sentinel | With Sentinel |
|----------|-----------------|---------------|
| Execution requires human approval | ✓ | ✓ |
| Execution requires Ed25519 signature | ✓ | ✓ + independent 2nd verification + HMAC IPC |
| Network isolation (executor) | Docker only | Docker + WFP kernel (host-side agents) |
| Filesystem isolation | Docker volume mounts | Docker volume mounts ([FUTURE] minifilter) |
| Process spawn prevention | Docker + handler-level | Docker + handler-level ([FUTURE] process callbacks) |
| Behavioral anomaly detection | None | Fragmergent Brain per-process (network behavior) |
| Emergency halt capability | Stop Docker containers | Instant freeze via UI (with essential services whitelist) |
| Kernel-level enforcement | None | WFP driver at Ring 0 (network only) |
| Survives application compromise | Partially (Docker helps) | Network layer: Yes (kernel independent). FS/Process: Docker only |
| Human remains final authority | Yes (approval flow) | Yes + guaranteed by kernel network veto |
| Fully reversible | N/A | Yes (disable/uninstall at any time) |
| Optional / no mandatory dependency | N/A | Yes (standard mode works without it) |
| Docker/WSL2 aware | N/A | Yes (host-side enforcement, documented limitations) |
