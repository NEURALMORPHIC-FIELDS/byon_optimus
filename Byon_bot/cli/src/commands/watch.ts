/**
 * Watch Command - Monitor agent activity in real-time
 */

import { watch as chokidarWatch } from 'chokidar';
import { readFile } from 'fs/promises';
import { join, basename } from 'path';
import chalk from 'chalk';

interface WatchOptions {
  path: string;
  verbose?: boolean;
}

const DIRECTORIES = [
  { path: 'worker_to_auditor', label: 'Worker → Auditor', emoji: '📝' },
  { path: 'auditor_to_user', label: 'Auditor → User', emoji: '🔔' },
  { path: 'auditor_to_executor', label: 'Auditor → Executor', emoji: '✅' },
  { path: 'executor_to_worker', label: 'Executor → Worker', emoji: '📋' },
];

/**
 * Main watch command
 */
export async function watchCommand(options: WatchOptions): Promise<void> {
  const handoffPath = options.path;

  console.log(chalk.blue('\n👁️  Activity Monitor'));
  console.log(chalk.gray(`   Watching: ${handoffPath}`));
  console.log(chalk.gray('   Press Ctrl+C to exit\n'));

  // Header
  console.log(chalk.bold('─'.repeat(70)));
  console.log(
    chalk.bold(
      `${'TIME'.padEnd(12)} ${'DIRECTION'.padEnd(25)} ${'FILE'.padEnd(30)}`
    )
  );
  console.log(chalk.bold('─'.repeat(70)));

  // Watch each directory
  for (const dir of DIRECTORIES) {
    const fullPath = join(handoffPath, dir.path);

    const watcher = chokidarWatch(join(fullPath, '*.json'), {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    watcher.on('add', async (filepath) => {
      const filename = basename(filepath);

      // Skip processed files
      if (
        filename.includes('.approved') ||
        filename.includes('.rejected') ||
        filename.includes('.processed')
      ) {
        return;
      }

      const time = new Date().toLocaleTimeString('en-US', { hour12: false });

      console.log(
        `${chalk.gray(time.padEnd(12))} ${dir.emoji} ${chalk
          .cyan(dir.label)
          .padEnd(33)} ${chalk.white(filename)}`
      );

      // Verbose mode - show content preview
      if (options.verbose) {
        try {
          const content = await readFile(filepath, 'utf-8');
          const json = JSON.parse(content);

          // Show summary based on file type
          if (filename.startsWith('evidence_pack_')) {
            console.log(
              chalk.gray(
                `   └─ Task: ${json.task_type}, Facts: ${json.extracted_facts?.length || 0}`
              )
            );
          } else if (filename.startsWith('plan_draft_')) {
            console.log(
              chalk.gray(
                `   └─ Intent: ${json.intent}, Actions: ${json.actions?.length || 0}, Risk: ${json.risk_level}`
              )
            );
          } else if (filename.startsWith('approval_request_')) {
            console.log(
              chalk.gray(
                `   └─ Summary: ${json.summary?.slice(0, 50)}...`
              )
            );
          } else if (filename.startsWith('execution_order_')) {
            console.log(
              chalk.gray(
                `   └─ Actions: ${json.actions?.length || 0}, Approved by: ${json.approved_by}`
              )
            );
          } else if (filename.startsWith('johnson_receipt_')) {
            const status = json.success ? chalk.green('SUCCESS') : chalk.red('FAILED');
            console.log(
              chalk.gray(
                `   └─ Status: ${status}, Executed: ${json.execution_summary?.actions_executed || 0}`
              )
            );
          }
        } catch {
          // Ignore parse errors
        }
      }
    });

    watcher.on('error', (error) => {
      console.error(chalk.red(`Error watching ${dir.path}: ${error}`));
    });
  }

  // Keep alive
  await new Promise(() => {});
}
