/*
 * WFP SEMANTIC GUARD - Kernel Driver Main
 * 
 * Main driver entry, WDF device setup, and IOCTL handling.
 * 
 * Copyright (c) 2025 - Network Execution Guard Project
 */

#include "wfp_guard_driver.h"

// ============================================================================
// GLOBAL CONTEXT
// ============================================================================

PWFP_GUARD_CONTEXT g_Context = NULL;

// ============================================================================
// DRIVER ENTRY
// ============================================================================

NTSTATUS
DriverEntry(
    _In_ PDRIVER_OBJECT DriverObject,
    _In_ PUNICODE_STRING RegistryPath
    )
{
    NTSTATUS status;
    WDF_DRIVER_CONFIG driverConfig;
    WDF_OBJECT_ATTRIBUTES driverAttributes;
    WDFDRIVER driver;
    PWDFDEVICE_INIT deviceInit = NULL;
    WDF_OBJECT_ATTRIBUTES deviceAttributes;
    WDF_IO_QUEUE_CONFIG queueConfig;
    WDF_FILEOBJECT_CONFIG fileConfig;
    UNICODE_STRING deviceName;
    UNICODE_STRING symbolicLink;

    KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_INFO_LEVEL,
        "WfpGuard: DriverEntry - Version %d.%d.%d\n",
        WFP_GUARD_VERSION_MAJOR, WFP_GUARD_VERSION_MINOR, WFP_GUARD_VERSION_BUILD));

    //
    // Initialize WDF driver
    //
    WDF_DRIVER_CONFIG_INIT(&driverConfig, NULL);
    driverConfig.DriverInitFlags |= WdfDriverInitNonPnpDriver;
    driverConfig.EvtDriverUnload = WfpGuardEvtDriverUnload;

    WDF_OBJECT_ATTRIBUTES_INIT(&driverAttributes);

    status = WdfDriverCreate(
        DriverObject,
        RegistryPath,
        &driverAttributes,
        &driverConfig,
        &driver
    );

    if (!NT_SUCCESS(status)) {
        KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_ERROR_LEVEL,
            "WfpGuard: WdfDriverCreate failed 0x%08X\n", status));
        return status;
    }

    //
    // Allocate global context
    //
    g_Context = ExAllocatePool2(
        POOL_FLAG_NON_PAGED,
        sizeof(WFP_GUARD_CONTEXT),
        WFP_GUARD_TAG_GENERIC
    );

    if (g_Context == NULL) {
        KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_ERROR_LEVEL,
            "WfpGuard: Failed to allocate context\n"));
        return STATUS_INSUFFICIENT_RESOURCES;
    }

    RtlZeroMemory(g_Context, sizeof(WFP_GUARD_CONTEXT));

    //
    // Initialize context
    //
    InitializeListHead(&g_Context->AppListHead);
    KeInitializeSpinLock(&g_Context->AppListLock);
    
    InitializeListHead(&g_Context->PendingEventListHead);
    KeInitializeSpinLock(&g_Context->PendingEventLock);
    KeInitializeEvent(&g_Context->PendingEventAvailable, NotificationEvent, FALSE);
    
    KeInitializeSpinLock(&g_Context->StatsLock);
    
    KeQuerySystemTime(&g_Context->StartTime);

    //
    // Initialize default configuration
    // NOTE: All detection disabled by default for MONITOR mode
    // User-mode service will enable as needed via IOCTL
    //
    g_Context->Config.EnableBehavioral = FALSE;
    g_Context->Config.EnableTemporal = FALSE;
    g_Context->Config.EnableCorrelation = FALSE;
    g_Context->Config.EnableExfiltration = FALSE;
    g_Context->Config.EnableBurst = FALSE;
    g_Context->Config.EnableReputation = FALSE;
    g_Context->Config.DefaultAction = WFP_ACTION_ALLOW;
    g_Context->Config.ClusterThreshold = CFG_CLUSTER_SIMILARITY_THRESHOLD;
    g_Context->Config.TemporalThreshold = CFG_TEMPORAL_MATCH_THRESHOLD;
    g_Context->Config.CorrelationThreshold = CFG_CORRELATION_THRESHOLD;
    g_Context->Config.ReputationBlockThreshold = CFG_REPUTATION_BLOCK_THRESHOLD;
    g_Context->Config.ReputationTrustThreshold = CFG_REPUTATION_TRUST_THRESHOLD;

    //
    // Initialize Fragmergent Brain engine
    //
    FragmergentInit(&g_Context->FragmergentEngine);
    g_Context->FragmergentConfig.Enabled = FALSE;
    g_Context->FragmergentConfig.FragmergentWeight = 300;  // 0.30 default weight
    g_Context->FragmergentConfig.AnomalyMild = FRAG_ANOMALY_MILD_THRESHOLD;
    g_Context->FragmergentConfig.AnomalyModerate = FRAG_ANOMALY_MODERATE_THRESHOLD;
    g_Context->FragmergentConfig.AnomalySevere = FRAG_ANOMALY_SEVERE_THRESHOLD;
    g_Context->FragmergentLastDecay = 0;

    KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_INFO_LEVEL,
        "WfpGuard: Fragmergent Brain initialized\n"));

    //
    // Initialize lookaside lists
    //
    status = ExInitializeLookasideListEx(
        &g_Context->AppLookaside,
        NULL, NULL,
        NonPagedPoolNx,
        0,
        sizeof(WFP_APP_ENTRY),
        WFP_GUARD_TAG_APP,
        0
    );

    if (!NT_SUCCESS(status)) {
        goto Cleanup;
    }

    status = ExInitializeLookasideListEx(
        &g_Context->EventLookaside,
        NULL, NULL,
        NonPagedPoolNx,
        0,
        sizeof(WFP_PENDING_EVENT),
        WFP_GUARD_TAG_EVENT,
        0
    );

    if (!NT_SUCCESS(status)) {
        ExDeleteLookasideListEx(&g_Context->AppLookaside);
        goto Cleanup;
    }

    //
    // Create control device
    //
    deviceInit = WdfControlDeviceInitAllocate(driver, &SDDL_DEVOBJ_SYS_ALL_ADM_ALL);
    if (deviceInit == NULL) {
        status = STATUS_INSUFFICIENT_RESOURCES;
        goto Cleanup;
    }

    RtlInitUnicodeString(&deviceName, WFP_GUARD_DEVICE_NAME);
    status = WdfDeviceInitAssignName(deviceInit, &deviceName);
    if (!NT_SUCCESS(status)) {
        WdfDeviceInitFree(deviceInit);
        goto Cleanup;
    }

    WdfDeviceInitSetDeviceType(deviceInit, FILE_DEVICE_UNKNOWN);
    WdfDeviceInitSetCharacteristics(deviceInit, FILE_DEVICE_SECURE_OPEN, FALSE);

    //
    // Set up file object callbacks
    //
    WDF_FILEOBJECT_CONFIG_INIT(&fileConfig, WfpGuardEvtDeviceFileCreate, WfpGuardEvtFileClose, NULL);
    WdfDeviceInitSetFileObjectConfig(deviceInit, &fileConfig, WDF_NO_OBJECT_ATTRIBUTES);

    //
    // Create device
    //
    WDF_OBJECT_ATTRIBUTES_INIT(&deviceAttributes);
    
    status = WdfDeviceCreate(&deviceInit, &deviceAttributes, &g_Context->Device);
    if (!NT_SUCCESS(status)) {
        WdfDeviceInitFree(deviceInit);
        goto Cleanup;
    }

    //
    // Create symbolic link
    //
    RtlInitUnicodeString(&symbolicLink, WFP_GUARD_SYMLINK_NAME);
    status = WdfDeviceCreateSymbolicLink(g_Context->Device, &symbolicLink);
    if (!NT_SUCCESS(status)) {
        goto Cleanup;
    }

    //
    // Create I/O queue for IOCTLs
    //
    WDF_IO_QUEUE_CONFIG_INIT_DEFAULT_QUEUE(&queueConfig, WdfIoQueueDispatchSequential);
    queueConfig.EvtIoDeviceControl = WfpGuardEvtIoDeviceControl;

    status = WdfIoQueueCreate(g_Context->Device, &queueConfig, WDF_NO_OBJECT_ATTRIBUTES, &g_Context->IoQueue);
    if (!NT_SUCCESS(status)) {
        goto Cleanup;
    }

    //
    // Finish initializing control device
    //
    WdfControlFinishInitializing(g_Context->Device);

    //
    // Register WFP callouts
    //
    status = WfpGuardRegisterCallouts(WdfDeviceWdmGetDeviceObject(g_Context->Device));
    if (!NT_SUCCESS(status)) {
        KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_ERROR_LEVEL,
            "WfpGuard: Failed to register callouts 0x%08X\n", status));
        goto Cleanup;
    }

    g_Context->Initialized = TRUE;
    g_Context->Filtering = TRUE;

    KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_INFO_LEVEL,
        "WfpGuard: Driver initialized successfully\n"));

    return STATUS_SUCCESS;

