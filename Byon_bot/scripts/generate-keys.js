#!/usr/bin/env node

/**
 * Generate Ed25519 key pair for signing execution orders
 *
 * SECURITY: Uses @noble/ed25519 for proper cryptographic key generation.
 * The public key is correctly derived from the private key.
 *
 * Run with: node scripts/generate-keys.js
 *
 * Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac
 */

import { writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Dynamic import for @noble/ed25519 (ESM module)
async function loadEd25519() {
  try {
    // Try to load @noble/ed25519
    const ed = await import('@noble/ed25519');
    return ed;
  } catch (e) {
    console.error('ERROR: @noble/ed25519 not installed.');
    console.error('Please run: npm install @noble/ed25519');
    console.error('');
    console.error('This library is required for proper Ed25519 key generation.');
    process.exit(1);
  }
}

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const ed25519 = await loadEd25519();

  // Determine keys directory (relative to project root)
  const projectRoot = join(__dirname, '..', '..');
  const keysDir = join(projectRoot, 'keys');

  console.log('');
  console.log('============================================================');
  console.log('  BYON Optimus - Ed25519 Key Generation');
  console.log('============================================================');
  console.log('');

  // Create keys directory
  if (!existsSync(keysDir)) {
    mkdirSync(keysDir, { recursive: true });
    console.log(`Created keys/ directory: ${keysDir}`);
  }

  // Key file paths
  const privateKeyPath = join(keysDir, 'private.key');
  const publicKeyPath = join(keysDir, 'public.key');
  const publicDir = join(keysDir, 'public');
  const auditorPubPath = join(publicDir, 'auditor.pub');

  // Check if keys already exist
  if (existsSync(privateKeyPath)) {
    console.error('');
    console.error('ERROR: Keys already exist at:');
    console.error(`  Private: ${privateKeyPath}`);
    console.error(`  Public:  ${auditorPubPath}`);
    console.error('');
    console.error('To regenerate, first delete the existing keys:');
    console.error('  rm -rf keys/');
    console.error('');
    process.exit(1);
  }

  console.log('Generating Ed25519 key pair...');
  console.log('');

  // Generate proper Ed25519 key pair
  // @noble/ed25519 generates cryptographically secure random private key
  const privateKeyBytes = ed25519.utils.randomPrivateKey();

  // Derive public key from private key (this is the correct way!)
  const publicKeyBytes = await ed25519.getPublicKeyAsync(privateKeyBytes);

  // Convert to base64 for storage
  const privateKeyBase64 = Buffer.from(privateKeyBytes).toString('base64');
  const publicKeyBase64 = Buffer.from(publicKeyBytes).toString('base64');

  // Create key pair JSON with metadata
  const keyPair = {
    privateKey: privateKeyBase64,
    publicKey: publicKeyBase64,
    algorithm: 'Ed25519',
    library: '@noble/ed25519',
    createdAt: new Date().toISOString(),
    keySize: 256,
    signatureSize: 512,
    warning: 'NEVER share or commit this file! Add keys/ to .gitignore'
  };

  // Save private key file (contains both keys)
  writeFileSync(privateKeyPath, JSON.stringify(keyPair, null, 2));

  // Set restrictive permissions on private key (Unix only)
  try {
    chmodSync(privateKeyPath, 0o600);
  } catch (e) {
    // Windows doesn't support chmod, that's OK
  }

  console.log(`Private key saved to: ${privateKeyPath}`);

  // Save public key in separate file for sharing
  const publicKeyData = {
    publicKey: publicKeyBase64,
    algorithm: 'Ed25519',
    purpose: 'BYON Execution Order Verification',
    createdAt: new Date().toISOString()
  };

  // Create public key directory
  if (!existsSync(publicDir)) {
    mkdirSync(publicDir, { recursive: true });
  }

  // Save public key for Auditor
  writeFileSync(publicKeyPath, JSON.stringify(publicKeyData, null, 2));
  console.log(`Public key saved to: ${publicKeyPath}`);

  // Save public key for Executor verification
  writeFileSync(auditorPubPath, JSON.stringify(publicKeyData, null, 2));
  console.log(`Auditor public key saved to: ${auditorPubPath}`);

  // Verification test
  console.log('');
  console.log('Verifying key pair...');

  const testMessage = Buffer.from('BYON Optimus verification test', 'utf-8');
  const signature = await ed25519.signAsync(testMessage, privateKeyBytes);
  const isValid = await ed25519.verifyAsync(signature, testMessage, publicKeyBytes);

  if (isValid) {
    console.log('Key pair verification: PASSED');
  } else {
    console.error('Key pair verification: FAILED');
    console.error('This should not happen. Please report this issue.');
    process.exit(1);
  }

  console.log('');
  console.log('============================================================');
  console.log('  KEY GENERATION COMPLETE');
  console.log('============================================================');
  console.log('');
  console.log('IMPORTANT SECURITY NOTES:');
  console.log('');
  console.log('  1. NEVER commit keys/ to version control!');
  console.log('     Verify .gitignore includes: keys/');
  console.log('');
  console.log('  2. The private.key file should only be accessible by the Auditor.');
  console.log('     Copy keys/public/auditor.pub to the Executor container.');
  console.log('');
  console.log('  3. Rotate keys regularly (recommended: every 90 days)');
  console.log('');
  console.log('  4. Back up the private key securely (encrypted storage, HSM, etc.)');
  console.log('');
  console.log('Files created:');
  console.log(`  - ${privateKeyPath} (KEEP SECRET)`)
  console.log(`  - ${publicKeyPath}`);
  console.log(`  - ${auditorPubPath} (for Executor)`);
  console.log('');
}

main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
