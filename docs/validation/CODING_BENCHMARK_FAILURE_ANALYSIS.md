# Coding Benchmark Failure Analysis (v0.6 baseline)

**Source benchmark:** PR #6, run `2026-05-13T15-12-02-640Z-1l7cg4`
**Verdict on record:** `BYON_CODING_ADVANTAGE_NOT_PROVEN`
**Suffix:** `FULL_LEVEL3_NOT_DECLARED`

## Observed result (verbatim from the v0.6 run)

| Condition | Weighted score (/5) |
| --- | ---: |
| A — Claude Sonnet 4.6 direct | **4.75** |
| B — BYON Optimus full organism | **2.55** |
| Delta | **−46.32 %** |

BYON lost 9 of 10 judged dimensions (architecture_quality, requirement_fidelity, longitudinal_memory, policy_security_correctness, adversarial_robustness, refactor_quality, debugging_quality, test_quality, documentation_quality, user_value).

5 of 8 acceptance gates failed:
- `gate_1_overall_15pct` (delta below +15 % threshold; in fact negative)
- `gate_2_policy_security_correctness`
- `gate_3_longitudinal_memory`
- `gate_4_adversarial_robustness`
- `gate_5_final_tests_pass` (BYON pytest exit = 2, collection error)

3 gates passed: `gate_6_no_bypass_yaml`, `gate_7_structural_refs_preserved`, `gate_8_no_level3_no_omega`.

## Failure symptoms (from the judge's rationale on B's repo)

- Two `AuditLog` classes (`audit.py` AND `executor.py`).
- Two `WorkflowDefinition` dataclasses (`models.py` AND `workflow.py`).
- Two `PolicyEngine` classes (`policy.py` AND `policies.py`).
- Inconsistent file paths / types across phases.
- A fragmented repo where later phases re-derived earlier types from lossy recall instead of extending them.

## Accepted diagnosis

> Semantic / thread-scoped memory retrieval is sufficient for Q&A but **insufficient for multi-file iterative coding**. Code coherence requires byte-exact prior file contents, exact symbol locations, exact failing-test output, and a stable requirements ledger — none of which a similarity-based conversational memory can provide.

Native chat history (Condition A) preserves every byte of every prior turn. BYON's similarity-based recall returned excerpts; the model regenerated partial / paraphrased versions of earlier classes; the orchestrator wrote them into NEW files; the project fragmented.

This is **not** a failure of BYON's safety / identity / trust layer. Those held (gate_6, gate_7, gate_8 all passed). It is a failure of the *coding context layer*, which until now has been the same generic Q&A context as everything else.

## Remediation path (this PR's scope)

Implement a `Code Workspace Memory` layer specialised for coding:

1. **ExactFileStateStore** — byte-exact prior file contents, not summaries.
2. **SymbolIndex** — every class / dataclass / function / test, with file:line; duplicate detection across files.
3. **RequirementsLedger** — explicit stable IDs (`REQ_NO_POLICY_BYPASS`, …) seeded across phases; refuses `bypass_all`.
4. **PatchMemory** — append-only patch log per phase.
5. **TestFailureMemory** — verbatim `pytest` / `compileall` stdout + parsed failing test + root cause.
6. **ArchitectureMap** — modules, public APIs, dependency edges, `FORBIDDEN_DUPLICATE_PUBLIC_APIS` list (PolicyEngine, AuditLog, WorkflowDefinition, …).
7. **WorkspaceDiffGuard** — inspects candidate patches: blocks duplicate public APIs / `bypass_all` acceptance / audit append-only violation / rollback-erases-audit / test-file emptying.
8. **CodingContextBuilder** — composes a structured user message with anti-duplication warning + requirements + exact files + symbol locations + last failure + output protocol.
9. **CodeWorkspaceMemory** — coordinator; called by the bench orchestrator before each Condition B phase.

The `software_engineer` capability manifest now lists all 9 modules as `module_status: active` (was `planned`). The CapabilityRouter reports `missing_required_modules: []` for coding prompts after this PR.

## Empirical answer (to be filled in by the rerun)

The same `policy-gated-workflow-engine` benchmark is rerun with the new layer active in Condition B. The result is recorded **honestly** under one of two operator-allowed verdict tokens:

- `BYON_CODING_ADVANTAGE_PROVEN` — only if BYON weighted ≥ Claude direct + 15 %, BYON pytest passes, and no duplicate `PolicyEngine` / `AuditLog` / `WorkflowDefinition` is detected.
- `BYON_CODING_ADVANTAGE_STILL_NOT_PROVEN` — for any other outcome.

The verdict, full per-dimension scores, gate breakdown, and `code-workspace-telemetry.json` (which records per-phase: how many exact files / requirements / failures were included; what the guard found; final patch log) live at `byon-orchestrator/test-results/coding-capability-benchmark/<new_run_id>/`.

**This document is a checkpoint — not a celebration.** Whether the layer reverses the −46.32 % delta is an empirical question. If BYON still loses, the report says so.

## Hard isolation reaffirmed (PR-level)

- `theta_s = 0.28` unchanged (tests 42 / 43 grep-assert it)
- `tau_coag = 12` unchanged
- No manual Omega
- No `ReferenceField` instantiation
- All 7 structural references remain `origin=operator_seeded`
- `level_3_declared = false`
- No forbidden verdict token (`LEVEL_3_REACHED`, `OMEGA_CREATED_MANUALLY`, `SYNTHETIC_OMEGA`, `THRESHOLD_LOWERED`) appears as a positive claim anywhere in this PR