Cleanup:
    if (g_Context != NULL) {
        ExDeleteLookasideListEx(&g_Context->AppLookaside);
        ExDeleteLookasideListEx(&g_Context->EventLookaside);
        ExFreePoolWithTag(g_Context, WFP_GUARD_TAG_GENERIC);
        g_Context = NULL;
    }
    return status;
}

// ============================================================================
// DRIVER UNLOAD
// ============================================================================

VOID
WfpGuardEvtDriverUnload(
    _In_ WDFDRIVER Driver
    )
{
    PLIST_ENTRY entry;
    PWFP_APP_ENTRY appEntry;
    PWFP_PENDING_EVENT pendingEvent;

    UNREFERENCED_PARAMETER(Driver);

    KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_INFO_LEVEL,
        "WfpGuard: Driver unloading\n"));

    if (g_Context == NULL) {
        return;
    }

    g_Context->Filtering = FALSE;

    //
    // Unregister WFP callouts
    //
    WfpGuardUnregisterCallouts();

    //
    // Free all app entries
    //
    while (!IsListEmpty(&g_Context->AppListHead)) {
        entry = RemoveHeadList(&g_Context->AppListHead);
        appEntry = CONTAINING_RECORD(entry, WFP_APP_ENTRY, ListEntry);
        ExFreeToLookasideListEx(&g_Context->AppLookaside, appEntry);
    }

    //
    // Free all pending events
    //
    while (!IsListEmpty(&g_Context->PendingEventListHead)) {
        entry = RemoveHeadList(&g_Context->PendingEventListHead);
        pendingEvent = CONTAINING_RECORD(entry, WFP_PENDING_EVENT, ListEntry);
        ExFreeToLookasideListEx(&g_Context->EventLookaside, pendingEvent);
    }

    //
    // Delete lookaside lists
    //
    ExDeleteLookasideListEx(&g_Context->AppLookaside);
    ExDeleteLookasideListEx(&g_Context->EventLookaside);

    //
    // Free context
    //
    ExFreePoolWithTag(g_Context, WFP_GUARD_TAG_GENERIC);
    g_Context = NULL;

    KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_INFO_LEVEL,
        "WfpGuard: Driver unloaded\n"));
}

