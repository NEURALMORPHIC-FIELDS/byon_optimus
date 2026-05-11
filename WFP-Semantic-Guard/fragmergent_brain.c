/*
 * FRAGMERGENT BRAIN - Implementation
 * ===================================
 *
 * Pure C implementation with integer math for kernel compatibility.
 * No floating point operations in core logic.
 *
 * Author: Lucian Borbeleac / Digital Systems Creator
 * Version: 1.0.0
 *
 * Adapted for Windows Kernel Mode
 */

#include "fragmergent_brain.h"

#ifdef WFP_GUARD_KERNEL
// Windows Kernel Mode - no string.h needed, use NT functions
#else
#include <string.h>
#endif

// ============================================================================
// PLATFORM ABSTRACTION MACROS
// ============================================================================

#ifdef WFP_GUARD_KERNEL
#define FRAG_MEMSET(dst, val, size)     RtlZeroMemory((dst), (size))
#define FRAG_MEMCPY(dst, src, size)     RtlCopyMemory((dst), (src), (size))
#define FRAG_UINT64_MAX                 ((UINT64)-1)
#else
#define FRAG_MEMSET(dst, val, size)     memset((dst), (val), (size))
#define FRAG_MEMCPY(dst, src, size)     memcpy((dst), (src), (size))
#define FRAG_UINT64_MAX                 UINT64_MAX
#endif

// ============================================================================
// INTERNAL HELPER FUNCTIONS (Integer Math)
// ============================================================================

/**
 * Integer square root approximation (Newton's method)
 * Input and output scaled by 1000
 */
static int32_t isqrt_scaled(int32_t x) {
    if (x <= 0) return 0;
    if (x < 1000) return 31;  // sqrt(x) where x < 1 → small value

    int32_t guess = x / 2;
    int32_t prev = 0;
    int iter = 0;

    while (guess != prev && iter < 20) {
        prev = guess;
        // Newton: guess = (guess + x/guess) / 2
        // Scaled: guess = (guess + (x * 1000) / guess) / 2
        guess = (guess + (x * 1000) / guess) / 2;
        iter++;
    }

    return guess;
}

/**
 * Absolute value
 */
static int32_t iabs(int32_t x) {
    return x < 0 ? -x : x;
}

/**
 * Clamp value to range
 */
static int32_t iclamp(int32_t x, int32_t min_val, int32_t max_val) {
    if (x < min_val) return min_val;
    if (x > max_val) return max_val;
    return x;
}

/**
 * Simple hash for finding app slot
 */
static uint32_t hash_to_slot(uint32_t hash, uint32_t max_slots) {
    return hash % max_slots;
}

/**
 * Spinlock acquire (platform-specific)
 */
#ifdef WFP_GUARD_KERNEL
static void acquire_lock(volatile LONG* lock) {
    while (InterlockedCompareExchange(lock, 1, 0) != 0) {
        // Busy wait - consider using KeSpinLock for production
        YieldProcessor();
    }
}
#else
static void acquire_lock(volatile int32_t* lock) {
    while (__sync_lock_test_and_set(lock, 1)) {
        // Busy wait
    }
}
#endif

/**
 * Spinlock release (platform-specific)
 */
#ifdef WFP_GUARD_KERNEL
static void release_lock(volatile LONG* lock) {
    InterlockedExchange(lock, 0);
}
#else
static void release_lock(volatile int32_t* lock) {
    __sync_lock_release(lock);
}
#endif

// ============================================================================
// INITIALIZATION
// ============================================================================

