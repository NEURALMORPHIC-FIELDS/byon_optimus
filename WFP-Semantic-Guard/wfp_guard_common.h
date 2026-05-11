/*
 * WFP SEMANTIC GUARD - Common Definitions
 * 
 * Shared structures between kernel driver and user-mode service.
 * 
 * Copyright (c) 2025 - Network Execution Guard Project
 * Licensed under MIT License
 */

#ifndef WFP_GUARD_COMMON_H
#define WFP_GUARD_COMMON_H

#if defined(WFP_GUARD_KERNEL)
#include <ntddk.h>
#else
#include <windows.h>
#endif

// ============================================================================
// VERSION & IDENTIFICATION
// ============================================================================

#define WFP_GUARD_VERSION_MAJOR     1
#define WFP_GUARD_VERSION_MINOR     0
#define WFP_GUARD_VERSION_BUILD     0

#define WFP_GUARD_DEVICE_NAME       L"\\Device\\WfpGuard"
#define WFP_GUARD_SYMLINK_NAME      L"\\DosDevices\\WfpGuard"
#define WFP_GUARD_WIN32_NAME        L"\\\\.\\WfpGuard"

// ============================================================================
// IOCTL CODES
// ============================================================================

#define WFP_GUARD_IOCTL_TYPE        0x8000

#define IOCTL_WFP_GUARD_GET_STATS \
    CTL_CODE(WFP_GUARD_IOCTL_TYPE, 0x800, METHOD_BUFFERED, FILE_READ_ACCESS)

#define IOCTL_WFP_GUARD_GET_EVENT \
    CTL_CODE(WFP_GUARD_IOCTL_TYPE, 0x801, METHOD_BUFFERED, FILE_READ_ACCESS)

#define IOCTL_WFP_GUARD_SET_VERDICT \
    CTL_CODE(WFP_GUARD_IOCTL_TYPE, 0x802, METHOD_BUFFERED, FILE_WRITE_ACCESS)

#define IOCTL_WFP_GUARD_SET_CONFIG \
    CTL_CODE(WFP_GUARD_IOCTL_TYPE, 0x803, METHOD_BUFFERED, FILE_WRITE_ACCESS)

#define IOCTL_WFP_GUARD_GET_APP_PROFILE \
    CTL_CODE(WFP_GUARD_IOCTL_TYPE, 0x804, METHOD_BUFFERED, FILE_READ_ACCESS)

#define IOCTL_WFP_GUARD_WHITELIST_APP \
    CTL_CODE(WFP_GUARD_IOCTL_TYPE, 0x805, METHOD_BUFFERED, FILE_WRITE_ACCESS)

#define IOCTL_WFP_GUARD_BLACKLIST_APP \
    CTL_CODE(WFP_GUARD_IOCTL_TYPE, 0x806, METHOD_BUFFERED, FILE_WRITE_ACCESS)

#define IOCTL_WFP_GUARD_GET_FRAGMERGENT_STATS \
    CTL_CODE(WFP_GUARD_IOCTL_TYPE, 0x807, METHOD_BUFFERED, FILE_READ_ACCESS)

#define IOCTL_WFP_GUARD_SET_FRAGMERGENT_CONFIG \
    CTL_CODE(WFP_GUARD_IOCTL_TYPE, 0x808, METHOD_BUFFERED, FILE_WRITE_ACCESS)

// ============================================================================
// BYON OPTIMUS EXECUTION_INTENT IOCTLs
// ============================================================================

// Add a BYON execution intent rule (allows specific network access)
#define IOCTL_WFP_GUARD_ADD_INTENT_RULE \
    CTL_CODE(WFP_GUARD_IOCTL_TYPE, 0x810, METHOD_BUFFERED, FILE_WRITE_ACCESS)

// Remove a specific intent rule by ID
#define IOCTL_WFP_GUARD_REMOVE_INTENT_RULE \
    CTL_CODE(WFP_GUARD_IOCTL_TYPE, 0x811, METHOD_BUFFERED, FILE_WRITE_ACCESS)

// Clear all intent rules for a process
#define IOCTL_WFP_GUARD_CLEAR_INTENT_RULES \
    CTL_CODE(WFP_GUARD_IOCTL_TYPE, 0x812, METHOD_BUFFERED, FILE_WRITE_ACCESS)