// ============================================================================
// FILE OBJECT CALLBACKS
// ============================================================================

VOID
WfpGuardEvtDeviceFileCreate(
    _In_ WDFDEVICE Device,
    _In_ WDFREQUEST Request,
    _In_ WDFFILEOBJECT FileObject
    )
{
    UNREFERENCED_PARAMETER(Device);
    UNREFERENCED_PARAMETER(FileObject);

    KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_INFO_LEVEL,
        "WfpGuard: Client connected\n"));

    WdfRequestComplete(Request, STATUS_SUCCESS);
}

VOID
WfpGuardEvtFileClose(
    _In_ WDFFILEOBJECT FileObject
    )
{
    UNREFERENCED_PARAMETER(FileObject);

    KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_INFO_LEVEL,
        "WfpGuard: Client disconnected\n"));
}

// ============================================================================
// IOCTL HANDLER
// ============================================================================

VOID
WfpGuardEvtIoDeviceControl(
    _In_ WDFQUEUE Queue,
    _In_ WDFREQUEST Request,
    _In_ size_t OutputBufferLength,
    _In_ size_t InputBufferLength,
    _In_ ULONG IoControlCode
    )
{
    NTSTATUS status = STATUS_SUCCESS;
    size_t bytesReturned = 0;
    PVOID inputBuffer = NULL;
    PVOID outputBuffer = NULL;
    PWFP_PENDING_EVENT pendingEvent;
    PWFP_GUARD_VERDICT verdict;
    PWFP_GUARD_STATISTICS stats;
    PWFP_GUARD_CONFIG config;
    KIRQL oldIrql;
    LARGE_INTEGER currentTime;

    UNREFERENCED_PARAMETER(Queue);

    if (g_Context == NULL) {
        WdfRequestComplete(Request, STATUS_DEVICE_NOT_READY);
        return;
    }

    switch (IoControlCode) {

    case IOCTL_WFP_GUARD_GET_STATS:
        //
        // Return global statistics
        //
        if (OutputBufferLength < sizeof(WFP_GUARD_STATISTICS)) {
            status = STATUS_BUFFER_TOO_SMALL;
            break;
        }

        status = WdfRequestRetrieveOutputBuffer(Request, sizeof(WFP_GUARD_STATISTICS), &outputBuffer, NULL);
        if (!NT_SUCCESS(status)) {
            break;
        }

        stats = (PWFP_GUARD_STATISTICS)outputBuffer;
        
        KeAcquireSpinLock(&g_Context->StatsLock, &oldIrql);
        RtlCopyMemory(stats, &g_Context->Stats, sizeof(WFP_GUARD_STATISTICS));
        KeReleaseSpinLock(&g_Context->StatsLock, oldIrql);

        // Update uptime
        KeQuerySystemTime(&currentTime);
        stats->UptimeMs = (currentTime.QuadPart - g_Context->StartTime.QuadPart) / 10000;
        stats->TrackedApps = g_Context->AppCount;

        bytesReturned = sizeof(WFP_GUARD_STATISTICS);
        break;

    case IOCTL_WFP_GUARD_GET_EVENT:
        //
        // Get next pending event for user-mode analysis
        //
        if (OutputBufferLength < sizeof(WFP_GUARD_EVENT)) {
            status = STATUS_BUFFER_TOO_SMALL;
            break;
        }

        pendingEvent = WfpGuardDequeueEvent();
        if (pendingEvent == NULL) {
            status = STATUS_NO_MORE_ENTRIES;
            break;
        }

        status = WdfRequestRetrieveOutputBuffer(Request, sizeof(WFP_GUARD_EVENT), &outputBuffer, NULL);
        if (!NT_SUCCESS(status)) {
            // Re-queue the event
            WfpGuardQueueEvent(pendingEvent);
            break;
        }

        RtlCopyMemory(outputBuffer, &pendingEvent->Event, sizeof(WFP_GUARD_EVENT));
        bytesReturned = sizeof(WFP_GUARD_EVENT);
        
        // Note: Event stays allocated until verdict is received
        break;

    case IOCTL_WFP_GUARD_SET_VERDICT:
        //
        // Receive verdict from user-mode
        //
        if (InputBufferLength < sizeof(WFP_GUARD_VERDICT)) {
            status = STATUS_BUFFER_TOO_SMALL;
            break;
        }

        status = WdfRequestRetrieveInputBuffer(Request, sizeof(WFP_GUARD_VERDICT), &inputBuffer, NULL);
        if (!NT_SUCCESS(status)) {
            break;
        }

        verdict = (PWFP_GUARD_VERDICT)inputBuffer;
        status = WfpGuardCompleteEvent(verdict->EventId, verdict);
        break;

    case IOCTL_WFP_GUARD_SET_CONFIG:
        //
        // Update configuration
        //
        if (InputBufferLength < sizeof(WFP_GUARD_CONFIG)) {
            status = STATUS_BUFFER_TOO_SMALL;
            break;
        }

        status = WdfRequestRetrieveInputBuffer(Request, sizeof(WFP_GUARD_CONFIG), &inputBuffer, NULL);
        if (!NT_SUCCESS(status)) {
            break;
        }

        config = (PWFP_GUARD_CONFIG)inputBuffer;
        RtlCopyMemory(&g_Context->Config, config, sizeof(WFP_GUARD_CONFIG));
        
        KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_INFO_LEVEL,
            "WfpGuard: Configuration updated\n"));
        break;

    case IOCTL_WFP_GUARD_GET_APP_PROFILE:
        //
        // Get detailed app profile (for user-mode display)
        //
        if (InputBufferLength < sizeof(UINT32) || OutputBufferLength < sizeof(WFP_GUARD_APP_PROFILE)) {
            status = STATUS_BUFFER_TOO_SMALL;
            break;
        }

        status = WdfRequestRetrieveInputBuffer(Request, sizeof(UINT32), &inputBuffer, NULL);
        if (!NT_SUCCESS(status)) {
            break;
        }

        status = WdfRequestRetrieveOutputBuffer(Request, sizeof(WFP_GUARD_APP_PROFILE), &outputBuffer, NULL);
        if (!NT_SUCCESS(status)) {
            break;
        }

        {
            UINT32 appHash = *(UINT32*)inputBuffer;
            PWFP_APP_ENTRY appEntry = WfpGuardFindApp(appHash);
            
            if (appEntry == NULL) {
                status = STATUS_NOT_FOUND;
                break;
            }

            PWFP_GUARD_APP_PROFILE profile = (PWFP_GUARD_APP_PROFILE)outputBuffer;
            
            KeAcquireSpinLock(&appEntry->Lock, &oldIrql);
            RtlCopyMemory(&profile->Metrics, &appEntry->Metrics, sizeof(WFP_GUARD_APP_METRICS));
            profile->FlowCount = appEntry->FlowCount;
            RtlCopyMemory(profile->Flows, appEntry->Flows, appEntry->FlowCount * sizeof(WFP_GUARD_FLOW_CONTEXT));
            KeReleaseSpinLock(&appEntry->Lock, oldIrql);

            bytesReturned = sizeof(WFP_GUARD_APP_PROFILE);
        }
        break;

    case IOCTL_WFP_GUARD_WHITELIST_APP:
    case IOCTL_WFP_GUARD_BLACKLIST_APP:
        //
        // Add app to whitelist/blacklist
        //
        if (InputBufferLength < sizeof(UINT32)) {
            status = STATUS_BUFFER_TOO_SMALL;
            break;
        }

        status = WdfRequestRetrieveInputBuffer(Request, sizeof(UINT32), &inputBuffer, NULL);
        if (!NT_SUCCESS(status)) {
            break;
        }

        {
            UINT32 appHash = *(UINT32*)inputBuffer;
            PWFP_APP_ENTRY appEntry = WfpGuardFindApp(appHash);
            
            if (appEntry == NULL) {
                status = STATUS_NOT_FOUND;
                break;
            }

            KeAcquireSpinLock(&appEntry->Lock, &oldIrql);
            if (IoControlCode == IOCTL_WFP_GUARD_WHITELIST_APP) {
                appEntry->Metrics.IsWhitelisted = TRUE;
                appEntry->Metrics.IsBlacklisted = FALSE;
            } else {
                appEntry->Metrics.IsWhitelisted = FALSE;
                appEntry->Metrics.IsBlacklisted = TRUE;
            }
            KeReleaseSpinLock(&appEntry->Lock, oldIrql);
        }
        break;

    case IOCTL_WFP_GUARD_GET_FRAGMERGENT_STATS:
        //
        // Return Fragmergent Brain statistics
        //
        if (OutputBufferLength < sizeof(WFP_GUARD_FRAGMERGENT_STATS)) {
            status = STATUS_BUFFER_TOO_SMALL;
            break;
        }

        status = WdfRequestRetrieveOutputBuffer(Request, sizeof(WFP_GUARD_FRAGMERGENT_STATS), &outputBuffer, NULL);
        if (!NT_SUCCESS(status)) {
            break;
        }

        {
            PWFP_GUARD_FRAGMERGENT_STATS fragStats = (PWFP_GUARD_FRAGMERGENT_STATS)outputBuffer;
            UINT64 totalEvents, anomalyDetections;
            UINT32 activeApps;
            UINT32 i;
            UINT32 eqCount = 0, fragCount = 0, emergeCount = 0;

            FragmergentGetStats(&g_Context->FragmergentEngine, &totalEvents, &anomalyDetections, &activeApps);

            // Count phase distribution
            for (i = 0; i < FRAG_MAX_TRACKED_APPS; i++) {
                if (g_Context->FragmergentEngine.apps[i].isActive) {
                    switch (g_Context->FragmergentEngine.apps[i].phase) {
                        case FRAG_PHASE_EQUILIBRIUM:    eqCount++; break;
                        case FRAG_PHASE_FRAGMENTATION: fragCount++; break;
                        case FRAG_PHASE_EMERGENCE:     emergeCount++; break;
                    }
                }
            }

            fragStats->Enabled = g_Context->FragmergentConfig.Enabled;
            fragStats->TotalProcessed = totalEvents;
            fragStats->AnomalyDetections = anomalyDetections;
            fragStats->ActiveBrains = activeApps;
            fragStats->EquilibriumCount = eqCount;
            fragStats->FragmentationCount = fragCount;
            fragStats->EmergenceCount = emergeCount;
            fragStats->PhaseTransitions = g_Context->FragmergentEngine.phase_transitions;

            bytesReturned = sizeof(WFP_GUARD_FRAGMERGENT_STATS);
        }
        break;

    case IOCTL_WFP_GUARD_SET_FRAGMERGENT_CONFIG:
        //
        // Update Fragmergent configuration
        //
        if (InputBufferLength < sizeof(WFP_GUARD_FRAGMERGENT_CONFIG)) {
            status = STATUS_BUFFER_TOO_SMALL;
            break;
        }

        status = WdfRequestRetrieveInputBuffer(Request, sizeof(WFP_GUARD_FRAGMERGENT_CONFIG), &inputBuffer, NULL);
        if (!NT_SUCCESS(status)) {
            break;
        }

        {
            PWFP_GUARD_FRAGMERGENT_CONFIG fragConfig = (PWFP_GUARD_FRAGMERGENT_CONFIG)inputBuffer;

            g_Context->FragmergentConfig.Enabled = fragConfig->Enabled;
            g_Context->FragmergentConfig.FragmergentWeight = fragConfig->FragmergentWeight;

            if (fragConfig->AnomalyMild > 0) {
                g_Context->FragmergentConfig.AnomalyMild = fragConfig->AnomalyMild;
            }
            if (fragConfig->AnomalyModerate > 0) {
                g_Context->FragmergentConfig.AnomalyModerate = fragConfig->AnomalyModerate;
            }
            if (fragConfig->AnomalySevere > 0) {
                g_Context->FragmergentConfig.AnomalySevere = fragConfig->AnomalySevere;
            }

            KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_INFO_LEVEL,
                "WfpGuard: Fragmergent config updated - Enabled=%d, Weight=%d\n",
                fragConfig->Enabled, fragConfig->FragmergentWeight));
        }
        break;

    default:
        status = STATUS_INVALID_DEVICE_REQUEST;
        break;
    }

    WdfRequestCompleteWithInformation(Request, status, bytesReturned);
}

