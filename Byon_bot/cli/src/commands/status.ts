/**
 * Status Command - Show system status and statistics
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';

interface StatusOptions {
  path: string;
  json?: boolean;
}

interface DirectoryStats {
  name: string;
  pending: number;
  processed: number;
  failed: number;
  lastActivity?: Date;
}

/**
 * Main status command
 */
export async function statusCommand(options: StatusOptions): Promise<void> {
  const handoffPath = options.path;
  const spinner = ora('Gathering system status...').start();

  try {
    const stats = await gatherStats(handoffPath);
    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify(stats, null, 2));
      return;
    }

    displayStatus(stats);
  } catch (error) {
    spinner.fail('Failed to gather status');
    console.error(chalk.red(`Error: ${error}`));
  }
}

/**
 * Gather statistics from all directories
 */
async function gatherStats(handoffPath: string): Promise<{
  directories: DirectoryStats[];
  totals: {
    pending: number;
    processed: number;
    failed: number;
  };
  systemHealth: 'healthy' | 'warning' | 'critical';
}> {
  const directories: DirectoryStats[] = [];
  let totalPending = 0;
  let totalProcessed = 0;
  let totalFailed = 0;

  const dirs = [
    { path: 'worker_to_auditor', name: 'Worker → Auditor' },
    { path: 'auditor_to_user', name: 'Auditor → User' },
    { path: 'auditor_to_executor', name: 'Auditor → Executor' },
    { path: 'executor_to_worker', name: 'Executor → Worker' },
  ];

  for (const dir of dirs) {
    try {
      const fullPath = join(handoffPath, dir.path);
      const files = await readdir(fullPath);

      let pending = 0;
      let processed = 0;
      let failed = 0;
      let lastActivity: Date | undefined;

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = join(fullPath, file);
        const fileStat = await stat(filePath);

        if (!lastActivity || fileStat.mtime > lastActivity) {
          lastActivity = fileStat.mtime;
        }

        if (file.includes('.processed') || file.includes('.approved')) {
          processed++;
        } else if (file.includes('.rejected') || file.includes('.failed')) {
          failed++;
        } else {
          pending++;
        }
      }

      directories.push({
        name: dir.name,
        pending,
        processed,
        failed,
        lastActivity,
      });

      totalPending += pending;
      totalProcessed += processed;
      totalFailed += failed;
    } catch {
      directories.push({
        name: dir.name,
        pending: 0,
        processed: 0,
        failed: 0,
      });
    }
  }

  // Determine system health
  let systemHealth: 'healthy' | 'warning' | 'critical' = 'healthy';
  if (totalFailed > 0) {
    systemHealth = 'warning';
  }
  if (totalPending > 10) {
    systemHealth = 'warning';
  }
  if (totalFailed > 5 || totalPending > 20) {
    systemHealth = 'critical';
  }

  return {
    directories,
    totals: {
      pending: totalPending,
      processed: totalProcessed,
      failed: totalFailed,
    },
    systemHealth,
  };
}

/**
 * Display status in a formatted way
 */
function displayStatus(stats: {
  directories: DirectoryStats[];
  totals: { pending: number; processed: number; failed: number };
  systemHealth: 'healthy' | 'warning' | 'critical';
}): void {
  // System Health
  console.log(chalk.blue('\n📊 System Status\n'));

  const healthEmoji =
    stats.systemHealth === 'healthy'
      ? '🟢'
      : stats.systemHealth === 'warning'
      ? '🟡'
      : '🔴';
  const healthColor =
    stats.systemHealth === 'healthy'
      ? chalk.green
      : stats.systemHealth === 'warning'
      ? chalk.yellow
      : chalk.red;

  console.log(
    `${healthEmoji} System Health: ${healthColor(stats.systemHealth.toUpperCase())}\n`
  );

  // Directory Table
  const table = new Table({
    head: [
      chalk.white('Directory'),
      chalk.white('Pending'),
      chalk.white('Processed'),
      chalk.white('Failed'),
      chalk.white('Last Activity'),
    ],
    colWidths: [25, 12, 12, 12, 22],
  });

  for (const dir of stats.directories) {
    const pendingColor = dir.pending > 0 ? chalk.yellow : chalk.gray;
    const failedColor = dir.failed > 0 ? chalk.red : chalk.gray;
    const lastActivity = dir.lastActivity
      ? dir.lastActivity.toLocaleString()
      : chalk.gray('Never');

    table.push([
      dir.name,
      pendingColor(dir.pending.toString()),
      chalk.green(dir.processed.toString()),
      failedColor(dir.failed.toString()),
      lastActivity,
    ]);
  }

  console.log(table.toString());

  // Totals
  console.log(chalk.bold('\n📈 Totals:'));
  console.log(`   Pending:   ${chalk.yellow(stats.totals.pending)}`);
  console.log(`   Processed: ${chalk.green(stats.totals.processed)}`);
  console.log(`   Failed:    ${chalk.red(stats.totals.failed)}`);

  // Recommendations
  if (stats.totals.pending > 0) {
    console.log(chalk.cyan('\n💡 Tip: Run `byon approve` to process pending requests\n'));
  }

  if (stats.totals.failed > 0) {
    console.log(
      chalk.yellow('⚠️  Warning: There are failed tasks. Check executor logs.\n')
    );
  }
}