// Get active intent rules count
#define IOCTL_WFP_GUARD_GET_INTENT_STATS \
    CTL_CODE(WFP_GUARD_IOCTL_TYPE, 0x813, METHOD_BUFFERED, FILE_READ_ACCESS)

// Verify if a connection is authorized by an intent
#define IOCTL_WFP_GUARD_VERIFY_INTENT \
    CTL_CODE(WFP_GUARD_IOCTL_TYPE, 0x814, METHOD_BUFFERED, FILE_READ_ACCESS)

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

// Detection thresholds (scaled 0-1000 for integer math)
#define CFG_CLUSTER_SIMILARITY_THRESHOLD    700     // 0.70
#define CFG_TEMPORAL_MATCH_THRESHOLD        650     // 0.65
#define CFG_CORRELATION_THRESHOLD           600     // 0.60
#define CFG_REPUTATION_BLOCK_THRESHOLD      350     // 0.35
#define CFG_REPUTATION_TRUST_THRESHOLD      650     // 0.65

// Behavioral clustering
#define CFG_MIN_SAMPLES_FOR_CLUSTERING      10
#define CFG_BEHAVIOR_HISTORY_DEPTH          64

// Temporal fingerprinting
#define CFG_MIN_EVENTS_FOR_TEMPORAL         8
#define CFG_TEMPORAL_HISTOGRAM_BUCKETS      8
#define CFG_TEMPORAL_WINDOW_MS              300000  // 5 minutes

// Cross-flow correlation
#define CFG_MIN_CORRELATED_FLOWS            2
#define CFG_CORRELATION_BUCKET_MS           500
#define CFG_MIN_FLOW_EVENTS                 3

// Exfiltration detection
#define CFG_EXFIL_MIN_PACKET_SIZE           800
#define CFG_EXFIL_MIN_ENTROPY               56      // 0.7 * 80 (scaled)
#define CFG_EXFIL_LARGE_PACKET_RATIO        600     // 0.60

// Burst detection
#define CFG_BURST_WINDOW_MS                 1000
#define CFG_BURST_MIN_PACKETS               10
#define CFG_BURST_MIN_AVG_SIZE              1000

// Limits
#define MAX_APP_PATH_LENGTH                 260
#define MAX_TRACKED_APPS                    256
#define MAX_FLOWS_PER_APP                   32
#define MAX_TIMESTAMPS_PER_FLOW             64
#define MAX_PENDING_EVENTS                  1024

// ============================================================================
// ENUMERATIONS
// ============================================================================

typedef enum _WFP_GUARD_ACTION {
    WFP_ACTION_ALLOW        = 0,
    WFP_ACTION_BLOCK        = 1,
    WFP_ACTION_ASK          = 2,
    WFP_ACTION_PENDING      = 3
} WFP_GUARD_ACTION;

typedef enum _WFP_GUARD_DETECTION_TYPE {
    DETECTION_NONE              = 0,
    DETECTION_BEHAVIORAL        = 1,
    DETECTION_TEMPORAL          = 2,
    DETECTION_CORRELATION       = 4,
    DETECTION_EXFILTRATION      = 8,
    DETECTION_BURST             = 16,
    DETECTION_REPUTATION        = 32,
    DETECTION_BLACKLIST         = 64
} WFP_GUARD_DETECTION_TYPE;

typedef enum _WFP_GUARD_CLUSTER_TYPE {
    CLUSTER_UNCLUSTERED         = 0,
    CLUSTER_BROWSER_LIKE        = 1,
    CLUSTER_BACKGROUND_SERVICE  = 2,
    CLUSTER_P2P_LIKE            = 3,
    CLUSTER_BEACON_LIKE         = 4,
    CLUSTER_EXFILTRATION_LIKE   = 5,
    CLUSTER_DGA_LIKE            = 6,
    CLUSTER_BURST_EXFIL         = 7
} WFP_GUARD_CLUSTER_TYPE;

typedef enum _WFP_GUARD_PROTOCOL {
    PROTO_TCP   = 6,
    PROTO_UDP   = 17,
    PROTO_OTHER = 255
} WFP_GUARD_PROTOCOL;

typedef enum _FRAG_PHASE_ENUM {
    FRAG_PHASE_EQUILIBRIUM_E    = 0,    // Normal stable operation
    FRAG_PHASE_FRAGMENTATION_E  = 1,    // System breaking apart (potential attack)
    FRAG_PHASE_EMERGENCE_E      = 2     // New pattern forming (learning)
} FRAG_PHASE_ENUM;