// ============================================================================
// APPLICATION TRACKING
// ============================================================================

PWFP_APP_ENTRY
WfpGuardFindOrCreateApp(
    _In_ PCWSTR AppPath
    )
{
    UINT32 appHash;
    PWFP_APP_ENTRY appEntry;
    PLIST_ENTRY entry;
    KIRQL oldIrql;

    if (g_Context == NULL || AppPath == NULL) {
        return NULL;
    }

    appHash = WfpGuardHashPath(AppPath);

    //
    // Search existing entries
    //
    KeAcquireSpinLock(&g_Context->AppListLock, &oldIrql);

    for (entry = g_Context->AppListHead.Flink;
         entry != &g_Context->AppListHead;
         entry = entry->Flink)
    {
        appEntry = CONTAINING_RECORD(entry, WFP_APP_ENTRY, ListEntry);
        if (appEntry->Metrics.AppHash == appHash) {
            KeReleaseSpinLock(&g_Context->AppListLock, oldIrql);
            return appEntry;
        }
    }

    //
    // Create new entry
    //
    if (g_Context->AppCount >= MAX_TRACKED_APPS) {
        KeReleaseSpinLock(&g_Context->AppListLock, oldIrql);
        KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_WARNING_LEVEL,
            "WfpGuard: Max tracked apps reached\n"));
        return NULL;
    }

    appEntry = ExAllocateFromLookasideListEx(&g_Context->AppLookaside);
    if (appEntry == NULL) {
        KeReleaseSpinLock(&g_Context->AppListLock, oldIrql);
        return NULL;
    }

    RtlZeroMemory(appEntry, sizeof(WFP_APP_ENTRY));
    KeInitializeSpinLock(&appEntry->Lock);

    appEntry->Metrics.AppHash = appHash;
    RtlStringCchCopyW(appEntry->Metrics.AppPath, MAX_APP_PATH_LENGTH, AppPath);
    
    KeQuerySystemTime((PLARGE_INTEGER)&appEntry->Metrics.FirstSeen);
    appEntry->Metrics.ReputationScore = 500; // Start neutral

    InsertTailList(&g_Context->AppListHead, &appEntry->ListEntry);
    g_Context->AppCount++;

    KeReleaseSpinLock(&g_Context->AppListLock, oldIrql);

    KdPrintEx((DPFLTR_IHVDRIVER_ID, DPFLTR_TRACE_LEVEL,
        "WfpGuard: New app tracked: %ws (hash=0x%08X)\n", AppPath, appHash));

    return appEntry;
}

