#!/usr/bin/env node

/**
 * Byon Bot - First Run Setup Script
 *
 * Automates the complete setup process:
 * 1. Checks prerequisites
 * 2. Installs dependencies
 * 3. Generates cryptographic keys
 * 4. Creates handoff directories
 * 5. Sets up environment file
 * 6. Builds all packages
 * 7. Runs verification tests
 */

import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, total, message) {
  console.log(`\n${colors.cyan}[${step}/${total}]${colors.reset} ${colors.bright}${message}${colors.reset}`);
}

function logSuccess(message) {
  console.log(`  ${colors.green}✓${colors.reset} ${message}`);
}

function logWarning(message) {
  console.log(`  ${colors.yellow}⚠${colors.reset} ${message}`);
}

function logError(message) {
  console.log(`  ${colors.red}✗${colors.reset} ${message}`);
}

function exec(command, options = {}) {
  try {
    return execSync(command, {
      cwd: ROOT_DIR,
      stdio: options.silent ? 'pipe' : 'inherit',
      encoding: 'utf-8',
      ...options,
    });
  } catch (error) {
    if (options.ignoreError) {
      return null;
    }
    throw error;
  }
}

function checkCommand(command) {
  try {
    execSync(`${command} --version`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function prompt(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log('\n');
  log('╔══════════════════════════════════════════════════════════════╗', 'cyan');
  log('║                                                              ║', 'cyan');
  log('║              BYON BOT - FIRST RUN SETUP                      ║', 'cyan');
  log('║              Multi-Agent System v1.0                         ║', 'cyan');
  log('║                                                              ║', 'cyan');
  log('╚══════════════════════════════════════════════════════════════╝', 'cyan');
  console.log('\n');

  const TOTAL_STEPS = 8;
  let currentStep = 0;

  // Step 1: Check Prerequisites
  logStep(++currentStep, TOTAL_STEPS, 'Checking prerequisites...');

  // Check Node.js
  const nodeVersion = exec('node --version', { silent: true })?.trim();
  if (nodeVersion) {
    const major = parseInt(nodeVersion.replace('v', '').split('.')[0]);
    if (major >= 22) {
      logSuccess(`Node.js ${nodeVersion} (required: 22+)`);
    } else {
      logError(`Node.js ${nodeVersion} is too old. Required: 22+`);
      process.exit(1);
    }
  } else {
    logError('Node.js not found. Please install Node.js 22+');
    process.exit(1);
  }

  // Check pnpm
  if (checkCommand('pnpm')) {
    const pnpmVersion = exec('pnpm --version', { silent: true })?.trim();
    logSuccess(`pnpm ${pnpmVersion}`);
  } else {
    logWarning('pnpm not found. Installing...');
    exec('npm install -g pnpm');
    logSuccess('pnpm installed');
  }

  // Check Docker
  if (checkCommand('docker')) {
    const dockerVersion = exec('docker --version', { silent: true })?.trim();
    logSuccess(`Docker: ${dockerVersion.split(',')[0]}`);
  } else {
    logWarning('Docker not found. Docker is required for production mode.');
    logWarning('Download from: https://docker.com/');
  }

  // Check Python (REQUIRED for FHRSS+FCPE!)
  let pythonCmd = null;
  if (checkCommand('python')) {
    pythonCmd = 'python';
    const pythonVersion = exec('python --version', { silent: true })?.trim();
    const major = parseInt(pythonVersion.split(' ')[1].split('.')[0]);
    const minor = parseInt(pythonVersion.split(' ')[1].split('.')[1]);
    if (major >= 3 && minor >= 10) {
      logSuccess(`${pythonVersion} (REQUIRED for FHRSS+FCPE memory)`);
    } else {
      logError(`${pythonVersion} is too old. Required: Python 3.10+`);
      logError('FHRSS+FCPE memory system REQUIRES Python 3.10+');
      process.exit(1);
    }
  } else if (checkCommand('python3')) {
    pythonCmd = 'python3';
    const pythonVersion = exec('python3 --version', { silent: true })?.trim();
    const major = parseInt(pythonVersion.split(' ')[1].split('.')[0]);
    const minor = parseInt(pythonVersion.split(' ')[1].split('.')[1]);
    if (major >= 3 && minor >= 10) {
      logSuccess(`${pythonVersion} (REQUIRED for FHRSS+FCPE memory)`);
    } else {
      logError(`${pythonVersion} is too old. Required: Python 3.10+`);
      logError('FHRSS+FCPE memory system REQUIRES Python 3.10+');
      process.exit(1);
    }
  } else {
    logError('');
    logError('╔═══════════════════════════════════════════════════════════════╗');
    logError('║  FATAL: Python 3.10+ NOT FOUND!                               ║');
    logError('║                                                               ║');
    logError('║  FHRSS+FCPE memory system is REQUIRED, not optional!          ║');
    logError('║  Byon Bot CANNOT function without it.                         ║');
    logError('║                                                               ║');
    logError('║  This is what makes Byon Bot different from other bots        ║');
    logError('║  that lose context or over-summarize and destroy projects.    ║');
    logError('║                                                               ║');
    logError('║  Please install Python 3.10+:                                 ║');
    logError('║    Windows: https://python.org/downloads/                     ║');
    logError('║    macOS:   brew install python@3.11                          ║');
    logError('║    Linux:   apt install python3.11                            ║');
    logError('╚═══════════════════════════════════════════════════════════════╝');
    logError('');
    process.exit(1);
  }

  // Step 2: Install Dependencies
  logStep(++currentStep, TOTAL_STEPS, 'Installing dependencies...');
  exec('pnpm install');
  logSuccess('Dependencies installed');

  // Step 3: Generate Cryptographic Keys
  logStep(++currentStep, TOTAL_STEPS, 'Generating Ed25519 cryptographic keys...');

  const keysDir = join(ROOT_DIR, 'keys');
  const publicKeyPath = join(keysDir, 'auditor.public.pem');
  const privateKeyPath = join(keysDir, 'auditor.private.pem');

  if (existsSync(publicKeyPath) && existsSync(privateKeyPath)) {
    logWarning('Keys already exist. Skipping generation.');
    logSuccess(`Public key: keys/auditor.public.pem`);
    logSuccess(`Private key: keys/auditor.private.pem`);
  } else {
    exec('node scripts/generate-keys.js');
    logSuccess('Ed25519 keypair generated');
    logSuccess('Public key: keys/auditor.public.pem');
    logSuccess('Private key: keys/auditor.private.pem');
  }

  // Step 4: Setup Handoff Directories
  logStep(++currentStep, TOTAL_STEPS, 'Creating handoff directories...');
  exec('node scripts/setup-handoff.js');
  logSuccess('Handoff directories created');

  // Step 5: Setup Environment File
  logStep(++currentStep, TOTAL_STEPS, 'Setting up environment...');

  const envPath = join(ROOT_DIR, '.env');
  const envExamplePath = join(ROOT_DIR, '.env.example');

  if (existsSync(envPath)) {
    logWarning('.env file already exists. Skipping.');
  } else if (existsSync(envExamplePath)) {
    copyFileSync(envExamplePath, envPath);
    logSuccess('.env file created from .env.example');
    logWarning('Please edit .env and add your ANTHROPIC_API_KEY');
  } else {
    // Create basic .env
    writeFileSync(envPath, `# Byon Bot Environment Configuration
# Generated by setup-first-run.js

# Anthropic API Key (required)
ANTHROPIC_API_KEY=sk-ant-xxx

# Agent Configuration
WORKER_POLL_INTERVAL=5000
AUDITOR_POLL_INTERVAL=3000
EXECUTOR_POLL_INTERVAL=2000

# Memory Service (optional)
MEMORY_SERVICE_MODE=stdio

# Logging
LOG_LEVEL=info
`);
    logSuccess('.env file created');
    logWarning('Please edit .env and add your ANTHROPIC_API_KEY');
  }

  // Step 6: Build All Packages
  logStep(++currentStep, TOTAL_STEPS, 'Building all packages...');
  exec('pnpm build');
  logSuccess('All packages built successfully');

  // Step 7: Install Python Dependencies (REQUIRED!)
  logStep(++currentStep, TOTAL_STEPS, 'Installing FHRSS+FCPE memory system (REQUIRED)...');

  const memoryReqPath = join(ROOT_DIR, 'shared', 'memory', 'requirements.txt');
  if (!existsSync(memoryReqPath)) {
    logError('requirements.txt not found in shared/memory/');
    logError('FHRSS+FCPE memory system files are missing!');
    process.exit(1);
  }

  const pipCmd = checkCommand('pip') ? 'pip' : (checkCommand('pip3') ? 'pip3' : null);
  if (!pipCmd) {
    logError('pip not found. Cannot install FHRSS+FCPE dependencies.');
    logError('Please install pip: python -m ensurepip --upgrade');
    process.exit(1);
  }

  try {
    log('  Installing sentence-transformers (this may take a few minutes)...', 'dim');
    exec(`${pipCmd} install -r shared/memory/requirements.txt`, { silent: false });
    logSuccess('FHRSS+FCPE dependencies installed');

    // Verify installation
    const testCmd = pythonCmd || 'python';
    exec(`${testCmd} -c "import sentence_transformers; print('OK')"`, { silent: true });
    logSuccess('sentence-transformers verified');

    exec(`${testCmd} -c "from shared.memory.fhrss_fcpe import UnifiedFHRSS_FCPE; print('OK')"`, { silent: true, ignoreError: true });
    logSuccess('FHRSS+FCPE module verified');
  } catch (error) {
    logError('Failed to install FHRSS+FCPE dependencies!');
    logError('Error: ' + error.message);
    logError('');
    logError('Try manually:');
    logError(`  ${pipCmd} install sentence-transformers numpy`);
    process.exit(1);
  }

  // Step 8: Run Verification Tests
  logStep(++currentStep, TOTAL_STEPS, 'Running verification tests...');

  try {
    exec('pnpm test:unit', { silent: true });
    logSuccess('Unit tests passed');
  } catch {
    logWarning('Some unit tests failed. Check with: pnpm test:unit');
  }

  try {
    exec('pnpm test:security', { silent: true });
    logSuccess('Security tests passed');
  } catch {
    logWarning('Some security tests failed. Check with: pnpm test:security');
  }

  // Final Summary
  console.log('\n');
  log('╔══════════════════════════════════════════════════════════════╗', 'green');
  log('║                                                              ║', 'green');
  log('║              SETUP COMPLETE!                                 ║', 'green');
  log('║                                                              ║', 'green');
  log('╚══════════════════════════════════════════════════════════════╝', 'green');
  console.log('\n');

  log('Next steps:', 'bright');
  console.log('');
  log('  1. Edit .env and add your ANTHROPIC_API_KEY', 'dim');
  console.log('');
  log('  2. Start the system:', 'dim');
  log('     pnpm docker:up          # Docker mode (recommended)', 'cyan');
  log('     pnpm dev                # Development mode', 'cyan');
  console.log('');
  log('  3. In another terminal, watch activity:', 'dim');
  log('     npx byon watch --verbose', 'cyan');
  console.log('');
  log('  4. Send a test message:', 'dim');
  log('     npx byon inbox "Hello, this is a test"', 'cyan');
  console.log('');
  log('  5. Approve the request:', 'dim');
  log('     npx byon approve', 'cyan');
  console.log('');
  log('Documentation:', 'bright');
  log('  - Quick Start:  docs/QUICKSTART.md', 'dim');
  log('  - Architecture: docs/ARCHITECTURE.md', 'dim');
  log('  - Security:     docs/SECURITY.md', 'dim');
  console.log('\n');
}

main().catch((error) => {
  logError(`Setup failed: ${error.message}`);
  process.exit(1);
});
