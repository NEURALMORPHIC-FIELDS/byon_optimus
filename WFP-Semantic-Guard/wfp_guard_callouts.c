/*
 * WFP SEMANTIC GUARD - WFP Callout Functions
 * 
 * Windows Filtering Platform callout registration and classification.
 * 
 * Copyright (c) 2025 - Network Execution Guard Project
 */

#include "wfp_guard_driver.h"
#include <ntstrsafe.h>

// ============================================================================
// CLUSTER CENTROIDS (integer arrays, 0-1000 scale)
// [avg_pkt_size, burstiness, conn_freq, port_div, ip_div, proto_mix, tod_bias, entropy]
// ============================================================================

static const UINT16 g_ClusterCentroids[7][8] = {
    { 400, 700, 800, 900, 800, 950, 600, 500 },  // BROWSER_LIKE
    { 200, 350,  20,  50,  50, 900, 500,  30 },  // BACKGROUND_SERVICE
    { 600, 800, 500, 700, 900, 500, 500, 600 },  // P2P_LIKE
    { 120,  50,  20,  20,  20, 950, 500, 110 },  // BEACON_LIKE
    { 850, 400, 500,  50,  50, 980, 300, 850 },  // EXFILTRATION_LIKE
    { 100, 600, 700, 100, 950, 900, 500, 300 },  // DGA_LIKE
    { 950, 950, 950,  20,  20, 980, 300, 900 },  // BURST_EXFIL
};

static const UINT16 g_ClusterWeights[8] = { 100, 150, 100, 100, 250, 30, 30, 240 };

static const BOOLEAN g_ClusterIsMalicious[7] = {
    FALSE,  // BROWSER_LIKE
    FALSE,  // BACKGROUND_SERVICE
    FALSE,  // P2P_LIKE (neutral)
    TRUE,   // BEACON_LIKE
    TRUE,   // EXFILTRATION_LIKE
    TRUE,   // DGA_LIKE
    TRUE,   // BURST_EXFIL
};

// ============================================================================
// WFP REGISTRATION
// ============================================================================

