/*
 * FRAGMERGENT BRAIN - Adaptive Anomaly Detection for WFP Semantic Guard
 * ======================================================================
 *
 * Lightweight real-time anomaly detection using Fragmergent dynamics.
 * Zero external dependencies, pure C, <0.1% CPU overhead.
 *
 * Integration with WFP Semantic Guard behavioral analysis engine.
 *
 * Author: Lucian Borbeleac / Digital Systems Creator
 * Patent: FHRSS Technologies
 * Version: 1.0.0
 *
 * Adapted for Windows Kernel Mode
 */

#ifndef FRAGMERGENT_BRAIN_H
#define FRAGMERGENT_BRAIN_H

// ============================================================================
// PLATFORM ABSTRACTION
// ============================================================================

#ifdef WFP_GUARD_KERNEL
// Windows Kernel Mode
#include <ntddk.h>
#include <ntstrsafe.h>

typedef UINT8   uint8_t;
typedef UINT16  uint16_t;
typedef UINT32  uint32_t;
typedef UINT64  uint64_t;
typedef INT32   int32_t;
typedef INT64   int64_t;
typedef BOOLEAN bool;
#define true    TRUE
#define false   FALSE

#else
// User Mode (for simulation/testing)
#include <stdint.h>
#include <stdbool.h>
#endif

