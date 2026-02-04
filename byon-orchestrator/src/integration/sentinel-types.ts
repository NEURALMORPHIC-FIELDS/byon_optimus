/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * WFP Sentinel Types
 * ==================
 *
 * TypeScript type definitions mirroring the WFP kernel driver structures.
 * These types are used by the sentinel bridge to generate EXECUTION_INTENT
 * files that the C# usermode bridge (ByonWfpBridge) picks up and pushes
 * to the kernel driver via IOCTLs.
 *
 * Kernel reference: WFP-Semantic-Guard/wfp_guard_common.h
 * Bridge reference: WFP-Semantic-Guard/byon-integration/ByonWfpBridge.cs
 */

// ============================================================================
// INTENT RULE TYPES
// ============================================================================

/** Maps to WFP_INTENT_RULE_TYPE enum in kernel */
export type IntentRuleType =
    | "exact_ip"        // INTENT_TYPE_EXACT_IP (0) — exact IP:port match
    | "ip_range"        // INTENT_TYPE_IP_RANGE (1) — CIDR-like range
    | "port_only"       // INTENT_TYPE_PORT_ONLY (2) — any IP, specific port
    | "domain"          // INTENT_TYPE_DOMAIN (3) — hostname resolved to IPs
    | "wildcard";       // INTENT_TYPE_WILDCARD (4) — e.g. *.example.com

/** Network protocol */
export type IntentProtocol = "tcp" | "udp" | "any";

/** Traffic direction */
export type IntentDirection = "outbound" | "inbound" | "both";

// ============================================================================
// EXECUTION INTENT (JSON file format)
// ============================================================================

/**
 * Network permission entry within an execution intent.
 * Maps to NetworkPermission in ByonWfpBridge.cs.
 */
export interface NetworkPermission {
    /** Protocol: tcp, udp */
    protocol: IntentProtocol;
    /** Target host: IP address or hostname */
    host: string;
    /** Destination port (0 = any) */
    port: number;
    /** Traffic direction */
    direction: IntentDirection;
    /** Rule type hint for kernel */
    ruleType?: IntentRuleType;
    /** Max connections allowed under this permission (0 = unlimited) */
    maxConnections?: number;
}

/**
 * EXECUTION_INTENT document — written as JSON to handoff/auditor_to_executor/.
 * The C# ByonWfpBridge watches this directory for *.intent.json files,
 * verifies the Ed25519 signature, and pushes rules to the kernel via IOCTL.
 *
 * Signed data format: IntentId|OrderId|Action|Timestamp|ExpiresAt (pipe-delimited)
 */
export interface ExecutionIntent {
    /** Unique intent ID (UUID) */
    intentId: string;
    /** Reference to the ExecutionOrder that authorized this intent */
    orderId: string;
    /** Action description (e.g. "http_fetch", "api_call", "dns_lookup") */
    action: string;
    /** Network permissions authorized by this intent */
    networkPermissions: NetworkPermission[];
    /** Creation timestamp (Unix epoch seconds) */
    timestamp: number;
    /** Expiration timestamp (Unix epoch seconds, 0 = no expiry) */
    expiresAt: number;
    /** Ed25519 signature (base64) over pipe-delimited signed data */
    signature: string;
    /** Ed25519 public key (base64) used for signing */
    publicKey: string;
    /** HMAC-SHA256 IPC authentication (anti-spoofing on named pipe) */
    ipcAuth?: IpcAuthentication;
}

// ============================================================================
// FRAGMERGENT BRAIN (anomaly detection state)
// ============================================================================

/** Phase of the Fragmergent adaptive system */
export type FragmergentPhase =
    | "equilibrium"     // FRAG_PHASE_EQUILIBRIUM_E (0) — normal stable operation
    | "fragmentation"   // FRAG_PHASE_FRAGMENTATION_E (1) — system disruption
    | "emergence";      // FRAG_PHASE_EMERGENCE_E (2) — new pattern forming

/** Anomaly severity level */
export type AnomalyLevel =
    | "none"            // FRAG_ANOMALY_NONE_E (0)
    | "mild"            // FRAG_ANOMALY_MILD_E (1)
    | "moderate"        // FRAG_ANOMALY_MODERATE_E (2)
    | "severe"          // FRAG_ANOMALY_SEVERE_E (3)
    | "critical";       // FRAG_ANOMALY_CRITICAL_E (4)

/** 8-dimensional behavioral feature vector (all values 0-1000) */
export interface FeatureVector {
    avgPacketSize: number;
    burstiness: number;
    connectionFrequency: number;
    portDiversity: number;
    ipDiversity: number;
    protocolMix: number;
    timeOfDayBias: number;
    payloadEntropy: number;
}

/** Fragmergent anomaly analysis result */
export interface FragmergentResult {
    /** Current clarity (0-1000) */
    clarity: number;
    /** Change from baseline (-1000 to +1000) */
    clarityDelta: number;
    /** Anomaly magnitude (0-1000) */
    anomalyScore: number;
    /** Current phase */
    phase: FragmergentPhase;
    /** Anomaly severity */
    anomalyLevel: AnomalyLevel;
    /** Bitmap: which dimensions are anomalous */
    anomalousDims: number;
    /** Confidence 0-1000 */
    confidence: number;
    /** Human-readable explanation */
    explanation: string;
}

