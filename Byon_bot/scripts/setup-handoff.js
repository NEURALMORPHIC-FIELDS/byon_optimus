#!/usr/bin/env node

/**
 * Setup handoff directories for the multi-agent system
 * Run with: node scripts/setup-handoff.js
 */

import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const handoffDirs = [
  'handoff/worker_to_auditor',
  'handoff/auditor_to_user',
  'handoff/auditor_to_executor',
  'handoff/executor_to_worker',
  'memory/worker',
  'memory/auditor',
  'project',
];

function main() {
  const root = process.cwd();

  console.log('Setting up handoff directories...\n');

  for (const dir of handoffDirs) {
    const fullPath = join(root, dir);

    if (existsSync(fullPath)) {
      console.log(`✓ ${dir} (exists)`);
    } else {
      mkdirSync(fullPath, { recursive: true });
      console.log(`✓ ${dir} (created)`);
    }
  }

  console.log('\nHandoff directory structure:');
  console.log(`
handoff/
├── worker_to_auditor/    # Evidence packs & plan drafts
├── auditor_to_user/      # Approval requests
├── auditor_to_executor/  # Signed execution orders
└── executor_to_worker/   # Johnson receipts

memory/
├── worker/               # FHRSS+FCPE storage
└── auditor/              # (minimal, mostly stateless)

project/                  # User's codebase (mounted in executor)
`);
}

main();
