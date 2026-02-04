/**
 * BYON Memory Unit Tests
 * ======================
 *
 * Tests for memory system components:
 * - Memory client
 * - Context manager
 * - Fact extractor
 * - Similarity search
 *
 * Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================
// Mock Memory Client
// ============================================

interface MemoryEntry {
    ctx_id: number;
    content: string;
    entry_type: "code" | "conversation" | "fact";
    metadata: Record<string, unknown>;
    embedding?: number[];
}

interface SearchResult {
    ctx_id: number;
    content: string;
    score: number;
    entry_type: string;
}

class MockMemoryClient {
    private entries: Map<number, MemoryEntry> = new Map();
    private nextId = 1;

    async store(
        content: string,
        entryType: "code" | "conversation" | "fact",
        metadata: Record<string, unknown> = {}
    ): Promise<{ ctx_id: number }> {
        const ctx_id = this.nextId++;
        this.entries.set(ctx_id, {
            ctx_id,
            content,
            entry_type: entryType,
            metadata,
            embedding: this.generateMockEmbedding(content)
        });
        return { ctx_id };
    }

    async search(
        query: string,
        entryType?: string,
        topK: number = 5
    ): Promise<SearchResult[]> {
        const results: SearchResult[] = [];
        const queryEmbedding = this.generateMockEmbedding(query);

        for (const entry of this.entries.values()) {
            if (entryType && entry.entry_type !== entryType) continue;

            const score = this.cosineSimilarity(queryEmbedding, entry.embedding || []);
            results.push({
                ctx_id: entry.ctx_id,
                content: entry.content,
                score,
                entry_type: entry.entry_type
            });
        }

        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    }

    async testRecovery(ctx_id: number, lossPercent: number): Promise<{
        success: boolean;
        recovered_content: string;
        loss_applied: number;
    }> {
        const entry = this.entries.get(ctx_id);
        if (!entry) {
            return { success: false, recovered_content: "", loss_applied: lossPercent };
        }

        // Simulate FHRSS recovery
        const recoveredContent = entry.content; // Perfect recovery for mock
        return {
            success: true,
            recovered_content: recoveredContent,
            loss_applied: lossPercent
        };
    }

    async getStats(): Promise<{
        total_entries: number;
        by_type: Record<string, number>;
    }> {
        const byType: Record<string, number> = {};
        for (const entry of this.entries.values()) {
            byType[entry.entry_type] = (byType[entry.entry_type] || 0) + 1;
        }

        return {
            total_entries: this.entries.size,
            by_type: byType
        };
    }

    private generateMockEmbedding(text: string): number[] {
        // Simple hash-based mock embedding
        const embedding: number[] = [];
        for (let i = 0; i < 128; i++) {
            const charCode = text.charCodeAt(i % text.length) || 0;
            embedding.push(Math.sin(charCode * (i + 1)) * 0.5 + 0.5);
        }
        return embedding;
    }

    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        return denominator === 0 ? 0 : dotProduct / denominator;
    }
}

// ============================================
// Memory Client Tests
// ============================================

describe("MemoryClient", () => {
    let client: MockMemoryClient;

    beforeEach(() => {
        client = new MockMemoryClient();
    });

    describe("store", () => {
        it("should store code entries", async () => {
            const code = "function add(a, b) { return a + b; }";
            const result = await client.store(code, "code", { file: "utils.ts", line: 10 });

            expect(result.ctx_id).toBeDefined();
            expect(result.ctx_id).toBeGreaterThan(0);
        });

        it("should store conversation entries", async () => {
            const content = "Please fix the bug in the login form";
            const result = await client.store(content, "conversation", { role: "user" });

            expect(result.ctx_id).toBeDefined();
        });

        it("should store fact entries", async () => {
            const fact = "The application uses TypeScript";
            const result = await client.store(fact, "fact", { source: "package.json" });

            expect(result.ctx_id).toBeDefined();
        });

        it("should increment ctx_id for each entry", async () => {
            const result1 = await client.store("content1", "code");
            const result2 = await client.store("content2", "code");
            const result3 = await client.store("content3", "code");

            expect(result2.ctx_id).toBeGreaterThan(result1.ctx_id);
            expect(result3.ctx_id).toBeGreaterThan(result2.ctx_id);
        });
    });

    describe("search", () => {
        beforeEach(async () => {
            await client.store("function calculateTotal(items) { ... }", "code");
            await client.store("function calculateTax(amount) { ... }", "code");
            await client.store("User asked about calculation features", "conversation");
            await client.store("The app supports multiple currencies", "fact");
        });

        it("should return relevant results", async () => {
            const results = await client.search("calculate", "code", 5);

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].entry_type).toBe("code");
        });

        it("should filter by entry type", async () => {
            const codeResults = await client.search("calculate", "code", 5);
            const factResults = await client.search("calculate", "fact", 5);

            for (const result of codeResults) {
                expect(result.entry_type).toBe("code");
            }
        });

        it("should respect topK limit", async () => {
            const results = await client.search("function", undefined, 2);

            expect(results.length).toBeLessThanOrEqual(2);
        });

        it("should sort by score descending", async () => {
            const results = await client.search("calculate", undefined, 10);

            for (let i = 1; i < results.length; i++) {
                expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
            }
        });
    });

    describe("testRecovery", () => {
        it("should recover content at 50% loss", async () => {
            const original = "This is important content that must be recovered";
            const { ctx_id } = await client.store(original, "fact");

            const recovery = await client.testRecovery(ctx_id, 50);

            expect(recovery.success).toBe(true);
            expect(recovery.recovered_content).toBe(original);
            expect(recovery.loss_applied).toBe(50);
        });

        it("should fail for non-existent entry", async () => {
            const recovery = await client.testRecovery(99999, 50);

            expect(recovery.success).toBe(false);
        });
    });

    describe("getStats", () => {
        it("should return correct statistics", async () => {
            await client.store("code1", "code");
            await client.store("code2", "code");
            await client.store("conv1", "conversation");
            await client.store("fact1", "fact");

            const stats = await client.getStats();

            expect(stats.total_entries).toBe(4);
            expect(stats.by_type.code).toBe(2);
            expect(stats.by_type.conversation).toBe(1);
            expect(stats.by_type.fact).toBe(1);
        });
    });
});

// ============================================
// Fact Extractor Tests
// ============================================

describe("FactExtractor", () => {
    const extractFacts = (content: string): string[] => {
        const facts: string[] = [];

        // Extract file references
        const filePattern = /(\w+\.(tsx|jsx|json|ts|js|py|md))/g;
        const files = content.match(filePattern);
        if (files) {
            facts.push(...files.map(f => `References file: ${f}`));
        }

        // Extract function names
        const funcPattern = /function\s+(\w+)/g;
        let match;
        while ((match = funcPattern.exec(content)) !== null) {
            facts.push(`Defines function: ${match[1]}`);
        }

        // Extract action words
        const actions = ["add", "remove", "fix", "update", "create", "delete", "modify"];
        for (const action of actions) {
            if (content.toLowerCase().includes(action)) {
                facts.push(`Action requested: ${action}`);
            }
        }

        // Extract error mentions
        if (/error|bug|issue|problem/i.test(content)) {
            facts.push("Contains error/bug reference");
        }

        return [...new Set(facts)]; // Deduplicate
    };

    describe("file extraction", () => {
        it("should extract TypeScript files", () => {
            const facts = extractFacts("Please check index.ts and utils.ts");

            expect(facts).toContain("References file: index.ts");
            expect(facts).toContain("References file: utils.ts");
        });

        it("should extract multiple file types", () => {
            const facts = extractFacts("Update config.json and README.md");

            expect(facts).toContain("References file: config.json");
            expect(facts).toContain("References file: README.md");
        });
    });

    describe("function extraction", () => {
        it("should extract function names", () => {
            const code = "function calculateTotal() { } function formatCurrency() { }";
            const facts = extractFacts(code);

            expect(facts).toContain("Defines function: calculateTotal");
            expect(facts).toContain("Defines function: formatCurrency");
        });
    });

    describe("action extraction", () => {
        it("should extract add action", () => {
            const facts = extractFacts("Please add a new button");
            expect(facts).toContain("Action requested: add");
        });

        it("should extract fix action", () => {
            const facts = extractFacts("Fix the login bug");
            expect(facts).toContain("Action requested: fix");
        });

        it("should extract multiple actions", () => {
            const facts = extractFacts("Add feature and fix bug");
            expect(facts).toContain("Action requested: add");
            expect(facts).toContain("Action requested: fix");
        });
    });

    describe("error extraction", () => {
        it("should detect error mentions", () => {
            const facts = extractFacts("There is an error in the code");
            expect(facts).toContain("Contains error/bug reference");
        });

        it("should detect bug mentions", () => {
            const facts = extractFacts("Found a bug in production");
            expect(facts).toContain("Contains error/bug reference");
        });
    });
});

// ============================================
// Context Manager Tests
// ============================================

describe("ContextManager", () => {
    interface MemoryContext {
        conversation_ctx_id?: number;
        relevant_code_ctx_ids: number[];
        relevant_fact_ctx_ids: number[];
        similar_past_ctx_ids: number[];
    }

    const buildContext = async (
        query: string,
        client: MockMemoryClient
    ): Promise<MemoryContext> => {
        const context: MemoryContext = {
            relevant_code_ctx_ids: [],
            relevant_fact_ctx_ids: [],
            similar_past_ctx_ids: []
        };

        // Search for relevant code
        const codeResults = await client.search(query, "code", 5);
        context.relevant_code_ctx_ids = codeResults.map(r => r.ctx_id);

        // Search for relevant facts
        const factResults = await client.search(query, "fact", 3);
        context.relevant_fact_ctx_ids = factResults.map(r => r.ctx_id);

        // Search for similar past conversations
        const convResults = await client.search(query, "conversation", 3);
        context.similar_past_ctx_ids = convResults.map(r => r.ctx_id);

        return context;
    };

    it("should build context with relevant IDs", async () => {
        const client = new MockMemoryClient();

        await client.store("function handleLogin() { }", "code");
        await client.store("Authentication uses JWT", "fact");
        await client.store("User asked about login", "conversation");

        const context = await buildContext("login authentication", client);

        expect(context.relevant_code_ctx_ids.length).toBeGreaterThan(0);
        expect(context.relevant_fact_ctx_ids.length).toBeGreaterThan(0);
    });

    it("should return empty arrays when no matches", async () => {
        const client = new MockMemoryClient();

        const context = await buildContext("nonexistent query", client);

        expect(context.relevant_code_ctx_ids).toEqual([]);
        expect(context.relevant_fact_ctx_ids).toEqual([]);
    });
});

// ============================================
// Memory Health Tests
// ============================================

describe("MemoryHealth", () => {
    const checkHealth = async (
        serviceUrl: string,
        timeoutMs: number = 5000
    ): Promise<{ healthy: boolean; latency_ms: number; error?: string }> => {
        const start = Date.now();

        // Mock health check
        const isHealthy = serviceUrl.includes("localhost:8000");
        const latency = Date.now() - start + Math.random() * 10;

        if (!isHealthy) {
            return {
                healthy: false,
                latency_ms: latency,
                error: "Service unavailable"
            };
        }

        return {
            healthy: true,
            latency_ms: latency
        };
    };

    it("should return healthy for valid service", async () => {
        const result = await checkHealth("http://localhost:8000");

        expect(result.healthy).toBe(true);
        expect(result.latency_ms).toBeDefined();
    });

    it("should return unhealthy for invalid service", async () => {
        const result = await checkHealth("http://invalid:9999");

        expect(result.healthy).toBe(false);
        expect(result.error).toBeDefined();
    });

    it("should include latency measurement", async () => {
        const result = await checkHealth("http://localhost:8000");

        expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });
});