PWFP_APP_ENTRY
WfpGuardFindApp(
    _In_ UINT32 AppHash
    )
{
    PWFP_APP_ENTRY appEntry;
    PLIST_ENTRY entry;
    KIRQL oldIrql;

    if (g_Context == NULL) {
        return NULL;
    }

    KeAcquireSpinLock(&g_Context->AppListLock, &oldIrql);

    for (entry = g_Context->AppListHead.Flink;
         entry != &g_Context->AppListHead;
         entry = entry->Flink)
    {
        appEntry = CONTAINING_RECORD(entry, WFP_APP_ENTRY, ListEntry);
        if (appEntry->Metrics.AppHash == AppHash) {
            KeReleaseSpinLock(&g_Context->AppListLock, oldIrql);
            return appEntry;
        }
    }

    KeReleaseSpinLock(&g_Context->AppListLock, oldIrql);
    return NULL;
}

// ============================================================================
// EVENT QUEUE MANAGEMENT
// ============================================================================

PWFP_PENDING_EVENT
WfpGuardAllocateEvent(
    VOID
    )
{
    PWFP_PENDING_EVENT event;
    static volatile LONG64 eventIdCounter = 0;

    if (g_Context == NULL) {
        return NULL;
    }

    event = ExAllocateFromLookasideListEx(&g_Context->EventLookaside);
    if (event == NULL) {
        return NULL;
    }

    RtlZeroMemory(event, sizeof(WFP_PENDING_EVENT));
    event->Event.EventId = InterlockedIncrement64(&eventIdCounter);
    KeInitializeEvent(&event->CompletionEvent, NotificationEvent, FALSE);

    return event;
}