NTSTATUS
WfpGuardRegisterCallouts(
    _In_ PDEVICE_OBJECT DeviceObject
    )
{
    NTSTATUS status;
    FWPM_SESSION0 session = {0};
    FWPM_PROVIDER0 provider = {0};
    FWPM_SUBLAYER0 sublayer = {0};
    FWPS_CALLOUT3 callout = {0};
    FWPM_CALLOUT0 mCallout = {0};
    FWPM_FILTER0 filter = {0};
    FWPM_FILTER_CONDITION0 filterConditions[1] = {0};

    //
    // Open WFP engine session
    //
    session.flags = FWPM_SESSION_FLAG_DYNAMIC;

    status = FwpmEngineOpen0(NULL, RPC_C_AUTHN_DEFAULT, NULL, &session, &g_Context->EngineHandle);
    if (!NT_SUCCESS(status)) {
        KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_ERROR_LEVEL,
            "WfpGuard: FwpmEngineOpen0 failed 0x%08X\n", status));
        return status;
    }

    //
    // Start transaction
    //
    status = FwpmTransactionBegin0(g_Context->EngineHandle, 0);
    if (!NT_SUCCESS(status)) {
        goto Cleanup;
    }

    //
    // Register provider
    //
    provider.providerKey = WFP_GUARD_PROVIDER_KEY;
    provider.displayData.name = L"WFP Semantic Guard Provider";
    provider.displayData.description = L"Network execution guard using behavioral analysis";
    provider.flags = FWPM_PROVIDER_FLAG_PERSISTENT;

    status = FwpmProviderAdd0(g_Context->EngineHandle, &provider, NULL);
    if (!NT_SUCCESS(status) && status != STATUS_FWP_ALREADY_EXISTS) {
        goto Abort;
    }

    //
    // Register sublayer
    //
    sublayer.subLayerKey = WFP_GUARD_SUBLAYER_KEY;
    sublayer.displayData.name = L"WFP Semantic Guard Sublayer";
    sublayer.displayData.description = L"Sublayer for semantic traffic analysis";
    sublayer.providerKey = (GUID*)&WFP_GUARD_PROVIDER_KEY;
    sublayer.weight = 0xFFFF;  // High priority
    sublayer.flags = 0;

    status = FwpmSubLayerAdd0(g_Context->EngineHandle, &sublayer, NULL);
    if (!NT_SUCCESS(status) && status != STATUS_FWP_ALREADY_EXISTS) {
        goto Abort;
    }

    //
    // Register ALE_AUTH_CONNECT_V4 callout (outbound connection authorization)
    //
    callout.calloutKey = WFP_GUARD_CALLOUT_CONNECT_V4_KEY;
    callout.flags = 0;
    callout.classifyFn = WfpGuardConnectClassify;
    callout.notifyFn = WfpGuardConnectNotify;
    callout.flowDeleteFn = NULL;

    status = FwpsCalloutRegister3(DeviceObject, &callout, &g_Context->CalloutIdConnectV4);
    if (!NT_SUCCESS(status)) {
        KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_ERROR_LEVEL,
            "WfpGuard: FwpsCalloutRegister3 (connect) failed 0x%08X\n", status));
        goto Abort;
    }

    //
    // Add management callout for ALE_AUTH_CONNECT
    //
    mCallout.calloutKey = WFP_GUARD_CALLOUT_CONNECT_V4_KEY;
    mCallout.displayData.name = L"WFP Guard Connect Callout";
    mCallout.displayData.description = L"Analyzes outbound connections";
    mCallout.providerKey = (GUID*)&WFP_GUARD_PROVIDER_KEY;
    mCallout.applicableLayer = FWPM_LAYER_ALE_AUTH_CONNECT_V4;
    mCallout.flags = 0;

    status = FwpmCalloutAdd0(g_Context->EngineHandle, &mCallout, NULL, NULL);
    if (!NT_SUCCESS(status) && status != STATUS_FWP_ALREADY_EXISTS) {
        goto Abort;
    }

    //
    // Add filter for ALE_AUTH_CONNECT
    //
    filter.filterKey = WFP_GUARD_FILTER_CONNECT_V4_KEY;
    filter.displayData.name = L"WFP Guard Connect Filter";
    filter.displayData.description = L"Filters outbound connections";
    filter.flags = FWPM_FILTER_FLAG_NONE;
    filter.providerKey = (GUID*)&WFP_GUARD_PROVIDER_KEY;
    filter.layerKey = FWPM_LAYER_ALE_AUTH_CONNECT_V4;
    filter.subLayerKey = WFP_GUARD_SUBLAYER_KEY;
    filter.weight.type = FWP_UINT8;
    filter.weight.uint8 = 0x0F;
    filter.numFilterConditions = 0;  // Match all
    filter.filterCondition = NULL;
    filter.action.type = FWP_ACTION_CALLOUT_TERMINATING;
    filter.action.calloutKey = WFP_GUARD_CALLOUT_CONNECT_V4_KEY;

    status = FwpmFilterAdd0(g_Context->EngineHandle, &filter, NULL, &g_Context->FilterIdConnectV4);
    if (!NT_SUCCESS(status)) {
        KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_ERROR_LEVEL,
            "WfpGuard: FwpmFilterAdd0 (connect) failed 0x%08X\n", status));
        goto Abort;
    }

    //
    // Register ALE_FLOW_ESTABLISHED callout (for flow tracking)
    //
    RtlZeroMemory(&callout, sizeof(callout));
    callout.calloutKey = WFP_GUARD_CALLOUT_FLOW_V4_KEY;
    callout.flags = FWP_CALLOUT_FLAG_CONDITIONAL_ON_FLOW;
    callout.classifyFn = WfpGuardFlowClassify;
    callout.notifyFn = WfpGuardConnectNotify;
    callout.flowDeleteFn = WfpGuardFlowDelete;

    status = FwpsCalloutRegister3(DeviceObject, &callout, &g_Context->CalloutIdFlowV4);
    if (!NT_SUCCESS(status)) {
        KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_ERROR_LEVEL,
            "WfpGuard: FwpsCalloutRegister3 (flow) failed 0x%08X\n", status));
        goto Abort;
    }

    //
    // Add management callout for flow
    //
    RtlZeroMemory(&mCallout, sizeof(mCallout));
    mCallout.calloutKey = WFP_GUARD_CALLOUT_FLOW_V4_KEY;
    mCallout.displayData.name = L"WFP Guard Flow Callout";
    mCallout.displayData.description = L"Tracks established flows";
    mCallout.providerKey = (GUID*)&WFP_GUARD_PROVIDER_KEY;
    mCallout.applicableLayer = FWPM_LAYER_ALE_FLOW_ESTABLISHED_V4;
    mCallout.flags = 0;

    status = FwpmCalloutAdd0(g_Context->EngineHandle, &mCallout, NULL, NULL);
    if (!NT_SUCCESS(status) && status != STATUS_FWP_ALREADY_EXISTS) {
        goto Abort;
    }

    //
    // Commit transaction
    //
    status = FwpmTransactionCommit0(g_Context->EngineHandle);
    if (!NT_SUCCESS(status)) {
        goto Cleanup;
    }

    KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_INFO_LEVEL,
        "WfpGuard: WFP callouts registered successfully\n"));

    return STATUS_SUCCESS;