typedef enum _FRAG_ANOMALY_LEVEL_ENUM {
    FRAG_ANOMALY_NONE_E     = 0,
    FRAG_ANOMALY_MILD_E     = 1,
    FRAG_ANOMALY_MODERATE_E = 2,
    FRAG_ANOMALY_SEVERE_E   = 3,
    FRAG_ANOMALY_CRITICAL_E = 4
} FRAG_ANOMALY_LEVEL_ENUM;

// ============================================================================
// DATA STRUCTURES
// ============================================================================

#pragma pack(push, 1)

//
// Network event sent from kernel to user-mode for analysis
//
typedef struct _WFP_GUARD_EVENT {
    UINT64              EventId;            // Unique event ID
    UINT64              Timestamp;          // KeQuerySystemTime value
    UINT32              ProcessId;          // Source process ID
    UINT32              RemoteIpV4;         // Remote IP (network byte order)
    UINT16              RemotePort;         // Remote port
    UINT16              LocalPort;          // Local port
    UINT8               Protocol;           // TCP/UDP
    UINT8               Direction;          // 0=outbound, 1=inbound
    UINT16              PacketSize;         // Packet size in bytes
    UINT8               EntropyEstimate;    // 0-80 (0.0-1.0 scaled)
    UINT8               Reserved[3];

    // Fragmergent Brain fields
    UINT16              FragClarity;        // 0-1000
    INT16               FragClarityDelta;   // -1000 to +1000
    UINT16              FragAnomalyScore;   // 0-1000
    UINT8               FragPhase;          // FRAG_PHASE_ENUM
    UINT8               FragAnomalyLevel;   // FRAG_ANOMALY_LEVEL_ENUM

    WCHAR               AppPath[MAX_APP_PATH_LENGTH];
} WFP_GUARD_EVENT, *PWFP_GUARD_EVENT;

//
// Verdict sent from user-mode to kernel
//
typedef struct _WFP_GUARD_VERDICT {
    UINT64              EventId;            // Event being responded to
    WFP_GUARD_ACTION    Action;             // Allow/Block/Ask
    UINT32              DetectionFlags;     // Which modules flagged
    UINT16              ConfidenceScore;    // 0-1000
    UINT16              Reserved;
} WFP_GUARD_VERDICT, *PWFP_GUARD_VERDICT;

//
// Per-application behavior profile (kernel-side, lightweight)
//
typedef struct _WFP_GUARD_APP_METRICS {
    // Identification
    WCHAR               AppPath[MAX_APP_PATH_LENGTH];
    UINT32              AppHash;            // FNV-1a hash of path
    
    // Connection counters
    UINT32              TotalConnections;
    UINT32              BlockedConnections;
    UINT32              UniqueRemoteIPs;
    UINT32              UniqueRemotePorts;
    
    // Packet statistics
    UINT64              TotalBytesSent;
    UINT32              PacketCount;
    UINT32              LargePacketCount;   // > CFG_EXFIL_MIN_PACKET_SIZE
    UINT32              HighEntropyCount;   // > CFG_EXFIL_MIN_ENTROPY
    
    // Timing (circular buffer indices)
    UINT64              FirstSeen;
    UINT64              LastSeen;
    UINT32              IntervalCount;
    UINT32              IntervalSum;        // Sum of intervals (for mean)
    UINT32              IntervalSumSq;      // Sum of squares (for variance)
    
    // Histogram buckets: <10ms, 10-50, 50-200, 200-1000, 1-5s, 5-30s, 30s-5m, >5m
    UINT16              IntervalHistogram[CFG_TEMPORAL_HISTOGRAM_BUCKETS];
    
    // Computed scores (updated periodically)
    UINT16              BurstinessScore;    // 0-1000
    UINT16              RegularityScore;    // 0-1000
    UINT16              EntropyScore;       // 0-1000 (average)
    UINT16              ReputationScore;    // 0-1000
    
    // Classification
    WFP_GUARD_CLUSTER_TYPE  ClusterType;
    UINT8               IsWhitelisted;
    UINT8               IsBlacklisted;
    UINT8               Reserved[2];
} WFP_GUARD_APP_METRICS, *PWFP_GUARD_APP_METRICS;