void FragmergentInit(FRAG_ENGINE* engine) {
    FRAG_CONFIG default_config;
    int i;

    // Initialize config
    default_config.alpha = 500;       // 0.5 - momentum
    default_config.beta = 300;        // 0.3 - coupling
    default_config.delta = 400;       // 0.4 - noise sensitivity
    default_config.eta = 800;         // 0.8 - memory
    default_config.zeta = 600;        // 0.6 - adaptation
    default_config.gamma = 700;       // 0.7 - damping

    // Thresholds
    default_config.theta1 = FRAG_THETA1_DEFAULT;
    default_config.theta2 = FRAG_THETA2_DEFAULT;

    // Anomaly thresholds
    default_config.anomaly_mild = FRAG_ANOMALY_MILD_THRESHOLD;
    default_config.anomaly_moderate = FRAG_ANOMALY_MODERATE_THRESHOLD;
    default_config.anomaly_severe = FRAG_ANOMALY_SEVERE_THRESHOLD;

    // Feature weights (equal by default, sum = 1000)
    for (i = 0; i < FRAG_NUM_DIMENSIONS; i++) {
        default_config.feature_weights[i] = 125;
    }

    FragmergentInitWithConfig(engine, &default_config);
}

void FragmergentInitWithConfig(FRAG_ENGINE* engine, const FRAG_CONFIG* config) {
    FRAG_MEMSET(engine, 0, sizeof(FRAG_ENGINE));
    FRAG_MEMCPY(&engine->config, config, sizeof(FRAG_CONFIG));
    engine->lock = 0;
}

// ============================================================================
// BRAIN MANAGEMENT
// ============================================================================

static FRAG_APP_BRAIN* find_or_create_brain(
    FRAG_ENGINE* engine,
    uint32_t appIdHash,
    uint64_t timestamp_ms
) {
    uint32_t start_slot;
    uint32_t slot;
    int i;

    // First pass: find existing
    start_slot = hash_to_slot(appIdHash, FRAG_MAX_TRACKED_APPS);
    slot = start_slot;

    do {
        if (engine->apps[slot].isActive &&
            engine->apps[slot].appIdHash == appIdHash) {
            return &engine->apps[slot];
        }
        slot = (slot + 1) % FRAG_MAX_TRACKED_APPS;
    } while (slot != start_slot);

    // Second pass: find empty slot
    slot = start_slot;
    do {
        if (!engine->apps[slot].isActive) {
            // Initialize new brain
            FRAG_APP_BRAIN* brain = &engine->apps[slot];
            FRAG_MEMSET(brain, 0, sizeof(FRAG_APP_BRAIN));

            brain->appIdHash = appIdHash;
            brain->isActive = true;
            brain->first_seen = timestamp_ms;
            brain->last_update = timestamp_ms;
            brain->phase = FRAG_PHASE_EQUILIBRIUM;
            brain->clarity = 500;           // Start neutral
            brain->clarity_baseline = 500;

            // Initialize dimensions to neutral
            for (i = 0; i < FRAG_NUM_DIMENSIONS; i++) {
                brain->dims[i].P = 500;
                brain->dims[i].P_prev = 500;
                brain->dims[i].P_prev2 = 500;
                brain->dims[i].baseline_mean = 500;
                brain->dims[i].baseline_var = 0;
                brain->dims[i].baseline_min = 1000;
                brain->dims[i].baseline_max = 0;
            }

            engine->active_app_count++;
            return brain;
        }
        slot = (slot + 1) % FRAG_MAX_TRACKED_APPS;
    } while (slot != start_slot);

    // No space available - evict oldest
    {
        uint64_t oldest_time = FRAG_UINT64_MAX;
        uint32_t oldest_slot = 0;
        FRAG_APP_BRAIN* brain;

        for (i = 0; i < (int)FRAG_MAX_TRACKED_APPS; i++) {
            if (engine->apps[i].isActive && engine->apps[i].last_update < oldest_time) {
                oldest_time = engine->apps[i].last_update;
                oldest_slot = (uint32_t)i;
            }
        }

        // Reinitialize the slot
        brain = &engine->apps[oldest_slot];
        FRAG_MEMSET(brain, 0, sizeof(FRAG_APP_BRAIN));
        brain->appIdHash = appIdHash;
        brain->isActive = true;
        brain->first_seen = timestamp_ms;
        brain->last_update = timestamp_ms;
        brain->phase = FRAG_PHASE_EQUILIBRIUM;
        brain->clarity = 500;
        brain->clarity_baseline = 500;

        for (i = 0; i < FRAG_NUM_DIMENSIONS; i++) {
            brain->dims[i].P = 500;
            brain->dims[i].P_prev = 500;
            brain->dims[i].P_prev2 = 500;
            brain->dims[i].baseline_mean = 500;
        }

        return brain;
    }
}

