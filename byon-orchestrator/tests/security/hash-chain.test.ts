/**
 * Hash Chain Integrity Tests
 * ===========================
 *
 * Tests hash chain integrity for audit trail:
 * - Chain initialization
 * - Tamper detection
 * - Verification
 * - State consistency
 *
 * Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as crypto from "node:crypto";

// ============================================
// Hash Chain Implementation
// ============================================

interface ChainBlock {
    index: number;
    timestamp: string;
    data: unknown;
    previousHash: string;
    hash: string;
    nonce?: number;
}

interface VerificationResult {
    valid: boolean;
    error?: string;
    failedIndex?: number;
}

class ImmutableHashChain {
    private chain: ChainBlock[] = [];
    private genesisHash: string;

    constructor() {
        this.genesisHash = this.computeHash("BYON-GENESIS-BLOCK-EP25216372.0");
        this.createGenesisBlock();
    }

    private createGenesisBlock(): void {
        const genesis: ChainBlock = {
            index: 0,
            timestamp: new Date(0).toISOString(),
            data: { type: "genesis", system: "BYON-Optimus" },
            previousHash: "0".repeat(64),
            hash: this.genesisHash
        };
        this.chain.push(genesis);
    }

    addBlock(data: unknown): ChainBlock {
        const previousBlock = this.chain[this.chain.length - 1];
        const index = this.chain.length;
        const timestamp = new Date().toISOString();
        const previousHash = previousBlock.hash;

        const block: ChainBlock = {
            index,
            timestamp,
            data,
            previousHash,
            hash: ""
        };

        block.hash = this.computeBlockHash(block);
        this.chain.push(block);

        return block;
    }

    getBlock(index: number): ChainBlock | undefined {
        return this.chain[index];
    }

    getLatestBlock(): ChainBlock {
        return this.chain[this.chain.length - 1];
    }

    getChainLength(): number {
        return this.chain.length;
    }

    verify(): VerificationResult {
        // Verify genesis block
        if (this.chain[0].hash !== this.genesisHash) {
            return {
                valid: false,
                error: "Genesis block tampered",
                failedIndex: 0
            };
        }

        // Verify each block
        for (let i = 1; i < this.chain.length; i++) {
            const currentBlock = this.chain[i];
            const previousBlock = this.chain[i - 1];

            // Check previous hash reference
            if (currentBlock.previousHash !== previousBlock.hash) {
                return {
                    valid: false,
                    error: "Previous hash mismatch",
                    failedIndex: i
                };
            }

            // Recompute and verify current hash
            const computedHash = this.computeBlockHash(currentBlock);
            if (currentBlock.hash !== computedHash) {
                return {
                    valid: false,
                    error: "Block hash invalid",
                    failedIndex: i
                };
            }
        }

        return { valid: true };
    }

    // Export chain for persistence
    export(): ChainBlock[] {
        return JSON.parse(JSON.stringify(this.chain));
    }

    // Import and verify chain
    import(chain: ChainBlock[]): boolean {
        if (chain.length === 0) {
            return false;
        }

        // Temporarily store and verify
        const originalChain = this.chain;
        this.chain = chain;

        const verification = this.verify();
        if (!verification.valid) {
            this.chain = originalChain;
            return false;
        }

        return true;
    }

    private computeHash(data: string): string {
        return crypto.createHash("sha256").update(data).digest("hex");
    }

    private computeBlockHash(block: Omit<ChainBlock, "hash">): string {
        const blockData = `${block.index}:${block.timestamp}:${JSON.stringify(block.data)}:${block.previousHash}`;
        return this.computeHash(blockData);
    }

    // Intentional tampering methods for testing
    _tamperBlock(index: number, newData: unknown): void {
        if (index > 0 && index < this.chain.length) {
            this.chain[index].data = newData;
        }
    }

    _tamperHash(index: number, newHash: string): void {
        if (index >= 0 && index < this.chain.length) {
            this.chain[index].hash = newHash;
        }
    }

    _insertBlock(index: number, block: ChainBlock): void {
        if (index > 0 && index <= this.chain.length) {
            this.chain.splice(index, 0, block);
        }
    }

    _deleteBlock(index: number): void {
        if (index > 0 && index < this.chain.length) {
            this.chain.splice(index, 1);
        }
    }
}

// ============================================
// Audit Entry Types
// ============================================

interface AuditEntry {
    event_type: "evidence_created" | "plan_created" | "order_signed" | "execution_started" | "execution_completed";
    document_id: string;
    actor: string;
    details: Record<string, unknown>;
}

// ============================================
// Hash Chain Tests
// ============================================

describe("Hash Chain Integrity", () => {
    let chain: ImmutableHashChain;

    beforeEach(() => {
        chain = new ImmutableHashChain();
    });

    describe("Chain Initialization", () => {
        it("should create genesis block", () => {
            expect(chain.getChainLength()).toBe(1);

            const genesis = chain.getBlock(0);
            expect(genesis).toBeDefined();
            expect(genesis!.index).toBe(0);
            expect(genesis!.previousHash).toBe("0".repeat(64));
        });

        it("should have valid genesis hash", () => {
            const result = chain.verify();
            expect(result.valid).toBe(true);
        });
    });

    describe("Block Addition", () => {
        it("should add block with correct links", () => {
            const genesis = chain.getBlock(0)!;
            const data = { event: "test", value: 42 };

            const block = chain.addBlock(data);

            expect(block.index).toBe(1);
            expect(block.previousHash).toBe(genesis.hash);
            expect(block.data).toEqual(data);
            expect(block.hash).toBeTruthy();
        });

        it("should maintain chain integrity after multiple additions", () => {
            for (let i = 0; i < 10; i++) {
                chain.addBlock({ event: `event_${i}`, index: i });
            }

            expect(chain.getChainLength()).toBe(11); // Genesis + 10
            expect(chain.verify().valid).toBe(true);
        });

        it("should link blocks correctly", () => {
            chain.addBlock({ first: true });
            chain.addBlock({ second: true });
            chain.addBlock({ third: true });

            for (let i = 1; i < chain.getChainLength(); i++) {
                const current = chain.getBlock(i)!;
                const previous = chain.getBlock(i - 1)!;
                expect(current.previousHash).toBe(previous.hash);
            }
        });
    });

    describe("Tamper Detection - Data Modification", () => {
        it("should detect modified block data", () => {
            chain.addBlock({ original: true });
            chain.addBlock({ data: "unchanged" });

            // Tamper with first added block
            chain._tamperBlock(1, { original: false, tampered: true });

            const result = chain.verify();
            expect(result.valid).toBe(false);
            expect(result.error).toContain("hash");
            expect(result.failedIndex).toBe(1);
        });

        it("should detect modified nested data", () => {
            chain.addBlock({
                nested: {
                    deep: {
                        value: "original"
                    }
                }
            });

            chain._tamperBlock(1, {
                nested: {
                    deep: {
                        value: "tampered"
                    }
                }
            });

            expect(chain.verify().valid).toBe(false);
        });
    });

    describe("Tamper Detection - Hash Modification", () => {
        it("should detect modified block hash", () => {
            chain.addBlock({ data: 1 });
            chain.addBlock({ data: 2 });

            chain._tamperHash(1, "invalid_hash_0000000000000000");

            const result = chain.verify();
            expect(result.valid).toBe(false);
        });

        it("should detect genesis hash modification", () => {
            chain._tamperHash(0, "tampered_genesis_hash");

            const result = chain.verify();
            expect(result.valid).toBe(false);
            expect(result.error).toContain("Genesis");
        });
    });

    describe("Tamper Detection - Chain Structure", () => {
        it("should detect inserted block", () => {
            chain.addBlock({ order: 1 });
            chain.addBlock({ order: 2 });
            chain.addBlock({ order: 3 });

            // Insert fake block
            const fakeBlock: ChainBlock = {
                index: 2,
                timestamp: new Date().toISOString(),
                data: { fake: true },
                previousHash: chain.getBlock(1)!.hash,
                hash: "fake_hash"
            };

            chain._insertBlock(2, fakeBlock);

            const result = chain.verify();
            expect(result.valid).toBe(false);
        });

        it("should detect deleted block", () => {
            chain.addBlock({ keep: 1 });
            chain.addBlock({ delete: 2 });
            chain.addBlock({ keep: 3 });

            chain._deleteBlock(2);

            const result = chain.verify();
            expect(result.valid).toBe(false);
        });
    });

    describe("Chain Export/Import", () => {
        it("should export chain state", () => {
            chain.addBlock({ data: "test" });
            chain.addBlock({ data: "export" });

            const exported = chain.export();

            expect(exported).toHaveLength(3);
            expect(exported[0].index).toBe(0);
            expect(exported[2].data).toEqual({ data: "export" });
        });

        it("should import valid chain", () => {
            chain.addBlock({ imported: true });
            const exported = chain.export();

            const newChain = new ImmutableHashChain();
            const success = newChain.import(exported);

            expect(success).toBe(true);
            expect(newChain.getChainLength()).toBe(exported.length);
        });

        it("should reject tampered import", () => {
            chain.addBlock({ original: true });
            const exported = chain.export();

            // Tamper with exported data
            exported[1].data = { tampered: true };

            const newChain = new ImmutableHashChain();
            const success = newChain.import(exported);

            expect(success).toBe(false);
            expect(newChain.getChainLength()).toBe(1); // Only genesis
        });

        it("should reject empty chain import", () => {
            const newChain = new ImmutableHashChain();
            const success = newChain.import([]);

            expect(success).toBe(false);
        });
    });
});

describe("Audit Trail Security", () => {
    let chain: ImmutableHashChain;

    beforeEach(() => {
        chain = new ImmutableHashChain();
    });

    describe("Audit Entry Recording", () => {
        it("should record evidence creation", () => {
            const entry: AuditEntry = {
                event_type: "evidence_created",
                document_id: "EV-001",
                actor: "worker",
                details: { task_type: "coding", sources_count: 3 }
            };

            const block = chain.addBlock(entry);

            expect(block.data).toEqual(entry);
            expect(chain.verify().valid).toBe(true);
        });

        it("should record complete workflow", () => {
            const entries: AuditEntry[] = [
                {
                    event_type: "evidence_created",
                    document_id: "EV-001",
                    actor: "worker",
                    details: {}
                },
                {
                    event_type: "plan_created",
                    document_id: "PLAN-001",
                    actor: "worker",
                    details: { based_on: "EV-001" }
                },
                {
                    event_type: "order_signed",
                    document_id: "ORD-001",
                    actor: "auditor",
                    details: { based_on: "PLAN-001", approved_by: "user" }
                },
                {
                    event_type: "execution_started",
                    document_id: "ORD-001",
                    actor: "executor",
                    details: { actions_count: 3 }
                },
                {
                    event_type: "execution_completed",
                    document_id: "RCPT-001",
                    actor: "executor",
                    details: { status: "success", based_on: "ORD-001" }
                }
            ];

            for (const entry of entries) {
                chain.addBlock(entry);
            }

            expect(chain.getChainLength()).toBe(6); // Genesis + 5 entries
            expect(chain.verify().valid).toBe(true);
        });
    });

    describe("Audit Tamper Protection", () => {
        it("should detect altered approval status", () => {
            chain.addBlock({
                event_type: "order_signed",
                document_id: "ORD-001",
                actor: "auditor",
                details: { approved: true, risk_level: "high" }
            });

            // Try to change approval to auto-approved low-risk
            chain._tamperBlock(1, {
                event_type: "order_signed",
                document_id: "ORD-001",
                actor: "system",
                details: { approved: true, risk_level: "low", auto_approved: true }
            });

            expect(chain.verify().valid).toBe(false);
        });

        it("should detect deleted audit entries", () => {
            // Record user rejection
            chain.addBlock({
                event_type: "plan_created",
                document_id: "PLAN-001",
                actor: "worker",
                details: { risk_level: "high" }
            });

            chain.addBlock({
                event_type: "order_signed",
                document_id: "ORD-001",
                actor: "auditor",
                details: { approved: false, rejection_reason: "User rejected" }
            });

            chain.addBlock({
                event_type: "execution_started",
                document_id: "ORD-002",
                actor: "executor",
                details: { actions_count: 1 }
            });

            // Attacker tries to delete rejection (middle block)
            chain._deleteBlock(2);

            expect(chain.verify().valid).toBe(false);
        });

        it("should detect inserted fake approvals", () => {
            chain.addBlock({
                event_type: "evidence_created",
                document_id: "EV-001",
                actor: "worker",
                details: {}
            });

            chain.addBlock({
                event_type: "execution_started",
                document_id: "ORD-FAKE",
                actor: "executor",
                details: { actions_count: 1 }
            });

            // Try to insert fake approval between
            const fakeApproval: ChainBlock = {
                index: 2,
                timestamp: new Date().toISOString(),
                data: {
                    event_type: "order_signed",
                    document_id: "ORD-FAKE",
                    actor: "auditor",
                    details: { approved: true }
                },
                previousHash: chain.getBlock(1)!.hash,
                hash: "fake_hash"
            };

            chain._insertBlock(2, fakeApproval);

            expect(chain.verify().valid).toBe(false);
        });
    });

    describe("Long-term Integrity", () => {
        it("should maintain integrity over many entries", () => {
            // Simulate long audit trail
            for (let i = 0; i < 100; i++) {
                chain.addBlock({
                    event_type: "evidence_created",
                    document_id: `DOC-${i}`,
                    actor: "system",
                    details: { iteration: i, timestamp: Date.now() }
                });
            }

            expect(chain.getChainLength()).toBe(101);
            expect(chain.verify().valid).toBe(true);
        });

        it("should detect tampering in long chain", () => {
            for (let i = 0; i < 50; i++) {
                chain.addBlock({ index: i });
            }

            // Tamper with block in the middle
            chain._tamperBlock(25, { index: 25, tampered: true });

            const result = chain.verify();
            expect(result.valid).toBe(false);
            expect(result.failedIndex).toBe(25);
        });
    });
});