VOID
WfpGuardFreeEvent(
    _In_ PWFP_PENDING_EVENT Event
    )
{
    if (g_Context != NULL && Event != NULL) {
        ExFreeToLookasideListEx(&g_Context->EventLookaside, Event);
    }
}

NTSTATUS
WfpGuardQueueEvent(
    _In_ PWFP_PENDING_EVENT Event
    )
{
    KIRQL oldIrql;

    if (g_Context == NULL || Event == NULL) {
        return STATUS_INVALID_PARAMETER;
    }

    KeAcquireSpinLock(&g_Context->PendingEventLock, &oldIrql);

    if (g_Context->PendingEventCount >= MAX_PENDING_EVENTS) {
        KeReleaseSpinLock(&g_Context->PendingEventLock, oldIrql);
        return STATUS_INSUFFICIENT_RESOURCES;
    }

    InsertTailList(&g_Context->PendingEventListHead, &Event->ListEntry);
    g_Context->PendingEventCount++;
    
    KeSetEvent(&g_Context->PendingEventAvailable, IO_NO_INCREMENT, FALSE);

    KeReleaseSpinLock(&g_Context->PendingEventLock, oldIrql);

    InterlockedIncrement64((volatile LONG64*)&g_Context->Stats.PendingEvents);

    return STATUS_SUCCESS;
}

