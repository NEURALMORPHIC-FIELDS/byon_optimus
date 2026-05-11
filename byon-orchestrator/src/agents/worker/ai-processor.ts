/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Worker AI Processor
 * ===================
 *
 * Integrates Claude AI or Local LLM for intelligent task processing.
 * Generates actual code, analysis, and plans based on user requests.
 */

import Anthropic from "@anthropic-ai/sdk";

// ============================================================================
// TYPES
// ============================================================================

export interface AIProcessorConfig {
    apiKey?: string;
    provider: "anthropic" | "openai_compatible";
    baseUrl?: string;
    model: string;
    maxTokens: number;
    temperature: number;
}

export interface TaskContext {
    taskId: string;
    taskType: "coding" | "analysis" | "planning" | "trading" | "general";
    content: string;
    priority: string;
    memoryContext?: {
        relevantFacts: string[];
        previousTasks: string[];
    };
}

export interface AIResponse {
    success: boolean;
    taskType: string;
    result: {
        content: string;
        code?: string;
        analysis?: Record<string, unknown>;
        plan?: string[];
        files?: { path: string; content: string }[];
    };
    tokens: {
        input: number;
        output: number;
    };
    error?: string;
}

// ============================================================================
// LLM CLIENT INTERFACE
// ============================================================================

interface LLMClient {
    chat(system: string, user: string, maxTokens: number, temperature: number): Promise<{ content: string; inputTokens: number; outputTokens: number }>;
}

class AnthropicClient implements LLMClient {
    private client: Anthropic;
    private model: string;

    constructor(apiKey: string, model: string) {
        this.client = new Anthropic({ apiKey });
        this.model = model;
    }

    async chat(system: string, user: string, maxTokens: number, temperature: number): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
        const response = await this.client.messages.create({
            model: this.model,
            max_tokens: maxTokens,
            temperature: temperature,
            system: system,
            messages: [
                { role: "user", content: user }
            ]
        });

        const textContent = response.content
            .filter(block => block.type === "text")
            .map(block => (block as { type: "text"; text: string }).text)
            .join("\n");

        return {
            content: textContent,
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens
        };
    }
}

class OpenAICompatibleClient implements LLMClient {
    private baseUrl: string;
    private model: string;
    private apiKey: string; // Optional for some local servers

    constructor(baseUrl: string, model: string, apiKey: string = "not-needed") {
        this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
        this.model = model;
        this.apiKey = apiKey;
    }

    async chat(system: string, user: string, maxTokens: number, temperature: number): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
        const payload = {
            model: this.model,
            messages: [
                { role: "system", content: system },
                { role: "user", content: user }
            ],
            max_tokens: maxTokens,
            temperature: temperature,
            stream: false
        };

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`LLM API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json() as any;
        const textContent = data.choices?.[0]?.message?.content || "";

        return {
            content: textContent,
            inputTokens: data.usage?.prompt_tokens || 0,
            outputTokens: data.usage?.completion_tokens || 0
        };
    }
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: AIProcessorConfig = {
    apiKey: process.env["ANTHROPIC_API_KEY"],
    provider: (process.env["LLM_PROVIDER"] as "anthropic" | "openai_compatible") || (process.env["ANTHROPIC_API_KEY"] ? "anthropic" : "openai_compatible"),
    baseUrl: process.env["LLM_BASE_URL"] || "http://localhost:11434/v1",
    model: process.env["LLM_MODEL"] || "claude-sonnet-4-6",
    maxTokens: 4096,
    temperature: 0.3
};

// ============================================================================
// SYSTEM PROMPTS
// ============================================================================

const SYSTEM_PROMPTS: Record<string, string> = {
    coding: `You are an expert software engineer. When given a coding task:
1. Write clean, production-ready code
2. Include proper type hints/annotations
3. Add docstrings/comments where helpful
4. Follow best practices for the language
5. Return ONLY the code, wrapped in appropriate markdown code blocks

Format your response as:
\`\`\`language
// Your code here
\`\`\``,

    analysis: `You are a data analyst. When given data to analyze:
1. Perform the requested calculations
2. Provide clear insights
3. Format numbers appropriately
4. Return structured JSON when appropriate

Format your response as a clear analysis with:
- Summary section
- Key findings
- Recommendations (if applicable)`,

