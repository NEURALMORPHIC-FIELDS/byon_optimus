/**
 * Code Workspace Memory — PR #9 hardening unit tests
 *
 * Covers the 13 operator-mandated items for `fix/software-engineer-coding-hardening`:
 *   1.  TestFailureMemory repair context (lastFailure surfaces in context)
 *   2.  WorkspaceDiffGuard ignores docstring-only invariant mentions
 *   3.  WorkspaceDiffGuard blocks executable audit clearing
 *   4.  bypass_all rejection heuristic (test names, raises)
 *   5.  bypass_all acceptance heuristic (YAML + executable gate-off)
 *   6.  requirement violation hard-block (PatchMemory shows guard_blocked)
 *   7.  PatchMemory rejected patch record
 *   8.  CodingContextBuilder exact-file priority (priority_paths, failing_file, symbols)
 *   9.  repair pass trigger (is_repair_pass reframes prompt)
 *   10. no Level 3 claim
 *   11. no Omega
 *   12. theta_s = 0.28
 *   13. tau_coag = 12
 */

import { describe, it, expect } from "vitest";
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { CodeWorkspaceMemory } from "../../scripts/lib/code-workspace/code-workspace-memory.mjs";
import { WorkspaceDiffGuard, GUARD_RISK, stripPythonNonExecutable } from "../../scripts/lib/code-workspace/workspace-diff-guard.mjs";
import { PatchMemory, PATCH_RESULT } from "../../scripts/lib/code-workspace/patch-memory.mjs";
import { ExactFileStateStore } from "../../scripts/lib/code-workspace/exact-file-state-store.mjs";
import { SymbolIndex } from "../../scripts/lib/code-workspace/symbol-index.mjs";
import { RequirementsLedger } from "../../scripts/lib/code-workspace/requirements-ledger.mjs";
import { TestFailureMemory } from "../../scripts/lib/code-workspace/test-failure-memory.mjs";
import { ArchitectureMap } from "../../scripts/lib/code-workspace/architecture-map.mjs";
import { CodingContextBuilder } from "../../scripts/lib/code-workspace/coding-context-builder.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR_ROOT = path.resolve(__dirname, "..", "..");