Abort:
    FwpmTransactionAbort0(g_Context->EngineHandle);

Cleanup:
    if (g_Context->CalloutIdConnectV4 != 0) {
        FwpsCalloutUnregisterById0(g_Context->CalloutIdConnectV4);
        g_Context->CalloutIdConnectV4 = 0;
    }
    if (g_Context->CalloutIdFlowV4 != 0) {
        FwpsCalloutUnregisterById0(g_Context->CalloutIdFlowV4);
        g_Context->CalloutIdFlowV4 = 0;
    }
    if (g_Context->EngineHandle != NULL) {
        FwpmEngineClose0(g_Context->EngineHandle);
        g_Context->EngineHandle = NULL;
    }

    return status;
}

VOID
WfpGuardUnregisterCallouts(
    VOID
    )
{
    if (g_Context == NULL) {
        return;
    }

    if (g_Context->EngineHandle != NULL) {
        // Filters are auto-deleted with dynamic session
        
        if (g_Context->CalloutIdConnectV4 != 0) {
            FwpsCalloutUnregisterById0(g_Context->CalloutIdConnectV4);
            g_Context->CalloutIdConnectV4 = 0;
        }
        
        if (g_Context->CalloutIdFlowV4 != 0) {
            FwpsCalloutUnregisterById0(g_Context->CalloutIdFlowV4);
            g_Context->CalloutIdFlowV4 = 0;
        }

        FwpmEngineClose0(g_Context->EngineHandle);
        g_Context->EngineHandle = NULL;
    }

    KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_INFO_LEVEL,
        "WfpGuard: WFP callouts unregistered\n"));
}

// ============================================================================
// FRAGMERGENT HELPER FUNCTIONS
// ============================================================================

//
// Build Fragmergent feature vector from app metrics
//
static VOID
BuildFragmergentFeatures(
    _In_ PWFP_APP_ENTRY AppEntry,
    _Out_ FRAG_FEATURE_VECTOR* Features
    )
{
    PWFP_GUARD_APP_METRICS m = &AppEntry->Metrics;
    LARGE_INTEGER now;
    UINT64 spanMs;

    // avgPacketSize: normalized to 0-1500 bytes -> 0-1000
    Features->avgPacketSize = (UINT16)((m->TotalBytesSent / (m->PacketCount + 1)) * 1000 / 1500);
    if (Features->avgPacketSize > 1000) Features->avgPacketSize = 1000;

    // burstiness: coefficient of variation
    Features->burstiness = m->BurstinessScore;
    if (Features->burstiness > 1000) Features->burstiness = 1000;

    // connectionFrequency: normalized to 0-100 conn/min -> 0-1000
    KeQuerySystemTime(&now);
    spanMs = (now.QuadPart - m->FirstSeen) / 10000;
    if (spanMs < 60000) spanMs = 60000;
    {
        UINT32 connPerMin = (m->TotalConnections * 60000) / (UINT32)spanMs;
        Features->connectionFrequency = (UINT16)(connPerMin * 10);
        if (Features->connectionFrequency > 1000) Features->connectionFrequency = 1000;
    }

    // portDiversity
    Features->portDiversity = (UINT16)((m->UniqueRemotePorts * 1000) / (m->TotalConnections + 1));
    if (Features->portDiversity > 1000) Features->portDiversity = 1000;

    // ipDiversity
    Features->ipDiversity = (UINT16)((m->UniqueRemoteIPs * 1000) / (m->TotalConnections + 1));
    if (Features->ipDiversity > 1000) Features->ipDiversity = 1000;

    // protocolMix: simplified (assume mostly TCP)
    Features->protocolMix = 900;

    // timeOfDayBias: neutral in kernel
    Features->timeOfDayBias = 500;

    // payloadEntropy
    Features->payloadEntropy = m->EntropyScore;
    if (Features->payloadEntropy > 1000) Features->payloadEntropy = 1000;
}

