/**
 * History Command
 *
 * View the immutable audit trail.
 * Supports filtering by date, week, hour, type, and status.
 */

import chalk from 'chalk';
import {
  queryDocuments,
  getAuditStats,
  formatCalendarKey,
  groupByCalendar,
  type AuditDocument,
  type AuditQueryOptions,
} from '@byon-bot/shared';

interface HistoryOptions {
  date?: string;      // YYYY-MM-DD
  week?: string;      // YYYY-WXX
  hour?: string;      // YYYY-MM-DD-HH
  year?: string;      // YYYY
  type?: string;      // Document type
  status?: string;    // Document status
  limit?: string;     // Max results
  json?: boolean;     // Output as JSON
  stats?: boolean;    // Show statistics only
}

/**
 * Format a single audit document for display
 */
function formatDocument(doc: AuditDocument): string {
  const lines: string[] = [];

  // Header
  const statusColor = {
    draft: chalk.gray,
    pending: chalk.yellow,
    approved: chalk.blue,
    executed: chalk.green,
    failed: chalk.red,
  }[doc.status] || chalk.white;

  const lockIcon = doc.is_immutable ? chalk.red('🔒') : chalk.gray('📝');

  lines.push(
    `${lockIcon} ${chalk.bold(doc.doc_id.slice(0, 8))}... ` +
    `${statusColor(`[${doc.status.toUpperCase()}]`)} ` +
    `${chalk.cyan(doc.doc_type)}`
  );

  // Timestamp
  lines.push(
    `   ${chalk.gray('Created:')} ${doc.created_at} ` +
    `${chalk.gray('by')} ${doc.created_by}`
  );

  // Calendar info
  lines.push(
    `   ${chalk.gray('Calendar:')} ` +
    `${doc.calendar.day} (${doc.calendar.week})`
  );

  // Summary if available
  if (doc.summary) {
    lines.push(`   ${chalk.gray('Summary:')} ${doc.summary.slice(0, 60)}...`);
  }

  // Deletion status
  if (doc.is_immutable) {
    lines.push(`   ${chalk.red('⚠ PERMANENT - Cannot be deleted')}`);
  } else if (doc.deletion.deletion_allowed) {
    lines.push(`   ${chalk.gray('✓ User can delete this document')}`);
  }

  return lines.join('\n');
}

/**
 * Format statistics for display
 */
function formatStats(stats: ReturnType<typeof getAuditStats>): string {
  const lines: string[] = [];

  lines.push(chalk.bold.white('\n📊 AUDIT TRAIL STATISTICS\n'));

  lines.push(`${chalk.gray('Total Documents:')} ${chalk.white(stats.total_documents)}`);
  lines.push(`${chalk.gray('Immutable:')} ${chalk.red(stats.immutable_count)}`);
  lines.push(`${chalk.gray('Deletable:')} ${chalk.green(stats.deletable_count)}`);

  lines.push(chalk.gray('\nBy Status:'));
  for (const [status, count] of Object.entries(stats.by_status)) {
    if (count > 0) {
      const color = {
        draft: chalk.gray,
        pending: chalk.yellow,
        approved: chalk.blue,
        executed: chalk.green,
        failed: chalk.red,
      }[status] || chalk.white;
      lines.push(`  ${color(status)}: ${count}`);
    }
  }

  lines.push(chalk.gray('\nBy Type:'));
  for (const [type, count] of Object.entries(stats.by_type)) {
    lines.push(`  ${chalk.cyan(type)}: ${count}`);
  }

  return lines.join('\n');
}

/**
 * History command handler
 */
export async function historyCommand(options: HistoryOptions): Promise<void> {
  console.log(chalk.bold.white('\n📜 AUDIT TRAIL HISTORY\n'));

  // Show stats only
  if (options.stats) {
    const stats = getAuditStats();
    console.log(formatStats(stats));
    return;
  }

  // Build query options
  const queryOptions: AuditQueryOptions = {};

  if (options.date) {
    queryOptions.day = options.date;
    console.log(chalk.gray(`Filtering by date: ${options.date}`));
  }

  if (options.week) {
    queryOptions.week = options.week;
    console.log(chalk.gray(`Filtering by week: ${options.week}`));
  }

  if (options.hour) {
    queryOptions.hour = options.hour;
    console.log(chalk.gray(`Filtering by hour: ${options.hour}`));
  }

  if (options.year) {
    queryOptions.year = options.year;
    console.log(chalk.gray(`Filtering by year: ${options.year}`));
  }

  if (options.type) {
    queryOptions.doc_type = options.type as any;
    console.log(chalk.gray(`Filtering by type: ${options.type}`));
  }

  if (options.status) {
    queryOptions.status = options.status as any;
    console.log(chalk.gray(`Filtering by status: ${options.status}`));
  }

  if (options.limit) {
    queryOptions.limit = parseInt(options.limit, 10);
  } else {
    queryOptions.limit = 20; // Default limit
  }

  // Execute query
  try {
    const result = await queryDocuments(queryOptions);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // No results
    if (result.documents.length === 0) {
      console.log(chalk.yellow('\nNo documents found matching your criteria.'));
      console.log(chalk.gray('Try: npx byon history --stats to see all statistics'));
      return;
    }

    // Header
    console.log(
      chalk.gray(`\nFound ${result.total_count} documents `) +
      chalk.gray(`(showing ${result.documents.length})`) +
      chalk.gray(` | Query time: ${result.query_time_ms}ms\n`)
    );

    // Group by day for better readability
    const byDay = groupByCalendar(result.documents, 'day');

    for (const [day, docs] of byDay) {
      console.log(chalk.bold.cyan(`\n═══ ${formatCalendarKey(day, 'day')} ═══`));

      for (const doc of docs) {
        console.log(formatDocument(doc));
        console.log('');
      }
    }

    // Footer
    console.log(chalk.gray('─'.repeat(60)));
    console.log(
      chalk.gray('Legend: ') +
      chalk.red('🔒 = Immutable (PERMANENT) ') +
      chalk.gray('📝 = Can be deleted by user')
    );

  } catch (error) {
    console.error(chalk.red(`\n✖ Error querying audit trail: ${error}`));
    process.exit(1);
  }
}
