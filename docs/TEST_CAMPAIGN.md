# BYON Optimus — Usage Test Campaign (100 Tests)

**Version:** 1.0
**Date:** 2026-02-07
**Patent:** EP25216372.0 — Omni-Qube-Vault
**Author:** Vasile Lucian Borbeleac

## Overview

This document defines 100 end-to-end usage tests across 10 real-world domains validating BYON Optimus as a production system. These tests complement the existing 326 unit/integration/security tests in `byon-orchestrator/`.

## Test Domains

| # | Domain | Tests | File |
|---|--------|-------|------|
| 1 | Codebase Maintenance | 10 | `campaign/codebase-maintenance.test.ts` |
| 2 | DevOps & Infrastructure | 10 | `campaign/devops.test.ts` |
| 3 | Security & Cryptography | 15 | `campaign/security.test.ts` |
| 4 | Memory & FHRSS+FCPE | 25 | `campaign/memory.test.ts` |
| 5 | Approval & Human-in-the-Loop | 10 | `campaign/approval.test.ts` |
| 6 | Data Analysis & Processing | 8 | `campaign/data-analysis.test.ts` |
| 7 | Documentation & Reporting | 5 | `campaign/documentation.test.ts` |
| 8 | Incident Response & Audit | 7 | `campaign/incident-audit.test.ts` |
| 9 | Multi-Channel & Gateway | 5 | `campaign/gateway.test.ts` |
| 10 | System Integration & Resilience | 5 | `campaign/resilience.test.ts` |

---

## Domain 1: Codebase Maintenance (10 tests)

| ID | Test | Expected Result |
|----|------|-----------------|
| TC-001 | Worker generates a valid PlanDraft for "fix a typo in README" | PlanDraft with code_edit action targeting README |
| TC-002 | Worker generates code_edit action with correct diff format | Action parameters include file path and edit content |
| TC-003 | Worker generates multi-file plan for "rename function across codebase" | PlanDraft with multiple code_edit actions |
| TC-004 | Worker handles ambiguous task ("improve the code") with clarification | Plan intent contains clarification language |
| TC-005 | Worker rejects plan that modifies forbidden path (/etc/passwd) | Plan flagged with forbidden_data_present or high risk |
| TC-006 | Auditor downgrades risk when plan only touches test files | Risk level is "low" for test-file-only plans |
| TC-007 | Auditor escalates risk when plan touches security-critical files | Risk level is "high" for signer.ts modifications |
| TC-008 | Full pipeline: file_create → approve → execute → receipt | JohnsonReceipt with success status and rollback info |
| TC-009 | Full pipeline: code_edit with rollback containing original content | ExecutionOrder has rollback.enabled = true |
| TC-010 | Executor rollback: verify rollback_info correctly records | Rollback instructions present in signed order |

## Domain 2: DevOps & Infrastructure (10 tests)

| ID | Test | Expected Result |
|----|------|-----------------|
| TC-011 | Worker generates build_run action for "run the build" | Action type is build_run |
| TC-012 | Worker generates test_run action for "run tests" | Action type is test_run |
| TC-013 | Worker rejects shell_exec action (forbidden by policy) | Whitelist blocks shell_exec |
| TC-014 | Auditor blocks plan with shell commands in code content | Pattern checker detects child_process/exec |
| TC-015 | Auditor blocks plan containing network_request in code | Air-gap validator detects fetch/axios |
| TC-016 | Executor respects resource limits (iteration count) | Verifier rejects order exceeding max_iterations |
| TC-017 | Executor blocks action exceeding disk_mb limit | Verifier rejects order exceeding disk_limit_mb |
| TC-018 | Docker-style isolation: executor rejects code with external URLs | Air-gap validator detects https:// references |
| TC-019 | Handoff directory structure validation (7 subdirectories) | All expected directories exist in schema |
| TC-020 | Manifest generation produces valid JSON with required fields | Manifest has version, components, security sections |

## Domain 3: Security & Cryptography (15 tests)

