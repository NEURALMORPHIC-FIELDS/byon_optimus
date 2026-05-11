/**
 * Unit Tests for Crypto Module (Ed25519 Signing)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as crypto from 'crypto';

// Mock the signing module functionality
// In real tests, import from '@byon-bot/shared'

describe('Ed25519 Signing', () => {
  let keyPair: { publicKey: Buffer; privateKey: Buffer };

  beforeAll(() => {
    // Generate test keypair
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });
    keyPair = { publicKey, privateKey };
  });

  describe('Key Generation', () => {
    it('should generate valid Ed25519 keypair', () => {
      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.publicKey.length).toBeGreaterThan(0);
      expect(keyPair.privateKey.length).toBeGreaterThan(0);
    });

    it('should generate different keypairs each time', () => {
      const { publicKey: pk2 } = crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'pkcs8', format: 'der' },
      });
      expect(pk2).not.toEqual(keyPair.publicKey);
    });
  });

  describe('Signing', () => {
    it('should sign data correctly', () => {
      const data = 'test execution order data';
      const privateKey = crypto.createPrivateKey({
        key: keyPair.privateKey,
        format: 'der',
        type: 'pkcs8',
      });

      const signature = crypto.sign(null, Buffer.from(data), privateKey);

      expect(signature).toBeDefined();
      expect(signature.length).toBe(64); // Ed25519 signatures are 64 bytes
    });

    it('should produce different signatures for different data', () => {
      const data1 = 'data one';
      const data2 = 'data two';
      const privateKey = crypto.createPrivateKey({
        key: keyPair.privateKey,
        format: 'der',
        type: 'pkcs8',
      });

      const sig1 = crypto.sign(null, Buffer.from(data1), privateKey);
      const sig2 = crypto.sign(null, Buffer.from(data2), privateKey);

      expect(sig1).not.toEqual(sig2);
    });
  });

  describe('Verification', () => {
    it('should verify valid signature', () => {
      const data = 'test execution order data';
      const privateKey = crypto.createPrivateKey({
        key: keyPair.privateKey,
        format: 'der',
        type: 'pkcs8',
      });
      const publicKey = crypto.createPublicKey({
        key: keyPair.publicKey,
        format: 'der',
        type: 'spki',
      });

      const signature = crypto.sign(null, Buffer.from(data), privateKey);
      const isValid = crypto.verify(null, Buffer.from(data), publicKey, signature);

      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const data = 'test execution order data';
      const publicKey = crypto.createPublicKey({
        key: keyPair.publicKey,
        format: 'der',
        type: 'spki',
      });

      const fakeSignature = Buffer.alloc(64, 0); // Invalid signature
      const isValid = crypto.verify(null, Buffer.from(data), publicKey, fakeSignature);

      expect(isValid).toBe(false);
    });

    it('should reject tampered data', () => {
      const originalData = 'test execution order data';
      const tamperedData = 'TAMPERED execution order data';
      const privateKey = crypto.createPrivateKey({
        key: keyPair.privateKey,
        format: 'der',
        type: 'pkcs8',
      });
      const publicKey = crypto.createPublicKey({
        key: keyPair.publicKey,
        format: 'der',
        type: 'spki',
      });

      const signature = crypto.sign(null, Buffer.from(originalData), privateKey);
      const isValid = crypto.verify(null, Buffer.from(tamperedData), publicKey, signature);

      expect(isValid).toBe(false);
    });
  });
});

describe('SHA256 Hashing', () => {
  it('should produce consistent hashes', () => {
    const data = { action: 'code_edit', file: 'test.ts' };
    const json = JSON.stringify(data);

    const hash1 = crypto.createHash('sha256').update(json).digest('hex');
    const hash2 = crypto.createHash('sha256').update(json).digest('hex');

    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different data', () => {
    const data1 = JSON.stringify({ action: 'code_edit' });
    const data2 = JSON.stringify({ action: 'file_create' });

    const hash1 = crypto.createHash('sha256').update(data1).digest('hex');
    const hash2 = crypto.createHash('sha256').update(data2).digest('hex');

    expect(hash1).not.toBe(hash2);
  });

  it('should produce 64-character hex strings', () => {
    const data = 'test data';
    const hash = crypto.createHash('sha256').update(data).digest('hex');

    expect(hash.length).toBe(64);
    expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
  });
});