// ============================================================================
// CORE FRAGMERGENT DYNAMICS
// ============================================================================

/**
 * Update baseline statistics for a dimension
 * Uses exponential moving average
 */
static void update_baseline(
    FRAG_DIM_STATE* dim,
    int32_t new_value,
    int32_t eta  // Memory factor (0-1000)
) {
    int32_t diff;
    int32_t diff_sq;

    // EMA: mean = eta * mean + (1-eta) * new_value
    // Scaled: mean = (eta * mean + (1000 - eta) * new_value) / 1000
    dim->baseline_mean = (eta * dim->baseline_mean + (1000 - eta) * new_value) / 1000;

    // Update variance estimate
    diff = new_value - dim->baseline_mean;
    diff_sq = (diff * diff) / 1000;  // Scale down to avoid overflow
    dim->baseline_var = (eta * dim->baseline_var + (1000 - eta) * diff_sq) / 1000;

    // Update min/max
    if (new_value < dim->baseline_min) dim->baseline_min = new_value;
    if (new_value > dim->baseline_max) dim->baseline_max = new_value;
}

/**
 * Compute fragmentation force F for a dimension
 * F = second derivative of P (acceleration)
 */
static int32_t compute_fragmentation(const FRAG_DIM_STATE* dim) {
    // F = P - 2*P_prev + P_prev2 (discrete second derivative)
    return dim->P - 2 * dim->P_prev + dim->P_prev2;
}

/**
 * Compute ESP (Emergent Synergistic Perturbation)
 * Measures deviation from baseline weighted by variance
 */
static int32_t compute_esp(
    const FRAG_DIM_STATE* dim,
    int32_t delta  // Noise sensitivity
) {
    int32_t deviation;
    int32_t std_dev;
    int32_t esp;

    deviation = iabs(dim->P - dim->baseline_mean);

    // Normalize by standard deviation (sqrt of variance)
    std_dev = isqrt_scaled(dim->baseline_var * 1000);
    if (std_dev < 50) std_dev = 50;  // Minimum to avoid division issues

    // ESP = (deviation / std_dev) * delta
    // Z-score scaled by sensitivity
    esp = (deviation * delta) / std_dev;

    return iclamp(esp, 0, 1000);
}

/**
 * Update dimensional state with new observation
 * Returns updated ESP
 */
static void update_dimension(
    FRAG_DIM_STATE* dim,
    int32_t new_value,
    const FRAG_CONFIG* config
) {
    // Shift history
    dim->P_prev2 = dim->P_prev;
    dim->P_prev = dim->P;

    // Update current state with momentum
    // P_new = gamma * P_old + (1-gamma) * observation
    dim->P = (config->gamma * dim->P + (1000 - config->gamma) * new_value) / 1000;

    // Compute derived metrics
    dim->F = compute_fragmentation(dim);
    dim->ESP = compute_esp(dim, config->delta);

    // Update baseline
    update_baseline(dim, new_value, config->eta);
}

/**
 * Compute overall clarity score
 * Clarity = 1 - weighted_mean(ESP)
 */
static int32_t compute_clarity(
    const FRAG_APP_BRAIN* brain,
    const FRAG_CONFIG* config
) {
    int64_t weighted_esp_sum = 0;
    int32_t weight_sum = 0;
    int32_t mean_esp;
    int i;

    for (i = 0; i < FRAG_NUM_DIMENSIONS; i++) {
        weighted_esp_sum += (int64_t)brain->dims[i].ESP * config->feature_weights[i];
        weight_sum += config->feature_weights[i];
    }

    mean_esp = (int32_t)(weighted_esp_sum / weight_sum);

    // Clarity = 1000 - mean_esp
    return iclamp(1000 - mean_esp, 0, 1000);
}

