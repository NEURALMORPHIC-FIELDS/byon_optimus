/**
 * Code Workspace Memory Layer — unit tests
 *
 * Operator-mandated coverage (~40 tests across the 43 acceptance items
 * listed in the task brief).
 *
 *  ExactFileStateStore       : tests 1-5
 *  SymbolIndex               : tests 6-10
 *  RequirementsLedger        : tests 11-15
 *  PatchMemory               : tests 16-19
 *  TestFailureMemory         : tests 20-22
 *  ArchitectureMap           : tests 23-24
 *  CodingContextBuilder      : tests 25-30
 *  WorkspaceDiffGuard        : tests 31-35
 *  Pipeline integration      : tests 36-43
 */

import { describe, it, expect } from "vitest";
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { ExactFileStateStore } from "../../scripts/lib/code-workspace/exact-file-state-store.mjs";
import { SymbolIndex, SymbolKinds } from "../../scripts/lib/code-workspace/symbol-index.mjs";
import { RequirementsLedger, STRUCTURAL_CODING_REQUIREMENTS, REQ_STATUS } from "../../scripts/lib/code-workspace/requirements-ledger.mjs";
import { PatchMemory, PATCH_RESULT } from "../../scripts/lib/code-workspace/patch-memory.mjs";
import { TestFailureMemory } from "../../scripts/lib/code-workspace/test-failure-memory.mjs";
import { ArchitectureMap, FORBIDDEN_DUPLICATE_PUBLIC_APIS } from "../../scripts/lib/code-workspace/architecture-map.mjs";
import { CodingContextBuilder } from "../../scripts/lib/code-workspace/coding-context-builder.mjs";
import { WorkspaceDiffGuard, GUARD_RISK } from "../../scripts/lib/code-workspace/workspace-diff-guard.mjs";
import { CodeWorkspaceMemory } from "../../scripts/lib/code-workspace/code-workspace-memory.mjs";
import { CapabilityRegistry } from "../../scripts/lib/capability-registry.mjs";
import { routeCapability } from "../../scripts/lib/capability-router.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR_ROOT = path.resolve(__dirname, "..", "..");
const CAPS_DIR = path.join(ORCHESTRATOR_ROOT, "config", "capabilities");

