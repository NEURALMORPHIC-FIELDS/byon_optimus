/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Key Manager
 * ===========
 *
 * Manages cryptographic keys for BYON orchestrator.
 * Handles key storage, rotation, and access control.
 *
 * Security:
 * - Keys stored encrypted at rest
 * - Memory-only mode for sensitive operations
 * - Key rotation support
 */

import crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Ed25519Signer, createEd25519Signer } from "./ed25519-signer.js";

// ============================================================================
// TYPES
// ============================================================================

export interface KeyPair {
    /** Key identifier */
    id: string;
    /** Public key PEM */
    publicKey: string;
    /** Private key PEM (encrypted) */
    privateKeyEncrypted: string;
    /** Creation timestamp */
    createdAt: string;
    /** Expiration timestamp (optional) */
    expiresAt?: string;
    /** Key purpose */
    purpose: "signing" | "encryption" | "general";
    /** Key fingerprint */
    fingerprint: string;
}

export interface KeyManagerConfig {
    /** Storage directory for keys */
    storageDir: string;
    /** Encryption key for stored keys (from env) */
    encryptionKey: string;
    /** Default key expiration (days) */
    defaultExpirationDays: number;
    /** Auto-rotate before expiration (days) */
    autoRotateDays: number;
    /** Keep keys in memory only */
    memoryOnly: boolean;
}

interface StoredKeys {
    keys: KeyPair[];
    activeKeyId: string;
    version: string;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: KeyManagerConfig = {
    storageDir: "./.byon-keys",
    encryptionKey: process.env['BYON_KEY_ENCRYPTION_KEY'] || "",
    defaultExpirationDays: 365,
    autoRotateDays: 30,
    memoryOnly: false
};

// ============================================================================
// KEY MANAGER
// ============================================================================

/**
 * Key Manager
 *
 * Securely manages cryptographic keys.
 */
export class KeyManager {
    private config: KeyManagerConfig;
    private keys: Map<string, KeyPair> = new Map();
    private activeKeyId: string | null = null;
    private decryptedPrivateKeys: Map<string, string> = new Map();