/**
 * Detect current phase based on fragmentation forces
 */
static FRAG_PHASE detect_phase(
    const FRAG_APP_BRAIN* brain,
    const FRAG_CONFIG* config
) {
    int32_t total_frag = 0;
    int32_t total_esp = 0;
    int32_t mean_frag;
    int32_t mean_esp;
    int i;

    // Compute mean absolute fragmentation
    for (i = 0; i < FRAG_NUM_DIMENSIONS; i++) {
        total_frag += iabs(brain->dims[i].F);
    }
    mean_frag = total_frag / FRAG_NUM_DIMENSIONS;

    // Compute mean ESP
    for (i = 0; i < FRAG_NUM_DIMENSIONS; i++) {
        total_esp += brain->dims[i].ESP;
    }
    mean_esp = total_esp / FRAG_NUM_DIMENSIONS;

    // Phase detection
    if (mean_frag > config->theta1 && mean_esp > config->theta1 * 2) {
        return FRAG_PHASE_FRAGMENTATION;
    } else if (mean_esp > config->theta2 && mean_frag < config->theta1 / 2) {
        return FRAG_PHASE_EMERGENCE;
    }

    return FRAG_PHASE_EQUILIBRIUM;
}

/**
 * Determine anomaly level from clarity delta
 */
static FRAG_ANOMALY_LEVEL compute_anomaly_level(
    int32_t clarity_delta,
    const FRAG_CONFIG* config
) {
    int32_t drop = -clarity_delta;  // Positive = clarity dropped

    if (drop >= config->anomaly_severe + 200) {
        return FRAG_ANOMALY_CRITICAL;
    } else if (drop >= config->anomaly_severe) {
        return FRAG_ANOMALY_SEVERE;
    } else if (drop >= config->anomaly_moderate) {
        return FRAG_ANOMALY_MODERATE;
    } else if (drop >= config->anomaly_mild) {
        return FRAG_ANOMALY_MILD;
    }

    return FRAG_ANOMALY_NONE;
}

/**
 * Identify which dimensions are anomalous
 */
static uint8_t identify_anomalous_dims(
    const FRAG_APP_BRAIN* brain,
    int32_t threshold  // ESP threshold for anomaly
) {
    uint8_t flags = 0;
    int i;

    for (i = 0; i < FRAG_NUM_DIMENSIONS; i++) {
        if (brain->dims[i].ESP > threshold) {
            flags |= (1 << i);
        }
    }

    return flags;
}

/**
 * Build explanation string
 */
static void build_explanation(
    char* buf,
    size_t buf_size,
    FRAG_ANOMALY_LEVEL level,
    FRAG_PHASE phase,
    uint8_t anomalous_dims,
    int32_t clarity_delta
) {
    static const char* dim_names[FRAG_NUM_DIMENSIONS] = {
        "pktSize", "burst", "connFreq", "portDiv",
        "ipDiv", "proto", "timeOfDay", "entropy"
    };

    int count = 0;
    char dims_str[64];
    char* p;
    size_t remaining;
    int i;
    const char* level_str;
    const char* phase_str;

    if (level == FRAG_ANOMALY_NONE) {
#ifdef WFP_GUARD_KERNEL
        RtlStringCchCopyA(buf, buf_size, "Normal operation");
#else
        snprintf(buf, buf_size, "Normal operation");
#endif
        return;
    }

    // Build dimension string
    dims_str[0] = '\0';
    p = dims_str;
    remaining = sizeof(dims_str);

    for (i = 0; i < FRAG_NUM_DIMENSIONS; i++) {
        if (anomalous_dims & (1 << i)) {
            size_t len;
            if (count > 0 && remaining > 1) {
                *p++ = ',';
                remaining--;
            }
#ifdef WFP_GUARD_KERNEL
            RtlStringCchCopyA(p, remaining, dim_names[i]);
            RtlStringCchLengthA(p, remaining, &len);
#else
            len = strlen(dim_names[i]);
            if (len < remaining) {
                strcpy(p, dim_names[i]);
            }
#endif
            p += len;
            remaining -= len;
            count++;
            if (count >= 3) {
                if ((anomalous_dims >> (i + 1)) && remaining > 3) {
#ifdef WFP_GUARD_KERNEL
                    RtlStringCchCopyA(p, remaining, "...");
#else
                    strcpy(p, "...");
#endif
                }
                break;
            }
        }
    }

    level_str = FragmergentGetAnomalyExplanation(level);
    phase_str = FragmergentGetPhaseString(phase);

#ifdef WFP_GUARD_KERNEL
    RtlStringCchPrintfA(buf, buf_size, "%s anomaly in [%s], phase=%s, clarity_drop=%d",
                        level_str, dims_str, phase_str, -clarity_delta / 10);
#else
    snprintf(buf, buf_size, "%s anomaly in [%s], phase=%s, clarity_drop=%d",
             level_str, dims_str, phase_str, -clarity_delta / 10);
#endif
}