    planning: `You are a technical architect. When asked to create a plan:
1. Break down into clear phases
2. Identify dependencies
3. List required resources
4. Include risk considerations
5. Be specific and actionable

Format your response with:
- Executive Summary
- Architecture Overview
- Implementation Steps
- Security Considerations
- Timeline (relative, not absolute)`,

    trading: `You are a financial data analyst. When working with trading data:
1. Analyze price movements and trends
2. Calculate relevant metrics (returns, volatility, etc.)
3. Present data clearly with proper formatting
4. Include risk warnings where appropriate
5. Never provide financial advice - only factual analysis

Format your response with:
- Current Data Summary
- Calculated Metrics
- Observations (factual only)`,

    general: `You are a helpful AI assistant. Process the user's request thoroughly and provide a clear, well-structured response.`
};

// ============================================================================
// AI PROCESSOR
// ============================================================================

export class AIProcessor {
    private client: LLMClient | null = null;
    private config: AIProcessorConfig;

    constructor(config: Partial<AIProcessorConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };

        if (this.config.provider === "anthropic" && this.config.apiKey) {
            this.client = new AnthropicClient(this.config.apiKey, this.config.model);
            console.log("[AIProcessor] Initialized with Claude API");
        } else if (this.config.provider === "openai_compatible" && this.config.baseUrl) {
            this.client = new OpenAICompatibleClient(this.config.baseUrl, this.config.model);
            console.log(`[AIProcessor] Initialized with OpenAI Compatible API (${this.config.baseUrl})`);
        } else {
            console.warn("[AIProcessor] No valid provider config - AI features disabled");
        }
    }

    /**
     * Check if AI is available
     */
    isAvailable(): boolean {
        return this.client !== null;
    }

    /**
     * Process a task with AI
     */
    async processTask(context: TaskContext): Promise<AIResponse> {
        if (!this.client) {
            return {
                success: false,
                taskType: context.taskType,
                result: { content: "AI processing not available - configured incorrectly" },
                tokens: { input: 0, output: 0 },
                error: "NO_VALID_PROVIDER"
            };
        }

        const systemPrompt = SYSTEM_PROMPTS[context.taskType] || SYSTEM_PROMPTS.general;

        // Build user message with context
        let userMessage = context.content;

        if (context.memoryContext?.relevantFacts?.length) {
            userMessage = `Context from memory:\n${context.memoryContext.relevantFacts.join("\n")}\n\n---\n\nTask:\n${context.content}`;
        }

        try {
            console.log(`[AIProcessor] Processing ${context.taskType} task: ${context.taskId} via ${this.config.provider}`);

            const response = await this.client.chat(
                systemPrompt,
                userMessage,
                this.config.maxTokens,
                this.config.temperature
            );

            // Parse response based on task type
            const result = this.parseResponse(context.taskType, response.content);

            return {
                success: true,
                taskType: context.taskType,
                result,
                tokens: {
                    input: response.inputTokens,
                    output: response.outputTokens
                }
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            console.error(`[AIProcessor] Error processing task: ${errorMessage}`);

            return {
                success: false,
                taskType: context.taskType,
                result: { content: `AI processing failed: ${errorMessage}` },
                tokens: { input: 0, output: 0 },
                error: errorMessage
            };
        }
    }

    /**
     * Parse AI response based on task type
     */
    private parseResponse(taskType: string, content: string): AIResponse["result"] {
        const result: AIResponse["result"] = { content };

        // Extract code blocks
        const codeMatch = content.match(/```(\w+)?\n([\s\S]*?)```/g);
        if (codeMatch) {
            const codes = codeMatch.map(block => {
                const match = block.match(/```(\w+)?\n([\s\S]*?)```/);
                return match ? match[2].trim() : "";
            });
            result.code = codes.join("\n\n");
        }

        // For analysis tasks, try to extract JSON
        if (taskType === "analysis") {
            const jsonMatch = content.match(/```json\n([\s\S]*?)```/);
            if (jsonMatch) {
                try {
                    result.analysis = JSON.parse(jsonMatch[1]);
                } catch {
                    // Keep as string if not valid JSON
                }
            }
        }

        // For planning tasks, extract steps
        if (taskType === "planning") {
            const steps: string[] = [];
            const stepMatches = content.match(/^\d+\.\s+.+$/gm);
            if (stepMatches) {
                result.plan = stepMatches.map(s => s.replace(/^\d+\.\s+/, ""));
            }
        }

        return result;
    }

    /**
     * Detect task type from content
     */
    detectTaskType(content: string): TaskContext["taskType"] {
        const lower = content.toLowerCase();

        if (lower.includes("scrie") && (lower.includes("functie") || lower.includes("cod") || lower.includes("program"))) {
            return "coding";
        }
        if (lower.includes("analizeaza") || lower.includes("calculeaza") || lower.includes("raport")) {
            return "analysis";
        }
        if (lower.includes("plan") || lower.includes("arhitectura") || lower.includes("implementare")) {
            return "planning";
        }
        if (lower.includes("pret") || lower.includes("trading") || lower.includes("crypto") || lower.includes("btc") || lower.includes("eth")) {
            return "trading";
        }

        return "general";
    }

    /**
     * Generate code for a specific language
     */
    async generateCode(language: string, description: string): Promise<AIResponse> {
        return this.processTask({
            taskId: `code_${Date.now()}`,
            taskType: "coding",
            content: `Write ${language} code: ${description}`,
            priority: "high"
        });
    }

    /**
     * Analyze data
     */
    async analyzeData(data: unknown, instructions: string): Promise<AIResponse> {
        return this.processTask({
            taskId: `analysis_${Date.now()}`,
            taskType: "analysis",
            content: `Data: ${JSON.stringify(data)}\n\nInstructions: ${instructions}`,
            priority: "medium"
        });
    }

    /**
     * Generate implementation plan
     */
    async generatePlan(requirements: string): Promise<AIResponse> {
        return this.processTask({
            taskId: `plan_${Date.now()}`,
            taskType: "planning",
            content: requirements,
            priority: "high"
        });
    }
}

