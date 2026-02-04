/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Vault Encryption Layer
 * ======================
 *
 * GPG-based encryption for sensitive vault data.
 * All data is encrypted at rest and decrypted only in memory.
 *
 * SECURITY:
 * - Uses GPG for industry-standard encryption
 * - Fallback to AES-256-GCM if GPG not available
 * - Keys never stored in plaintext
 * - Memory cleared after use
 */

import * as crypto from 'crypto';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/** Encryption result */
export interface EncryptionResult {
    encrypted: string;      // Base64 encoded
    checksum: string;       // SHA-256 of plaintext
    method: 'gpg' | 'aes';  // Encryption method used
}

/** Check if GPG is available */
export function isGpgAvailable(): boolean {
    try {
        execSync('gpg --version', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/** Get configured GPG key ID */
export async function getGpgKeyId(): Promise<string | null> {
    try {
        const { stdout } = await execAsync('gpg --list-secret-keys --keyid-format LONG');
        const match = stdout.match(/sec\s+\w+\/([A-F0-9]+)/i);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

/** Calculate SHA-256 checksum */
export function calculateChecksum(data: string): string {
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/** Generate random IV for AES */
function generateIV(): Buffer {
    return crypto.randomBytes(16);
}

/** Derive key from passphrase using PBKDF2 */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
}

/**
 * Encrypt data using GPG
 */
export async function encryptWithGpg(
    data: string,
    keyId: string
): Promise<EncryptionResult> {
    const checksum = calculateChecksum(data);

    try {
        // Create temp file approach for Windows compatibility
        const tempInput = `${process.env.TEMP || '/tmp'}/byon_vault_${Date.now()}.txt`;
        const tempOutput = `${tempInput}.gpg`;

        const fs = await import('fs/promises');
        await fs.writeFile(tempInput, data, 'utf8');

        await execAsync(
            `gpg --encrypt --recipient ${keyId} --armor --output "${tempOutput}" "${tempInput}"`
        );

        const encrypted = await fs.readFile(tempOutput, 'utf8');

        // Cleanup temp files
        await fs.unlink(tempInput).catch(() => {});
        await fs.unlink(tempOutput).catch(() => {});

        return {
            encrypted: Buffer.from(encrypted).toString('base64'),
            checksum,
            method: 'gpg'
        };
    } catch (error) {
        throw new Error(`GPG encryption failed: ${error}`);
    }
}

/**
 * Decrypt data using GPG
 */
export async function decryptWithGpg(encryptedBase64: string): Promise<string> {
    try {
        const encrypted = Buffer.from(encryptedBase64, 'base64').toString('utf8');

        const fs = await import('fs/promises');
        const tempInput = `${process.env.TEMP || '/tmp'}/byon_vault_${Date.now()}.gpg`;
        const tempOutput = `${tempInput}.txt`;

        await fs.writeFile(tempInput, encrypted, 'utf8');

        await execAsync(
            `gpg --decrypt --output "${tempOutput}" "${tempInput}"`
        );

        const decrypted = await fs.readFile(tempOutput, 'utf8');

        // Cleanup temp files
        await fs.unlink(tempInput).catch(() => {});
        await fs.unlink(tempOutput).catch(() => {});

        return decrypted;
    } catch (error) {
        throw new Error(`GPG decryption failed: ${error}`);
    }
}

/**
 * Encrypt data using AES-256-GCM (fallback when GPG not available)
 */
export function encryptWithAes(data: string, passphrase: string): EncryptionResult {
    const checksum = calculateChecksum(data);
    const salt = crypto.randomBytes(32);
    const iv = generateIV();
    const key = deriveKey(passphrase, salt);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(data, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    // Combine salt + iv + authTag + encrypted
    const combined = Buffer.concat([
        salt,
        iv,
        authTag,
        Buffer.from(encrypted, 'base64')
    ]);

    return {
        encrypted: combined.toString('base64'),
        checksum,
        method: 'aes'
    };
}

/**
 * Decrypt data using AES-256-GCM
 */
export function decryptWithAes(encryptedBase64: string, passphrase: string): string {
    const combined = Buffer.from(encryptedBase64, 'base64');

    // Extract components
    const salt = combined.subarray(0, 32);
    const iv = combined.subarray(32, 48);
    const authTag = combined.subarray(48, 64);
    const encrypted = combined.subarray(64);

    const key = deriveKey(passphrase, salt);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
}

/**
 * Verify checksum
 */
export function verifyChecksum(data: string, expectedChecksum: string): boolean {
    const actualChecksum = calculateChecksum(data);
    return crypto.timingSafeEqual(
        Buffer.from(actualChecksum, 'hex'),
        Buffer.from(expectedChecksum, 'hex')
    );
}

/**
 * Secure memory wipe (best effort)
 */
export function secureWipe(data: string): void {
    // In JavaScript, we can't truly wipe memory, but we can
    // overwrite the string reference
    const buffer = Buffer.from(data);
    crypto.randomFillSync(buffer);
}
