#!/usr/bin/env node
/**
 * Byon Bot CLI
 *
 * User interface for:
 * - Approving execution orders
 * - Monitoring agent activity
 * - Managing the system
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { approveCommand } from './commands/approve.js';
import { watchCommand } from './commands/watch.js';
import { statusCommand } from './commands/status.js';
import { inboxCommand } from './commands/inbox.js';
import { historyCommand } from './commands/history.js';
import { deleteCommand } from './commands/delete.js';

const program = new Command();

// ASCII Banner
const banner = `
${chalk.cyan('╔═══════════════════════════════════════════════════════════╗')}
${chalk.cyan('║')}  ${chalk.bold.white('BYON BOT')} - Multi-Agent System CLI                      ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.gray('MACP v1.1 | Air-Gapped Executor | Ed25519 Signing')}        ${chalk.cyan('║')}
${chalk.cyan('╚═══════════════════════════════════════════════════════════╝')}
`;

program
  .name('byon')
  .description('Byon Bot CLI - Multi-Agent Control Interface')
  .version('1.0.0')
  .hook('preAction', () => {
    console.log(banner);
  });

// Approve command - review and approve execution orders
program
  .command('approve')
  .description('Review and approve pending execution orders')
  .option('-a, --auto', 'Auto-approve low-risk actions')
  .option('-w, --watch', 'Watch for new approval requests')
  .option('-p, --path <path>', 'Handoff directory path', './handoff')
  .action(approveCommand);

// Watch command - monitor agent activity
program
  .command('watch')
  .description('Watch agent activity in real-time')
  .option('-p, --path <path>', 'Handoff directory path', './handoff')
  .option('-v, --verbose', 'Show detailed output')
  .action(watchCommand);

// Status command - show system status
program
  .command('status')
  .description('Show system status and statistics')
  .option('-p, --path <path>', 'Handoff directory path', './handoff')
  .option('-j, --json', 'Output as JSON')
  .action(statusCommand);

// Inbox command - send messages to agents
program
  .command('inbox')
  .description('Send a message to the system')
  .argument('<message>', 'Message content')
  .option('-s, --source <source>', 'Message source', 'cli')
  .option('-p, --path <path>', 'Handoff directory path', './handoff')
  .action(inboxCommand);

// History command - view audit trail
program
  .command('history')
  .description('View the immutable audit trail')
  .option('-d, --date <date>', 'Filter by date (YYYY-MM-DD)')
  .option('-w, --week <week>', 'Filter by week (YYYY-WXX)')
  .option('-H, --hour <hour>', 'Filter by hour (YYYY-MM-DD-HH)')
  .option('-y, --year <year>', 'Filter by year (YYYY)')
  .option('-t, --type <type>', 'Filter by document type')
  .option('-s, --status <status>', 'Filter by status')
  .option('-l, --limit <limit>', 'Maximum results to show', '20')
  .option('-j, --json', 'Output as JSON')
  .option('--stats', 'Show statistics only')
  .action(historyCommand);

// Delete command - delete draft documents (user only)
program
  .command('delete')
  .description('Delete a draft document (user only, physical deletion)')
  .argument('<doc_id>', 'Document ID to delete')
  .option('-f, --force', 'Skip confirmation prompt')
  .option('-r, --reason <reason>', 'Reason for deletion')
  .action(deleteCommand);

// Parse and execute
program.parse();