// ============================================================================
// TRADING API CLIENT
// ============================================================================

export class TradingAPIClient {
    private baseUrl: string;

    constructor(baseUrl: string = "https://api.coingecko.com/api/v3") {
        this.baseUrl = baseUrl;
    }

    /**
     * Get current price for a cryptocurrency
     */
    async getPrice(coinId: string, currency: string = "usd"): Promise<{ price: number; change24h: number } | null> {
        try {
            const response = await fetch(
                `${this.baseUrl}/simple/price?ids=${coinId}&vs_currencies=${currency}&include_24hr_change=true`
            );

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json() as Record<string, { [key: string]: number }>;

            if (data[coinId]) {
                return {
                    price: data[coinId][currency],
                    change24h: data[coinId][`${currency}_24h_change`] || 0
                };
            }

            return null;
        } catch (error) {
            console.error(`[TradingAPI] Error fetching price: ${error}`);
            return null;
        }
    }

    /**
     * Get market data for multiple coins
     */
    async getMarketData(coinIds: string[], currency: string = "usd"): Promise<unknown[]> {
        try {
            const response = await fetch(
                `${this.baseUrl}/coins/markets?vs_currency=${currency}&ids=${coinIds.join(",")}&order=market_cap_desc`
            );

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            return await response.json() as unknown[];
        } catch (error) {
            console.error(`[TradingAPI] Error fetching market data: ${error}`);
            return [];
        }
    }

    /**
     * Get historical price data
     */
    async getHistoricalPrices(coinId: string, days: number = 7, currency: string = "usd"): Promise<number[][]> {
        try {
            const response = await fetch(
                `${this.baseUrl}/coins/${coinId}/market_chart?vs_currency=${currency}&days=${days}`
            );

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json() as { prices: number[][] };
            return data.prices || [];
        } catch (error) {
            console.error(`[TradingAPI] Error fetching historical data: ${error}`);
            return [];
        }
    }
}

// ============================================================================
// FACTORY
// ============================================================================

let aiProcessorInstance: AIProcessor | null = null;
let tradingClientInstance: TradingAPIClient | null = null;

export function getAIProcessor(): AIProcessor {
    if (!aiProcessorInstance) {
        aiProcessorInstance = new AIProcessor();
    }
    return aiProcessorInstance;
}

export function getTradingClient(): TradingAPIClient {
    if (!tradingClientInstance) {
        tradingClientInstance = new TradingAPIClient();
    }
    return tradingClientInstance;
}