PWFP_PENDING_EVENT
WfpGuardDequeueEvent(
    VOID
    )
{
    PWFP_PENDING_EVENT event = NULL;
    PLIST_ENTRY entry;
    KIRQL oldIrql;

    if (g_Context == NULL) {
        return NULL;
    }

    KeAcquireSpinLock(&g_Context->PendingEventLock, &oldIrql);

    if (!IsListEmpty(&g_Context->PendingEventListHead)) {
        entry = RemoveHeadList(&g_Context->PendingEventListHead);
        event = CONTAINING_RECORD(entry, WFP_PENDING_EVENT, ListEntry);
        g_Context->PendingEventCount--;

        if (IsListEmpty(&g_Context->PendingEventListHead)) {
            KeClearEvent(&g_Context->PendingEventAvailable);
        }
    }

    KeReleaseSpinLock(&g_Context->PendingEventLock, oldIrql);

    if (event != NULL) {
        InterlockedDecrement64((volatile LONG64*)&g_Context->Stats.PendingEvents);
    }

    return event;
}

NTSTATUS
WfpGuardCompleteEvent(
    _In_ UINT64 EventId,
    _In_ PWFP_GUARD_VERDICT Verdict
    )
{
    // In a real implementation, this would find the pending event
    // and signal its completion. For now, just update stats.
    
    KIRQL oldIrql;

    if (g_Context == NULL || Verdict == NULL) {
        return STATUS_INVALID_PARAMETER;
    }

    KeAcquireSpinLock(&g_Context->StatsLock, &oldIrql);

    if (Verdict->Action == WFP_ACTION_BLOCK) {
        g_Context->Stats.BlockedEvents++;
        
        if (Verdict->DetectionFlags & DETECTION_BEHAVIORAL) {
            g_Context->Stats.BehavioralDetections++;
        }
        if (Verdict->DetectionFlags & DETECTION_TEMPORAL) {
            g_Context->Stats.TemporalDetections++;
        }
        if (Verdict->DetectionFlags & DETECTION_CORRELATION) {
            g_Context->Stats.CorrelationDetections++;
        }
        if (Verdict->DetectionFlags & DETECTION_EXFILTRATION) {
            g_Context->Stats.ExfiltrationDetections++;
        }
        if (Verdict->DetectionFlags & DETECTION_BURST) {
            g_Context->Stats.BurstDetections++;
        }
        if (Verdict->DetectionFlags & DETECTION_REPUTATION) {
            g_Context->Stats.ReputationDetections++;
        }
    } else {
        g_Context->Stats.AllowedEvents++;
    }

    KeReleaseSpinLock(&g_Context->StatsLock, oldIrql);

    UNREFERENCED_PARAMETER(EventId);
    return STATUS_SUCCESS;
}

