/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * WFP Sentinel Bridge
 * ====================
 *
 * TypeScript bridge between BYON Orchestrator and WFP Sentinel kernel guard.
 *
 * Architecture:
 *   Auditor signs ExecutionOrder → this bridge generates EXECUTION_INTENT JSON
 *   → C# ByonWfpBridge picks up *.intent.json files from handoff dir
 *   → C# bridge verifies Ed25519 signature and pushes rules to kernel via IOCTL
 *
 * This bridge is OPTIONAL. If sentinel is not installed, all methods gracefully
 * return defaults. The BYON pipeline operates identically with or without sentinel.
 *
 * Safety guarantees:
 *   G1: All intents have TTL (max 3600s) — kernel auto-expires stale rules
 *   G2: Human freeze always wins — freeze command bypasses all intents
 *   G3: Bridge failure = fail-safe deny — no intent = kernel blocks
 *   G4: Zero mandatory dependency — pipeline runs without sentinel
 */

import { readFile, writeFile, readdir, mkdir, unlink, stat } from "fs/promises";
import { join } from "path";
import { randomUUID, createHmac } from "crypto";
import { sign } from "@noble/ed25519";
import type {
    ExecutionIntent,
    NetworkPermission,
    SentinelStatus,
    SentinelConfig,
    SentinelEvent,
    AppProfile,
    IntentStats,
    SentinelMode,
    DetectionModules,
    EssentialService,
    IpcAuthentication,
} from "./sentinel-types.js";
import { DEFAULT_ESSENTIAL_SERVICES } from "./sentinel-types.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface SentinelBridgeConfig {
    /** Path to handoff directory root */
    handoffPath: string;
    /** Path to auditor's Ed25519 private key (hex) */
    privateKeyHex?: string;
    /** Path to auditor's Ed25519 public key (hex) */
    publicKeyHex?: string;
    /** Default intent TTL in seconds (default: 300 = 5 minutes) */
    defaultTtlSeconds?: number;
    /** Maximum intent TTL in seconds (hard cap: 3600 = 1 hour) */
    maxTtlSeconds?: number;
    /** Enable polling for sentinel status changes */
    enableStatusPolling?: boolean;
    /** Polling interval in ms (default: 10000) */
    pollingIntervalMs?: number;
    /**
     * HMAC-SHA256 shared secret (hex) for IPC authentication.
     * Prevents spoofing on the named pipe between TS bridge and C# bridge.
     * If not provided, IPC authentication is disabled (intent files are unsigned).
     */
    ipcHmacSecret?: string;
    /** Custom essential services list (overrides defaults) */
    essentialServices?: EssentialService[];
}

const MAX_TTL_SECONDS = 3600; // Hard cap: 1 hour
const DEFAULT_TTL_SECONDS = 300; // 5 minutes

// ============================================================================
// SENTINEL BRIDGE
// ============================================================================

export class SentinelBridge {
    private readonly handoffPath: string;
    private readonly sentinelDir: string;
    private readonly intentDir: string;
    private readonly eventsDir: string;
    private privateKeyHex: string | undefined;
    private publicKeyHex: string | undefined;
    private readonly defaultTtl: number;
    private readonly maxTtl: number;
    private pollingTimer: ReturnType<typeof setInterval> | null = null;
    private _lastStatus: SentinelStatus | null = null;
    private _installed: boolean | null = null;
    private readonly ipcHmacSecret: string | undefined;
    private ipcSequence: number = 0;
    private readonly essentialServices: EssentialService[];

    constructor(config: SentinelBridgeConfig) {
        this.handoffPath = config.handoffPath;
        this.sentinelDir = join(config.handoffPath, "sentinel");
        this.intentDir = join(config.handoffPath, "auditor_to_executor");
        this.eventsDir = join(this.sentinelDir, "events");
        this.privateKeyHex = config.privateKeyHex;
        this.publicKeyHex = config.publicKeyHex;
        this.defaultTtl = Math.min(config.defaultTtlSeconds ?? DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS);
        this.maxTtl = Math.min(config.maxTtlSeconds ?? MAX_TTL_SECONDS, MAX_TTL_SECONDS);
        this.ipcHmacSecret = config.ipcHmacSecret;
        this.essentialServices = config.essentialServices ?? DEFAULT_ESSENTIAL_SERVICES;

        if (config.enableStatusPolling) {
            this.startPolling(config.pollingIntervalMs ?? 10_000);
        }
    }

    // ========================================================================
    // LIFECYCLE
    // ========================================================================

    /** Initialize sentinel directories if they don't exist */
    async initialize(): Promise<void> {
        await mkdir(this.sentinelDir, { recursive: true });
        await mkdir(this.eventsDir, { recursive: true });
    }