//
// Per-flow tracking (for correlation detection)
//
typedef struct _WFP_GUARD_FLOW_CONTEXT {
    UINT32              RemoteIpV4;
    UINT16              RemotePort;
    UINT16              EventCount;
    UINT64              Timestamps[MAX_TIMESTAMPS_PER_FLOW];
} WFP_GUARD_FLOW_CONTEXT, *PWFP_GUARD_FLOW_CONTEXT;

//
// Extended app profile with flow data (user-mode analysis)
//
typedef struct _WFP_GUARD_APP_PROFILE {
    WFP_GUARD_APP_METRICS   Metrics;
    UINT32                  FlowCount;
    WFP_GUARD_FLOW_CONTEXT  Flows[MAX_FLOWS_PER_APP];
} WFP_GUARD_APP_PROFILE, *PWFP_GUARD_APP_PROFILE;

//
// Global statistics
//
typedef struct _WFP_GUARD_STATISTICS {
    UINT64              TotalEvents;
    UINT64              AllowedEvents;
    UINT64              BlockedEvents;
    UINT64              PendingEvents;
    
    // Detection counters
    UINT32              BehavioralDetections;
    UINT32              TemporalDetections;
    UINT32              CorrelationDetections;
    UINT32              ExfiltrationDetections;
    UINT32              BurstDetections;
    UINT32              ReputationDetections;
    
    // System info
    UINT32              TrackedApps;
    UINT32              ActiveFlows;
    UINT64              UptimeMs;
} WFP_GUARD_STATISTICS, *PWFP_GUARD_STATISTICS;

//
// Configuration structure
//
typedef struct _WFP_GUARD_CONFIG {
    // Feature toggles
    UINT8               EnableBehavioral;
    UINT8               EnableTemporal;
    UINT8               EnableCorrelation;
    UINT8               EnableExfiltration;
    UINT8               EnableBurst;
    UINT8               EnableReputation;
    UINT8               DefaultAction;      // 0=allow, 1=block, 2=ask
    UINT8               Reserved;
    
    // Thresholds (0-1000)
    UINT16              ClusterThreshold;
    UINT16              TemporalThreshold;
    UINT16              CorrelationThreshold;
    UINT16              ReputationBlockThreshold;
    UINT16              ReputationTrustThreshold;
    UINT16              Reserved2;
} WFP_GUARD_CONFIG, *PWFP_GUARD_CONFIG;

//
// Fragmergent Brain statistics
//
typedef struct _WFP_GUARD_FRAGMERGENT_STATS {
    UINT8               Enabled;            // Is Fragmergent enabled
    UINT8               Reserved[3];
    UINT64              TotalProcessed;     // Total events processed
    UINT64              AnomalyDetections;  // Anomalies detected (moderate+)
    UINT32              ActiveBrains;       // Active per-app brains
    UINT32              EquilibriumCount;   // Apps in equilibrium phase
    UINT32              FragmentationCount; // Apps in fragmentation phase
    UINT32              EmergenceCount;     // Apps in emergence phase
    UINT64              PhaseTransitions;   // Total phase transitions
} WFP_GUARD_FRAGMERGENT_STATS, *PWFP_GUARD_FRAGMERGENT_STATS;

//
// Fragmergent Brain configuration
//
typedef struct _WFP_GUARD_FRAGMERGENT_CONFIG {
    UINT8               Enabled;            // Enable Fragmergent processing
    UINT8               Reserved[3];
    UINT16              FragmergentWeight;  // 0-1000 (weight in final decision)
    UINT16              AnomalyMild;        // Mild anomaly threshold (clarity drop)
    UINT16              AnomalyModerate;    // Moderate anomaly threshold
    UINT16              AnomalySevere;      // Severe anomaly threshold
    UINT16              Reserved2;
} WFP_GUARD_FRAGMERGENT_CONFIG, *PWFP_GUARD_FRAGMERGENT_CONFIG;

// ============================================================================
// BYON OPTIMUS EXECUTION_INTENT STRUCTURES
// ============================================================================

// Maximum values for intent rules
#define MAX_INTENT_RULES            64      // Max active intent rules
#define MAX_INTENT_ID_LENGTH        64      // UUID + timestamp
#define MAX_INTENT_DESCRIPTION      128     // Human-readable description
#define ED25519_SIGNATURE_LENGTH    64      // Ed25519 signature size
#define ED25519_PUBKEY_LENGTH       32      // Ed25519 public key size

