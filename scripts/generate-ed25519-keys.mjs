#!/usr/bin/env node

/**
 * BYON Optimus - Ed25519 Key Generation Script
 *
 * Generates proper Ed25519 key pairs for signing execution orders.
 * Uses @noble/ed25519 for cryptographically secure key generation.
 *
 * Run with: node scripts/generate-ed25519-keys.mjs
 *
 * Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac
 */

import { writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get script directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('');
console.log('============================================================');
console.log('  BYON Optimus - Ed25519 Key Generation');
console.log('============================================================');
console.log('');

// Try to load @noble/ed25519
let ed25519;
try {
  // Try from byon-orchestrator
  ed25519 = await import('../byon-orchestrator/node_modules/@noble/ed25519/index.js');
  console.log('Loaded @noble/ed25519 from byon-orchestrator');
} catch (e1) {
  try {
    // Try from Byon_bot
    ed25519 = await import('../Byon_bot/node_modules/@noble/ed25519/index.js');
    console.log('Loaded @noble/ed25519 from Byon_bot');
  } catch (e2) {
    try {
      // Try global
      ed25519 = await import('@noble/ed25519');
      console.log('Loaded @noble/ed25519 from global');
    } catch (e3) {
      console.error('ERROR: @noble/ed25519 not found!');
      console.error('');
      console.error('Install with one of:');
      console.error('  cd byon-orchestrator && npm install @noble/ed25519');
      console.error('  cd Byon_bot && npm install @noble/ed25519');
      console.error('');
      process.exit(1);
    }
  }
}

// Keys directory
const keysDir = join(projectRoot, 'keys');
const publicDir = join(keysDir, 'public');

// Check if keys already exist
const privateKeyPath = join(keysDir, 'private.key');
if (existsSync(privateKeyPath)) {
  console.error('ERROR: Keys already exist!');
  console.error(`  Location: ${keysDir}`);
  console.error('');
  console.error('To regenerate, delete the keys directory first:');
  console.error('  rm -rf keys/');
  console.error('');
  process.exit(1);
}

// Create directories
mkdirSync(keysDir, { recursive: true });
mkdirSync(publicDir, { recursive: true });
console.log(`Created keys directory: ${keysDir}`);

// Generate Ed25519 key pair
console.log('Generating Ed25519 key pair...');

// Use keygenAsync or utils.randomSecretKey depending on version
let privateKeyBytes, publicKeyBytes;
if (ed25519.keygenAsync) {
  // Newer API
  const keyPairResult = await ed25519.keygenAsync();
  privateKeyBytes = keyPairResult.secretKey || keyPairResult.privateKey || keyPairResult;
  publicKeyBytes = keyPairResult.publicKey || await ed25519.getPublicKeyAsync(privateKeyBytes);
} else if (ed25519.utils && ed25519.utils.randomSecretKey) {
  // Alternative API
  privateKeyBytes = ed25519.utils.randomSecretKey();
  publicKeyBytes = await ed25519.getPublicKeyAsync(privateKeyBytes);
} else if (ed25519.utils && ed25519.utils.randomPrivateKey) {
  // Legacy API
  privateKeyBytes = ed25519.utils.randomPrivateKey();
  publicKeyBytes = await ed25519.getPublicKeyAsync(privateKeyBytes);
} else {
  // Fallback: generate using crypto
  const { randomBytes } = await import('crypto');
  privateKeyBytes = randomBytes(32);
  publicKeyBytes = await ed25519.getPublicKeyAsync(privateKeyBytes);
}

// Convert to base64
const privateKeyBase64 = Buffer.from(privateKeyBytes).toString('base64');
const publicKeyBase64 = Buffer.from(publicKeyBytes).toString('base64');

// Create key pair JSON
const keyPair = {
  privateKey: privateKeyBase64,
  publicKey: publicKeyBase64,
  algorithm: 'Ed25519',
  library: '@noble/ed25519',
  createdAt: new Date().toISOString(),
  keySize: 256,
  signatureSize: 512,
  warning: 'NEVER share or commit this file!'
};

// Save private key
writeFileSync(privateKeyPath, JSON.stringify(keyPair, null, 2));
try { chmodSync(privateKeyPath, 0o600); } catch (e) { /* Windows */ }
console.log(`Private key saved: ${privateKeyPath}`);

// Save public key
const publicKeyData = {
  publicKey: publicKeyBase64,
  algorithm: 'Ed25519',
  purpose: 'BYON Execution Order Verification',
  createdAt: new Date().toISOString()
};

const publicKeyPath = join(keysDir, 'public.key');
writeFileSync(publicKeyPath, JSON.stringify(publicKeyData, null, 2));
console.log(`Public key saved: ${publicKeyPath}`);

// Save auditor public key for Executor (JSON format)
const auditorPubPath = join(publicDir, 'auditor.pub');
writeFileSync(auditorPubPath, JSON.stringify(publicKeyData, null, 2));
console.log(`Auditor public key saved: ${auditorPubPath}`);

// Save auditor public key in raw format for Executor (base64 only)
const auditorPemPath = join(publicDir, 'auditor_public.pem');
writeFileSync(auditorPemPath, publicKeyBase64);
console.log(`Auditor public key (raw): ${auditorPemPath}`);

// Verify keys work
console.log('');
console.log('Verifying key pair...');
const testMsg = Buffer.from('BYON Optimus key verification');
const signature = await ed25519.signAsync(testMsg, privateKeyBytes);
const isValid = await ed25519.verifyAsync(signature, testMsg, publicKeyBytes);

if (isValid) {
  console.log('Verification: PASSED ✓');
} else {
  console.error('Verification: FAILED ✗');
  process.exit(1);
}

console.log('');
console.log('============================================================');
console.log('  KEY GENERATION COMPLETE');
console.log('============================================================');
console.log('');
console.log('Files created:');
console.log(`  - ${privateKeyPath} (KEEP SECRET!)`);
console.log(`  - ${publicKeyPath}`);
console.log(`  - ${auditorPubPath}`);
console.log(`  - ${auditorPemPath} (for Executor)`);
console.log('');
console.log('SECURITY NOTES:');
console.log('  1. NEVER commit keys/ to version control');
console.log('  2. Back up private.key securely');
console.log('  3. Rotate keys every 90 days');
console.log('');
