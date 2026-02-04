/**
 * BYON File Watcher Service
 * ==========================
 * Monitors handoff directories and logs activity for debugging/monitoring.
 *
 * Features:
 * - Watches all handoff directories
 * - Graceful shutdown on SIGTERM/SIGINT
 * - Health check endpoint (optional)
 * - Structured logging
 */

import { watch, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { createServer } from 'http';

const HANDOFF_PATH = process.env.HANDOFF_PATH || '/handoff';
const HEALTH_PORT = process.env.WATCHER_HEALTH_PORT || 3010;
const ENABLE_HEALTH_SERVER = process.env.ENABLE_HEALTH_SERVER === 'true';

// Directories to monitor
const directories = [
  { path: 'inbox', description: 'Incoming Messages', emoji: '📥' },
  { path: 'outbox', description: 'Outgoing Messages', emoji: '📤' },
  { path: 'worker_to_auditor', description: 'Worker → Auditor', emoji: '📝' },
  { path: 'auditor_to_user', description: 'Auditor → User', emoji: '🔔' },
  { path: 'auditor_to_executor', description: 'Auditor → Executor', emoji: '✅' },
  { path: 'executor_to_worker', description: 'Executor → Worker', emoji: '📋' },
];

// State
const watchers = [];
let server = null;
let isShuttingDown = false;
const stats = {
  started_at: new Date().toISOString(),
  events_total: 0,
  events_by_dir: {}
};

// Initialize stats
directories.forEach(d => {
  stats.events_by_dir[d.path] = 0;
});

/**
 * Format timestamp for logs
 */
function formatTime() {
  return new Date().toISOString();
}

/**
 * Log message with structured format
 */
function log(level, message, data = {}) {
  const entry = {
    timestamp: formatTime(),
    level,
    message,
    ...data
  };

  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

/**
 * Ensure directory exists
 */
function ensureDir(path) {
  if (!existsSync(path)) {
    try {
      mkdirSync(path, { recursive: true });
      log('info', `Created directory: ${path}`);
    } catch (error) {
      log('error', `Failed to create directory: ${path}`, { error: error.message });
    }
  }
}

/**
 * Start watching a directory
 */
function startWatcher(dir) {
  const fullPath = join(HANDOFF_PATH, dir.path);

  // Ensure directory exists
  ensureDir(fullPath);

  try {
    const watcher = watch(fullPath, { persistent: true }, (eventType, filename) => {
      if (isShuttingDown) return;

      // Ignore temporary files and processed markers
      if (!filename ||
          filename.endsWith('.tmp') ||
          filename.endsWith('.processed') ||
          filename.startsWith('.')) {
        return;
      }

      stats.events_total++;
      stats.events_by_dir[dir.path]++;

      log('info', 'File event', {
        directory: dir.path,
        description: dir.description,
        event_type: eventType,
        filename,
        emoji: dir.emoji
      });
    });

    watchers.push({ watcher, path: dir.path });

    // Count initial files
    try {
      const files = readdirSync(fullPath).filter(f => !f.startsWith('.'));
      log('info', `Watching: ${dir.path}`, {
        initial_files: files.length,
        emoji: dir.emoji
      });
    } catch {
      log('info', `Watching: ${dir.path}`, { emoji: dir.emoji });
    }

    return true;
  } catch (error) {
    log('error', `Failed to watch ${dir.path}`, { error: error.message });
    return false;
  }
}

/**
 * Start health check server
 */
function startHealthServer() {
  server = createServer((req, res) => {
    if (req.url === '/health') {
      const health = {
        status: isShuttingDown ? 'shutting_down' : 'healthy',
        uptime_seconds: Math.floor((Date.now() - new Date(stats.started_at).getTime()) / 1000),
        watchers_active: watchers.length,
        stats
      };

      res.writeHead(isShuttingDown ? 503 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health));
    } else if (req.url === '/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats, null, 2));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(HEALTH_PORT, () => {
    log('info', `Health server listening on port ${HEALTH_PORT}`);
  });
}

/**
 * Graceful shutdown
 */
function shutdown(signal) {
  if (isShuttingDown) return;

  isShuttingDown = true;
  log('info', `Received ${signal}, shutting down gracefully...`);

  // Close all watchers
  for (const { watcher, path } of watchers) {
    try {
      watcher.close();
      log('info', `Closed watcher: ${path}`);
    } catch (error) {
      log('error', `Error closing watcher ${path}`, { error: error.message });
    }
  }

  // Close health server
  if (server) {
    server.close(() => {
      log('info', 'Health server closed');
      log('info', 'Shutdown complete', {
        events_processed: stats.events_total,
        uptime_seconds: Math.floor((Date.now() - new Date(stats.started_at).getTime()) / 1000)
      });
      process.exit(0);
    });

    // Force close after 5 seconds
    setTimeout(() => {
      log('warn', 'Forced shutdown after timeout');
      process.exit(0);
    }, 5000);
  } else {
    log('info', 'Shutdown complete', { events_processed: stats.events_total });
    process.exit(0);
  }
}

/**
 * Main entry point
 */
function main() {
  log('info', 'BYON File Watcher starting', {
    handoff_path: HANDOFF_PATH,
    directories: directories.map(d => d.path)
  });

  // Start watchers
  let successCount = 0;
  for (const dir of directories) {
    if (startWatcher(dir)) {
      successCount++;
    }
  }

  // Start health server if enabled
  if (ENABLE_HEALTH_SERVER) {
    startHealthServer();
  }

  log('info', 'Watcher ready', {
    watching: successCount,
    total: directories.length
  });

  // Keep process alive
  const keepAlive = setInterval(() => {
    if (isShuttingDown) {
      clearInterval(keepAlive);
    }
  }, 1000);
}

// Signal handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (error) => {
  log('error', 'Uncaught exception', { error: error.message, stack: error.stack });
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  log('error', 'Unhandled rejection', { reason: String(reason) });
});

// Start
main();