// ============================================================================
// UTILITIES
// ============================================================================

//
// Estimate entropy of data (simplified Shannon entropy)
// Returns 0-80 (representing 0.0-1.0)
//
UINT8
WfpGuardEstimateEntropy(
    _In_reads_bytes_(Length) const UINT8* Data,
    _In_ UINT32 Length
    )
{
    UINT32 freq[256] = {0};
    UINT32 i;
    UINT32 entropy = 0;
    UINT32 p;

    if (Data == NULL || Length == 0) {
        return 0;
    }

    // Count byte frequencies
    for (i = 0; i < Length && i < 1024; i++) {
        freq[Data[i]]++;
    }

    // Calculate entropy (simplified)
    for (i = 0; i < 256; i++) {
        if (freq[i] > 0) {
            // p = probability * 1000
            p = (freq[i] * 1000) / Length;
            if (p > 0) {
                // Approximate -p * log2(p) using lookup or linear approx
                // For simplicity: high frequency = low entropy contribution
                entropy += (p * (1000 - p)) / 1000;
            }
        }
    }

    // Scale to 0-80
    return (UINT8)((entropy * 80) / 1000);
}

//
// Get process path from PID
//
VOID
WfpGuardGetProcessPath(
    _In_ HANDLE ProcessId,
    _Out_writes_(MAX_APP_PATH_LENGTH) PWCHAR PathBuffer
    )
{
    NTSTATUS status;
    PEPROCESS process = NULL;
    PUNICODE_STRING imageName = NULL;

    PathBuffer[0] = L'\0';

    status = PsLookupProcessByProcessId(ProcessId, &process);
    if (!NT_SUCCESS(status)) {
        RtlStringCchCopyW(PathBuffer, MAX_APP_PATH_LENGTH, L"<unknown>");
        return;
    }

    status = SeLocateProcessImageName(process, &imageName);
    if (NT_SUCCESS(status) && imageName != NULL) {
        RtlStringCchCopyW(PathBuffer, MAX_APP_PATH_LENGTH, imageName->Buffer);
        ExFreePool(imageName);
    } else {
        RtlStringCchCopyW(PathBuffer, MAX_APP_PATH_LENGTH, L"<unknown>");
    }

    ObDereferenceObject(process);
}