    constructor(config: Partial<KeyManagerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Initialize key manager
     */
    async initialize(): Promise<void> {
        if (!this.config.memoryOnly) {
            await this.loadKeys();
        }

        // Generate initial key if none exist
        if (this.keys.size === 0) {
            await this.generateKey("signing");
        }
    }

    /**
     * Generate new key pair
     */
    async generateKey(
        purpose: KeyPair["purpose"] = "signing",
        expirationDays?: number
    ): Promise<KeyPair> {
        const signer = createEd25519Signer();
        const { privateKey, publicKey } = signer.generateKeyPair();

        const keyId = crypto.randomUUID();
        const now = new Date();
        const expiration = new Date(
            now.getTime() +
            (expirationDays || this.config.defaultExpirationDays) * 24 * 60 * 60 * 1000
        );

        const keyPair: KeyPair = {
            id: keyId,
            publicKey,
            privateKeyEncrypted: this.encryptPrivateKey(privateKey),
            createdAt: now.toISOString(),
            expiresAt: expiration.toISOString(),
            purpose,
            fingerprint: signer.getKeyFingerprint()
        };

        this.keys.set(keyId, keyPair);
        this.decryptedPrivateKeys.set(keyId, privateKey);

        // Set as active if no active key
        if (!this.activeKeyId) {
            this.activeKeyId = keyId;
        }

        // Persist if not memory-only
        if (!this.config.memoryOnly) {
            await this.saveKeys();
        }

        return keyPair;
    }

    /**
     * Get active signing key
     */
    getActiveKey(): KeyPair | null {
        if (!this.activeKeyId) return null;
        return this.keys.get(this.activeKeyId) || null;
    }

    /**
     * Get signer for active key
     */
    getActiveSigner(): Ed25519Signer | null {
        if (!this.activeKeyId) return null;

        const privateKey = this.getDecryptedPrivateKey(this.activeKeyId);
        if (!privateKey) return null;

        const keyPair = this.keys.get(this.activeKeyId);
        if (!keyPair) return null;

        return createEd25519Signer(privateKey, keyPair.publicKey);
    }

    /**
     * Get signer for specific key
     */
    getSigner(keyId: string): Ed25519Signer | null {
        const privateKey = this.getDecryptedPrivateKey(keyId);
        if (!privateKey) return null;

        const keyPair = this.keys.get(keyId);
        if (!keyPair) return null;

        return createEd25519Signer(privateKey, keyPair.publicKey);
    }

    /**
     * Set active key
     */
    setActiveKey(keyId: string): void {
        if (!this.keys.has(keyId)) {
            throw new Error(`Key ${keyId} not found`);
        }
        this.activeKeyId = keyId;

        if (!this.config.memoryOnly) {
            this.saveKeys();
        }
    }

    /**
     * Rotate keys (create new, keep old for verification)
     */
    async rotateKey(): Promise<KeyPair> {
        const oldKeyId = this.activeKeyId;
        const oldKey = oldKeyId ? this.keys.get(oldKeyId) : null;

        // Generate new key
        const newKey = await this.generateKey(
            oldKey?.purpose || "signing"
        );

        // Set new key as active
        this.activeKeyId = newKey.id;

        if (!this.config.memoryOnly) {
            await this.saveKeys();
        }

        return newKey;
    }

    /**
     * Get public key by ID
     */
    getPublicKey(keyId: string): string | null {
        const keyPair = this.keys.get(keyId);
        return keyPair?.publicKey || null;
    }

    /**
     * Get public key by fingerprint
     */
    getPublicKeyByFingerprint(fingerprint: string): string | null {
        for (const keyPair of this.keys.values()) {
            if (keyPair.fingerprint === fingerprint) {
                return keyPair.publicKey;
            }
        }
        return null;
    }

    /**
     * List all keys
     */
    listKeys(): KeyPair[] {
        return Array.from(this.keys.values()).map(k => ({
            ...k,
            privateKeyEncrypted: "[REDACTED]"
        }));
    }

    /**
     * Check if key is expired
     */
    isKeyExpired(keyId: string): boolean {
        const keyPair = this.keys.get(keyId);
        if (!keyPair?.expiresAt) return false;

        return new Date() > new Date(keyPair.expiresAt);
    }

    /**
     * Check if key needs rotation
     */
    needsRotation(keyId: string): boolean {
        const keyPair = this.keys.get(keyId);
        if (!keyPair?.expiresAt) return false;

        const expiresAt = new Date(keyPair.expiresAt);
        const rotateThreshold = new Date(
            expiresAt.getTime() - this.config.autoRotateDays * 24 * 60 * 60 * 1000
        );

        return new Date() > rotateThreshold;
    }

    /**
     * Delete key
     */
    async deleteKey(keyId: string): Promise<void> {
        if (keyId === this.activeKeyId) {
            throw new Error("Cannot delete active key");
        }

        this.keys.delete(keyId);
        this.decryptedPrivateKeys.delete(keyId);

        if (!this.config.memoryOnly) {
            await this.saveKeys();
        }
    }

    /**
     * Clear all decrypted keys from memory
     */
    clearMemory(): void {
        this.decryptedPrivateKeys.clear();
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    /**
     * Encrypt private key for storage
     */
    private encryptPrivateKey(privateKey: string): string {
        if (!this.config.encryptionKey) {
            // Fallback: base64 encode (NOT SECURE - for development only)
            console.warn("WARNING: No encryption key configured, using base64 encoding");
            return Buffer.from(privateKey).toString("base64");
        }

        const iv = crypto.randomBytes(16);
        const key = crypto.scryptSync(this.config.encryptionKey, "salt", 32);
        const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

        let encrypted = cipher.update(privateKey, "utf8", "hex");
        encrypted += cipher.final("hex");

        const authTag = cipher.getAuthTag();

        return JSON.stringify({
            iv: iv.toString("hex"),
            data: encrypted,
            tag: authTag.toString("hex")
        });
    }

    /**
     * Decrypt private key
     */
    private decryptPrivateKey(encrypted: string): string {
        if (!this.config.encryptionKey) {
            // Fallback: base64 decode
            return Buffer.from(encrypted, "base64").toString("utf8");
        }

        const { iv, data, tag } = JSON.parse(encrypted);
        const key = crypto.scryptSync(this.config.encryptionKey, "salt", 32);
        const decipher = crypto.createDecipheriv(
            "aes-256-gcm",
            key,
            Buffer.from(iv, "hex")
        );

        decipher.setAuthTag(Buffer.from(tag, "hex"));

        let decrypted = decipher.update(data, "hex", "utf8");
        decrypted += decipher.final("utf8");

        return decrypted;
    }

    /**
     * Get decrypted private key
     */
    private getDecryptedPrivateKey(keyId: string): string | null {
        // Check cache first
        if (this.decryptedPrivateKeys.has(keyId)) {
            return this.decryptedPrivateKeys.get(keyId)!;
        }

        // Decrypt from storage
        const keyPair = this.keys.get(keyId);
        if (!keyPair) return null;

        try {
            const decrypted = this.decryptPrivateKey(keyPair.privateKeyEncrypted);
            this.decryptedPrivateKeys.set(keyId, decrypted);
            return decrypted;
        } catch {
            return null;
        }
    }

    /**
     * Load keys from storage
     */
    private async loadKeys(): Promise<void> {
        const keyFile = path.join(this.config.storageDir, "keys.json");

        try {
            if (!fs.existsSync(keyFile)) {
                return;
            }

            const data = fs.readFileSync(keyFile, "utf8");
            const stored: StoredKeys = JSON.parse(data);

            for (const keyPair of stored.keys) {
                this.keys.set(keyPair.id, keyPair);
            }

            this.activeKeyId = stored.activeKeyId;
        } catch (error) {
            console.error("Failed to load keys:", error);
        }
    }

    /**
     * Save keys to storage
     */
    private async saveKeys(): Promise<void> {
        const keyFile = path.join(this.config.storageDir, "keys.json");

        try {
            // Ensure directory exists
            if (!fs.existsSync(this.config.storageDir)) {
                fs.mkdirSync(this.config.storageDir, { recursive: true });
            }

            const stored: StoredKeys = {
                keys: Array.from(this.keys.values()),
                activeKeyId: this.activeKeyId || "",
                version: "1.0"
            };

            fs.writeFileSync(keyFile, JSON.stringify(stored, null, 2), {
                mode: 0o600 // Owner read/write only
            });
        } catch (error) {
            console.error("Failed to save keys:", error);
        }
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create key manager
 */
export function createKeyManager(
    config?: Partial<KeyManagerConfig>
): KeyManager {
    return new KeyManager(config);
}

/**
 * Create key manager with memory-only storage
 */
export function createMemoryKeyManager(): KeyManager {
    return new KeyManager({ memoryOnly: true });
}