// ============================================================================
// QUICK CLASSIFICATION (kernel-side, fast)
// ============================================================================

//
// Compute weighted distance to cluster centroid
// Returns distance * 1000
//
static UINT32
ComputeClusterDistance(
    _In_ const UINT16* Features,
    _In_ UINT32 ClusterIndex
    )
{
    UINT32 distance = 0;
    UINT32 i;
    INT32 diff;

    for (i = 0; i < 8; i++) {
        diff = (INT32)Features[i] - (INT32)g_ClusterCentroids[ClusterIndex][i];
        distance += (UINT32)((diff * diff * g_ClusterWeights[i]) / 1000);
    }

    return WfpGuardIsqrt(distance * 1000);
}

//
// Classify app based on collected metrics
// Returns cluster index (0=unclustered, 1-7=clusters)
//
static WFP_GUARD_CLUSTER_TYPE
ClassifyApp(
    _In_ PWFP_APP_ENTRY AppEntry,
    _Out_ PUINT16 Similarity
    )
{
    UINT16 features[8];
    UINT32 minDist = MAXUINT32;
    UINT32 dist;
    UINT32 i;
    WFP_GUARD_CLUSTER_TYPE bestCluster = CLUSTER_UNCLUSTERED;
    PWFP_GUARD_APP_METRICS m = &AppEntry->Metrics;

    *Similarity = 0;

    if (m->TotalConnections < CFG_MIN_SAMPLES_FOR_CLUSTERING) {
        return CLUSTER_UNCLUSTERED;
    }

    //
    // Build feature vector (0-1000 scale)
    //
    
    // avg_packet_size: normalized to 0-1500 bytes
    features[0] = (UINT16)((m->TotalBytesSent / (m->PacketCount + 1)) * 1000 / 1500);
    if (features[0] > 1000) features[0] = 1000;

    // burstiness: coefficient of variation of intervals
    features[1] = WfpGuardComputeCV(m->IntervalSum, m->IntervalSumSq, m->IntervalCount);
    if (features[1] > 1000) features[1] = 1000;

    // connection_frequency: normalized to 0-100 conn/min
    {
        LARGE_INTEGER now;
        UINT64 spanMs;
        KeQuerySystemTime(&now);
        spanMs = (now.QuadPart - m->FirstSeen) / 10000;
        if (spanMs < 60000) spanMs = 60000; // min 1 minute
        
        UINT32 connPerMin = (m->TotalConnections * 60000) / (UINT32)spanMs;
        features[2] = (UINT16)(connPerMin * 10);  // 100 conn/min = 1000
        if (features[2] > 1000) features[2] = 1000;
    }

    // port_diversity
    features[3] = (UINT16)((m->UniqueRemotePorts * 1000) / (m->TotalConnections + 1));
    if (features[3] > 1000) features[3] = 1000;

    // ip_diversity
    features[4] = (UINT16)((m->UniqueRemoteIPs * 1000) / (m->TotalConnections + 1));
    if (features[4] > 1000) features[4] = 1000;

    // protocol_mix (assume TCP=1000, UDP=500, other=250 average)
    features[5] = 900;  // Simplified: assume mostly TCP

    // time_of_day_bias (not computed in kernel, neutral)
    features[6] = 500;

    // payload_entropy (average, scaled from 0-80 to 0-1000)
    if (m->PacketCount > 0) {
        features[7] = m->EntropyScore;
    } else {
        features[7] = 500;
    }

    //
    // Find nearest cluster
    //
    for (i = 0; i < 7; i++) {
        dist = ComputeClusterDistance(features, i);
        if (dist < minDist) {
            minDist = dist;
            bestCluster = (WFP_GUARD_CLUSTER_TYPE)(i + 1);
        }
    }

    // Similarity = 1000 - normalized_distance
    // Max theoretical distance ~3000 (if all features differ by 1000 with max weights)
    *Similarity = (UINT16)(1000 - (minDist * 1000 / 3000));
    
    // Check threshold
    if (*Similarity < g_Context->Config.ClusterThreshold) {
        return CLUSTER_UNCLUSTERED;
    }

    return bestCluster;
}