    /** Stop polling and clean up */
    destroy(): void {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
        }
    }

    /** Load signing keys from files */
    async loadKeys(privateKeyPath: string, publicKeyPath: string): Promise<void> {
        const [privRaw, pubRaw] = await Promise.all([
            readFile(privateKeyPath, "utf8"),
            readFile(publicKeyPath, "utf8"),
        ]);
        this.privateKeyHex = privRaw.trim();
        this.publicKeyHex = pubRaw.trim();
    }

    // ========================================================================
    // STATUS
    // ========================================================================

    /** Check if WFP Sentinel is installed (status file exists) */
    async isInstalled(): Promise<boolean> {
        if (this._installed !== null) {return this._installed;}
        try {
            await stat(join(this.sentinelDir, "status.json"));
            this._installed = true;
            return true;
        } catch {
            this._installed = false;
            return false;
        }
    }

    /** Get current sentinel status */
    async getStatus(): Promise<SentinelStatus> {
        try {
            const raw = await readFile(join(this.sentinelDir, "status.json"), "utf8");
            const status: SentinelStatus = JSON.parse(raw);
            this._lastStatus = status;
            return status;
        } catch {
            return {
                installed: false,
                active: false,
                mode: "offline",
                frozen: false,
                stats: { connections: 0, allowed: 0, blocked: 0, anomalies: 0, appsTracked: 0, activeIntents: 0 },
                lastUpdate: null,
            };
        }
    }

    /** Get cached status (non-async, for quick checks) */
    get lastStatus(): SentinelStatus | null {
        return this._lastStatus;
    }

    /** Check if sentinel is currently frozen */
    async isFrozen(): Promise<boolean> {
        const status = await this.getStatus();
        return status.frozen;
    }

    // ========================================================================
    // INTENT GENERATION
    // ========================================================================

    /**
     * Generate and write an EXECUTION_INTENT file for the C# bridge to pick up.
     *
     * @param orderId - The ExecutionOrder ID this intent is linked to
     * @param action - Action description (e.g. "api_call", "http_fetch")
     * @param permissions - Network permissions to authorize
     * @param ttlSeconds - Time-to-live (capped at maxTtl)
     * @returns The intent ID, or null if sentinel is not installed or frozen
     */
    async generateIntent(
        orderId: string,
        action: string,
        permissions: NetworkPermission[],
        ttlSeconds?: number,
    ): Promise<string | null> {
        // Safety check: don't generate intents if sentinel is frozen
        const status = await this.getStatus();
        if (status.frozen) {
            console.warn("[Sentinel] System is FROZEN — intent generation blocked");
            return null;
        }

        // If sentinel is not installed, skip silently (no-op)
        if (!status.installed && !status.active) {
            return null;
        }

        if (!this.privateKeyHex || !this.publicKeyHex) {
            console.error("[Sentinel] No signing keys loaded — cannot generate intent");
            return null;
        }

        const intentId = randomUUID();
        const now = Math.floor(Date.now() / 1000);
        const ttl = Math.min(ttlSeconds ?? this.defaultTtl, this.maxTtl);
        const expiresAt = now + ttl;

        // Sign: IntentId|OrderId|Action|Timestamp|ExpiresAt
        const signedData = `${intentId}|${orderId}|${action}|${now}|${expiresAt}`;
        const signedDataBytes = new TextEncoder().encode(signedData);
        const privateKeyBytes = hexToBytes(this.privateKeyHex);

        let signatureBase64: string;
        try {
            const signResult = sign(signedDataBytes, privateKeyBytes);
            const signatureBytes = signResult instanceof Promise ? await signResult : signResult;
            signatureBase64 = Buffer.from(signatureBytes).toString("base64");
        } catch (err) {
            console.error("[Sentinel] Failed to sign intent:", err);
            return null;
        }

        const intent: ExecutionIntent = {
            intentId,
            orderId,
            action,
            networkPermissions: permissions,
            timestamp: now,
            expiresAt,
            signature: signatureBase64,
            publicKey: Buffer.from(hexToBytes(this.publicKeyHex)).toString("base64"),
        };

        // Add HMAC IPC authentication if secret is configured
        if (this.ipcHmacSecret) {
            intent.ipcAuth = this.computeIpcAuth(intent);
        }

        // Write to handoff directory as *.intent.json
        const filename = `${intentId}.intent.json`;
        const filepath = join(this.intentDir, filename);

        try {
            await writeFile(filepath, JSON.stringify(intent, null, 2), "utf8");
            return intentId;
        } catch (err) {
            console.error("[Sentinel] Failed to write intent file:", err);
            return null;
        }
    }

    /**
     * Revoke an intent by writing a revocation file.
     * The C# bridge picks up *.revoke.json and sends IOCTL_REMOVE_INTENT_RULE.
     */
    async revokeIntent(intentId: string): Promise<boolean> {
        const revocation = {
            command: "revoke",
            intentId,
            timestamp: new Date().toISOString(),
        };

        const filename = `${intentId}.revoke.json`;
        try {
            await writeFile(join(this.intentDir, filename), JSON.stringify(revocation, null, 2), "utf8");
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Revoke all intents for a given order ID.
     * Scans intent directory for matching order IDs.
     */
    async revokeAllForOrder(orderId: string): Promise<number> {
        let revoked = 0;
        try {
            const files = await readdir(this.intentDir);
            for (const f of files.filter(f => f.endsWith(".intent.json"))) {
                try {
                    const raw = await readFile(join(this.intentDir, f), "utf8");
                    const intent: ExecutionIntent = JSON.parse(raw);
                    if (intent.orderId === orderId) {
                        await this.revokeIntent(intent.intentId);
                        revoked++;
                    }
                } catch { /* skip malformed */ }
            }
        } catch { /* directory doesn't exist */ }
        return revoked;
    }

    // ========================================================================
    // EVENTS
    // ========================================================================

    /** Get recent sentinel events */
    async getEvents(limit = 50): Promise<SentinelEvent[]> {
        try {
            const files = await readdir(this.eventsDir);
            const jsonFiles = files.filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit);
            const events: SentinelEvent[] = [];
            for (const f of jsonFiles) {
                try {
                    const raw = await readFile(join(this.eventsDir, f), "utf8");
                    events.push(JSON.parse(raw));
                } catch { /* skip malformed */ }
            }
            return events;
        } catch {
            return [];
        }
    }

    /** Write a sentinel event (used by auditor to log intent generation) */
    async writeEvent(event: Omit<SentinelEvent, "id" | "timestamp">): Promise<void> {
        const fullEvent: SentinelEvent = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            ...event,
        };

        await mkdir(this.eventsDir, { recursive: true });
        const filename = `${Date.now()}-${fullEvent.id.slice(0, 8)}.json`;
        await writeFile(join(this.eventsDir, filename), JSON.stringify(fullEvent, null, 2), "utf8");
    }

    // ========================================================================
    // APP PROFILES
    // ========================================================================

    /** Get application profiles from sentinel */
    async getAppProfiles(): Promise<AppProfile[]> {
        try {
            const raw = await readFile(join(this.sentinelDir, "apps.json"), "utf8");
            return JSON.parse(raw);
        } catch {
            return [];
        }
    }

    // ========================================================================
    // CONFIGURATION
    // ========================================================================

    /** Get current sentinel configuration */
    async getConfig(): Promise<SentinelConfig> {
        try {
            const raw = await readFile(join(this.sentinelDir, "config.json"), "utf8");
            return JSON.parse(raw);
        } catch {
            return {
                mode: "monitor",
                modules: {
                    behavioral: true,
                    fragmergent: true,
                    exfiltration: true,
                    burst: true,
                    reputation: true,
                },
            };
        }
    }

    /** Update sentinel configuration */
    async setConfig(config: Partial<SentinelConfig>): Promise<void> {
        const current = await this.getConfig();
        const merged: SentinelConfig = {
            ...current,
            ...config,
            modules: {
                ...current.modules,
                ...(config.modules ?? {}),
            },
        };

        await mkdir(this.sentinelDir, { recursive: true });
        await writeFile(join(this.sentinelDir, "config.json"), JSON.stringify(merged, null, 2), "utf8");
    }

    /** Set security mode */
    async setMode(mode: SentinelMode): Promise<void> {
        await this.setConfig({ mode });
    }

    /** Toggle a detection module */
    async toggleModule(module: keyof DetectionModules, enabled: boolean): Promise<void> {
        const config = await this.getConfig();
        config.modules[module] = enabled;
        await this.setConfig(config);
    }

    // ========================================================================
    // FREEZE CONTROL
    // ========================================================================

    /**
     * Trigger emergency freeze — blocks ALL network traffic at kernel level.
     * This is the dead-hand mechanism: human can always freeze regardless of agent state.
     */
    async freeze(reason: string, source: string = "orchestrator"): Promise<boolean> {
        try {
            await mkdir(this.sentinelDir, { recursive: true });

            const freezeCommand = {
                command: "freeze",
                timestamp: new Date().toISOString(),
                source,
                reason,
            };
            await writeFile(join(this.sentinelDir, "freeze-command.json"), JSON.stringify(freezeCommand, null, 2), "utf8");

            // Update status
            try {
                const status = await this.getStatus();
                status.frozen = true;
                status.frozenAt = freezeCommand.timestamp;
                status.frozenBy = source;
                await writeFile(join(this.sentinelDir, "status.json"), JSON.stringify(status, null, 2), "utf8");
            } catch { /* ignore status update failure */ }

            // Log event
            await this.writeEvent({
                type: "freeze",
                app: "system",
                message: `Emergency freeze: ${reason}`,
                details: { source },
            });

            return true;
        } catch {
            return false;
        }
    }

    /**
     * Lift emergency freeze — restore normal operation.
     * Only the human (via UI or CLI) should trigger this.
     */
    async unfreeze(source: string = "orchestrator"): Promise<boolean> {
        try {
            const unfreezeCommand = {
                command: "unfreeze",
                timestamp: new Date().toISOString(),
                source,
                reason: "Manual unfreeze",
            };
            await writeFile(join(this.sentinelDir, "freeze-command.json"), JSON.stringify(unfreezeCommand, null, 2), "utf8");

            // Update status
            try {
                const statusRaw = await readFile(join(this.sentinelDir, "status.json"), "utf8");
                const status = JSON.parse(statusRaw);
                status.frozen = false;
                delete status.frozenAt;
                delete status.frozenBy;
                await writeFile(join(this.sentinelDir, "status.json"), JSON.stringify(status, null, 2), "utf8");
            } catch { /* ignore */ }

            await this.writeEvent({
                type: "unfreeze",
                app: "system",
                message: "Freeze lifted — normal operation resumed",
                details: { source },
            });

            return true;
        } catch {
            return false;
        }
    }

    // ========================================================================
    // INTENT STATS
    // ========================================================================

    /** Get intent statistics from sentinel */
    async getIntentStats(): Promise<IntentStats> {
        try {
            const raw = await readFile(join(this.sentinelDir, "intent-stats.json"), "utf8");
            return JSON.parse(raw);
        } catch {
            return {
                activeRules: 0,
                totalRulesAdded: 0,
                totalRulesExpired: 0,
                totalRulesUsed: 0,
                intentAllowed: 0,
                intentBlocked: 0,
                intentExpired: 0,
            };
        }
    }

    // ========================================================================
    // IPC AUTHENTICATION (HMAC-SHA256 anti-spoofing)
    // ========================================================================

    /**
     * Compute HMAC-SHA256 tag for an intent payload.
     * The HMAC covers the full intent JSON (excluding ipcAuth field) plus a
     * monotonic sequence number to prevent replay on the named pipe.
     *
     * The C# bridge must verify this HMAC before pushing rules to the kernel.
     * Without valid HMAC, the C# bridge rejects the intent file.
     */
    private computeIpcAuth(intent: ExecutionIntent): IpcAuthentication {
        if (!this.ipcHmacSecret) {
            throw new Error("IPC HMAC secret not configured");
        }

        const sequence = ++this.ipcSequence;
        const hmacTimestamp = Math.floor(Date.now() / 1000);

        // Serialize intent without ipcAuth field for HMAC computation
        const { ipcAuth: _, ...intentWithoutAuth } = intent;
        const payload = JSON.stringify(intentWithoutAuth) + `|${hmacTimestamp}|${sequence}`;

        const hmac = createHmac("sha256", Buffer.from(this.ipcHmacSecret, "hex"))
            .update(payload)
            .digest("hex");

        return { hmac, hmacTimestamp, hmacSequence: sequence };
    }

    /**
     * Verify HMAC on an intent file (used by tests and the C# bridge equivalent).
     * Returns true if the HMAC is valid.
     */
    verifyIpcAuth(intent: ExecutionIntent): boolean {
        if (!this.ipcHmacSecret || !intent.ipcAuth) {
            return false;
        }

        const { ipcAuth, ...intentWithoutAuth } = intent;
        const payload = JSON.stringify(intentWithoutAuth) + `|${ipcAuth.hmacTimestamp}|${ipcAuth.hmacSequence}`;

        const expected = createHmac("sha256", Buffer.from(this.ipcHmacSecret, "hex"))
            .update(payload)
            .digest("hex");

        return expected === ipcAuth.hmac;
    }

    // ========================================================================
    // ESSENTIAL SERVICES
    // ========================================================================

    /**
     * Get the list of essential services that must remain accessible
     * even during freeze or strict enforce mode.
     */
    getEssentialServices(): EssentialService[] {
        return [...this.essentialServices];
    }

    /**
     * Check if a given connection target is an essential service.
     * Used by the freeze logic to allow critical traffic through.
     */
    isEssentialService(host: string, port: number): boolean {
        return this.essentialServices.some(svc =>
            (svc.host === host || svc.host === "0.0.0.0") &&
            (svc.port === 0 || svc.port === port),
        );
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================

    /**
     * Clean up expired intent files from handoff directory.
     * Called periodically to prevent file buildup.
     */
    async cleanupExpiredIntents(): Promise<number> {
        const now = Math.floor(Date.now() / 1000);
        let cleaned = 0;

        try {
            const files = await readdir(this.intentDir);
            for (const f of files.filter(f => f.endsWith(".intent.json"))) {
                try {
                    const raw = await readFile(join(this.intentDir, f), "utf8");
                    const intent: ExecutionIntent = JSON.parse(raw);
                    if (intent.expiresAt > 0 && intent.expiresAt < now) {
                        await unlink(join(this.intentDir, f));
                        cleaned++;
                    }
                } catch { /* skip */ }
            }
        } catch { /* directory doesn't exist */ }

        return cleaned;
    }

    // ========================================================================
    // POLLING
    // ========================================================================

    private startPolling(intervalMs: number): void {
        this.pollingTimer = setInterval(async () => {
            try {
                await this.getStatus();
                // Invalidate cached installed state
                this._installed = null;
            } catch { /* ignore polling errors */ }
        }, intervalMs);
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a SentinelBridge instance.
 * Returns a bridge that gracefully no-ops if sentinel is not installed.
 */
export function createSentinelBridge(config: SentinelBridgeConfig): SentinelBridge {
    return new SentinelBridge(config);
}

// ============================================================================
// HELPERS
// ============================================================================

/** Convert hex string to Uint8Array */
function hexToBytes(hex: string): Uint8Array {
    const clean = hex.replace(/\s/g, "");
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

/**
 * Extract network permissions from an ExecutionOrder's actions.
 * This is a heuristic mapper — it identifies actions that imply network access
 * (HTTP requests, API calls, git operations, etc.) and generates corresponding
 * NetworkPermission entries.
 */
export function extractNetworkPermissions(
    actions: Array<{ type: string; target?: string; args?: Record<string, unknown> }>,
): NetworkPermission[] {
    const permissions: NetworkPermission[] = [];

    for (const action of actions) {
        const actionType = action.type?.toLowerCase() ?? "";
        const target = (action.target ?? "");

        // HTTP/API calls
        if (actionType.includes("http") || actionType.includes("api") || actionType.includes("fetch")) {
            try {
                const url = new URL(target);
                permissions.push({
                    protocol: "tcp",
                    host: url.hostname,
                    port: parseInt(url.port) || (url.protocol === "https:" ? 443 : 80),
                    direction: "outbound",
                    ruleType: "domain",
                });
            } catch {
                // If not a valid URL, try to extract host:port
                const match = target.match(/^([^:]+):(\d+)/);
                if (match) {
                    permissions.push({
                        protocol: "tcp",
                        host: match[1],
                        port: parseInt(match[2]),
                        direction: "outbound",
                        ruleType: "domain",
                    });
                }
            }
        }

        // Git operations
        if (actionType.includes("git")) {
            // Git uses HTTPS (443) or SSH (22)
            permissions.push(
                { protocol: "tcp", host: "github.com", port: 443, direction: "outbound", ruleType: "domain" },
                { protocol: "tcp", host: "github.com", port: 22, direction: "outbound", ruleType: "domain" },
                { protocol: "tcp", host: "gitlab.com", port: 443, direction: "outbound", ruleType: "domain" },
            );
        }

        // Package manager operations
        if (actionType.includes("npm") || actionType.includes("pip") || actionType.includes("install")) {
            permissions.push(
                { protocol: "tcp", host: "registry.npmjs.org", port: 443, direction: "outbound", ruleType: "domain" },
                { protocol: "tcp", host: "pypi.org", port: 443, direction: "outbound", ruleType: "domain" },
            );
        }

        // DNS (always needed for domain resolution)
        if (permissions.some(p => p.ruleType === "domain")) {
            const hasDns = permissions.some(p => p.port === 53);
            if (!hasDns) {
                permissions.push(
                    { protocol: "udp", host: "0.0.0.0", port: 53, direction: "outbound", ruleType: "port_only" },
                );
            }
        }
    }

    // Deduplicate
    const seen = new Set<string>();
    return permissions.filter(p => {
        const key = `${p.protocol}:${p.host}:${p.port}:${p.direction}`;
        if (seen.has(key)) {return false;}
        seen.add(key);
        return true;
    });
}
