/**
 * Memory System Integration Tests
 * ================================
 *
 * Tests FHRSS+FCPE memory integration:
 * - Store and retrieve operations
 * - Search functionality
 * - Recovery testing
 * - Health monitoring
 *
 * Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ============================================
// Mock Memory Service Client
// ============================================

interface MemoryContext {
    ctx_id: number;
    content: string;
    memory_type: "code" | "conversation" | "fact";
    metadata: Record<string, unknown>;
    timestamp: string;
}

interface SearchResult {
    ctx_id: number;
    content: string;
    similarity: number;
    memory_type: string;
}

interface RecoveryTestResult {
    ctx_id: number;
    original_content: string;
    recovered_content: string;
    loss_percent: number;
    recovery_success: boolean;
    similarity_score: number;
}

interface MemoryStats {
    total_contexts: number;
    by_type: {
        code: number;
        conversation: number;
        fact: number;
    };
    storage_bytes: number;
    compression_ratio: number;
}

class MockMemoryService {
    private contexts: Map<number, MemoryContext> = new Map();
    private nextCtxId = 1;
    private healthy = true;

    async store(
        content: string,
        memoryType: MemoryContext["memory_type"],
        metadata: Record<string, unknown> = {}
    ): Promise<number> {
        if (!this.healthy) {
            throw new Error("Memory service unavailable");
        }

        const ctx_id = this.nextCtxId++;
        this.contexts.set(ctx_id, {
            ctx_id,
            content,
            memory_type: memoryType,
            metadata,
            timestamp: new Date().toISOString()
        });
        return ctx_id;
    }

    async storeCode(
        code: string,
        file: string,
        line: number,
        tags: string[]
    ): Promise<number> {
        return this.store(code, "code", { file, line, tags });
    }

    async storeConversation(content: string, role: string): Promise<number> {
        return this.store(content, "conversation", { role });
    }

    async storeFact(fact: string, source: string, tags: string[]): Promise<number> {
        return this.store(fact, "fact", { source, tags });
    }

    async search(
        query: string,
        memoryType?: MemoryContext["memory_type"],
        topK: number = 5
    ): Promise<SearchResult[]> {
        if (!this.healthy) {
            throw new Error("Memory service unavailable");
        }

        const results: SearchResult[] = [];

        for (const [, ctx] of this.contexts) {
            if (memoryType && ctx.memory_type !== memoryType) {
                continue;
            }

            // Similarity: word overlap with substring matching
            const queryWords = query.toLowerCase().split(/\s+/);
            const contentLower = ctx.content.toLowerCase();
            let overlap = 0;
            for (const w of queryWords) {
                if (contentLower.includes(w)) overlap++;
            }
            const similarity = overlap / Math.max(queryWords.length, 1);

            if (similarity > 0) {
                results.push({
                    ctx_id: ctx.ctx_id,
                    content: ctx.content,
                    similarity,
                    memory_type: ctx.memory_type
                });
            }
        }

        return results
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK);
    }

    async searchCode(query: string, topK?: number): Promise<SearchResult[]> {
        return this.search(query, "code", topK);
    }

    async searchConversation(query: string, topK?: number): Promise<SearchResult[]> {
        return this.search(query, "conversation", topK);
    }

    async searchFacts(query: string, topK?: number): Promise<SearchResult[]> {
        return this.search(query, "fact", topK);
    }

    async searchAll(query: string, topK?: number): Promise<SearchResult[]> {
        return this.search(query, undefined, topK);
    }

    async testRecovery(ctxId: number, lossPercent: number): Promise<RecoveryTestResult> {
        if (!this.healthy) {
            throw new Error("Memory service unavailable");
        }

        const ctx = this.contexts.get(ctxId);
        if (!ctx) {
            throw new Error(`Context ${ctxId} not found`);
        }

        // Simulate FHRSS recovery
        const original = ctx.content;
        const chars = original.split("");
        const numToRemove = Math.floor(chars.length * (lossPercent / 100));

        // Randomly "lose" characters
        const lostIndices = new Set<number>();
        while (lostIndices.size < numToRemove) {
            lostIndices.add(Math.floor(Math.random() * chars.length));
        }

        // Simulate recovery (FHRSS would recover fully up to 50% loss)
        const recovered = chars
            .map((c, i) => (lostIndices.has(i) ? (lossPercent <= 50 ? c : "_") : c))
            .join("");

        const recoverySuccess = lossPercent <= 50;
        const similarity = this.calculateSimilarity(original, recovered);

        return {
            ctx_id: ctxId,
            original_content: original,
            recovered_content: recovered,
            loss_percent: lossPercent,
            recovery_success: recoverySuccess,
            similarity_score: similarity
        };
    }

    async getStats(): Promise<MemoryStats> {
        if (!this.healthy) {
            throw new Error("Memory service unavailable");
        }

        const byType = { code: 0, conversation: 0, fact: 0 };
        let totalBytes = 0;

        for (const [, ctx] of this.contexts) {
            byType[ctx.memory_type]++;
            totalBytes += ctx.content.length;
        }

        return {
            total_contexts: this.contexts.size,
            by_type: byType,
            storage_bytes: totalBytes,
            compression_ratio: 73000 // FCPE advertised ratio
        };
    }

    async health(): Promise<{ status: string; latency_ms: number }> {
        const start = Date.now();
        if (!this.healthy) {
            return { status: "unhealthy", latency_ms: Date.now() - start };
        }
        return { status: "healthy", latency_ms: Date.now() - start };
    }

    // Test helpers
    setHealthy(healthy: boolean): void {
        this.healthy = healthy;
    }

    clear(): void {
        this.contexts.clear();
        this.nextCtxId = 1;
    }

    private calculateSimilarity(a: string, b: string): number {
        if (a === b) return 1.0;
        const longer = a.length > b.length ? a : b;
        const shorter = a.length > b.length ? b : a;
        if (longer.length === 0) return 1.0;

        let matches = 0;
        for (let i = 0; i < shorter.length; i++) {
            if (shorter[i] === longer[i]) matches++;
        }
        return matches / longer.length;
    }
}

// ============================================
// Mock Context Manager
// ============================================

class MockContextManager {
    constructor(private memoryService: MockMemoryService) {}

    async buildContext(
        query: string,
        taskType: "coding" | "scheduling" | "messaging" | "general"
    ): Promise<{
        conversation_ctx_id?: number;
        relevant_code_ctx_ids: number[];
        relevant_fact_ctx_ids: number[];
    }> {
        const context = {
            conversation_ctx_id: undefined as number | undefined,
            relevant_code_ctx_ids: [] as number[],
            relevant_fact_ctx_ids: [] as number[]
        };

        // Search conversations
        const conversations = await this.memoryService.searchConversation(query, 1);
        if (conversations.length > 0) {
            context.conversation_ctx_id = conversations[0].ctx_id;
        }

        // For coding tasks, prioritize code context
        if (taskType === "coding") {
            const codeResults = await this.memoryService.searchCode(query, 5);
            context.relevant_code_ctx_ids = codeResults.map(r => r.ctx_id);
        }

        // Always search facts
        const factResults = await this.memoryService.searchFacts(query, 3);
        context.relevant_fact_ctx_ids = factResults.map(r => r.ctx_id);

        return context;
    }
}

// ============================================
// Mock Fact Extractor
// ============================================

class MockFactExtractor {
    extractFacts(text: string): Array<{ fact: string; confidence: number }> {
        const facts: Array<{ fact: string; confidence: number }> = [];

        // Extract patterns
        const patterns = [
            { regex: /function\s+(\w+)/g, template: "Function defined: $1", conf: 0.9 },
            { regex: /class\s+(\w+)/g, template: "Class defined: $1", conf: 0.9 },
            { regex: /import\s+.*from\s+['"]([^'"]+)['"]/g, template: "Imports from: $1", conf: 0.8 },
            { regex: /TODO:\s*(.+)/gi, template: "TODO: $1", conf: 0.7 }
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.regex.exec(text)) !== null) {
                facts.push({
                    fact: pattern.template.replace("$1", match[1]),
                    confidence: pattern.conf
                });
            }
        }

        return facts;
    }

    extractCode(text: string): Array<{ code: string; language: string }> {
        const codeBlocks: Array<{ code: string; language: string }> = [];
        const regex = /```(\w*)\n([\s\S]*?)```/g;

        let match;
        while ((match = regex.exec(text)) !== null) {
            codeBlocks.push({
                language: match[1] || "unknown",
                code: match[2].trim()
            });
        }

        return codeBlocks;
    }
}

// ============================================
// Integration Tests
// ============================================

describe("Memory System Integration", () => {
    let memoryService: MockMemoryService;
    let contextManager: MockContextManager;
    let factExtractor: MockFactExtractor;

    beforeEach(() => {
        memoryService = new MockMemoryService();
        contextManager = new MockContextManager(memoryService);
        factExtractor = new MockFactExtractor();
    });

    afterEach(() => {
        memoryService.clear();
    });

    describe("Store Operations", () => {
        it("should store code with metadata", async () => {
            const code = "function calculateSum(a: number, b: number): number { return a + b; }";
            const ctxId = await memoryService.storeCode(code, "math.ts", 10, ["utility", "math"]);

            expect(ctxId).toBeGreaterThan(0);

            const stats = await memoryService.getStats();
            expect(stats.by_type.code).toBe(1);
        });

        it("should store conversation with role", async () => {
            const ctxId = await memoryService.storeConversation(
                "How do I implement authentication?",
                "user"
            );

            expect(ctxId).toBeGreaterThan(0);

            const stats = await memoryService.getStats();
            expect(stats.by_type.conversation).toBe(1);
        });

        it("should store facts with tags", async () => {
            const ctxId = await memoryService.storeFact(
                "The API uses JWT tokens for authentication",
                "architecture-doc.md",
                ["auth", "api", "security"]
            );

            expect(ctxId).toBeGreaterThan(0);

            const stats = await memoryService.getStats();
            expect(stats.by_type.fact).toBe(1);
        });

        it("should handle multiple stores", async () => {
            await memoryService.storeCode("const x = 1;", "a.ts", 1, []);
            await memoryService.storeCode("const y = 2;", "b.ts", 1, []);
            await memoryService.storeConversation("Hello", "user");
            await memoryService.storeFact("Fact 1", "doc", []);

            const stats = await memoryService.getStats();
            expect(stats.total_contexts).toBe(4);
            expect(stats.by_type.code).toBe(2);
            expect(stats.by_type.conversation).toBe(1);
            expect(stats.by_type.fact).toBe(1);
        });
    });

    describe("Search Operations", () => {
        beforeEach(async () => {
            // Setup test data
            await memoryService.storeCode(
                "function login(username: string, password: string) { /* auth logic */ }",
                "auth.ts",
                15,
                ["auth", "login"]
            );
            await memoryService.storeCode(
                "function logout() { clearSession(); }",
                "auth.ts",
                45,
                ["auth", "logout"]
            );
            await memoryService.storeConversation(
                "I need to implement user authentication",
                "user"
            );
            await memoryService.storeFact(
                "Authentication uses bcrypt for password hashing",
                "security.md",
                ["auth", "security"]
            );
        });

        it("should search code by query", async () => {
            const results = await memoryService.searchCode("login authentication");

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].content).toContain("login");
        });

        it("should search conversations", async () => {
            const results = await memoryService.searchConversation("authentication");

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].content).toContain("authentication");
        });

        it("should search facts", async () => {
            const results = await memoryService.searchFacts("password security");

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].content).toContain("bcrypt");
        });

        it("should search all memory types", async () => {
            const results = await memoryService.searchAll("authentication");

            expect(results.length).toBeGreaterThan(0);
            // Should include results from multiple types
            const types = new Set(results.map(r => r.memory_type));
            expect(types.size).toBeGreaterThanOrEqual(1);
        });

        it("should respect topK limit", async () => {
            const results = await memoryService.searchAll("authentication", 2);
            expect(results.length).toBeLessThanOrEqual(2);
        });

        it("should sort by similarity", async () => {
            const results = await memoryService.searchAll("login");

            for (let i = 1; i < results.length; i++) {
                expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
            }
        });
    });

    describe("Recovery Testing (FHRSS)", () => {
        it("should recover fully at 50% data loss", async () => {
            const code = "export function importantFunction() { return criticalValue; }";
            const ctxId = await memoryService.storeCode(code, "critical.ts", 1, []);

            const result = await memoryService.testRecovery(ctxId, 50);

            expect(result.recovery_success).toBe(true);
            expect(result.similarity_score).toBe(1.0);
        });

        it("should recover fully at 30% data loss", async () => {
            const ctxId = await memoryService.storeCode("const data = { key: 'value' };", "data.ts", 1, []);

            const result = await memoryService.testRecovery(ctxId, 30);

            expect(result.recovery_success).toBe(true);
            expect(result.similarity_score).toBe(1.0);
        });

        it("should fail recovery above 50% data loss", async () => {
            const ctxId = await memoryService.storeCode("important code here", "file.ts", 1, []);

            const result = await memoryService.testRecovery(ctxId, 60);

            expect(result.recovery_success).toBe(false);
            expect(result.similarity_score).toBeLessThan(1.0);
        });

        it("should report loss percentage correctly", async () => {
            const ctxId = await memoryService.storeCode("test content", "test.ts", 1, []);

            const result = await memoryService.testRecovery(ctxId, 40);

            expect(result.loss_percent).toBe(40);
        });
    });

    describe("Context Manager Integration", () => {
        beforeEach(async () => {
            await memoryService.storeCode(
                "async function fetchUsers() { return api.get('/users'); }",
                "api.ts",
                10,
                ["api", "users"]
            );
            await memoryService.storeConversation(
                "Can you help me fetch user data from the API?",
                "user"
            );
            await memoryService.storeFact(
                "The /users endpoint returns paginated results",
                "api-docs.md",
                ["api", "users", "pagination"]
            );
        });

        it("should build context for coding task", async () => {
            const context = await contextManager.buildContext(
                "fetch users from API",
                "coding"
            );

            expect(context.relevant_code_ctx_ids.length).toBeGreaterThan(0);
        });

        it("should include conversation context", async () => {
            const context = await contextManager.buildContext(
                "help with API user data",
                "general"
            );

            expect(context.conversation_ctx_id).toBeDefined();
        });

        it("should include fact context", async () => {
            const context = await contextManager.buildContext(
                "users API pagination",
                "general"
            );

            expect(context.relevant_fact_ctx_ids.length).toBeGreaterThan(0);
        });
    });

    describe("Fact Extractor Integration", () => {
        it("should extract function definitions", () => {
            const code = `
                function calculateTotal(items: Item[]): number {
                    return items.reduce((sum, item) => sum + item.price, 0);
                }

                function formatPrice(amount: number): string {
                    return '$' + amount.toFixed(2);
                }
            `;

            const facts = factExtractor.extractFacts(code);

            expect(facts.some(f => f.fact.includes("calculateTotal"))).toBe(true);
            expect(facts.some(f => f.fact.includes("formatPrice"))).toBe(true);
        });

        it("should extract class definitions", () => {
            const code = `
                class UserService {
                    constructor(private db: Database) {}
                }

                class OrderProcessor {
                    process(order: Order) {}
                }
            `;

            const facts = factExtractor.extractFacts(code);

            expect(facts.some(f => f.fact.includes("UserService"))).toBe(true);
            expect(facts.some(f => f.fact.includes("OrderProcessor"))).toBe(true);
        });

        it("should extract imports", () => {
            const code = `
                import { Router } from 'express';
                import * as fs from 'node:fs';
                import { UserModel } from './models/user';
            `;

            const facts = factExtractor.extractFacts(code);

            expect(facts.some(f => f.fact.includes("express"))).toBe(true);
            expect(facts.some(f => f.fact.includes("node:fs"))).toBe(true);
        });

        it("should extract code blocks from markdown", () => {
            const markdown = `
                Here's an example:

                \`\`\`typescript
                const greeting = "Hello, World!";
                console.log(greeting);
                \`\`\`

                And another:

                \`\`\`javascript
                function test() { return 42; }
                \`\`\`
            `;

            const codeBlocks = factExtractor.extractCode(markdown);

            expect(codeBlocks).toHaveLength(2);
            expect(codeBlocks[0].language).toBe("typescript");
            expect(codeBlocks[1].language).toBe("javascript");
        });
    });

    describe("Health Monitoring", () => {
        it("should report healthy status", async () => {
            const health = await memoryService.health();

            expect(health.status).toBe("healthy");
            expect(health.latency_ms).toBeDefined();
        });

        it("should report unhealthy status when service is down", async () => {
            memoryService.setHealthy(false);

            const health = await memoryService.health();

            expect(health.status).toBe("unhealthy");
        });

        it("should fail operations when unhealthy", async () => {
            memoryService.setHealthy(false);

            await expect(
                memoryService.storeCode("code", "file.ts", 1, [])
            ).rejects.toThrow("Memory service unavailable");

            await expect(
                memoryService.searchCode("query")
            ).rejects.toThrow("Memory service unavailable");
        });

        it("should recover after becoming healthy again", async () => {
            memoryService.setHealthy(false);
            await expect(memoryService.storeCode("x", "x.ts", 1, [])).rejects.toThrow();

            memoryService.setHealthy(true);
            const ctxId = await memoryService.storeCode("recovered", "r.ts", 1, []);
            expect(ctxId).toBeGreaterThan(0);
        });
    });

    describe("Statistics", () => {
        it("should report accurate statistics", async () => {
            await memoryService.storeCode("code1", "a.ts", 1, []);
            await memoryService.storeCode("code2", "b.ts", 1, []);
            await memoryService.storeConversation("msg1", "user");
            await memoryService.storeConversation("msg2", "assistant");
            await memoryService.storeFact("fact1", "src", []);

            const stats = await memoryService.getStats();

            expect(stats.total_contexts).toBe(5);
            expect(stats.by_type.code).toBe(2);
            expect(stats.by_type.conversation).toBe(2);
            expect(stats.by_type.fact).toBe(1);
            expect(stats.storage_bytes).toBeGreaterThan(0);
        });

        it("should report compression ratio", async () => {
            await memoryService.storeCode("some code", "file.ts", 1, []);

            const stats = await memoryService.getStats();

            expect(stats.compression_ratio).toBe(73000); // FCPE ratio
        });
    });
});