//
// Quick kernel-side verdict
//
WFP_GUARD_ACTION
WfpGuardQuickClassify(
    _In_ PWFP_APP_ENTRY AppEntry
    )
{
    UINT16 similarity;
    WFP_GUARD_CLUSTER_TYPE cluster;
    PWFP_GUARD_APP_METRICS m = &AppEntry->Metrics;

    //
    // Whitelist/blacklist override
    //
    if (m->IsWhitelisted) {
        return WFP_ACTION_ALLOW;
    }
    if (m->IsBlacklisted) {
        return WFP_ACTION_BLOCK;
    }

    //
    // Check reputation (only if enabled)
    //
    if (g_Context->Config.EnableReputation) {
        if (m->ReputationScore < g_Context->Config.ReputationBlockThreshold) {
            return WFP_ACTION_BLOCK;
        }
        if (m->ReputationScore > g_Context->Config.ReputationTrustThreshold) {
            return WFP_ACTION_ALLOW;
        }
    }

    //
    // Behavioral clustering (if enough samples)
    //
    if (g_Context->Config.EnableBehavioral && 
        m->TotalConnections >= CFG_MIN_SAMPLES_FOR_CLUSTERING) 
    {
        cluster = ClassifyApp(AppEntry, &similarity);
        m->ClusterType = cluster;

        if (cluster != CLUSTER_UNCLUSTERED && g_ClusterIsMalicious[cluster - 1]) {
            // Malicious cluster - reduce reputation
            if (m->ReputationScore > 100) {
                m->ReputationScore -= 20;
            }
            return WFP_ACTION_BLOCK;
        }
    }

    //
    // Fragmergent Brain processing (if enabled and enough samples)
    //
    if (g_Context->FragmergentConfig.Enabled && m->TotalConnections >= 5) {
        FRAG_FEATURE_VECTOR fragFeatures;
        FRAG_RESULT fragResult;
        LARGE_INTEGER currentTime;
        UINT64 timestampMs;

        // Build feature vector
        BuildFragmergentFeatures(AppEntry, &fragFeatures);

        // Get timestamp in milliseconds
        KeQuerySystemTime(&currentTime);
        timestampMs = currentTime.QuadPart / 10000;

        // Process through Fragmergent
        fragResult = FragmergentProcess(
            &g_Context->FragmergentEngine,
            m->AppHash,
            &fragFeatures,
            timestampMs
        );

        // Check if Fragmergent recommends blocking
        if (FragmergentShouldBlock(&fragResult)) {
            // Apply reputation penalty based on anomaly level
            if (m->ReputationScore > 100) {
                m->ReputationScore -= (UINT16)(10 * fragResult.anomaly_level);
            }

            KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_TRACE_LEVEL,
                "WfpGuard: Fragmergent BLOCK - clarity=%d, phase=%d, anomaly=%d\n",
                fragResult.clarity, fragResult.phase, fragResult.anomaly_level));

            return WFP_ACTION_BLOCK;
        }

        // Periodic decay (every minute)
        if (timestampMs - g_Context->FragmergentLastDecay > 60000) {
            FragmergentDecayAll(&g_Context->FragmergentEngine, timestampMs);
            g_Context->FragmergentLastDecay = timestampMs;
        }
    }

    //
    // Exfiltration detection
    //
    if (g_Context->Config.EnableExfiltration && m->PacketCount >= 15) {
        UINT32 largeRatio = (m->LargePacketCount * 1000) / m->PacketCount;
        UINT32 entropyRatio = (m->HighEntropyCount * 1000) / m->PacketCount;

        if (largeRatio >= CFG_EXFIL_LARGE_PACKET_RATIO && entropyRatio >= 500) {
            if (m->ReputationScore > 100) {
                m->ReputationScore -= 25;
            }
            return WFP_ACTION_BLOCK;
        }
    }

    //
    // Burst detection (using recent timestamps)
    //
    if (g_Context->Config.EnableBurst && AppEntry->TimestampCount >= 10) {
        UINT32 burstCount = 0;
        UINT8 i;
        
        for (i = 1; i < AppEntry->TimestampCount; i++) {
            UINT64 diff = AppEntry->RecentTimestamps[i] - AppEntry->RecentTimestamps[i-1];
            if (diff < CFG_BURST_WINDOW_MS * 10000) {  // Convert ms to 100ns
                burstCount++;
            }
        }

        if (burstCount >= CFG_BURST_MIN_PACKETS - 1) {
            UINT32 avgSize = (UINT32)(m->TotalBytesSent / m->PacketCount);
            if (avgSize >= CFG_BURST_MIN_AVG_SIZE) {
                if (m->ReputationScore > 100) {
                    m->ReputationScore -= 30;
                }
                return WFP_ACTION_BLOCK;
            }
        }
    }

    //
    // Default: allow but consider sending to user-mode for deeper analysis
    //
    return WFP_ACTION_ALLOW;
}