//
// Intent rule types - what network access is authorized
//
typedef enum _WFP_INTENT_RULE_TYPE {
    INTENT_TYPE_EXACT_IP        = 0,    // Exact IP:port match
    INTENT_TYPE_IP_RANGE        = 1,    // IP range (CIDR-like)
    INTENT_TYPE_PORT_ONLY       = 2,    // Any IP, specific port
    INTENT_TYPE_DOMAIN          = 3,    // Domain-based (resolved to IPs)
    INTENT_TYPE_WILDCARD        = 4     // Wildcard (e.g., *.example.com)
} WFP_INTENT_RULE_TYPE;

//
// BYON Execution Intent Rule
// Pushed from user-mode bridge after signature verification
//
typedef struct _WFP_GUARD_INTENT_RULE {
    // Rule identification
    CHAR                IntentId[MAX_INTENT_ID_LENGTH];     // Unique intent ID
    UINT32              ProcessId;                          // Authorized process ID
    WCHAR               ProcessPath[MAX_APP_PATH_LENGTH];   // Process executable path

    // Network authorization
    WFP_INTENT_RULE_TYPE RuleType;
    UINT32              RemoteIpV4;         // Target IP (or range start)
    UINT32              RemoteIpV4End;      // Range end (for IP_RANGE type)
    UINT16              RemotePort;         // Target port (0 = any)
    UINT8               Protocol;           // TCP/UDP/any (0 = any)
    UINT8               Direction;          // 0=outbound, 1=inbound, 2=both

    // Time constraints
    UINT64              CreatedTimestamp;   // When intent was created
    UINT64              ExpiresTimestamp;   // When intent expires (0 = no expiry)
    UINT32              MaxConnections;     // Max connections allowed (0 = unlimited)
    UINT32              ConnectionsUsed;    // Connections made under this intent

    // Audit trail
    CHAR                Description[MAX_INTENT_DESCRIPTION];
    UINT8               SignatureValid;     // Was Ed25519 signature verified
    UINT8               Reserved[3];
} WFP_GUARD_INTENT_RULE, *PWFP_GUARD_INTENT_RULE;

//
// Request to add an intent rule
//
typedef struct _WFP_GUARD_ADD_INTENT_REQUEST {
    WFP_GUARD_INTENT_RULE   Rule;
    UINT8                   EdSignature[ED25519_SIGNATURE_LENGTH];  // Ed25519 signature
    UINT8                   EdPubKey[ED25519_PUBKEY_LENGTH];        // Signing public key
} WFP_GUARD_ADD_INTENT_REQUEST, *PWFP_GUARD_ADD_INTENT_REQUEST;

//
// Request to remove an intent rule
//
typedef struct _WFP_GUARD_REMOVE_INTENT_REQUEST {
    CHAR                IntentId[MAX_INTENT_ID_LENGTH];
} WFP_GUARD_REMOVE_INTENT_REQUEST, *PWFP_GUARD_REMOVE_INTENT_REQUEST;

//
// Request to clear all rules for a process
//
typedef struct _WFP_GUARD_CLEAR_INTENT_REQUEST {
    UINT32              ProcessId;
} WFP_GUARD_CLEAR_INTENT_REQUEST, *PWFP_GUARD_CLEAR_INTENT_REQUEST;

//
// Intent statistics
//
typedef struct _WFP_GUARD_INTENT_STATS {
    UINT32              ActiveRules;        // Currently active intent rules
    UINT32              TotalRulesAdded;    // Total rules added (lifetime)
    UINT32              TotalRulesExpired;  // Rules that expired
    UINT32              TotalRulesUsed;     // Rules that hit max connections
    UINT64              IntentAllowed;      // Connections allowed by intents
    UINT64              IntentBlocked;      // Connections blocked (no intent)
    UINT64              IntentExpired;      // Connections blocked (expired intent)
} WFP_GUARD_INTENT_STATS, *PWFP_GUARD_INTENT_STATS;

//
// Verify intent request (check if connection is authorized)
//
typedef struct _WFP_GUARD_VERIFY_INTENT_REQUEST {
    UINT32              ProcessId;
    UINT32              RemoteIpV4;
    UINT16              RemotePort;
    UINT8               Protocol;
    UINT8               Direction;
} WFP_GUARD_VERIFY_INTENT_REQUEST, *PWFP_GUARD_VERIFY_INTENT_REQUEST;