describe("Code Workspace Memory Layer", () => {

    // -----------------------------------------------------------------------
    // ExactFileStateStore (tests 1-5)
    // -----------------------------------------------------------------------
    describe("ExactFileStateStore", () => {
        it("1. stores full content and hash", () => {
            const s = new ExactFileStateStore();
            const content = "class PolicyEngine:\n    pass\n";
            s.set("src/policy_engine/policy.py", content, { phase: "P1" });
            const e = s.get("src/policy_engine/policy.py");
            expect(e?.full_content).toBe(content);
            expect(e?.content_hash).toMatch(/^[a-f0-9]{16}$/);
            expect(e?.last_seen_phase).toBe("P1");
            expect(e?.last_modified_phase).toBe("P1");
        });
        it("2. updates modified files (last_modified_phase advances on content change)", () => {
            const s = new ExactFileStateStore();
            s.set("a.py", "v1", { phase: "P1" });
            s.set("a.py", "v1", { phase: "P2" });   // same content -> last_modified unchanged
            expect(s.get("a.py")?.last_modified_phase).toBe("P1");
            s.set("a.py", "v2", { phase: "P3" });   // changed content -> updated
            expect(s.get("a.py")?.last_modified_phase).toBe("P3");
        });
        it("3. marks deleted/missing files but preserves last-known state", () => {
            const s = new ExactFileStateStore();
            s.set("doomed.py", "x", { phase: "P1" });
            s.markMissing("doomed.py", "P2");
            const e = s.get("doomed.py");
            expect(e?.exists).toBe(false);
            expect(e?.last_seen_phase).toBe("P2");
            expect(e?.full_content).toBe("x");
            expect(s.listExisting()).toHaveLength(0);
            expect(s.listDeleted()).toHaveLength(1);
        });
        it("4. returns exact relevant files (source first, then tests, capped)", () => {
            const s = new ExactFileStateStore();
            s.set("docs/README.md", "doc", { phase: "P1" });
            s.set("src/x.py", "class X: pass", { phase: "P1" });
            s.set("tests/test_x.py", "def test_x(): pass", { phase: "P1" });
            const rel = s.relevantFiles({ maxFiles: 2 });
            expect(rel).toHaveLength(2);
            expect(rel[0].role).toBe("source");
            expect(rel[1].role).toBe("test");
        });
        it("5. NEVER replaces full content with a summary", () => {
            const s = new ExactFileStateStore();
            const original = "# very long file\n" + "x = 1\n".repeat(500);
            s.set("big.py", original, { phase: "P1" });
            const snap = s.snapshot();
            expect(snap.files[0].bytes).toBe(Buffer.byteLength(original, "utf-8"));
            // snapshot is metadata only; full content must still be retrievable from get()
            expect(s.get("big.py")?.full_content).toBe(original);
        });
    });

    // -----------------------------------------------------------------------
    // SymbolIndex (tests 6-10)
    // -----------------------------------------------------------------------
    describe("SymbolIndex", () => {
        it("6. extracts Python classes / dataclasses / functions", () => {
            const idx = new SymbolIndex();
            idx.indexFile("a.py", [
                "from dataclasses import dataclass",
                "@dataclass",
                "class WorkflowDefinition:",
                "    name: str",
                "class PolicyEngine:",
                "    def evaluate(self):",
                "        return True",
                "def helper():",
                "    return 1",
            ].join("\n"));
            expect(idx.locations("WorkflowDefinition")[0].kind).toBe(SymbolKinds.DATACLASS);
            expect(idx.locations("PolicyEngine")[0].kind).toBe(SymbolKinds.CLASS);
            expect(idx.locations("helper")[0].kind).toBe(SymbolKinds.FUNCTION);
            expect(idx.locations("evaluate")[0].kind).toBe(SymbolKinds.FUNCTION);
        });
        it("7. extracts imports", () => {
            const idx = new SymbolIndex();
            idx.indexFile("a.py", "from typing import List\nimport os\nfrom .util import helper\n");
            const imps = idx.importsOf("a.py");
            expect(imps).toContainEqual({ from: "typing", import: "List" });
            expect(imps).toContainEqual({ from: null, import: "os" });
            expect(imps).toContainEqual({ from: ".util", import: "helper" });
        });
        it("8. extracts test functions", () => {
            const idx = new SymbolIndex();
            idx.indexFile("tests/test_x.py", "def test_one():\n    pass\ndef test_two():\n    pass\ndef helper():\n    pass\n");
            const tests = idx.locations("test_one").concat(idx.locations("test_two"));
            for (const t of tests) expect(t.kind).toBe(SymbolKinds.TEST);
            // helper() is NOT a test
            expect(idx.locations("helper")[0].kind).toBe(SymbolKinds.FUNCTION);
        });
        it("9. detects duplicate class names across files", () => {
            const idx = new SymbolIndex();
            idx.indexFile("a.py", "class PolicyEngine:\n    pass\n");
            idx.indexFile("b.py", "class PolicyEngine:\n    pass\n");
            const dups = idx.duplicates();
            expect(dups.map(d => d.name)).toContain("PolicyEngine");
        });
        it("10. detects duplicate dataclass names", () => {
            const idx = new SymbolIndex();
            idx.indexFile("a.py", "@dataclass\nclass WorkflowDefinition:\n    name: str\n");
            idx.indexFile("b.py", "@dataclass\nclass WorkflowDefinition:\n    title: str\n");
            const dups = idx.duplicatesByKind(SymbolKinds.DATACLASS);
            expect(dups.map(d => d.name)).toContain("WorkflowDefinition");
        });
    });

    // -----------------------------------------------------------------------
    // RequirementsLedger (tests 11-15)
    // -----------------------------------------------------------------------
    describe("RequirementsLedger", () => {
        it("11. stores all seven structural coding requirements", () => {
            const r = new RequirementsLedger();
            r.seedStructuralRequirements("P0");
            expect(r.size()).toBe(7);
            const ids = r.list().map(x => x.id);
            for (const seed of STRUCTURAL_CODING_REQUIREMENTS) {
                expect(ids).toContain(seed.id);
            }
        });
        it("12. preserves requirement IDs across phases (status mutates, id stable)", () => {
            const r = new RequirementsLedger();
            r.seedStructuralRequirements("P0");
            const before = r.get("REQ_NO_POLICY_BYPASS")!;
            r.markSatisfied("REQ_NO_POLICY_BYPASS");
            const after = r.get("REQ_NO_POLICY_BYPASS")!;
            expect(after.id).toBe(before.id);
            expect(after.status).toBe(REQ_STATUS.SATISFIED);
        });
        it("13. marks violated requirement", () => {
            const r = new RequirementsLedger();
            r.seedStructuralRequirements("P0");
            expect(r.markViolated("REQ_AUDIT_APPEND_ONLY", "PATCH_0001")).toBe(true);
            expect(r.get("REQ_AUDIT_APPEND_ONLY")?.status).toBe(REQ_STATUS.VIOLATED);
            expect(r.listViolated().map(x => x.id)).toContain("REQ_AUDIT_APPEND_ONLY");
        });
        it("14. links tests to requirements", () => {
            const r = new RequirementsLedger();
            r.seedStructuralRequirements("P0");
            r.linkTest("REQ_TESTS_NOT_OPTIONAL", "tests/test_requirements.py::test_seeded");
            const tc = r.get("REQ_TESTS_NOT_OPTIONAL")?.tests_covering;
            expect(tc).toContain("tests/test_requirements.py::test_seeded");
        });
        it("15. refuses `bypass_all` as a valid requirement", () => {
            const r = new RequirementsLedger();
            const res = r.add({ text: "Allow workflow YAML to set policy_gate: bypass_all and skip checks.", source_phase: "P3" });
            expect(res.ok).toBe(false);
            expect(res.refusal).toBe("adversarial_bypass_request");
            expect(r.size()).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // PatchMemory (tests 16-19)
    // -----------------------------------------------------------------------
    describe("PatchMemory", () => {
        it("16. stores patch metadata (id, ts, phase, files_changed)", () => {
            const pm = new PatchMemory();
            const p = pm.record({ phase: "P1", files_changed: ["src/a.py", "tests/test_a.py"], reason: "initial" });
            expect(p.patch_id).toMatch(/^PATCH_\d{4}$/);
            expect(p.phase).toBe("P1");
            expect(p.files_changed).toEqual(["src/a.py", "tests/test_a.py"]);
        });
        it("17. links patch to requirements", () => {
            const pm = new PatchMemory();
            const p = pm.record({ phase: "P1", files_changed: ["a.py"], requirement_ids: ["REQ_NO_POLICY_BYPASS", "REQ_TESTS_NOT_OPTIONAL"] });
            expect(p.requirement_ids).toEqual(["REQ_NO_POLICY_BYPASS", "REQ_TESTS_NOT_OPTIONAL"]);
        });
        it("18. records test command and result on the patch", () => {
            const pm = new PatchMemory();
            const p = pm.record({
                phase: "P1", files_changed: ["a.py"],
                tests_run: ["pytest -q"],
                test_result: { exit_code: 0, summary: "1 passed" },
            });
            expect(p.tests_run).toEqual(["pytest -q"]);
            expect(p.test_result?.exit_code).toBe(0);
        });
        it("19. marks rejected patch with reason", () => {
            const pm = new PatchMemory();
            const p = pm.record({ phase: "P3", files_changed: ["evil.yaml"], result: PATCH_RESULT.GUARD_BLOCKED, rejected_reason: "bypass_all_accepted" });
            expect(p.accepted).toBe(false);
            expect(p.rejected_reason).toBe("bypass_all_accepted");
            expect(pm.listRejected()).toHaveLength(1);
        });
    });

    // -----------------------------------------------------------------------
    // TestFailureMemory (tests 20-22)
    // -----------------------------------------------------------------------
    describe("TestFailureMemory", () => {
        it("20. stores failing command + exit + stderr/stdout excerpts", () => {
            const tf = new TestFailureMemory();
            const r = tf.record({
                phase: "P1",
                command: "pytest -q",
                exit_code: 1,
                stdout: "FAILED tests/test_x.py::test_y - AssertionError: 7 != 8",
                stderr: "",
            });
            expect(r.success).toBe(false);
            expect(r.exit_code).toBe(1);
            expect(r.failing_test).toBe("tests/test_x.py::test_y");
            expect(r.root_cause).toMatch(/AssertionError/);
        });
        it("21. extracts failing test name where possible (pytest verbose form)", () => {
            const tf = new TestFailureMemory();
            const r = tf.record({
                phase: "P2",
                command: "pytest -v",
                exit_code: 1,
                stdout: "tests/test_x.py::test_z FAILED",
            });
            expect(r.failing_test).toBe("tests/test_x.py::test_z");
        });
        it("22. lastFailure() returns the most-recent failure (skipping any success)", () => {
            const tf = new TestFailureMemory();
            tf.record({ phase: "P1", command: "pytest -q", exit_code: 1, stdout: "FAILED tests/test_a.py::test_a - AssertionError: nope" });
            tf.record({ phase: "P2", command: "pytest -q", exit_code: 0, stdout: "5 passed" });
            tf.record({ phase: "P3", command: "pytest -q", exit_code: 1, stdout: "FAILED tests/test_b.py::test_b - ValueError: ouch" });
            expect(tf.lastFailure()?.phase).toBe("P3");
        });
    });

    // -----------------------------------------------------------------------
    // ArchitectureMap (tests 23-24)
    // -----------------------------------------------------------------------
    describe("ArchitectureMap", () => {
        it("23. maps modules + public APIs", () => {
            const fs = new ExactFileStateStore();
            const si = new SymbolIndex();
            fs.set("src/policy_engine/policy.py", "class PolicyEngine:\n    pass\n", { phase: "P1" });
            si.indexFile("src/policy_engine/policy.py", "class PolicyEngine:\n    pass\n");
            const am = new ArchitectureMap(fs, si);
            am.rebuild();
            const snap = am.snapshot();
            expect(snap.modules).toContain("src/policy_engine/policy.py");
            expect(snap.public_apis["src/policy_engine/policy.py"][0].name).toBe("PolicyEngine");
        });
        it("24. detects forbidden duplicate public APIs", () => {
            const fs = new ExactFileStateStore();
            const si = new SymbolIndex();
            fs.set("a.py", "class AuditLog:\n    pass\n", { phase: "P1" });
            fs.set("b.py", "class AuditLog:\n    pass\n", { phase: "P1" });
            si.indexFile("a.py", "class AuditLog:\n    pass\n");
            si.indexFile("b.py", "class AuditLog:\n    pass\n");
            const am = new ArchitectureMap(fs, si);
            const dups = am.forbiddenDuplicatePublicApis();
            expect(dups.map(d => d.name)).toContain("AuditLog");
        });
    });

    // -----------------------------------------------------------------------
    // CodingContextBuilder (tests 25-30)
    // -----------------------------------------------------------------------
    describe("CodingContextBuilder", () => {
        function makeBuilder() {
            const m = new CodeWorkspaceMemory();
            m.ingestPatch({ phase: "P1", blocks: [
                { path: "src/policy_engine/policy.py", content: "class PolicyEngine:\n    def evaluate(self):\n        return True\n" },
                { path: "tests/test_policy.py", content: "def test_basic():\n    assert True\n" },
            ]});
            m.recordTestRun({ phase: "P1", command: "pytest -q", exit_code: 1, stdout: "FAILED tests/test_policy.py::test_basic - AssertionError: nope" });
            return m;
        }
        it("25. includes exact file contents (byte-exact)", () => {
            const m = makeBuilder();
            const { text } = m.buildContext({ phase_id: "P2", phase_title: "Add feature", phase_prompt: "Do X" });
            expect(text).toContain("class PolicyEngine:");
            expect(text).toContain("def evaluate(self):");
        });
        it("26. includes symbol index excerpt (forbidden-duplicate names with current locations)", () => {
            const m = makeBuilder();
            const { text } = m.buildContext({ phase_id: "P2", phase_title: "Add feature", phase_prompt: "Do X" });
            expect(text).toMatch(/PolicyEngine:.*src\/policy_engine\/policy\.py/);
        });
        it("27. includes requirements ledger", () => {
            const m = makeBuilder();
            const { text } = m.buildContext({ phase_id: "P2", phase_title: "Add feature", phase_prompt: "Do X" });
            expect(text).toContain("REQ_NO_POLICY_BYPASS");
            expect(text).toContain("REQ_AUDIT_APPEND_ONLY");
            expect(text).toContain("REQ_TESTS_NOT_OPTIONAL");
        });
        it("28. includes most-recent test failure verbatim", () => {
            const m = makeBuilder();
            const { text } = m.buildContext({ phase_id: "P2", phase_title: "Fix it", phase_prompt: "Fix the failure" });
            expect(text).toContain("FAILED tests/test_policy.py::test_basic");
            expect(text).toMatch(/AssertionError/);
        });
        it("29. includes anti-duplication warning + forbidden symbols list", () => {
            const m = makeBuilder();
            const { text } = m.buildContext({ phase_id: "P2", phase_title: "x", phase_prompt: "y" });
            expect(text).toContain("ANTI-DUPLICATION WARNING");
            expect(text).toContain("PolicyEngine");
            expect(text).toContain("AuditLog");
            expect(text).toContain("WorkflowDefinition");
        });
        it("30. reports missing workspace modules if any", () => {
            const builder = new CodingContextBuilder({});
            expect(builder.missingModulesReport().length).toBeGreaterThan(0);
            const m = new CodeWorkspaceMemory();
            expect(m.builder.missingModulesReport()).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // WorkspaceDiffGuard (tests 31-35)
    // -----------------------------------------------------------------------
    describe("WorkspaceDiffGuard", () => {
        it("31. blocks duplicate `PolicyEngine`", () => {
            const fs = new ExactFileStateStore();
            fs.set("src/policy_engine/policy.py", "class PolicyEngine:\n    pass\n", { phase: "P1" });
            const g = new WorkspaceDiffGuard({ fileStore: fs });
            const res = g.inspect([{ path: "src/policy_engine/policy2.py", content: "class PolicyEngine:\n    pass\n" }]);
            expect(res.ok).toBe(false);
            expect(res.risks.some(r => r.type === GUARD_RISK.DUPLICATE_PUBLIC_API && r.names?.includes("PolicyEngine"))).toBe(true);
        });
        it("32. blocks duplicate `AuditLog`", () => {
            const fs = new ExactFileStateStore();
            fs.set("a.py", "class AuditLog:\n    pass\n", { phase: "P1" });
            const g = new WorkspaceDiffGuard({ fileStore: fs });
            const res = g.inspect([{ path: "b.py", content: "class AuditLog:\n    pass\n" }]);
            expect(res.risks.some(r => r.type === GUARD_RISK.DUPLICATE_PUBLIC_API && r.names?.includes("AuditLog"))).toBe(true);
        });
        it("33. detects test file emptied", () => {
            const fs = new ExactFileStateStore();
            fs.set("tests/test_a.py", "def test_a(): assert True\n", { phase: "P1" });
            const g = new WorkspaceDiffGuard({ fileStore: fs });
            const res = g.inspect([{ path: "tests/test_a.py", content: "" }]);
            expect(res.risks.some(r => r.type === GUARD_RISK.TEST_EMPTIED)).toBe(true);
        });
        it("34. detects unsafe YAML `bypass_all` in untrusted workflow", () => {
            const g = new WorkspaceDiffGuard({});
            const res = g.inspect([{ path: "examples/deploy.yaml", content: "policy_gate: bypass_all\nsteps:\n  - run\n" }]);
            expect(res.risks.some(r => r.type === GUARD_RISK.BYPASS_ALL_ACCEPTED)).toBe(true);
        });
        it("35. detects audit append-only invariant break (del entries)", () => {
            const g = new WorkspaceDiffGuard({});
            const res = g.inspect([{
                path: "src/policy_engine/audit.py",
                content: [
                    "class AuditLog:",
                    "    def __init__(self): self._entries = []",
                    "    def reset(self):",
                    "        del self._entries",   // append-only broken
                    "        self._entries = []",
                ].join("\n"),
            }]);
            expect(res.risks.some(r => r.type === GUARD_RISK.AUDIT_APPEND_BROKEN)).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Pipeline integration (tests 36-43)
    // -----------------------------------------------------------------------
    describe("Pipeline integration", () => {
        it("36. coding prompt selects `software_engineer` primary", () => {
            const reg = CapabilityRegistry.fromDirectory(CAPS_DIR);
            const plan = routeCapability("Refactor src/policy_engine/engine.py and add unit tests in tests/test_engine.py.", {}, reg);
            expect(plan.primary_capability).toBe("software_engineer");
        });
        it("37. software_engineer's required modules are NO LONGER missing (all active)", () => {
            const reg = CapabilityRegistry.fromDirectory(CAPS_DIR);
            const plan = routeCapability("Refactor the loader and add tests.", {}, reg);
            expect(plan.primary_capability).toBe("software_engineer");
            expect(plan.missing_required_modules).toEqual([]);
            expect(reg.missingRequiredModules("software_engineer")).toEqual([]);
        });
        it("38. Condition B coding path activates CodeWorkspaceMemory (smoke instantiation)", () => {
            const m = new CodeWorkspaceMemory();
            expect(m.fileStore).toBeDefined();
            expect(m.symbolIndex).toBeDefined();
            expect(m.requirements).toBeDefined();
            expect(m.patches).toBeDefined();
            expect(m.failures).toBeDefined();
            expect(m.architecture).toBeDefined();
            expect(m.builder).toBeDefined();
            expect(m.guard).toBeDefined();
            // Structural requirements seeded at construction:
            expect(m.requirements.size()).toBe(7);
        });
        it("39. buildContext telemetry records exact-files / requirements / failure inclusion", () => {
            const m = new CodeWorkspaceMemory();
            m.ingestPatch({ phase: "P1", blocks: [{ path: "src/a.py", content: "class X: pass\n" }] });
            m.recordTestRun({ phase: "P1", command: "pytest", exit_code: 1, stdout: "FAILED tests/test_a.py::test_a - AssertionError" });
            const { telemetry } = m.buildContext({ phase_id: "P2", phase_title: "x", phase_prompt: "y" });
            expect(telemetry.exact_files_count).toBeGreaterThan(0);
            expect(telemetry.requirements_included).toBe(7);
            expect(telemetry.last_failure_included).toBe(true);
            expect(telemetry.anti_duplication_warning_included).toBe(true);
            expect(telemetry.output_protocol_included).toBe(true);
        });
        it("40. no Level 3 claim in any manifest after this PR", async () => {
            const files = (await fsp.readdir(CAPS_DIR)).filter(f => f.endsWith(".json"));
            for (const f of files) {
                const raw = await fsp.readFile(path.join(CAPS_DIR, f), "utf-8");
                const m = JSON.parse(raw);
                expect(m.level3_claim).not.toBe(true);
            }
        });
        it("41. no Omega manually created in workspace code (grep-asserted)", async () => {
            const file = path.join(ORCHESTRATOR_ROOT, "scripts", "lib", "code-workspace", "code-workspace-memory.mjs");
            const src = await fsp.readFile(file, "utf-8");
            // Sanity: no manual OmegaRegistry.register or OmegaRecord( instantiation.
            expect(/OmegaRegistry\.register\(/.test(src)).toBe(false);
            expect(/new\s+OmegaRecord\(/.test(src)).toBe(false);
        });
        it("42. theta_s remains 0.28 in the canonical source", async () => {
            const file = path.join(ORCHESTRATOR_ROOT, "scripts", "byon-coagulation-harness.mjs");
            const src = await fsp.readFile(file, "utf-8");
            expect(/const\s+theta_s\s*=\s*0\.28\b/.test(src)).toBe(true);
        });
        it("43. tau_coag remains 12 in the canonical source", async () => {
            const file = path.join(ORCHESTRATOR_ROOT, "scripts", "byon-coagulation-harness.mjs");
            const src = await fsp.readFile(file, "utf-8");
            expect(/const\s+tau_coag\s*=\s*12\b/.test(src)).toBe(true);
        });
    });
});