// ============================================================================
// UPDATE METRICS
// ============================================================================

VOID
WfpGuardUpdateAppMetrics(
    _Inout_ PWFP_APP_ENTRY AppEntry,
    _In_ PWFP_GUARD_EVENT Event
    )
{
    KIRQL oldIrql;
    PWFP_GUARD_APP_METRICS m;
    UINT32 i;
    UINT64 interval;
    BOOLEAN newIp = TRUE;
    BOOLEAN newPort = TRUE;

    KeAcquireSpinLock(&AppEntry->Lock, &oldIrql);

    m = &AppEntry->Metrics;

    //
    // Basic counters
    //
    m->TotalConnections++;
    m->PacketCount++;
    m->TotalBytesSent += Event->PacketSize;
    m->LastSeen = Event->Timestamp;

    //
    // Large packet / high entropy tracking
    //
    if (Event->PacketSize >= CFG_EXFIL_MIN_PACKET_SIZE) {
        m->LargePacketCount++;
    }
    if (Event->EntropyEstimate >= CFG_EXFIL_MIN_ENTROPY) {
        m->HighEntropyCount++;
    }

    //
    // Running entropy average (simple moving average)
    //
    m->EntropyScore = (m->EntropyScore * 9 + (Event->EntropyEstimate * 1000 / 80)) / 10;

    //
    // Unique IP/port tracking (simplified - check flows)
    //
    for (i = 0; i < AppEntry->FlowCount; i++) {
        if (AppEntry->Flows[i].RemoteIpV4 == Event->RemoteIpV4) {
            newIp = FALSE;
            if (AppEntry->Flows[i].RemotePort == Event->RemotePort) {
                newPort = FALSE;
                
                // Add timestamp to flow
                if (AppEntry->Flows[i].EventCount < MAX_TIMESTAMPS_PER_FLOW) {
                    AppEntry->Flows[i].Timestamps[AppEntry->Flows[i].EventCount++] = Event->Timestamp;
                }
                break;
            }
        }
    }

    if (newIp) {
        m->UniqueRemoteIPs++;
    }
    if (newPort && (newIp || newPort)) {
        m->UniqueRemotePorts++;
        
        // Add new flow if space
        if (AppEntry->FlowCount < MAX_FLOWS_PER_APP) {
            AppEntry->Flows[AppEntry->FlowCount].RemoteIpV4 = Event->RemoteIpV4;
            AppEntry->Flows[AppEntry->FlowCount].RemotePort = Event->RemotePort;
            AppEntry->Flows[AppEntry->FlowCount].EventCount = 1;
            AppEntry->Flows[AppEntry->FlowCount].Timestamps[0] = Event->Timestamp;
            AppEntry->FlowCount++;
        }
    }

    //
    // Interval tracking (for burstiness calculation)
    //
    if (AppEntry->TimestampCount > 0) {
        UINT8 lastIdx = (AppEntry->TimestampIndex + AppEntry->TimestampCount - 1) % 16;
        interval = (Event->Timestamp - AppEntry->RecentTimestamps[lastIdx]) / 10000;  // 100ns to ms
        
        if (interval > 0 && interval < 600000) {  // Ignore >10min gaps
            m->IntervalCount++;
            m->IntervalSum += (UINT32)interval;
            m->IntervalSumSq += (UINT32)(interval * interval / 1000);  // Scaled to prevent overflow
            
            // Histogram
            UINT8 bucket = WfpGuardIntervalToBucket((UINT32)interval);
            if (m->IntervalHistogram[bucket] < 65535) {
                m->IntervalHistogram[bucket]++;
            }
        }
    }

    //
    // Update recent timestamps circular buffer
    //
    if (AppEntry->TimestampCount < 16) {
        AppEntry->TimestampCount++;
    }
    AppEntry->RecentTimestamps[AppEntry->TimestampIndex] = Event->Timestamp;
    AppEntry->TimestampIndex = (AppEntry->TimestampIndex + 1) % 16;

    //
    // Update computed scores
    //
    m->BurstinessScore = WfpGuardComputeCV(m->IntervalSum, m->IntervalSumSq, m->IntervalCount);
    m->RegularityScore = 1000 - m->BurstinessScore;

    KeReleaseSpinLock(&AppEntry->Lock, oldIrql);
}