// ============================================================================
// MAIN PROCESSING
// ============================================================================

FRAG_RESULT FragmergentProcess(
    FRAG_ENGINE* engine,
    uint32_t appIdHash,
    const FRAG_FEATURE_VECTOR* features,
    uint64_t timestamp_ms
) {
    FRAG_RESULT result;
    FRAG_APP_BRAIN* brain;
    int32_t values[FRAG_NUM_DIMENSIONS];
    int32_t prev_clarity;
    FRAG_PHASE prev_phase;
    int32_t clarity_delta;
    int32_t esp_threshold;
    uint8_t anomalous_dims;
    int i;

    FRAG_MEMSET(&result, 0, sizeof(result));

    acquire_lock(&engine->lock);

    // Get or create brain for this app
    brain = find_or_create_brain(engine, appIdHash, timestamp_ms);

    // Extract feature values as array
    values[0] = features->avgPacketSize;
    values[1] = features->burstiness;
    values[2] = features->connectionFrequency;
    values[3] = features->portDiversity;
    values[4] = features->ipDiversity;
    values[5] = features->protocolMix;
    values[6] = features->timeOfDayBias;
    values[7] = features->payloadEntropy;

    // Update each dimension
    for (i = 0; i < FRAG_NUM_DIMENSIONS; i++) {
        update_dimension(&brain->dims[i], values[i], &engine->config);
    }

    // Store in history buffer
    FRAG_MEMCPY(&brain->history[brain->history_index], features, sizeof(FRAG_FEATURE_VECTOR));
    brain->history_index = (brain->history_index + 1) % FRAG_HISTORY_SIZE;
    brain->sample_count++;

    // Compute global metrics
    prev_clarity = brain->clarity;
    brain->clarity = compute_clarity(brain, &engine->config);

    // Update baseline clarity (slow adaptation)
    if (brain->sample_count > FRAG_BASELINE_SAMPLES) {
        brain->clarity_baseline = (engine->config.eta * brain->clarity_baseline +
                                   (1000 - engine->config.eta) * brain->clarity) / 1000;
    } else {
        // Learning phase - track actual clarity
        brain->clarity_baseline = brain->clarity;
    }

    // Detect phase
    prev_phase = brain->phase;
    brain->phase = detect_phase(brain, &engine->config);

    if (brain->phase != prev_phase) {
        brain->phase_transitions++;
        engine->phase_transitions++;
    }

    // Compute anomaly metrics
    clarity_delta = brain->clarity - brain->clarity_baseline;
    brain->anomaly_score = iclamp(-clarity_delta, 0, 1000);
    brain->anomaly_level = compute_anomaly_level(clarity_delta, &engine->config);

    // Identify anomalous dimensions
    esp_threshold = 300;  // Dimension ESP threshold for flagging
    anomalous_dims = identify_anomalous_dims(brain, esp_threshold);

    // Track anomaly events
    if (brain->anomaly_level >= FRAG_ANOMALY_MODERATE) {
        brain->anomaly_events++;
        engine->anomaly_detections++;
    }

    // Update timestamps
    brain->last_update = timestamp_ms;

    // Build result
    result.clarity = brain->clarity;
    result.clarity_delta = clarity_delta;
    result.anomaly_score = brain->anomaly_score;
    result.phase = brain->phase;
    result.anomaly_level = brain->anomaly_level;
    result.anomalous_dims = anomalous_dims;

    // Confidence based on sample count
    if (brain->sample_count < FRAG_BASELINE_SAMPLES) {
        result.confidence = (brain->sample_count * 1000) / FRAG_BASELINE_SAMPLES;
    } else {
        result.confidence = 1000;
    }

    // Build explanation
    build_explanation(result.explanation, sizeof(result.explanation),
                     result.anomaly_level, result.phase,
                     result.anomalous_dims, result.clarity_delta);

    engine->total_events++;

    release_lock(&engine->lock);

    return result;
}

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