/** Fragmergent configuration (matches FRAG_CONFIG kernel struct) */
export interface FragmergentConfig {
    /** Momentum coefficient (0-1000, default 500) */
    alpha: number;
    /** Coupling strength (0-1000, default 300) */
    beta: number;
    /** Noise sensitivity (0-1000, default 400) */
    delta: number;
    /** Memory factor / EMA weight (0-1000, default 800) */
    eta: number;
    /** Adaptation rate (0-1000, default 600) */
    zeta: number;
    /** Damping coefficient (0-1000, default 700) */
    gamma: number;
    /** Fragmentation threshold (default 80) */
    theta1: number;
    /** Emergence threshold (default 10) */
    theta2: number;
    /** Anomaly thresholds (clarity drops) */
    anomalyMild: number;
    anomalyModerate: number;
    anomalySevere: number;
    /** Feature weights (8 elements, sum = 1000) */
    featureWeights: number[];
}

// ============================================================================
// SENTINEL STATUS (bridge state file)
// ============================================================================

/** Per-application profile as tracked by sentinel */
export interface AppProfile {
    /** Application name (process name) */
    name: string;
    /** Application path */
    path: string;
    /** Reputation score (0-1000) */
    reputation: number;
    /** Total connections observed */
    connections: number;
    /** Connections blocked */
    blocked: number;
    /** Current anomaly level */
    anomalyLevel: AnomalyLevel;
    /** Current Fragmergent phase */
    phase: FragmergentPhase;
    /** Active intent count */
    activeIntents: number;
    /** Last seen timestamp */
    lastSeen: string;
}

/** Sentinel event (connection, block, anomaly) */
export interface SentinelEvent {
    /** Event ID */
    id: string;
    /** Timestamp */
    timestamp: string;
    /** Event type */
    type: "allow" | "block" | "anomaly" | "intent" | "freeze" | "unfreeze" | "config_change";
    /** Application name */
    app: string;
    /** Remote endpoint */
    remote?: string;
    /** Port */
    port?: number;
    /** Protocol */
    protocol?: IntentProtocol;
    /** Description */
    message: string;
    /** Additional data */
    details?: Record<string, unknown>;
}

/** Security mode */
export type SentinelMode = "monitor" | "enforce" | "strict";

/** Detection module toggles */
export interface DetectionModules {
    behavioral: boolean;
    fragmergent: boolean;
    exfiltration: boolean;
    burst: boolean;
    reputation: boolean;
}

/** Sentinel configuration */
export interface SentinelConfig {
    mode: SentinelMode;
    modules: DetectionModules;
    fragmergent?: FragmergentConfig;
    /** Essential services that remain accessible even during freeze/enforce */
    essentialServices?: EssentialService[];
}

/** Aggregate statistics from sentinel */
export interface SentinelStats {
    connections: number;
    allowed: number;
    blocked: number;
    anomalies: number;
    appsTracked: number;
    activeIntents: number;
}

/** Full sentinel status */
export interface SentinelStatus {
    installed: boolean;
    active: boolean;
    mode: SentinelMode | "offline";
    frozen: boolean;
    frozenAt?: string;
    frozenBy?: string;
    stats: SentinelStats;
    lastUpdate: string | null;
    driverVersion?: string;
}

// ============================================================================
// INTENT STATS (kernel response)
// ============================================================================

/** Maps to WFP_GUARD_INTENT_STATS */
export interface IntentStats {
    activeRules: number;
    totalRulesAdded: number;
    totalRulesExpired: number;
    totalRulesUsed: number;
    intentAllowed: number;
    intentBlocked: number;
    intentExpired: number;
}

// ============================================================================
// IPC AUTHENTICATION (anti-spoofing)
// ============================================================================

/**
 * HMAC-SHA256 authentication for IPC between Sentinel Bridge and C# kernel bridge.
 * Prevents spoofing on the named pipe (\\.\pipe\WfpGuardBridge).
 *
 * The shared secret is established during setup and stored in the vault.
 * Each intent file includes an HMAC tag computed over the full JSON payload
 * (excluding the hmac field itself). The C# bridge verifies before pushing to kernel.
 */
export interface IpcAuthentication {
    /** HMAC-SHA256 tag (hex) over the serialized intent payload */
    hmac: string;
    /** Timestamp of HMAC computation (Unix epoch seconds) */
    hmacTimestamp: number;
    /** Sequence number to prevent replay on IPC channel */
    hmacSequence: number;
}

// ============================================================================
// ESSENTIAL SERVICES (freeze/enforce exemptions)
// ============================================================================

/**
 * Essential services that must remain accessible during freeze or enforce mode.
 * Without these, the system itself becomes non-functional.
 *
 * Each entry defines a network endpoint that is whitelisted even during freeze.
 * The UI, memory service, and Redis are required for the human to interact with
 * the system and issue unfreeze commands.
 */
export interface EssentialService {
    /** Human-readable service name */
    name: string;
    /** Target host (IP or hostname) */
    host: string;
    /** Target port */
    port: number;
    /** Protocol */
    protocol: IntentProtocol;
    /** Why this service is essential */
    reason: string;
}

/** Default essential services — always reachable even during freeze */
export const DEFAULT_ESSENTIAL_SERVICES: EssentialService[] = [
    {
        name: "Local loopback",
        host: "127.0.0.1",
        port: 0,     // all ports on loopback
        protocol: "tcp",
        reason: "Inter-service communication on localhost must always work",
    },
    {
        name: "Memory Service",
        host: "127.0.0.1",
        port: 8001,
        protocol: "tcp",
        reason: "FHRSS+FCPE memory backend required for agent operation",
    },
    {
        name: "Redis",
        host: "127.0.0.1",
        port: 6379,
        protocol: "tcp",
        reason: "Message queue and pub/sub for real-time events",
    },
    {
        name: "OpenClaw Gateway",
        host: "127.0.0.1",
        port: 3000,
        protocol: "tcp",
        reason: "UI must remain accessible for human to issue unfreeze commands",
    },
    {
        name: "Prometheus",
        host: "127.0.0.1",
        port: 9090,
        protocol: "tcp",
        reason: "Monitoring must continue during freeze for diagnostics",
    },
];