// ============================================================================
// CALLOUT CLASSIFY FUNCTIONS
// ============================================================================

VOID NTAPI
WfpGuardConnectClassify(
    _In_ const FWPS_INCOMING_VALUES0* InFixedValues,
    _In_ const FWPS_INCOMING_METADATA_VALUES0* InMetaValues,
    _Inout_opt_ void* LayerData,
    _In_opt_ const void* ClassifyContext,
    _In_ const FWPS_FILTER3* Filter,
    _In_ UINT64 FlowContext,
    _Inout_ FWPS_CLASSIFY_OUT0* ClassifyOut
    )
{
    WFP_GUARD_ACTION action;
    PWFP_APP_ENTRY appEntry;
    PWFP_PENDING_EVENT pendingEvent;
    WFP_GUARD_EVENT event = {0};
    WCHAR appPath[MAX_APP_PATH_LENGTH];
    UINT32 remoteIp;
    UINT16 remotePort;
    UINT16 localPort;
    UINT8 protocol;
    KIRQL oldIrql;

    UNREFERENCED_PARAMETER(LayerData);
    UNREFERENCED_PARAMETER(ClassifyContext);
    UNREFERENCED_PARAMETER(Filter);
    UNREFERENCED_PARAMETER(FlowContext);

    if (g_Context == NULL || !g_Context->Filtering) {
        ClassifyOut->actionType = FWP_ACTION_PERMIT;
        return;
    }

    //
    // Extract connection parameters
    //
    remoteIp = InFixedValues->incomingValue[FWPS_FIELD_ALE_AUTH_CONNECT_V4_IP_REMOTE_ADDRESS].value.uint32;
    remotePort = InFixedValues->incomingValue[FWPS_FIELD_ALE_AUTH_CONNECT_V4_IP_REMOTE_PORT].value.uint16;
    localPort = InFixedValues->incomingValue[FWPS_FIELD_ALE_AUTH_CONNECT_V4_IP_LOCAL_PORT].value.uint16;
    protocol = InFixedValues->incomingValue[FWPS_FIELD_ALE_AUTH_CONNECT_V4_IP_PROTOCOL].value.uint8;

    //
    // Get process path
    //
    if (FWPS_IS_METADATA_FIELD_PRESENT(InMetaValues, FWPS_METADATA_FIELD_PROCESS_PATH)) {
        RtlStringCchCopyW(appPath, MAX_APP_PATH_LENGTH, 
            (PCWSTR)InMetaValues->processPath->data);
    } else if (FWPS_IS_METADATA_FIELD_PRESENT(InMetaValues, FWPS_METADATA_FIELD_PROCESS_ID)) {
        WfpGuardGetProcessPath((HANDLE)(ULONG_PTR)InMetaValues->processId, appPath);
    } else {
        RtlStringCchCopyW(appPath, MAX_APP_PATH_LENGTH, L"<unknown>");
    }

    //
    // Find or create app entry
    //
    appEntry = WfpGuardFindOrCreateApp(appPath);
    if (appEntry == NULL) {
        // Can't track - allow
        ClassifyOut->actionType = FWP_ACTION_PERMIT;
        return;
    }

    //
    // Build event
    //
    KeQuerySystemTime((PLARGE_INTEGER)&event.Timestamp);
    event.ProcessId = FWPS_IS_METADATA_FIELD_PRESENT(InMetaValues, FWPS_METADATA_FIELD_PROCESS_ID) 
        ? (UINT32)InMetaValues->processId : 0;
    event.RemoteIpV4 = remoteIp;
    event.RemotePort = remotePort;
    event.LocalPort = localPort;
    event.Protocol = protocol;
    event.Direction = 0;  // Outbound
    event.PacketSize = 0;  // Not available at ALE layer
    event.EntropyEstimate = 50;  // Default medium

    // Initialize Fragmergent fields to defaults
    event.FragClarity = 500;
    event.FragClarityDelta = 0;
    event.FragAnomalyScore = 0;
    event.FragPhase = FRAG_PHASE_EQUILIBRIUM_E;
    event.FragAnomalyLevel = FRAG_ANOMALY_NONE_E;

    RtlStringCchCopyW(event.AppPath, MAX_APP_PATH_LENGTH, appPath);

    //
    // Update metrics
    //
    WfpGuardUpdateAppMetrics(appEntry, &event);

    //
    // Populate Fragmergent fields from brain state (if enabled)
    //
    if (g_Context->FragmergentConfig.Enabled) {
        const FRAG_APP_BRAIN* brain = FragmergentGetBrain(
            &g_Context->FragmergentEngine,
            appEntry->Metrics.AppHash
        );
        if (brain != NULL) {
            event.FragClarity = (UINT16)brain->clarity;
            event.FragClarityDelta = (INT16)(brain->clarity - brain->clarity_baseline);
            event.FragAnomalyScore = (UINT16)brain->anomaly_score;
            event.FragPhase = (UINT8)brain->phase;
            event.FragAnomalyLevel = (UINT8)brain->anomaly_level;
        }
    }

    //
    // Quick classification
    //
    action = WfpGuardQuickClassify(appEntry);

    //
    // Update statistics
    //
    KeAcquireSpinLock(&g_Context->StatsLock, &oldIrql);
    g_Context->Stats.TotalEvents++;
    if (action == WFP_ACTION_BLOCK) {
        g_Context->Stats.BlockedEvents++;
        appEntry->Metrics.BlockedConnections++;
    } else {
        g_Context->Stats.AllowedEvents++;
    }
    KeReleaseSpinLock(&g_Context->StatsLock, oldIrql);

    //
    // Apply verdict
    //
    if (action == WFP_ACTION_BLOCK) {
        ClassifyOut->actionType = FWP_ACTION_BLOCK;
        ClassifyOut->rights &= ~FWPS_RIGHT_ACTION_WRITE;
        
        KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_TRACE_LEVEL,
            "WfpGuard: BLOCKED %ws -> %u.%u.%u.%u:%u\n",
            appPath,
            (remoteIp >> 24) & 0xFF, (remoteIp >> 16) & 0xFF,
            (remoteIp >> 8) & 0xFF, remoteIp & 0xFF,
            remotePort));
    } else {
        ClassifyOut->actionType = FWP_ACTION_PERMIT;
    }
}