const FRAG_APP_BRAIN* FragmergentGetBrain(
    const FRAG_ENGINE* engine,
    uint32_t appIdHash
) {
    uint32_t start_slot = hash_to_slot(appIdHash, FRAG_MAX_TRACKED_APPS);
    uint32_t slot = start_slot;

    do {
        if (engine->apps[slot].isActive &&
            engine->apps[slot].appIdHash == appIdHash) {
            return &engine->apps[slot];
        }
        slot = (slot + 1) % FRAG_MAX_TRACKED_APPS;
    } while (slot != start_slot);

    return NULL;
}

void FragmergentResetBrain(FRAG_ENGINE* engine, uint32_t appIdHash) {
    uint32_t start_slot;
    uint32_t slot;

    acquire_lock(&engine->lock);

    start_slot = hash_to_slot(appIdHash, FRAG_MAX_TRACKED_APPS);
    slot = start_slot;

    do {
        if (engine->apps[slot].isActive &&
            engine->apps[slot].appIdHash == appIdHash) {
            engine->apps[slot].isActive = false;
            engine->active_app_count--;
            break;
        }
        slot = (slot + 1) % FRAG_MAX_TRACKED_APPS;
    } while (slot != start_slot);

    release_lock(&engine->lock);
}

void FragmergentDecayAll(FRAG_ENGINE* engine, uint64_t current_time_ms) {
    uint32_t i;
    int j;

    acquire_lock(&engine->lock);

    for (i = 0; i < FRAG_MAX_TRACKED_APPS; i++) {
        FRAG_APP_BRAIN* brain;
        uint64_t elapsed_ms;

        if (!engine->apps[i].isActive) continue;

        brain = &engine->apps[i];

        // Calculate time since last update
        elapsed_ms = current_time_ms - brain->last_update;

        // Decay towards neutral every minute
        if (elapsed_ms > 60000) {
            int32_t decay_factor = 950;  // 0.95 per minute

            // Decay all dimensions
            for (j = 0; j < FRAG_NUM_DIMENSIONS; j++) {
                brain->dims[j].P = 500 + ((brain->dims[j].P - 500) * decay_factor) / 1000;
                brain->dims[j].ESP = (brain->dims[j].ESP * decay_factor) / 1000;
            }

            // Decay clarity towards baseline
            brain->clarity = 500 + ((brain->clarity - 500) * decay_factor) / 1000;
            brain->anomaly_score = (brain->anomaly_score * decay_factor) / 1000;

            // Evict very old inactive brains (> 1 hour)
            if (elapsed_ms > 3600000 && brain->sample_count < 10) {
                brain->isActive = false;
                engine->active_app_count--;
            }
        }
    }

    release_lock(&engine->lock);
}

void FragmergentGetStats(
    const FRAG_ENGINE* engine,
    uint64_t* total_events,
    uint64_t* anomaly_detections,
    uint32_t* active_apps
) {
    if (total_events) *total_events = engine->total_events;
    if (anomaly_detections) *anomaly_detections = engine->anomaly_detections;
    if (active_apps) *active_apps = engine->active_app_count;
}

// ============================================================================
// WFP INTEGRATION HELPERS
// ============================================================================