#ifdef __cplusplus
extern "C" {
#endif

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

#define FRAG_NUM_DIMENSIONS         8       // Behavioral feature vector size
#define FRAG_HISTORY_SIZE          64       // Rolling window for baseline
#define FRAG_MAX_TRACKED_APPS     256       // Max concurrent applications
#define FRAG_BASELINE_SAMPLES      32       // Samples needed for stable baseline

// Phase thresholds (scaled 0-1000 for integer math)
#define FRAG_THETA1_DEFAULT        80       // 0.08 - fragmentation threshold
#define FRAG_THETA2_DEFAULT        10       // 0.01 - emergence threshold

// Anomaly thresholds (clarity drop triggers)
#define FRAG_ANOMALY_MILD_THRESHOLD    200   // 0.20 clarity drop = mild anomaly
#define FRAG_ANOMALY_MODERATE_THRESHOLD 350  // 0.35 clarity drop = moderate
#define FRAG_ANOMALY_SEVERE_THRESHOLD   500  // 0.50 clarity drop = severe

// ============================================================================
// DATA STRUCTURES
// ============================================================================

/**
 * System phase enumeration
 * Fragmergent cycles between these phases
 */
typedef enum _FRAG_PHASE {
    FRAG_PHASE_EQUILIBRIUM = 0,     // Normal stable operation
    FRAG_PHASE_FRAGMENTATION = 1,   // System breaking apart (potential attack)
    FRAG_PHASE_EMERGENCE = 2        // New pattern forming (learning)
} FRAG_PHASE;

/**
 * Anomaly severity levels
 */
typedef enum _FRAG_ANOMALY_LEVEL {
    FRAG_ANOMALY_NONE = 0,
    FRAG_ANOMALY_MILD = 1,
    FRAG_ANOMALY_MODERATE = 2,
    FRAG_ANOMALY_SEVERE = 3,
    FRAG_ANOMALY_CRITICAL = 4
} FRAG_ANOMALY_LEVEL;

/**
 * 8-dimensional behavioral feature vector
 * All values normalized 0-1000 (integer math)
 */
typedef struct _FRAG_FEATURE_VECTOR {
    uint16_t avgPacketSize;         // Average packet size (normalized)
    uint16_t burstiness;            // Traffic burstiness coefficient
    uint16_t connectionFrequency;   // Connections per time unit
    uint16_t portDiversity;         // Unique destination ports ratio
    uint16_t ipDiversity;           // Unique destination IPs ratio
    uint16_t protocolMix;           // TCP/UDP ratio
    uint16_t timeOfDayBias;         // Activity time distribution
    uint16_t payloadEntropy;        // Average payload entropy
} FRAG_FEATURE_VECTOR;

/**
 * Fragmergent state for a single dimension
 */
typedef struct _FRAG_DIM_STATE {
    // Current state
    int32_t P;                      // Current value (0-1000)
    int32_t P_prev;                 // Previous value
    int32_t P_prev2;                // Two steps back

    // Baseline statistics
    int32_t baseline_mean;          // Rolling mean
    int32_t baseline_var;           // Rolling variance (scaled)
    int32_t baseline_min;           // Observed minimum
    int32_t baseline_max;           // Observed maximum

    // Derived metrics
    int32_t F;                      // Fragmentation force
    int32_t ESP;                    // Emergent Synergistic Perturbation
} FRAG_DIM_STATE;

/**
 * Per-application Fragmergent brain state
 */
typedef struct _FRAG_APP_BRAIN {
    // Identification
    uint32_t appIdHash;             // Application identifier hash
    bool isActive;                  // Slot in use

    // Dimensional states
    FRAG_DIM_STATE dims[FRAG_NUM_DIMENSIONS];

    // Global metrics
    int32_t clarity;                // Overall system clarity (0-1000)
    int32_t clarity_baseline;       // Baseline clarity
    int32_t anomaly_score;          // Current anomaly score (0-1000)
    FRAG_PHASE phase;               // Current system phase
    FRAG_ANOMALY_LEVEL anomaly_level;

    // History ring buffer
    FRAG_FEATURE_VECTOR history[FRAG_HISTORY_SIZE];
    uint8_t history_index;
    uint16_t sample_count;          // Total samples observed

    // Timestamps (in milliseconds)
    uint64_t first_seen;
    uint64_t last_update;

    // Statistics
    uint32_t anomaly_events;        // Total anomaly detections
    uint32_t phase_transitions;     // Phase change count
} FRAG_APP_BRAIN;

/**
 * Fragmergent analysis result
 */
typedef struct _FRAG_RESULT {
    // Core metrics
    int32_t clarity;                // Current clarity (0-1000)
    int32_t clarity_delta;          // Change from baseline (-1000 to +1000)
    int32_t anomaly_score;          // Anomaly magnitude (0-1000)

    // Phase information
    FRAG_PHASE phase;
    FRAG_ANOMALY_LEVEL anomaly_level;

    // Dimension-specific anomalies (bitmap)
    uint8_t anomalous_dims;         // Bit flags for which dims are anomalous

    // Confidence (0-1000)
    int32_t confidence;             // How confident are we in this result

    // Explanation (simplified for kernel)
    char explanation[64];
} FRAG_RESULT;

/**
 * Global Fragmergent engine configuration
 */
typedef struct _FRAG_CONFIG {
    // Dynamics parameters (all scaled 0-1000)
    int32_t alpha;                  // 500 = 0.5 - momentum
    int32_t beta;                   // 300 = 0.3 - coupling strength
    int32_t delta;                  // 400 = 0.4 - noise sensitivity
    int32_t eta;                    // 800 = 0.8 - memory factor
    int32_t zeta;                   // 600 = 0.6 - adaptation rate
    int32_t gamma;                  // 700 = 0.7 - damping

    // Thresholds
    int32_t theta1;                 // Fragmentation threshold
    int32_t theta2;                 // Emergence threshold

    // Anomaly thresholds
    int32_t anomaly_mild;
    int32_t anomaly_moderate;
    int32_t anomaly_severe;

    // Feature weights for clarity calculation
    int32_t feature_weights[FRAG_NUM_DIMENSIONS];
} FRAG_CONFIG;

/**
 * Main Fragmergent engine state
 */
typedef struct _FRAG_ENGINE {
    // Configuration
    FRAG_CONFIG config;

    // Per-application brains
    FRAG_APP_BRAIN apps[FRAG_MAX_TRACKED_APPS];
    uint32_t active_app_count;

    // Global statistics
    uint64_t total_events;
    uint64_t anomaly_detections;
    uint64_t phase_transitions;

    // Lock (platform-specific)
#ifdef WFP_GUARD_KERNEL
    volatile LONG lock;
#else
    volatile int32_t lock;
#endif
} FRAG_ENGINE;

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Initialize Fragmergent engine with default configuration
 */
void FragmergentInit(FRAG_ENGINE* engine);

/**
 * Initialize with custom configuration
 */
void FragmergentInitWithConfig(FRAG_ENGINE* engine, const FRAG_CONFIG* config);

/**
 * Process a behavioral feature vector for an application
 * Returns analysis result with anomaly detection
 */
FRAG_RESULT FragmergentProcess(
    FRAG_ENGINE* engine,
    uint32_t appIdHash,
    const FRAG_FEATURE_VECTOR* features,
    uint64_t timestamp_ms
);

/**
 * Get current brain state for an application
 * Returns NULL if not tracked
 */
const FRAG_APP_BRAIN* FragmergentGetBrain(
    const FRAG_ENGINE* engine,
    uint32_t appIdHash
);

/**
 * Reset brain for an application (clear learning)
 */
void FragmergentResetBrain(
    FRAG_ENGINE* engine,
    uint32_t appIdHash
);

/**
 * Decay all brains (call periodically, e.g., every minute)
 * Moves states toward neutral, forgets old patterns
 */
void FragmergentDecayAll(
    FRAG_ENGINE* engine,
    uint64_t current_time_ms
);

/**
 * Get engine statistics
 */
void FragmergentGetStats(
    const FRAG_ENGINE* engine,
    uint64_t* total_events,
    uint64_t* anomaly_detections,
    uint32_t* active_apps
);

/**
 * Check if Fragmergent recommends blocking
 * Independent of WFP decision
 */
bool FragmergentShouldBlock(const FRAG_RESULT* result);

/**
 * Get human-readable explanation for anomaly
 */
const char* FragmergentGetAnomalyExplanation(FRAG_ANOMALY_LEVEL level);

/**
 * Get phase string
 */
const char* FragmergentGetPhaseString(FRAG_PHASE phase);

#ifdef __cplusplus
}
#endif

#endif // FRAGMERGENT_BRAIN_H
