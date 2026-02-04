/**
 * Delete Command
 *
 * Delete audit documents (user only, drafts only).
 *
 * IMMUTABILITY RULES (HARD-CODED):
 * - Only USER can delete (this command)
 * - Only draft/pending/approved can be deleted
 * - executed/failed are PERMANENT - cannot be deleted by anyone
 * - This is a PHYSICAL deletion (not soft delete)
 */

import chalk from 'chalk';
import readline from 'readline';
import {
  getDocument,
  deleteDocument,
  canDelete,
  getDeleteBlockReason,
  type AuditDocument,
} from '@byon-bot/shared';

interface DeleteOptions {
  force?: boolean;    // Skip confirmation
  reason?: string;    // Deletion reason
}

/**
 * Format document info for confirmation
 */
function formatDocumentInfo(doc: AuditDocument): string {
  const lines: string[] = [];

  lines.push(chalk.bold.white('\n📄 DOCUMENT TO DELETE:\n'));

  lines.push(`  ${chalk.gray('ID:')} ${doc.doc_id}`);
  lines.push(`  ${chalk.gray('Type:')} ${chalk.cyan(doc.doc_type)}`);
  lines.push(`  ${chalk.gray('Status:')} ${doc.status}`);
  lines.push(`  ${chalk.gray('Created:')} ${doc.created_at}`);
  lines.push(`  ${chalk.gray('Created by:')} ${doc.created_by}`);

  if (doc.summary) {
    lines.push(`  ${chalk.gray('Summary:')} ${doc.summary}`);
  }

  return lines.join('\n');
}

/**
 * Prompt for confirmation
 */
async function confirmDelete(doc: AuditDocument): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log(formatDocumentInfo(doc));
    console.log(chalk.yellow('\n⚠ WARNING: This is a PHYSICAL deletion. The document will be permanently removed.'));

    rl.question(
      chalk.bold.white('\nAre you sure you want to delete this document? [y/N] '),
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y');
      }
    );
  });
}

/**
 * Delete command handler
 */
export async function deleteCommand(docId: string, options: DeleteOptions): Promise<void> {
  console.log(chalk.bold.white('\n🗑️  DELETE AUDIT DOCUMENT\n'));

  // Get the document
  const doc = getDocument(docId);

  if (!doc) {
    console.error(chalk.red(`\n✖ Document not found: ${docId}`));
    console.log(chalk.gray('\nTip: Use "npx byon history" to list all documents'));
    process.exit(1);
  }

  // Check if deletion is allowed
  const blockReason = getDeleteBlockReason(doc, 'user');

  if (blockReason) {
    console.error(chalk.red(`\n✖ Cannot delete this document:`));
    console.error(chalk.red(`  ${blockReason}`));

    if (doc.status === 'executed' || doc.status === 'failed') {
      console.log(chalk.yellow('\n⚠ Documents with status "executed" or "failed" are PERMANENT.'));
      console.log(chalk.yellow('  This is by design - they form the immutable audit trail.'));
    }

    process.exit(1);
  }

  // Confirm deletion (unless --force)
  if (!options.force) {
    const confirmed = await confirmDelete(doc);

    if (!confirmed) {
      console.log(chalk.gray('\nDeletion cancelled.'));
      process.exit(0);
    }
  }

  // Perform deletion
  const reason = options.reason || 'User requested deletion via CLI';
  const result = deleteDocument(docId, 'user', reason);

  if (result.success) {
    console.log(chalk.green(`\n✓ Document deleted successfully`));
    console.log(chalk.gray(`  ID: ${result.doc_id}`));
    console.log(chalk.gray(`  Reason: ${reason}`));
  } else {
    console.error(chalk.red(`\n✖ Failed to delete document: ${result.reason}`));
    process.exit(1);
  }
}