#ifndef WFP_GUARD_KERNEL
// These functions use floating point, only available in user mode

void FragmergentConvertFromWFP(
    FRAG_FEATURE_VECTOR* out,
    float avgPacketSize,
    float burstiness,
    float connectionFrequency,
    float portDiversity,
    float ipDiversity,
    float protocolMix,
    float timeOfDayBias,
    float payloadEntropy
) {
    // Convert 0.0-1.0 floats to 0-1000 integers
    out->avgPacketSize = (uint16_t)(avgPacketSize * 1000);
    out->burstiness = (uint16_t)(burstiness * 1000);
    out->connectionFrequency = (uint16_t)(connectionFrequency * 1000);
    out->portDiversity = (uint16_t)(portDiversity * 1000);
    out->ipDiversity = (uint16_t)(ipDiversity * 1000);
    out->protocolMix = (uint16_t)(protocolMix * 1000);
    out->timeOfDayBias = (uint16_t)(timeOfDayBias * 1000);
    out->payloadEntropy = (uint16_t)(payloadEntropy * 1000);
}

float FragmergentAdjustReputation(
    float wfp_reputation,
    const FRAG_RESULT* frag_result,
    float fragmergent_weight
) {
    // Convert Fragmergent clarity to 0-1 scale
    float frag_score = frag_result->clarity / 1000.0f;

    // Adjust based on confidence
    float confidence = frag_result->confidence / 1000.0f;
    float effective_weight = fragmergent_weight * confidence;

    // Weighted combination
    float adjusted = wfp_reputation * (1.0f - effective_weight) +
                     frag_score * effective_weight;

    // Apply anomaly penalty
    if (frag_result->anomaly_level >= FRAG_ANOMALY_SEVERE) {
        adjusted -= 0.20f;  // Severe anomaly = -20% reputation
    } else if (frag_result->anomaly_level >= FRAG_ANOMALY_MODERATE) {
        adjusted -= 0.10f;  // Moderate = -10%
    } else if (frag_result->anomaly_level >= FRAG_ANOMALY_MILD) {
        adjusted -= 0.05f;  // Mild = -5%
    }

    // Apply phase penalty for fragmentation
    if (frag_result->phase == FRAG_PHASE_FRAGMENTATION) {
        adjusted -= 0.15f;
    }

    // Clamp to valid range
    if (adjusted < 0.0f) adjusted = 0.0f;
    if (adjusted > 1.0f) adjusted = 1.0f;

    return adjusted;
}

#endif  // !WFP_GUARD_KERNEL

bool FragmergentShouldBlock(const FRAG_RESULT* result) {
    // Block on critical anomaly
    if (result->anomaly_level >= FRAG_ANOMALY_CRITICAL) {
        return true;
    }

    // Block on severe anomaly with high confidence
    if (result->anomaly_level >= FRAG_ANOMALY_SEVERE &&
        result->confidence >= 800) {
        return true;
    }

    // Block on fragmentation phase with severe anomaly
    if (result->phase == FRAG_PHASE_FRAGMENTATION &&
        result->anomaly_level >= FRAG_ANOMALY_MODERATE) {
        return true;
    }

    return false;
}

const char* FragmergentGetAnomalyExplanation(FRAG_ANOMALY_LEVEL level) {
    switch (level) {
        case FRAG_ANOMALY_NONE:     return "None";
        case FRAG_ANOMALY_MILD:     return "Mild";
        case FRAG_ANOMALY_MODERATE: return "Moderate";
        case FRAG_ANOMALY_SEVERE:   return "Severe";
        case FRAG_ANOMALY_CRITICAL: return "CRITICAL";
        default:                    return "Unknown";
    }
}

const char* FragmergentGetPhaseString(FRAG_PHASE phase) {
    switch (phase) {
        case FRAG_PHASE_EQUILIBRIUM:    return "Equilibrium";
        case FRAG_PHASE_FRAGMENTATION:  return "Fragmentation";
        case FRAG_PHASE_EMERGENCE:      return "Emergence";
        default:                        return "Unknown";
    }
}