NTSTATUS NTAPI
WfpGuardConnectNotify(
    _In_ FWPS_CALLOUT_NOTIFY_TYPE NotifyType,
    _In_ const GUID* FilterKey,
    _Inout_ FWPS_FILTER3* Filter
    )
{
    UNREFERENCED_PARAMETER(NotifyType);
    UNREFERENCED_PARAMETER(FilterKey);
    UNREFERENCED_PARAMETER(Filter);
    return STATUS_SUCCESS;
}

VOID NTAPI
WfpGuardFlowClassify(
    _In_ const FWPS_INCOMING_VALUES0* InFixedValues,
    _In_ const FWPS_INCOMING_METADATA_VALUES0* InMetaValues,
    _Inout_opt_ void* LayerData,
    _In_opt_ const void* ClassifyContext,
    _In_ const FWPS_FILTER3* Filter,
    _In_ UINT64 FlowContext,
    _Inout_ FWPS_CLASSIFY_OUT0* ClassifyOut
    )
{
    // Flow established - can be used for additional tracking
    UNREFERENCED_PARAMETER(InFixedValues);
    UNREFERENCED_PARAMETER(InMetaValues);
    UNREFERENCED_PARAMETER(LayerData);
    UNREFERENCED_PARAMETER(ClassifyContext);
    UNREFERENCED_PARAMETER(Filter);
    UNREFERENCED_PARAMETER(FlowContext);

    ClassifyOut->actionType = FWP_ACTION_PERMIT;
}

VOID NTAPI
WfpGuardFlowDelete(
    _In_ UINT16 LayerId,
    _In_ UINT32 CalloutId,
    _In_ UINT64 FlowContext
    )
{
    // Flow deleted - cleanup if needed
    UNREFERENCED_PARAMETER(LayerId);
    UNREFERENCED_PARAMETER(CalloutId);
    UNREFERENCED_PARAMETER(FlowContext);
}