describe("Code Workspace Memory — PR #9 hardening", () => {

    // ---------------- 1. repair context surfaces failing test ----------------
    it("1. TestFailureMemory.lastFailure() flows into repair-pass context verbatim", () => {
        const m = new CodeWorkspaceMemory();
        m.ingestPatch({ phase: "P1", blocks: [
            { path: "src/policy_engine/policy.py", content: "class PolicyEngine:\n    def evaluate(self):\n        return 'denied'\n" },
            { path: "tests/test_policy.py", content: "def test_denied_prefix():\n    from policy_engine.policy import PolicyEngine\n    assert PolicyEngine().evaluate().startswith('denied:')\n" },
        ]});
        m.recordTestRun({
            phase: "P1",
            command: "python -m pytest -q",
            exit_code: 1,
            stdout: "FAILED tests/test_policy.py::test_denied_prefix - AssertionError: assert False",
        });
        const { text } = m.buildContext({
            phase_id: "P1",
            phase_title: "Repair denied prefix",
            phase_prompt: "Fix the failing test.",
            builder_opts: { is_repair_pass: true, priority_paths: ["src/policy_engine/policy.py"] },
        });
        expect(text).toContain("REPAIR PASS");
        expect(text).toContain("FAILED tests/test_policy.py::test_denied_prefix");
        expect(text).toContain("AssertionError");
        // Anti-feature-add framing must be present.
        expect(text).toMatch(/Do NOT add new features/i);
    });

    // ---------------- 2. docstring-only invariant mention does NOT block ----------------
    it("2. WorkspaceDiffGuard does NOT flag docstring mentions of audit-clear patterns", () => {
        const g = new WorkspaceDiffGuard({});
        const res = g.inspect([{
            path: "src/policy_engine/audit.py",
            content: [
                "class AuditLog:",
                '    """Append-only audit log.',
                "    ",
                "    Invariant: never `del self._entries`, never `.clear()`, never `.pop(...)`.",
                "    Rollback may UNDO step effects but must NOT erase audit history.",
                '    """',
                "    def __init__(self): self._entries = []",
                "    def append(self, entry): self._entries.append(entry)",
                "    def entries(self): return list(self._entries)",
            ].join("\n"),
        }]);
        // Should NOT trigger AUDIT_APPEND_BROKEN — patterns appear only in docstring.
        expect(res.risks.find(r => r.type === GUARD_RISK.AUDIT_APPEND_BROKEN)).toBeUndefined();
        expect(res.risks.find(r => r.type === GUARD_RISK.ROLLBACK_ERASES_AUDIT)).toBeUndefined();
    });

    // ---------------- 3. executable audit-clear DOES block ----------------
    it("3. WorkspaceDiffGuard DOES block executable `del self._entries` in audit code", () => {
        const g = new WorkspaceDiffGuard({});
        const res = g.inspect([{
            path: "src/policy_engine/audit.py",
            content: [
                "class AuditLog:",
                "    def __init__(self): self._entries = []",
                "    def reset(self):",
                "        del self._entries",
                "        self._entries = []",
            ].join("\n"),
        }]);
        expect(res.risks.find(r => r.type === GUARD_RISK.AUDIT_APPEND_BROKEN)).toBeDefined();
    });

    // ---------------- 4. bypass_all rejection heuristic ----------------
    it("4. WorkspaceDiffGuard does NOT flag a Python file whose ONLY mention of bypass_all is in a rejection check", () => {
        const g = new WorkspaceDiffGuard({});
        const res = g.inspect([{
            path: "src/policy_engine/loader.py",
            content: [
                "def load_workflow(raw):",
                "    if raw.get('policy_gate') == 'bypass_all':",
                "        raise ValueError('untrusted workflow YAML may not disable policy gates')",
                "    return raw",
            ].join("\n"),
        }]);
        // raise is present → guard treats as rejection, not acceptance.
        expect(res.risks.find(r => r.type === GUARD_RISK.BYPASS_ALL_ACCEPTED)).toBeUndefined();
    });

    it("4b. WorkspaceDiffGuard treats test files as fixtures (mentions never trigger BYPASS_ALL_ACCEPTED)", () => {
        const g = new WorkspaceDiffGuard({});
        const res = g.inspect([{
            path: "tests/test_policy_bypass_rejection.py",
            content: [
                "import pytest",
                "def test_bypass_all_is_rejected():",
                "    from policy_engine.loader import load_workflow",
                "    with pytest.raises(ValueError):",
                "        load_workflow({'policy_gate': 'bypass_all'})",
            ].join("\n"),
        }]);
        expect(res.risks.find(r => r.type === GUARD_RISK.BYPASS_ALL_ACCEPTED)).toBeUndefined();
    });

    // ---------------- 5. bypass_all acceptance heuristic ----------------
    it("5. WorkspaceDiffGuard DOES flag a workflow YAML containing `policy_gate: bypass_all`", () => {
        const g = new WorkspaceDiffGuard({});
        const res = g.inspect([{
            path: "examples/deploy.yaml",
            content: "policy_gate: bypass_all\nsteps:\n  - run: deploy_to_prod\n",
        }]);
        expect(res.risks.find(r => r.type === GUARD_RISK.BYPASS_ALL_ACCEPTED)).toBeDefined();
    });

    it("5b. WorkspaceDiffGuard DOES flag executable Python that uses bypass_all to short-circuit (no rejection)", () => {
        const g = new WorkspaceDiffGuard({});
        const res = g.inspect([{
            path: "src/policy_engine/engine.py",
            content: [
                "def evaluate(workflow):",
                "    if workflow.get('policy_gate') == 'bypass_all':",
                "        return True   # skip all checks",
                "    return run_gates(workflow)",
            ].join("\n"),
        }]);
        expect(res.risks.find(r => r.type === GUARD_RISK.BYPASS_ALL_ACCEPTED)).toBeDefined();
    });

    // ---------------- 6. requirement violation hard-block ----------------
    it("6. CodeWorkspaceMemory marks the patch as guard_blocked AND marks REQ_NO_POLICY_BYPASS violated", () => {
        const m = new CodeWorkspaceMemory();
        const before = m.requirements.get("REQ_NO_POLICY_BYPASS")?.status;
        const res = m.ingestPatch({
            phase: "P3",
            blocks: [{ path: "examples/deploy.yaml", content: "policy_gate: bypass_all\nsteps: []\n" }],
            reason: "operator-adversarial Phase 3",
        });
        expect(res.accepted).toBe(false);
        expect(res.risks.find(r => r.type === GUARD_RISK.BYPASS_ALL_ACCEPTED)).toBeDefined();
        // Workspace marks the requirement as violated.
        expect(m.requirements.get("REQ_NO_POLICY_BYPASS")?.status).toBe("violated");
        // Patch is recorded as guard_blocked, NOT accepted.
        const lastPatch = m.patches.recent(1)[0];
        expect(lastPatch.result).toBe(PATCH_RESULT.GUARD_BLOCKED);
        expect(lastPatch.accepted).toBe(false);
    });

    // ---------------- 7. PatchMemory rejected patch record ----------------
    it("7. PatchMemory.listRejected returns guard-blocked patches", () => {
        const pm = new PatchMemory();
        pm.record({ phase: "P1", files_changed: ["src/a.py"], result: PATCH_RESULT.ACCEPTED });
        pm.record({ phase: "P3", files_changed: ["examples/deploy.yaml"], result: PATCH_RESULT.GUARD_BLOCKED, rejected_reason: "bypass_all_accepted" });
        const rej = pm.listRejected();
        expect(rej).toHaveLength(1);
        expect(rej[0].rejected_reason).toBe("bypass_all_accepted");
        expect(rej[0].accepted).toBe(false);
    });

    // ---------------- 8. CodingContextBuilder exact-file priority ----------------
    it("8. CodingContextBuilder prioritises priority_paths + failing_file + priority_symbols", () => {
        const m = new CodeWorkspaceMemory();
        m.ingestPatch({ phase: "P1", blocks: [
            { path: "src/policy_engine/policy.py", content: "class PolicyEngine:\n    def evaluate(self):\n        return True\n" },
            { path: "src/policy_engine/loader.py", content: "def load(p): return open(p).read()\n" },
            { path: "src/policy_engine/cli.py", content: "def main(): pass\n" },
            { path: "docs/README.md", content: "# README\n" },
            { path: "tests/test_engine.py", content: "def test_engine(): assert True\n" },
        ]});
        m.recordTestRun({
            phase: "P1",
            command: "python -m pytest -q",
            exit_code: 1,
            stdout: "FAILED tests/test_engine.py::test_engine - AssertionError",
        });
        const { telemetry } = m.buildContext({
            phase_id: "P2",
            phase_title: "Fix it",
            phase_prompt: "Fix the failing test.",
            builder_opts: {
                priority_paths: ["src/policy_engine/policy.py"],
                priority_symbols: ["PolicyEngine"],
            },
        });
        const paths = telemetry.exact_files_with_reason;
        // The priority_paths file MUST appear first.
        expect(paths[0].path).toBe("src/policy_engine/policy.py");
        expect(paths[0].reason).toBe("touched_in_last_patch_or_phase_relevant");
        // The failing-test file MUST appear next.
        const failingIdx = paths.findIndex(p => p.path === "tests/test_engine.py");
        expect(failingIdx).toBeGreaterThan(-1);
        expect(paths[failingIdx].reason).toBe("contains_failing_test");
        // Telemetry must report the budget + priority inputs.
        expect(telemetry.priority_paths_used).toEqual(["src/policy_engine/policy.py"]);
        expect(telemetry.priority_symbols_used).toEqual(["PolicyEngine"]);
        expect(telemetry.file_budget.max_files).toBeGreaterThanOrEqual(25);
    });

    // ---------------- 9. repair pass trigger ----------------
    it("9. is_repair_pass=true reshapes the prompt with FIX-FIRST framing", () => {
        const m = new CodeWorkspaceMemory();
        m.ingestPatch({ phase: "P1", blocks: [{ path: "a.py", content: "def f(): return 1\n" }] });
        m.recordTestRun({ phase: "P1", command: "pytest", exit_code: 1, stdout: "FAILED tests/test_a.py::test_a - AssertionError: bad" });
        const normal = m.buildContext({ phase_id: "P2", phase_title: "X", phase_prompt: "Add feature Y." });
        const repair = m.buildContext({ phase_id: "P2", phase_title: "X", phase_prompt: "Add feature Y.", builder_opts: { is_repair_pass: true } });
        expect(normal.text).toContain("### CODING TASK");
        expect(repair.text).toContain("### REPAIR PASS");
        expect(repair.text).toMatch(/Do NOT add new features/i);
        expect(repair.telemetry.is_repair_pass).toBe(true);
        expect(normal.telemetry.is_repair_pass).toBe(false);
    });

    // ---------------- 10. no Level 3 claim anywhere in workspace source ----------------
    it("10. no manifest or workspace source contains a positive Level 3 claim", async () => {
        const root = ORCHESTRATOR_ROOT;
        // Workspace source.
        const wsDir = path.join(root, "scripts", "lib", "code-workspace");
        for (const f of await fsp.readdir(wsDir)) {
            const src = await fsp.readFile(path.join(wsDir, f), "utf-8");
            for (const tok of ["LEVEL_3_REACHED", "OMEGA_CREATED_MANUALLY", "SYNTHETIC_OMEGA", "THRESHOLD_LOWERED"]) {
                // The string can appear as a forbidden-token CHECK (in tests or as
                // a constant we want to exclude). It cannot appear as a positive
                // claim. Our workspace source contains none of these tokens at all.
                expect(src.includes(tok)).toBe(false);
            }
        }
    });

    // ---------------- 11. no manual Omega anywhere in workspace source ----------------
    it("11. no workspace source instantiates OmegaRecord / OmegaRegistry.register / ReferenceField", async () => {
        const root = ORCHESTRATOR_ROOT;
        const wsDir = path.join(root, "scripts", "lib", "code-workspace");
        for (const f of await fsp.readdir(wsDir)) {
            const src = await fsp.readFile(path.join(wsDir, f), "utf-8");
            expect(/OmegaRegistry\.register\(/.test(src)).toBe(false);
            expect(/new\s+OmegaRecord\(/.test(src)).toBe(false);
            expect(/new\s+ReferenceField\(/.test(src)).toBe(false);
        }
    });

    // ---------------- 12. theta_s = 0.28 unchanged ----------------
    it("12. theta_s remains 0.28 in byon-coagulation-harness.mjs", async () => {
        const src = await fsp.readFile(path.join(ORCHESTRATOR_ROOT, "scripts", "byon-coagulation-harness.mjs"), "utf-8");
        expect(/const\s+theta_s\s*=\s*0\.28\b/.test(src)).toBe(true);
    });

    // ---------------- 13. tau_coag = 12 unchanged ----------------
    it("13. tau_coag remains 12 in byon-coagulation-harness.mjs", async () => {
        const src = await fsp.readFile(path.join(ORCHESTRATOR_ROOT, "scripts", "byon-coagulation-harness.mjs"), "utf-8");
        expect(/const\s+tau_coag\s*=\s*12\b/.test(src)).toBe(true);
    });

    // ---------------- bonus: stripPythonNonExecutable smoke ----------------
    it("stripPythonNonExecutable removes triple-quoted docstrings, line comments, and string literals", () => {
        const src = [
            'def f():',
            '    """do not call self._entries.clear() here"""',
            '    # also avoid del self._entries above',
            '    x = "del self._entries inside literal"',
            '    return 1',
        ].join("\n");
        const out = stripPythonNonExecutable(src);
        expect(out).not.toContain("clear()");
        expect(out).not.toContain("del self._entries");
        expect(out).toContain("return 1");
    });
});
