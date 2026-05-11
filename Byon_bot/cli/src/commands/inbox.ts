/**
 * Inbox Command - Send messages to the system
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';

interface InboxOptions {
  source: string;
  path: string;
}

/**
 * Main inbox command
 */
export async function inboxCommand(
  message: string,
  options: InboxOptions
): Promise<void> {
  const handoffPath = options.path;
  const inboxPath = join(handoffPath, 'inbox');

  console.log(chalk.blue('\n📬 Sending Message\n'));

  try {
    // Ensure inbox directory exists
    await mkdir(inboxPath, { recursive: true });

    // Create inbox event
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const event = {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      source: options.source,
      content: message,
      metadata: {
        cli_version: '1.0.0',
        user: process.env.USER || process.env.USERNAME || 'unknown',
      },
    };

    // Write event file
    const filename = `inbox_${eventId}.json`;
    const filepath = join(inboxPath, filename);
    await writeFile(filepath, JSON.stringify(event, null, 2));

    console.log(chalk.green('✅ Message sent successfully!\n'));
    console.log(chalk.gray(`   Event ID: ${eventId}`));
    console.log(chalk.gray(`   Source:   ${options.source}`));
    console.log(chalk.gray(`   File:     ${filename}`));
    console.log(chalk.gray(`   Content:  ${message.slice(0, 50)}${message.length > 50 ? '...' : ''}`));
    console.log();

    console.log(chalk.cyan('💡 The Worker agent will process this message.\n'));
    console.log(chalk.gray('   Run `byon watch` to monitor activity.\n'));
  } catch (error) {
    console.error(chalk.red(`❌ Failed to send message: ${error}\n`));
  }
}
