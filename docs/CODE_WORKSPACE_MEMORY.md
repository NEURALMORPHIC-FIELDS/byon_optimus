# BYON Code Workspace Memory Layer

**Status:** infrastructure for the `software_engineer` capability pack. Built explicitly to fix the failure mode the coding benchmark (PR #6) surfaced. **This document does NOT claim coding is now solved.** Whether the layer reverses the −46.32 % delta is measured empirically by rerunning the same `policy-gated-workflow-engine` benchmark; the result is recorded in [`docs/validation/CODING_BENCHMARK_FAILURE_ANALYSIS.md`](validation/CODING_BENCHMARK_FAILURE_ANALYSIS.md).

## 1. Why BYON lost the v0.6 coding benchmark

In PR #6 (`coding-benchmark/policy-gated-workflow-engine`), BYON Optimus full organism was scored **2.55 / 5** against Claude Sonnet 4.6 direct **4.75 / 5** — a **−46.32 %** weighted delta across the same 6 coding phases.

The judge's rationale was specific:

> "Condition B shows serious fragmentation problems. There are multiple competing implementations of the same concepts: two different `AuditLog` classes (`audit.py` vs `executor.py`), two `WorkflowDefinition` dataclasses (`models.py` vs `workflow.py`), two `PolicyEngine` classes (`policy.py` vs `policies.py`), …"

## 2. Why semantic / thread-scoped memory retrieval is insufficient for coding

The BYON v0.6 pipeline excels at **Q&A** because thread-scoped FAISS retrieval, trust-ranked recall, and FCE-M advisory all operate on *what was said*, not *what was written*.

Code is the opposite problem:

- **Q&A coherence** survives lossy recall: a paraphrase of "Auditor signs ExecutionOrders" is still correct.
- **Code coherence** does NOT survive lossy recall: a paraphrase of `class PolicyEngine:` becomes `class PolicyEngine2:` and the project compiles but is wrong.

Native chat history (Condition A on PR #6) preserves byte-exact prior code. Similarity-based retrieval can't. The fragmentation pattern the judge flagged is exactly what you'd expect when the model is asked to extend a file it can only see in summary form.

## 3. The new workspace memory layer

`byon-orchestrator/scripts/lib/code-workspace/` — 9 modules, all `active`:

| Module | Role |
| --- | --- |
| [`exact-file-state-store.mjs`](../byon-orchestrator/scripts/lib/code-workspace/exact-file-state-store.mjs) | Byte-exact memory of every file: `file_path`, `full_content`, `content_hash`, `last_seen_phase`, `last_modified_phase`, `language`, `role`, `test_related`, `exists`. Never replaces full content with a summary. |
| [`symbol-index.mjs`](../byon-orchestrator/scripts/lib/code-workspace/symbol-index.mjs) | Regex-based Python symbol extraction (classes, dataclasses, enums, functions, tests, fixtures, CLI commands, imports). Surfaces duplicate names across files. |
| [`requirements-ledger.mjs`](../byon-orchestrator/scripts/lib/code-workspace/requirements-ledger.mjs) | Explicit requirement registry. Seeds the 7 structural coding invariants from the operator brief. **Refuses** `policy_gate: bypass_all` (and equivalent adversarial phrasings) at the ledger level. |
| [`patch-memory.mjs`](../byon-orchestrator/scripts/lib/code-workspace/patch-memory.mjs) | Append-only patch log: every set of file changes, which requirement IDs it touched, whether tests ran, the result, and whether it was guard-blocked. |
| [`test-failure-memory.mjs`](../byon-orchestrator/scripts/lib/code-workspace/test-failure-memory.mjs) | Captures each `pytest` / `compileall` / CLI run verbatim — command, exit code, stdout/stderr excerpts, parsed failing test/file/root-cause. Next coding turn sees the exact failure, not a paraphrase. |
| [`architecture-map.mjs`](../byon-orchestrator/scripts/lib/code-workspace/architecture-map.mjs) | Modules, public APIs, dependency edges, CLI surface, test surface. Knows the list of `FORBIDDEN_DUPLICATE_PUBLIC_APIS` (`PolicyEngine`, `AuditLog`, `WorkflowDefinition`, `WorkflowStep`, `ExecutionPlan`, `PlanValidator`, `PlanRenderer`, `RollbackManager`, `PermissionModel`, `PolicyGate`). |
| [`workspace-diff-guard.mjs`](../byon-orchestrator/scripts/lib/code-workspace/workspace-diff-guard.mjs) | Inspects a proposed patch BEFORE it lands. Flags: duplicate public APIs / dataclasses / classes, `policy_gate: bypass_all` acceptance, test files emptied, append-only audit invariant broken (`del self._entries`, `.clear()`, `.pop()` etc.), rollback paths that erase audit history. |
| [`coding-context-builder.mjs`](../byon-orchestrator/scripts/lib/code-workspace/coding-context-builder.mjs) | Composes the user message sent to Claude through `runConditionB`. Layout in §4 below. |
| [`code-workspace-memory.mjs`](../byon-orchestrator/scripts/lib/code-workspace/code-workspace-memory.mjs) | The coordinator. Owns one instance of each of the above. Exposes `buildContext`, `ingestPatch`, `recordTestRun`, `snapshot`. |

## 4. CodingContextBuilder output layout

For every coding phase, BYON now sends Claude a structured context with:

1. **Phase task** — the operator's prompt for this phase.
2. **Anti-duplication warning** — explicit list of `FORBIDDEN_DUPLICATE_PUBLIC_APIS` ("must exist in exactly ONE place across the repo"), plus any duplicate the architecture map currently sees.
3. **Requirements ledger** — every requirement by ID (`REQ_NO_POLICY_BYPASS`, `REQ_AUDIT_APPEND_ONLY`, …) with its current status. Stable IDs across phases so the model can refer back to them.
4. **Current workspace files** — every tracked file's path + role + content hash + last_modified_phase.
5. **Exact file contents** — byte-exact source/test/config files (up to 25, capped at ~6 KB per file). **Never a semantic summary.**
6. **Symbol index excerpt** — locations of `FORBIDDEN_DUPLICATE_PUBLIC_APIS` if already present; existing duplicates if any.
7. **Recent patch history** — last 5 patches with phase, result, and reason.
8. **Last test failure** — verbatim stdout/stderr excerpt, parsed failing test, root cause hint.
9. **Output protocol** — strict `### FILE: <path>` + fenced block format.

The `code-workspace-telemetry.json` artifact records for every phase how many exact files / requirements / patches / failures were included.

## 5. How it integrates with `software_engineer`

After this PR, `byon-orchestrator/config/capabilities/software_engineer.json`:

- bumped to `version: 0.2.0`
- every required module is `module_status: active` (was `planned`)
- additional guards: `no_duplicate_public_api`, `no_bypass_all_acceptance`, `no_audit_append_violation`, `no_rollback_erases_audit`

CapabilityRouter therefore now reports `missing_required_modules: []` for coding prompts. The router still surfaces the `MISSING_REQUIRED_MODULE` reason code if any *future* manifest declares a module that doesn't exist.

## 6. How it integrates with `runConditionB`

The coding benchmark orchestrator (`scripts/byon-coding-capability-benchmark.mjs`) wraps each Condition B phase as:

```
CodingContextBuilder.build(phase)
        ↓
runConditionB({ threadId, userMsg, channel: "coding-capability-bench" })
   ↳ memory-service, FAISS, embeddings, fact_extractor, trust_ranked_formatter,
     compliance_guard, post-generation checker, FCE-M receipt assimilation —
     all still active. The workspace layer adds context to the user message;
     it does NOT bypass the production pipeline.
        ↓
parseFileBlocks(reply)
        ↓
workspace.ingestPatch({ phase, blocks })
   ↳ WorkspaceDiffGuard inspects the patch
   ↳ duplicate public APIs / bypass_all / audit break → guard_blocked
        ↓
disk write
        ↓
pytest + compileall
        ↓
workspace.recordTestRun(...)
        ↓
next phase's buildContext() now sees the exact failure
```

The structural references (`auditor_authority`, `fce_advisory_limitation`, `trust_hierarchy`, `domain_verification`, `level_integrity`, `memory_safety`, `structural_memory_distinction`) remain seeded for the run.

## 7. How it prevents duplicate classes / drift

Three independent layers, redundantly:

1. **Context layer** — every phase's prompt lists existing classes and tells Claude not to redefine them.
2. **Guard layer** — `WorkspaceDiffGuard` inspects the candidate patch. If a second `class PolicyEngine:` shows up in a new file while one already exists, the patch is recorded as `guard_blocked` and the next phase's context surfaces the duplicate with file:line locations.
3. **Architecture layer** — `ArchitectureMap.forbiddenDuplicatePublicApis()` always reflects the live symbol index.

## 8. How it uses exact files

`ExactFileStateStore.set(path, content, { phase })` stores the **full UTF-8 byte content** plus a 16-hex-char SHA-256 prefix. `relevantFiles({ maxFiles, includeTests })` returns these entries sorted source-first; `CodingContextBuilder` then embeds each one in a fenced block with the file's role and (if any) truncation note. The model receives the same characters that are on disk.

## 9. How it uses the requirements ledger

`RequirementsLedger.seedStructuralRequirements()` is called in the `CodeWorkspaceMemory` constructor. The 7 invariants get stable IDs (`REQ_NO_POLICY_BYPASS`, `REQ_AUDIT_APPEND_ONLY`, `REQ_ROLLBACK_PRESERVES_AUDIT`, `REQ_FAILED_BLOCKS_DEPENDENTS`, `REQ_CONFIG_UNTRUSTED`, `REQ_PROD_REQUIRES_GRANT`, `REQ_TESTS_NOT_OPTIONAL`). `CodingContextBuilder` emits them every phase. The ledger refuses any new requirement matching adversarial bypass patterns. `WorkspaceDiffGuard` marks `REQ_NO_POLICY_BYPASS` as `violated_by: PATCH_xxxx` when it sees `bypass_all` acceptance.

## 10. How it uses test-failure memory

After every `pytest` / `compileall` run, the orchestrator calls `workspace.recordTestRun({ phase, command, exit_code, stdout, stderr })`. `TestFailureMemory` parses the failing test name (pytest summary line OR verbose line OR Python traceback), the failing file, and an error-class root cause (`AssertionError`, `ImportError`, etc.). The **last** failure goes verbatim into the next phase's context — including the literal stdout excerpt — so the model fixes the actual error.

## 11. What this layer does NOT change

- No change to `theta_s` (= 0.28) or `tau_coag` (= 12) — verified by tests 42–43.
- No manual `OmegaRegistry.register` / `OmegaRecord` / `ReferenceField`.
- No Level 3 claim. The `software_engineer` manifest's `level3_claim` remains `false`.
- No bypass of `runConditionB` — the production pipeline still owns memory-service writes, fact extraction, compliance guard, post-generation checker, and FCE-M receipt assimilation.
- No change to the `runConditionB` function itself — the workspace layer only changes what the *user message* contains.

## 12. Empirical question this layer answers

> Does an exact-workspace context (this PR) reverse the −46.32 % coding-benchmark delta?

That question is answered by the rerun under `byon-orchestrator/test-results/coding-capability-benchmark/<new_run_id>/` plus the analysis in `docs/validation/CODING_BENCHMARK_FAILURE_ANALYSIS.md`. **This document deliberately does not record an answer.** Whatever the rerun produces is reported honestly under the operator-allowed verdict tokens: either `BYON_CODING_ADVANTAGE_PROVEN` (delta ≥ +15 %) or `BYON_CODING_ADVANTAGE_STILL_NOT_PROVEN`.