| ID | Test | Expected Result |
|----|------|-----------------|
| TC-021 | Ed25519 key generation produces valid keypair | Public key is SPKI DER format, can sign/verify |
| TC-022 | Signature verification fails with wrong public key | VerificationResult.valid = false |
| TC-023 | Signature verification fails on tampered actions | Hash mismatch detected |
| TC-024 | Signature verification fails on tampered order_id | Hash mismatch detected |
| TC-025 | Nonce replay detection: same nonce rejected on second use | Error: "Nonce already consumed" |
| TC-026 | TTL enforcement: expired approval rejected | Error: "TTL exceeded" |
| TC-027 | TTL scaling by risk: high_risk gets shorter TTL | high=600s < medium=900s < low=1800s |
| TC-028 | Hash chain: 50-block chain maintains integrity | verify().valid = true |
| TC-029 | Hash chain: detects single-bit tampering in middle block | verify().valid = false, correct failedIndex |
| TC-030 | Hash chain: export → import round-trip preserves integrity | Import succeeds, verify() passes |
| TC-031 | Path traversal: blocks `....//....//etc/passwd` | Forbidden path detected |
| TC-032 | Path traversal: blocks URL-encoded traversal `%2e%2e%2f` | Forbidden path detected |
| TC-033 | Path traversal: blocks null-byte injection `file.txt%00.exe` | Forbidden path detected |
| TC-034 | Combined attack: traversal + forbidden pattern + shell_exec | All three violations detected |
| TC-035 | Air-gap: executor rejects code containing fetch() or XMLHttpRequest | Air-gap validator non-compliant |

## Domain 4: Memory & FHRSS+FCPE (25 tests)

| ID | Test | Expected Result |
|----|------|-----------------|
| TC-036 | Store code snippet and retrieve by semantic search | Search returns stored code entry |
| TC-037 | Store conversation context and retrieve by topic | Search returns stored conversation entry |
| TC-038 | Store fact and retrieve with confidence score | Result includes score > 0 |
| TC-039 | Search returns results sorted by relevance score | Descending score order |
| TC-040 | Search respects topK limit (ask for 5, get <= 5) | results.length <= 5 |
| TC-041 | Search filters by entry type (code vs conversation vs fact) | All results match requested type |
| TC-042 | Store 100 entries and verify all retrievable | Stats show 100 total entries |
| TC-043 | Store entry with metadata and verify preserved | Metadata fields intact on retrieval |
| TC-044 | Context building: coding task pulls code + fact entries | Context has code and fact IDs |
| TC-045 | Context building: messaging task pulls conversation entries | Context has conversation IDs |
| TC-046 | Context building: empty memory returns empty context | All ID arrays empty |
| TC-047 | Fact extraction: extracts function names from TypeScript | "Defines function: X" in facts |
| TC-048 | Fact extraction: extracts class definitions | "class" keyword detected |
| TC-049 | Fact extraction: extracts import statements | File references detected |
| TC-050 | Fact extraction: detects action verbs | "Action requested: add/fix/update" |
| TC-051 | Fact extraction: detects error/bug mentions | "Contains error/bug reference" |
| TC-052 | Recovery test: 30% data loss → 100% recovery | success=true, content matches |
| TC-053 | Recovery test: 40% data loss → 100% recovery | success=true, content matches |
| TC-054 | Recovery test: 50% data loss → >95% recovery | success=true |
| TC-055 | Recovery test: verify recovered data matches original | Exact string match |
| TC-056 | Health check: reports healthy when service responds | healthy=true |
| TC-057 | Health check: reports unhealthy when service unreachable | healthy=false, error defined |
| TC-058 | Health check: includes latency measurement | latency_ms >= 0 |
| TC-059 | Statistics: reports entry counts by type | by_type has correct counts |
| TC-060 | Cross-type search: query matches entries across code+fact types | Results contain both types |

## Domain 5: Approval & Human-in-the-Loop (10 tests)

| ID | Test | Expected Result |
|----|------|-----------------|
| TC-061 | ApprovalRequest contains correct nonce (hex format) | nonce is 32-char hex string |
| TC-062 | ApprovalRequest TTL matches risk level | low=1800s, medium=900s, high=600s |
| TC-063 | Low-risk plan gets auto-approved (no human needed) | requires_approval = false |
| TC-064 | High-risk plan requires explicit human approval | requires_approval = true |
| TC-065 | Approval timeout: request expires after TTL | processDecision throws "expired" |
| TC-066 | Approval with "deny" blocks ExecutionOrder creation | Decision is "rejected" |
| TC-067 | Approval with "approve" produces signed ExecutionOrder | Decision is "approved" |
| TC-068 | Approval tracks decided_by and reason fields | Fields populated in decision |
| TC-069 | Multiple concurrent approvals: each gets unique request_id | All IDs unique |
| TC-070 | Approval nonce cannot be reused (replay protection) | Error: "Nonce already consumed" |

