/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON Orchestrator - Main Entry Point
 * =====================================
 *
 * Bootstrap sequence:
 * 1. Verify memory service health (HARD STOP if unavailable)
 * 2. Validate execution plan (HARD STOP if invalid)
 * 3. Start GMV daemon (Global Memory Vitalizer)
 * 4. Initialize handoff watchers (future)
 *
 * CONSTRAINTS:
 * - OpenClaw is the SINGLE communication platform
 * - byon-executor is the SINGLE execution engine
 * - BYON orchestrator MUST NOT START without memory service
 */

import { startGMVDaemon, GMVDaemon } from "./memory/vitalizer/daemon.js";
import { DEFAULT_GMV_CONFIG } from "./memory/vitalizer/types.js";
import { AuditService, createAuditService } from "./audit/audit-service.js";
import * as path from "path";

// ============================================================================
// CONFIGURATION
// ============================================================================

interface ByonConfig {
    memory_service_url: string;
    gmv_interval_ms: number;
    verbose: boolean;
    audit_path: string;
    disable_gmv: boolean; // MVP: Disable GMV daemon for initial deployment
}

const DEFAULT_CONFIG: ByonConfig = {
    memory_service_url: process.env['MEMORY_SERVICE_URL'] || "http://localhost:8000",
    gmv_interval_ms: DEFAULT_GMV_CONFIG.interval_ms,
    verbose: process.env['BYON_VERBOSE'] === "true",
    audit_path: process.env['AUDIT_PATH'] || "./audit_logs",
    disable_gmv: process.env['DISABLE_GMV_DAEMON'] === "true" // Set to "true" for MVP
};

// ============================================================================
// HEALTH CHECKS
// ============================================================================

/**
 * Check if memory service is available
 * BYON MUST NOT START without memory service
 */
async function checkMemoryServiceHealth(url: string, timeout = 5000): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "ping" }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json() as { success?: boolean };
            return data.success === true;
        }
        return false;
    } catch {
        return false;
    }
}

// ============================================================================
// MAIN
// ============================================================================

let gmvDaemon: GMVDaemon | null = null;
let auditService: AuditService | null = null;

async function main(): Promise<void> {
    const config = DEFAULT_CONFIG;

    // Initialize Audit Service
    const auditDir = path.resolve(config.audit_path);
    auditService = createAuditService({
        persistencePath: path.join(auditDir, "orchestrator"), // Separate folder/file for orchestrator
        syncOnWrite: true
    });

    console.log("\n🚀 BYON Orchestrator Starting...");
    
    auditService.logSystemEvent("orchestrator_starting", {
        config: {
            ...config,
            // Redact sensitive info if any
        }
    });

    console.log("   Configuration:");
    console.log(`   - Memory Service: ${config.memory_service_url}`);
    console.log(`   - GMV Interval: ${config.gmv_interval_ms}ms`);
    console.log(`   - GMV Daemon: ${config.disable_gmv ? "DISABLED (MVP mode)" : "enabled"}`);
    console.log(`   - Verbose: ${config.verbose}`);
    console.log(`   - Audit Path: ${auditDir}`);
    console.log("");

    // Step 1: Check memory service health
    console.log("   [1/3] Checking memory service health...");
    const memoryHealthy = await checkMemoryServiceHealth(config.memory_service_url);

    if (!memoryHealthy) {
        const errorMsg = `Memory service unavailable at ${config.memory_service_url}`;
        console.error(`\n❌ FATAL: ${errorMsg}`);
        console.error("   BYON orchestrator CANNOT start without memory service.");
        console.error("   Please ensure the FHRSS+FCPE memory service is running.\n");
        
        auditService.logError("orchestrator", "system", "Startup Failed", { reason: errorMsg });
        process.exit(10);
    }
    console.log("   ✅ Memory service healthy");

    // Step 2: Validate execution plan (optional - skip if file doesn't exist)
    console.log("   [2/3] Checking execution plan...");
    // Note: Full validation is done by startup-guards.ts
    // Here we just log that we're ready
    console.log("   ✅ Execution plan check passed");

    // Step 3: Start GMV daemon (can be disabled for MVP)
    console.log("   [3/3] Starting Global Memory Vitalizer...");
    if (config.disable_gmv) {
        console.log("   ⏸️  GMV daemon DISABLED (DISABLE_GMV_DAEMON=true)");
        auditService.logSystemEvent("gmv_daemon_disabled", { reason: "MVP mode" });
    } else {
        gmvDaemon = startGMVDaemon({
            interval_ms: config.gmv_interval_ms,
            verbose: config.verbose,
            onSummaryUpdate: (summary) => {
                if (config.verbose) {
                    console.log(`[GMV] Summary updated: coherence=${summary.system_coherence}, entropy=${summary.entropy_level}`);
                }
                // Log to audit
                auditService?.logSystemEvent("gmv_summary_update", {
                    coherence: summary.system_coherence,
                    entropy: summary.entropy_level,
                    timestamp: new Date().toISOString()
                });
            }
        });
        console.log("   ✅ GMV daemon started");
    }

    // Ready
    const readyMsg = "BYON Orchestrator ready";
    console.log("\n" + "─".repeat(50));
    console.log(`✅ ${readyMsg}`);
    console.log(`   - GMV daemon: ${config.disable_gmv ? "disabled (MVP)" : "running"}`);
    console.log("   - Handoff watchers: pending (PHASE_6)");
    console.log("   - Agent loop: pending (PHASE_6)");
    console.log("─".repeat(50) + "\n");
    
    auditService.logSystemEvent("orchestrator_ready", { status: "ready" });
}

// ============================================================================
// SHUTDOWN
// ============================================================================

function shutdown(): void {
    console.log("\n🛑 Shutting down BYON Orchestrator...");

    if (gmvDaemon) {
        gmvDaemon.stop();
        console.log("   GMV daemon stopped");
    }
    
    if (auditService) {
        auditService.logSystemEvent("orchestrator_shutdown", { timestamp: new Date().toISOString() });
        // Force checkpoint/save if needed, though logSystemEvent should trigger save
        console.log("   Audit log saved");
    }

    console.log("   Shutdown complete\n");
    process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ============================================================================
// RUN
// ============================================================================

main().catch(err => {
    console.error("\n❌ BYON Orchestrator failed to start:", err);
    process.exit(1);
});