//
// Verify intent response
//
typedef struct _WFP_GUARD_VERIFY_INTENT_RESPONSE {
    UINT8               Authorized;         // 1=allowed, 0=blocked
    UINT8               Reserved[3];
    CHAR                MatchingIntentId[MAX_INTENT_ID_LENGTH];
} WFP_GUARD_VERIFY_INTENT_RESPONSE, *PWFP_GUARD_VERIFY_INTENT_RESPONSE;

#pragma pack(pop)

// ============================================================================
// CLUSTER CENTROIDS (for behavioral classification)
// Stored as integers 0-1000 for each of 8 features:
// [avg_pkt_size, burstiness, conn_freq, port_div, ip_div, proto_mix, tod_bias, entropy]
// ============================================================================

#define CLUSTER_CENTROID_BROWSER        { 400, 700, 800, 900, 800, 950, 600, 500 }
#define CLUSTER_CENTROID_BACKGROUND     { 200, 350,  20,  50,  50, 900, 500,  30 }
#define CLUSTER_CENTROID_P2P            { 600, 800, 500, 700, 900, 500, 500, 600 }
#define CLUSTER_CENTROID_BEACON         { 120,  50,  20,  20,  20, 950, 500, 110 }
#define CLUSTER_CENTROID_EXFIL          { 850, 400, 500,  50,  50, 980, 300, 850 }
#define CLUSTER_CENTROID_DGA            { 100, 600, 700, 100, 950, 900, 500, 300 }
#define CLUSTER_CENTROID_BURST          { 950, 950, 950,  20,  20, 980, 300, 900 }

// Feature weights for distance calculation (sum = 1000)
#define CLUSTER_WEIGHTS                 { 100, 150, 100, 100, 250,  30,  30, 240 }

// ============================================================================
// INLINE UTILITY FUNCTIONS
// ============================================================================

//
// FNV-1a hash for app path (fast, simple)
//
static __inline UINT32 WfpGuardHashPath(const WCHAR* Path)
{
    UINT32 hash = 2166136261u;
    while (*Path) {
        hash ^= (UINT8)(*Path & 0xFF);
        hash *= 16777619u;
        hash ^= (UINT8)((*Path >> 8) & 0xFF);
        hash *= 16777619u;
        Path++;
    }
    return hash;
}

//
// Convert timestamp to interval bucket index (0-7)
//
static __inline UINT8 WfpGuardIntervalToBucket(UINT32 IntervalMs)
{
    if (IntervalMs < 10)        return 0;   // <10ms
    if (IntervalMs < 50)        return 1;   // 10-50ms
    if (IntervalMs < 200)       return 2;   // 50-200ms
    if (IntervalMs < 1000)      return 3;   // 200ms-1s
    if (IntervalMs < 5000)      return 4;   // 1-5s
    if (IntervalMs < 30000)     return 5;   // 5-30s
    if (IntervalMs < 300000)    return 6;   // 30s-5m
    return 7;                               // >5m
}

//
// Simple integer square root (for variance calculation)
//
static __inline UINT32 WfpGuardIsqrt(UINT64 n)
{
    if (n == 0) return 0;
    UINT64 x = n;
    UINT64 y = (x + 1) / 2;
    while (y < x) {
        x = y;
        y = (x + n / x) / 2;
    }
    return (UINT32)x;
}

//
// Compute coefficient of variation (0-1000 scale)
// CV = (std / mean) * 1000
//
static __inline UINT16 WfpGuardComputeCV(UINT32 Sum, UINT32 SumSq, UINT32 Count)
{
    if (Count < 2 || Sum == 0) return 0;
    
    UINT32 mean = Sum / Count;
    if (mean == 0) return 0;
    
    // variance = E[X^2] - E[X]^2
    UINT64 meanSq = (UINT64)mean * mean;
    UINT64 eSq = (UINT64)SumSq / Count;
    
    if (eSq <= meanSq) return 0;
    
    UINT32 variance = (UINT32)(eSq - meanSq);
    UINT32 std = WfpGuardIsqrt(variance);
    
    // CV scaled to 0-1000
    return (UINT16)((std * 1000) / mean);
}

#endif // WFP_GUARD_COMMON_H