## Domain 6: Data Analysis & Processing (8 tests)

| ID | Test | Expected Result |
|----|------|-----------------|
| TC-071 | Worker classifies "analyze sales data" as general task | inferTaskType returns "general" |
| TC-072 | Worker classifies "write a Python function" as coding | inferTaskType returns "coding" |
| TC-073 | Worker classifies "schedule a meeting" as scheduling | inferTaskType returns "scheduling" |
| TC-074 | Worker classifies "send a message" as messaging | inferTaskType returns "messaging" |
| TC-075 | Worker generates plan with multiple ordered actions | actions.length > 1 |
| TC-076 | Risk assessment: single file_create = low risk | level = "low" |
| TC-077 | Risk assessment: file_delete = medium+ risk | level = "medium" or "high" |
| TC-078 | Risk assessment: multiple actions with file_delete = high risk | level = "high" |

## Domain 7: Documentation & Reporting (5 tests)

| ID | Test | Expected Result |
|----|------|-----------------|
| TC-079 | Manifest contains all 16 components | components.length = 16 |
| TC-080 | Manifest contains naming conventions for sentinel, gmv, ui, approval | All 4 keys present |
| TC-081 | Manifest reports gitignored file existence (boolean only) | exists is boolean, no file contents |
| TC-082 | Manifest UI section identifies Lit framework and /optimus route | framework="Lit", route="/optimus" |
| TC-083 | Manifest security section reports Ed25519, HMAC, CORS, rate limiting | All security fields present |

## Domain 8: Incident Response & Audit (7 tests)

| ID | Test | Expected Result |
|----|------|-----------------|
| TC-084 | JohnsonReceipt contains execution summary with status | status is "success"/"partial"/"failed" |
| TC-085 | JohnsonReceipt tracks file_changes with paths and types | changes_made has arrays |
| TC-086 | JohnsonReceipt includes timing information | duration_ms > 0 |
| TC-087 | Hash chain records complete workflow (5-step pipeline) | Chain length = genesis + 5 |
| TC-088 | Hash chain detects deleted audit entries | verify().valid = false |
| TC-089 | Hash chain detects fake approval injection | verify().valid = false |
| TC-090 | Audit trail: 20-step workflow maintains full chain integrity | verify().valid = true |

## Domain 9: Multi-Channel & Gateway (5 tests)

| ID | Test | Expected Result |
|----|------|-----------------|
| TC-091 | Message from "web" channel processed correctly | Inbox message created with source "web" |
| TC-092 | Message from "telegram" channel processed correctly | Inbox message with "telegram" source |
| TC-093 | Message from "discord" channel processed correctly | Inbox message with "discord" source |
| TC-094 | Message from "cli" channel processed correctly | Inbox message with "cli" source |
| TC-095 | Message with missing channel defaults gracefully | No crash, message still processed |

## Domain 10: System Integration & Resilience (5 tests)

| ID | Test | Expected Result |
|----|------|-----------------|
| TC-096 | Malformed JSON in inbox is rejected gracefully | Error caught, no process crash |
| TC-097 | Oversized message (>1MB) is rejected or truncated | Validation error raised |
| TC-098 | Empty message content produces meaningful error | Error message references content |
| TC-099 | Concurrent handoff: 5 simultaneous plans don't corrupt | All 5 produce valid receipts |
| TC-100 | Full MACP cycle: message → evidence → plan → approve → execute → receipt | All 5 documents produced with valid hashes |

---

## Running the Campaign

```bash
# Run all 100 campaign tests
cd byon-orchestrator && npx vitest run tests/campaign/

# Run a specific domain
cd byon-orchestrator && npx vitest run tests/campaign/security.test.ts

# Run with verbose output
cd byon-orchestrator && npx vitest run tests/campaign/ --reporter=verbose
```

## Test Results

Results are saved to `test-results/campaign/` (gitignored). See `docs/USAGE_VALIDATION_REPORT.md` for the pass/fail matrix.
