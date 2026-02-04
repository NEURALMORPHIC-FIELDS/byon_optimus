/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Health Check Server
 * ===================
 *
 * Simple HTTP server for container health checks.
 * Provides /health endpoint for Docker healthcheck probes.
 *
 * Each agent exposes a health endpoint on a different port:
 * - Worker: 3002
 * - Auditor: 3003
 */

import * as http from 'http';

// ============================================================================
// TYPES
// ============================================================================

export interface HealthStatus {
    status: 'healthy' | 'unhealthy' | 'degraded';
    service: string;
    version: string;
    uptime_seconds: number;
    checks: Record<string, {
        status: 'ok' | 'error';
        message?: string;
    }>;
    timestamp: string;
}

export interface HealthCheckFn {
    name: string;
    check: () => Promise<{ ok: boolean; message?: string }>;
}

// ============================================================================
// HEALTH SERVER
// ============================================================================

/**
 * Health Check Server for container probes
 */
export class HealthServer {
    private server: http.Server | null = null;
    private startTime: number = Date.now();
    private serviceName: string;
    private version: string;
    private port: number;
    private checks: HealthCheckFn[] = [];

    constructor(serviceName: string, port: number, version: string = '1.0.0') {
        this.serviceName = serviceName;
        this.port = port;
        this.version = version;
    }

    /**
     * Register a health check function
     */
    registerCheck(name: string, check: () => Promise<{ ok: boolean; message?: string }>): void {
        this.checks.push({ name, check });
    }

    /**
     * Start the health server
     */
    start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer(async (req, res) => {
                if (req.url === '/health' && req.method === 'GET') {
                    await this.handleHealth(res);
                } else if (req.url === '/ready' && req.method === 'GET') {
                    await this.handleReady(res);
                } else if (req.url === '/live' && req.method === 'GET') {
                    this.handleLive(res);
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Not found' }));
                }
            });

            this.server.on('error', reject);

            this.server.listen(this.port, '0.0.0.0', () => {
                resolve();
            });
        });
    }

    /**
     * Stop the health server
     */
    stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => resolve());
            } else {
                resolve();
            }
        });
    }

    /**
     * Handle /health endpoint - comprehensive health status
     */
    private async handleHealth(res: http.ServerResponse): Promise<void> {
        const checkResults: Record<string, { status: 'ok' | 'error'; message?: string }> = {};
        let allHealthy = true;

        // Run all registered checks
        for (const { name, check } of this.checks) {
            try {
                const result = await check();
                checkResults[name] = {
                    status: result.ok ? 'ok' : 'error',
                    message: result.message
                };
                if (!result.ok) {
                    allHealthy = false;
                }
            } catch (error) {
                checkResults[name] = {
                    status: 'error',
                    message: error instanceof Error ? error.message : 'Unknown error'
                };
                allHealthy = false;
            }
        }

        const status: HealthStatus = {
            status: allHealthy ? 'healthy' : 'unhealthy',
            service: this.serviceName,
            version: this.version,
            uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
            checks: checkResults,
            timestamp: new Date().toISOString()
        };

        const statusCode = allHealthy ? 200 : 503;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status, null, 2));
    }

    /**
     * Handle /ready endpoint - readiness probe
     */
    private async handleReady(res: http.ServerResponse): Promise<void> {
        // Run all checks to determine readiness
        for (const { check } of this.checks) {
            try {
                const result = await check();
                if (!result.ok) {
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ready: false }));
                    return;
                }
            } catch {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ready: false }));
                return;
            }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ready: true }));
    }

    /**
     * Handle /live endpoint - liveness probe (always returns 200 if process is running)
     */
    private handleLive(res: http.ServerResponse): void {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            alive: true,
            uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000)
        }));
    }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create health server for Worker agent
 */
export function createWorkerHealthServer(): HealthServer {
    return new HealthServer('byon-worker', 3002, '1.0.0');
}

/**
 * Create health server for Auditor agent
 */
export function createAuditorHealthServer(): HealthServer {
    return new HealthServer('byon-auditor', 3003, '1.0.0');
}

// ============================================================================
// COMMON HEALTH CHECKS
// ============================================================================

/**
 * Memory service health check
 */
export function createMemoryServiceCheck(serviceUrl: string): HealthCheckFn {
    return {
        name: 'memory-service',
        check: async () => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);

                const response = await fetch(`${serviceUrl}/health`, {
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (response.ok) {
                    return { ok: true, message: 'Memory service healthy' };
                }
                return { ok: false, message: `Memory service returned ${response.status}` };
            } catch (error) {
                return {
                    ok: false,
                    message: error instanceof Error ? error.message : 'Connection failed'
                };
            }
        }
    };
}

/**
 * Handoff directory access check
 */
export function createHandoffDirCheck(paths: string[]): HealthCheckFn {
    return {
        name: 'handoff-directories',
        check: async () => {
            const fs = await import('fs');
            for (const dirPath of paths) {
                try {
                    fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK);
                } catch {
                    return { ok: false, message: `Cannot access ${dirPath}` };
                }
            }
            return { ok: true, message: 'All handoff directories accessible' };
        }
    };
}

/**
 * Process memory check (warns if memory usage is high)
 */
export function createMemoryUsageCheck(maxHeapMB: number = 1500): HealthCheckFn {
    return {
        name: 'memory-usage',
        check: async () => {
            const used = process.memoryUsage();
            const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);

            if (heapUsedMB > maxHeapMB) {
                return {
                    ok: false,
                    message: `Heap usage ${heapUsedMB}MB exceeds ${maxHeapMB}MB threshold`
                };
            }
            return { ok: true, message: `Heap usage: ${heapUsedMB}MB` };
        }
    };
}
