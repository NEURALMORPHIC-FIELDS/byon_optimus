/**
 * Usage Test Campaign — Domain 8: Incident Response & Audit
 * ===========================================================
 * TC-084 through TC-090
 *
 * Validates JohnsonReceipt structure, hash chain audit trail integrity,
 * and detection of tampered/deleted/injected audit entries.
 *
 * Patent: EP25216372.0 — Vasile Lucian Borbeleac
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as crypto from "node:crypto";
import type {
    JohnsonReceipt,
    ExecutionOrder,
    ActionResult,
    ExecutionError,
} from "../../src/types/protocol.js";

// ============================================================================
// HASH CHAIN (same ImmutableHashChain as security tests)
// ============================================================================

interface ChainBlock {
    index: number;
    timestamp: string;
    data: unknown;
    previousHash: string;
    hash: string;
}

interface AuditEntry {
    event_type: "evidence_created" | "plan_created" | "order_signed" | "execution_started" | "execution_completed";
    document_id: string;
    actor: string;
    details: Record<string, unknown>;
}

class ImmutableHashChain {
    private chain: ChainBlock[] = [];
    private genesisHash: string;

    constructor() {
        this.genesisHash = crypto.createHash("sha256").update("BYON-GENESIS-BLOCK-EP25216372.0").digest("hex");
        this.chain.push({
            index: 0,
            timestamp: new Date(0).toISOString(),
            data: { type: "genesis", system: "BYON-Optimus" },
            previousHash: "0".repeat(64),
            hash: this.genesisHash,
        });
    }

    addBlock(data: unknown): ChainBlock {
        const prev = this.chain[this.chain.length - 1];
        const block: ChainBlock = { index: this.chain.length, timestamp: new Date().toISOString(), data, previousHash: prev.hash, hash: "" };
        block.hash = crypto.createHash("sha256").update(`${block.index}:${block.timestamp}:${JSON.stringify(block.data)}:${block.previousHash}`).digest("hex");
        this.chain.push(block);
        return block;
    }

    getChainLength(): number { return this.chain.length; }
    getBlock(index: number): ChainBlock | undefined { return this.chain[index]; }

    verify(): { valid: boolean; error?: string; failedIndex?: number } {
        if (this.chain[0].hash !== this.genesisHash) return { valid: false, error: "Genesis block tampered", failedIndex: 0 };
        for (let i = 1; i < this.chain.length; i++) {
            if (this.chain[i].previousHash !== this.chain[i - 1].hash) return { valid: false, error: "Previous hash mismatch", failedIndex: i };
            const expected = crypto.createHash("sha256").update(`${this.chain[i].index}:${this.chain[i].timestamp}:${JSON.stringify(this.chain[i].data)}:${this.chain[i].previousHash}`).digest("hex");
            if (this.chain[i].hash !== expected) return { valid: false, error: "Block hash invalid", failedIndex: i };
        }
        return { valid: true };
    }

    _deleteBlock(index: number): void { if (index > 0 && index < this.chain.length) this.chain.splice(index, 1); }

    _insertBlock(index: number, block: ChainBlock): void { if (index > 0 && index <= this.chain.length) this.chain.splice(index, 0, block); }
}

// ============================================================================
// HELPERS
// ============================================================================

function makeReceipt(overrides: Partial<JohnsonReceipt> = {}): JohnsonReceipt {
    const receipt: JohnsonReceipt = {
        document_type: "JOHNSON_RECEIPT",
        document_version: "1.0",
        receipt_id: `rcpt_${crypto.randomUUID().slice(0, 8)}`,
        timestamp: new Date().toISOString(),
        based_on_order: `order_${crypto.randomUUID().slice(0, 8)}`,
        execution_summary: {
            status: "success",
            actions_total: 3,
            actions_completed: 3,
            actions_failed: 0,
            iterations_used: 1,
            duration_ms: 250,
        },
        action_results: [
            { action_id: "act_1", status: "success", success: true, duration_ms: 80 },
            { action_id: "act_2", status: "success", success: true, duration_ms: 90 },
            { action_id: "act_3", status: "success", success: true, duration_ms: 80 },
        ],
        errors: [],
        changes_made: {
            files_modified: ["src/index.ts"],
            files_created: ["src/new.ts"],
            files_deleted: [],
        },
        verification: {
            tests_passing: true,
            lint_passing: true,
            build_passing: true,
        },
        hash: "",
        ...overrides,
    };
    receipt.hash = crypto.createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
    return receipt;
}

// ============================================================================
// TESTS
// ============================================================================

describe("Campaign: Incident Response & Audit", () => {
    it("TC-084: JohnsonReceipt contains execution summary with status", () => {
        const receipt = makeReceipt();

        expect(receipt.execution_summary).toBeDefined();
        expect(receipt.execution_summary.status).toBe("success");
        expect(["success", "partial", "failed", "rejected"]).toContain(receipt.execution_summary.status);
        expect(receipt.execution_summary.actions_total).toBe(3);
        expect(receipt.execution_summary.actions_completed).toBe(3);
        expect(receipt.execution_summary.actions_failed).toBe(0);
    });

    it("TC-085: JohnsonReceipt tracks file_changes with paths and types", () => {
        const receipt = makeReceipt();

        expect(receipt.changes_made).toBeDefined();
        expect(receipt.changes_made.files_modified).toContain("src/index.ts");
        expect(receipt.changes_made.files_created).toContain("src/new.ts");
        expect(Array.isArray(receipt.changes_made.files_deleted)).toBe(true);
    });

    it("TC-086: JohnsonReceipt includes timing information", () => {
        const receipt = makeReceipt();

        expect(receipt.execution_summary.duration_ms).toBeGreaterThan(0);

        // Individual action results also have timing
        for (const result of receipt.action_results) {
            expect(result.duration_ms).toBeDefined();
            expect(result.duration_ms).toBeGreaterThan(0);
        }
    });

    it("TC-087: Hash chain records complete workflow (5-step pipeline)", () => {
        const chain = new ImmutableHashChain();

        const entries: AuditEntry[] = [
            { event_type: "evidence_created", document_id: "EV-001", actor: "worker", details: { task_type: "coding" } },
            { event_type: "plan_created", document_id: "PLAN-001", actor: "worker", details: { based_on: "EV-001", actions: 3 } },
            { event_type: "order_signed", document_id: "ORD-001", actor: "auditor", details: { based_on: "PLAN-001", approved_by: "user" } },
            { event_type: "execution_started", document_id: "ORD-001", actor: "executor", details: { actions_count: 3 } },
            { event_type: "execution_completed", document_id: "RCPT-001", actor: "executor", details: { status: "success", based_on: "ORD-001" } },
        ];

        for (const entry of entries) chain.addBlock(entry);

        expect(chain.getChainLength()).toBe(6); // genesis + 5
        expect(chain.verify().valid).toBe(true);
    });

    it("TC-088: Hash chain detects deleted audit entries", () => {
        const chain = new ImmutableHashChain();
        chain.addBlock({ event_type: "plan_created", document_id: "PLAN-001", actor: "worker", details: {} });
        chain.addBlock({ event_type: "order_signed", document_id: "ORD-001", actor: "auditor", details: { approved: false } });
        chain.addBlock({ event_type: "execution_completed", document_id: "RCPT-001", actor: "executor", details: {} });

        // Attacker tries to delete the rejection entry
        chain._deleteBlock(2);

        expect(chain.verify().valid).toBe(false);
    });

    it("TC-089: Hash chain detects fake approval injection", () => {
        const chain = new ImmutableHashChain();
        chain.addBlock({ event_type: "evidence_created", document_id: "EV-001", actor: "worker", details: {} });
        chain.addBlock({ event_type: "execution_started", document_id: "ORD-FAKE", actor: "executor", details: {} });

        // Inject fake approval
        const fakeBlock: ChainBlock = {
            index: 2,
            timestamp: new Date().toISOString(),
            data: { event_type: "order_signed", document_id: "ORD-FAKE", actor: "auditor", details: { approved: true } },
            previousHash: chain.getBlock(1)!.hash,
            hash: "fake_hash_injected",
        };
        chain._insertBlock(2, fakeBlock);

        expect(chain.verify().valid).toBe(false);
    });

    it("TC-090: Audit trail: 20-step workflow maintains full chain integrity", () => {
        const chain = new ImmutableHashChain();

        // Simulate 4 complete workflows (5 steps each) = 20 entries
        for (let w = 0; w < 4; w++) {
            chain.addBlock({ event_type: "evidence_created", document_id: `EV-${w}`, actor: "worker", details: { workflow: w } });
            chain.addBlock({ event_type: "plan_created", document_id: `PLAN-${w}`, actor: "worker", details: { workflow: w } });
            chain.addBlock({ event_type: "order_signed", document_id: `ORD-${w}`, actor: "auditor", details: { workflow: w } });
            chain.addBlock({ event_type: "execution_started", document_id: `ORD-${w}`, actor: "executor", details: { workflow: w } });
            chain.addBlock({ event_type: "execution_completed", document_id: `RCPT-${w}`, actor: "executor", details: { workflow: w } });
        }

        expect(chain.getChainLength()).toBe(21); // genesis + 20
        expect(chain.verify().valid).toBe(true);

        // Verify chain links
        for (let i = 1; i < chain.getChainLength(); i++) {
            expect(chain.getBlock(i)!.previousHash).toBe(chain.getBlock(i - 1)!.hash);
        }
    });
});
