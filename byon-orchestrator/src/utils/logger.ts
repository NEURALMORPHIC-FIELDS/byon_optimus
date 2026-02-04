/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON Structured Logger
 * ======================
 *
 * Centralized logging utility for BYON orchestrator.
 * Provides structured JSON logging for production environments.
 *
 * Features:
 * - Multiple log levels (DEBUG, INFO, WARN, ERROR)
 * - Structured JSON output for log aggregation
 * - Context-aware logging with metadata
 * - Performance-safe (no-op in production for DEBUG)
 */

// ============================================================================
// TYPES
// ============================================================================

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    service: string;
    message: string;
    context?: Record<string, unknown>;
    error?: {
        name: string;
        message: string;
        stack?: string;
    };
}

export interface LoggerConfig {
    service: string;
    level: LogLevel;
    json: boolean;
    timestamps: boolean;
}

// ============================================================================
// LOG LEVELS
// ============================================================================

const LOG_LEVELS: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: LoggerConfig = {
    service: process.env['SERVICE_NAME'] || 'byon-orchestrator',
    level: (process.env['LOG_LEVEL'] as LogLevel) || 'INFO',
    json: process.env['LOG_FORMAT'] === 'json' || process.env['NODE_ENV'] === 'production',
    timestamps: true
};

// ============================================================================
// LOGGER CLASS
// ============================================================================

/**
 * Structured Logger for BYON services
 */
export class Logger {
    private config: LoggerConfig;
    private levelValue: number;

    constructor(config: Partial<LoggerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.levelValue = LOG_LEVELS[this.config.level];
    }

    /**
     * Create child logger with additional context
     */
    child(context: Record<string, unknown>): ChildLogger {
        return new ChildLogger(this, context);
    }

    /**
     * Debug level logging
     */
    debug(message: string, context?: Record<string, unknown>): void {
        this.log('DEBUG', message, context);
    }

    /**
     * Info level logging
     */
    info(message: string, context?: Record<string, unknown>): void {
        this.log('INFO', message, context);
    }

    /**
     * Warning level logging
     */
    warn(message: string, context?: Record<string, unknown>): void {
        this.log('WARN', message, context);
    }

    /**
     * Error level logging
     */
    error(message: string, error?: Error, context?: Record<string, unknown>): void {
        this.log('ERROR', message, context, error);
    }

    /**
     * Internal log method
     */
    private log(
        level: LogLevel,
        message: string,
        context?: Record<string, unknown>,
        error?: Error
    ): void {
        // Check if level should be logged
        if (LOG_LEVELS[level] < this.levelValue) {
            return;
        }

        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            service: this.config.service,
            message
        };

        if (context && Object.keys(context).length > 0) {
            entry.context = context;
        }

        if (error) {
            entry.error = {
                name: error.name,
                message: error.message,
                stack: error.stack
            };
        }

        this.write(level, entry);
    }

    /**
     * Write log entry to output
     */
    private write(level: LogLevel, entry: LogEntry): void {
        const output = this.config.json
            ? JSON.stringify(entry)
            : this.formatText(entry);

        switch (level) {
            case 'ERROR':
                console.error(output);
                break;
            case 'WARN':
                console.warn(output);
                break;
            default:
                // Use console.info for INFO and DEBUG to avoid ESLint no-console
                console.info(output);
        }
    }

    /**
     * Format log entry as text
     */
    private formatText(entry: LogEntry): string {
        const parts: string[] = [];

        if (this.config.timestamps) {
            parts.push(`[${entry.timestamp}]`);
        }

        parts.push(`[${entry.level}]`);
        parts.push(`[${entry.service}]`);
        parts.push(entry.message);

        if (entry.context) {
            parts.push(JSON.stringify(entry.context));
        }

        if (entry.error) {
            parts.push(`\n  Error: ${entry.error.name}: ${entry.error.message}`);
            if (entry.error.stack) {
                parts.push(`\n  Stack: ${entry.error.stack}`);
            }
        }

        return parts.join(' ');
    }
}

/**
 * Child Logger with persistent context
 */
class ChildLogger {
    private parent: Logger;
    private context: Record<string, unknown>;

    constructor(parent: Logger, context: Record<string, unknown>) {
        this.parent = parent;
        this.context = context;
    }

    debug(message: string, additionalContext?: Record<string, unknown>): void {
        this.parent.debug(message, { ...this.context, ...additionalContext });
    }

    info(message: string, additionalContext?: Record<string, unknown>): void {
        this.parent.info(message, { ...this.context, ...additionalContext });
    }

    warn(message: string, additionalContext?: Record<string, unknown>): void {
        this.parent.warn(message, { ...this.context, ...additionalContext });
    }

    error(message: string, error?: Error, additionalContext?: Record<string, unknown>): void {
        this.parent.error(message, error, { ...this.context, ...additionalContext });
    }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/**
 * Default logger instance
 */
export const logger = new Logger();

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a logger for a specific service
 */
export function createLogger(service: string, config?: Partial<LoggerConfig>): Logger {
    return new Logger({ ...config, service });
}

/**
 * Create a logger with specific configuration
 */
export function configureLogger(config: Partial<LoggerConfig>): Logger {
    return new Logger(config);
}

// ============================================================================
// PERFORMANCE HELPERS
// ============================================================================

/**
 * Measure and log execution time
 */
export async function withTiming<T>(
    logger: Logger,
    operation: string,
    fn: () => Promise<T>
): Promise<T> {
    const start = Date.now();
    try {
        const result = await fn();
        const duration = Date.now() - start;
        logger.info(`${operation} completed`, { duration_ms: duration });
        return result;
    } catch (error) {
        const duration = Date.now() - start;
        logger.error(`${operation} failed`, error as Error, { duration_ms: duration });
        throw error;
    }
}
