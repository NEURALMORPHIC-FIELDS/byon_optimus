/**
 * Ed25519 Signing Utilities
 * Used by Auditor to sign execution orders
 * Used by Executor to verify signatures
 */

import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'crypto';
import type { Ed25519Signature, ExecutionOrder } from '../types';

// ============================================
// Key Management
// ============================================

export interface KeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

/**
 * Generate a new Ed25519 key pair
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return { privateKey, publicKey };
}

/**
 * Export key pair to base64 strings for storage
 */
export function exportKeyPair(keyPair: KeyPair): {
  privateKey: string;
  publicKey: string;
} {
  return {
    privateKey: Buffer.from(keyPair.privateKey).toString('base64'),
    publicKey: Buffer.from(keyPair.publicKey).toString('base64'),
  };
}

/**
 * Import key pair from base64 strings
 */
export function importKeyPair(exported: {
  privateKey: string;
  publicKey: string;
}): KeyPair {
  return {
    privateKey: new Uint8Array(Buffer.from(exported.privateKey, 'base64')),
    publicKey: new Uint8Array(Buffer.from(exported.publicKey, 'base64')),
  };
}

// ============================================
// Signing
// ============================================

/**
 * Create a canonical JSON string for signing
 * Sorts keys to ensure consistent ordering
 */
function canonicalize(obj: object): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/**
 * Sign an execution order with Ed25519
 */
export async function signExecutionOrder(
  order: Omit<ExecutionOrder, 'signature'>,
  privateKey: Uint8Array
): Promise<ExecutionOrder> {
  const message = canonicalize(order);
  const messageBytes = new TextEncoder().encode(message);

  const signature = await ed.signAsync(messageBytes, privateKey);
  const publicKey = await ed.getPublicKeyAsync(privateKey);

  return {
    ...order,
    signature: {
      algorithm: 'Ed25519',
      public_key: Buffer.from(publicKey).toString('base64'),
      signature: Buffer.from(signature).toString('base64'),
    },
  };
}

/**
 * Verify an execution order signature
 */
export async function verifyExecutionOrder(
  order: ExecutionOrder
): Promise<boolean> {
  try {
    const { signature, ...content } = order;

    if (signature.algorithm !== 'Ed25519') {
      return false;
    }

    const message = canonicalize(content);
    const messageBytes = new TextEncoder().encode(message);

    const signatureBytes = new Uint8Array(
      Buffer.from(signature.signature, 'base64')
    );
    const publicKeyBytes = new Uint8Array(
      Buffer.from(signature.public_key, 'base64')
    );

    return await ed.verifyAsync(signatureBytes, messageBytes, publicKeyBytes);
  } catch {
    return false;
  }
}

// ============================================
// Hashing
// ============================================

/**
 * Calculate SHA-256 hash of an object
 * Used for integrity verification of all protocol files
 */
export function calculateHash(obj: object): string {
  const canonical = canonicalize(obj);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Verify the hash of a protocol object
 */
export function verifyHash<T extends { hash: string }>(obj: T): boolean {
  const { hash, ...content } = obj;
  const calculated = calculateHash(content);
  return hash === calculated;
}

/**
 * Add hash to an object
 */
export function addHash<T extends object>(obj: T): T & { hash: string } {
  return {
    ...obj,
    hash: calculateHash(obj),
  };
}

// ============================================
// UUID Generation
// ============================================

/**
 * Generate a UUID v4
 */
export function generateUUID(): string {
  const bytes = randomBytes(16);

  // Set version (4) and variant (RFC4122)
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
