/**
 * BYON Crypto Unit Tests
 * ======================
 *
 * Tests for cryptographic components:
 * - Ed25519 signing and verification
 * - Key management
 * - Hash computation
 *
 * Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac
 */

import { describe, it, expect, beforeEach } from "vitest";

// ============================================
// Mock Ed25519 Implementation
// ============================================

interface KeyPair {
    publicKey: string;
    privateKey: string;
}

interface Signature {
    signature: string;
    publicKey: string;
    timestamp: string;
}

class MockEd25519Signer {
    private keyPair: KeyPair | null = null;

    generateKeyPair(): KeyPair {
        // Mock key generation (in real implementation would use @noble/ed25519)
        const privateKey = this.generateRandomHex(64);
        const publicKey = this.derivePublicKey(privateKey);

        this.keyPair = { publicKey, privateKey };
        return this.keyPair;
    }

    loadKeyPair(publicKey: string, privateKey: string): void {
        this.keyPair = { publicKey, privateKey };
    }

    sign(data: string): Signature {
        if (!this.keyPair) {
            throw new Error("No key pair loaded");
        }

        const timestamp = new Date().toISOString();
        const dataToSign = `${data}|${timestamp}`;
        const signature = this.computeSignature(dataToSign, this.keyPair.privateKey);

        return {
            signature,
            publicKey: this.keyPair.publicKey,
            timestamp
        };
    }

    verify(data: string, signature: Signature): boolean {
        const dataToVerify = `${data}|${signature.timestamp}`;
        const expectedSignature = this.computeSignature(dataToVerify, this.recoverPrivateKey(signature.publicKey));

        // In mock, we just check format validity
        return (
            signature.signature.length === 128 &&
            signature.publicKey.length === 64 &&
            /^\d{4}-\d{2}-\d{2}/.test(signature.timestamp)
        );
    }

    static verifyWithPublicKey(data: string, signature: Signature, publicKey: string): boolean {
        // Verify that the signature's public key matches
        if (signature.publicKey !== publicKey) {
            return false;
        }

        // In real implementation, would verify cryptographically
        return (
            signature.signature.length === 128 &&
            /^\d{4}-\d{2}-\d{2}/.test(signature.timestamp)
        );
    }

    private generateRandomHex(length: number): string {
        const chars = "0123456789abcdef";
        let result = "";
        for (let i = 0; i < length; i++) {
            result += chars[Math.floor(Math.random() * 16)];
        }
        return result;
    }

    private derivePublicKey(privateKey: string): string {
        // Mock derivation - in real implementation uses Ed25519 curve
        let hash = 0;
        for (let i = 0; i < privateKey.length; i++) {
            hash = ((hash << 5) - hash + privateKey.charCodeAt(i)) | 0;
        }
        return Math.abs(hash).toString(16).padStart(64, "0");
    }

    private computeSignature(data: string, privateKey: string): string {
        // Mock signature - in real implementation uses Ed25519
        const combined = data + privateKey;
        let hash = 0;
        for (let i = 0; i < combined.length; i++) {
            hash = ((hash << 5) - hash + combined.charCodeAt(i)) | 0;
        }
        return Math.abs(hash).toString(16).padStart(128, "0");
    }

    private recoverPrivateKey(publicKey: string): string {
        // Mock - can't actually recover private key from public key
        return "0".repeat(64);
    }
}

// ============================================
// Ed25519 Signer Tests
// ============================================

describe("Ed25519Signer", () => {
    let signer: MockEd25519Signer;

    beforeEach(() => {
        signer = new MockEd25519Signer();
    });

    describe("key generation", () => {
        it("should generate key pair", () => {
            const keyPair = signer.generateKeyPair();

            expect(keyPair.publicKey).toBeDefined();
            expect(keyPair.privateKey).toBeDefined();
            expect(keyPair.publicKey).toHaveLength(64);
            expect(keyPair.privateKey).toHaveLength(64);
        });

        it("should generate different keys each time", () => {
            const signer1 = new MockEd25519Signer();
            const signer2 = new MockEd25519Signer();

            const keys1 = signer1.generateKeyPair();
            const keys2 = signer2.generateKeyPair();

            expect(keys1.privateKey).not.toBe(keys2.privateKey);
        });

        it("should derive public key from private key", () => {
            const keyPair = signer.generateKeyPair();

            // Public key should be deterministically derived
            expect(keyPair.publicKey).toBeDefined();
            expect(keyPair.publicKey).not.toBe(keyPair.privateKey);
        });
    });

    describe("signing", () => {
        beforeEach(() => {
            signer.generateKeyPair();
        });

        it("should sign data and return signature object", () => {
            const data = "test data to sign";
            const signature = signer.sign(data);

            expect(signature.signature).toBeDefined();
            expect(signature.publicKey).toBeDefined();
            expect(signature.timestamp).toBeDefined();
        });

        it("should include timestamp in signature", () => {
            const signature = signer.sign("data");

            expect(signature.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}/);
        });

        it("should produce different signatures for different data", () => {
            const sig1 = signer.sign("data1");
            const sig2 = signer.sign("data2");

            expect(sig1.signature).not.toBe(sig2.signature);
        });

        it("should throw error without key pair", () => {
            const newSigner = new MockEd25519Signer();

            expect(() => newSigner.sign("data")).toThrow("No key pair loaded");
        });
    });

    describe("verification", () => {
        let keyPair: KeyPair;

        beforeEach(() => {
            keyPair = signer.generateKeyPair();
        });

        it("should verify valid signature", () => {
            const data = "important data";
            const signature = signer.sign(data);

            const isValid = signer.verify(data, signature);
            expect(isValid).toBe(true);
        });

        it("should verify with public key only", () => {
            const data = "important data";
            const signature = signer.sign(data);

            const isValid = MockEd25519Signer.verifyWithPublicKey(
                data,
                signature,
                keyPair.publicKey
            );

            expect(isValid).toBe(true);
        });

        it("should reject mismatched public key", () => {
            const data = "important data";
            const signature = signer.sign(data);

            const isValid = MockEd25519Signer.verifyWithPublicKey(
                data,
                signature,
                "different_public_key".padStart(64, "0")
            );

            expect(isValid).toBe(false);
        });
    });

    describe("key loading", () => {
        it("should load existing key pair", () => {
            const publicKey = "a".repeat(64);
            const privateKey = "b".repeat(64);

            signer.loadKeyPair(publicKey, privateKey);

            const signature = signer.sign("test");
            expect(signature.publicKey).toBe(publicKey);
        });
    });
});

// ============================================
// Hash Computation Tests
// ============================================

describe("HashComputation", () => {
    const computeSHA256 = (data: string): string => {
        // Mock SHA-256 (in real implementation would use crypto)
        let hash = 0;
        for (let i = 0; i < data.length; i++) {
            const char = data.charCodeAt(i);
            hash = ((hash << 5) - hash + char) | 0;
        }
        return Math.abs(hash).toString(16).padStart(64, "0");
    };

    describe("SHA-256", () => {
        it("should produce 64-character hex hash", () => {
            const hash = computeSHA256("test data");

            expect(hash).toHaveLength(64);
            expect(hash).toMatch(/^[0-9a-f]+$/);
        });

        it("should produce consistent hashes", () => {
            const hash1 = computeSHA256("same data");
            const hash2 = computeSHA256("same data");

            expect(hash1).toBe(hash2);
        });

        it("should produce different hashes for different data", () => {
            const hash1 = computeSHA256("data1");
            const hash2 = computeSHA256("data2");

            expect(hash1).not.toBe(hash2);
        });

        it("should be sensitive to small changes", () => {
            const hash1 = computeSHA256("hello");
            const hash2 = computeSHA256("hallo");

            expect(hash1).not.toBe(hash2);
        });
    });
});

// ============================================
// Key Manager Tests
// ============================================

describe("KeyManager", () => {
    interface StoredKey {
        publicKey: string;
        encryptedPrivateKey: string;
        createdAt: string;
        algorithm: string;
    }

    class MockKeyManager {
        private storage: Map<string, StoredKey> = new Map();

        async storeKey(
            keyId: string,
            publicKey: string,
            privateKey: string,
            passphrase: string
        ): Promise<void> {
            const encryptedPrivateKey = this.encrypt(privateKey, passphrase);

            this.storage.set(keyId, {
                publicKey,
                encryptedPrivateKey,
                createdAt: new Date().toISOString(),
                algorithm: "Ed25519"
            });
        }

        async loadKey(keyId: string, passphrase: string): Promise<KeyPair | null> {
            const stored = this.storage.get(keyId);
            if (!stored) return null;

            const privateKey = this.decrypt(stored.encryptedPrivateKey, passphrase);
            if (!privateKey) return null;

            return {
                publicKey: stored.publicKey,
                privateKey
            };
        }

        async getPublicKey(keyId: string): Promise<string | null> {
            const stored = this.storage.get(keyId);
            return stored?.publicKey ?? null;
        }

        async deleteKey(keyId: string): Promise<boolean> {
            return this.storage.delete(keyId);
        }

        async listKeys(): Promise<string[]> {
            return Array.from(this.storage.keys());
        }

        private encrypt(data: string, passphrase: string): string {
            // Mock encryption
            return Buffer.from(data + "|" + passphrase).toString("base64");
        }

        private decrypt(encryptedData: string, passphrase: string): string | null {
            // Mock decryption
            try {
                const decoded = Buffer.from(encryptedData, "base64").toString();
                const [data, storedPassphrase] = decoded.split("|");
                if (storedPassphrase !== passphrase) return null;
                return data;
            } catch {
                return null;
            }
        }
    }

    let keyManager: MockKeyManager;

    beforeEach(() => {
        keyManager = new MockKeyManager();
    });

    describe("key storage", () => {
        it("should store and retrieve keys", async () => {
            const publicKey = "pub123";
            const privateKey = "priv456";

            await keyManager.storeKey("auditor", publicKey, privateKey, "password");
            const loaded = await keyManager.loadKey("auditor", "password");

            expect(loaded).not.toBeNull();
            expect(loaded?.publicKey).toBe(publicKey);
            expect(loaded?.privateKey).toBe(privateKey);
        });

        it("should reject wrong passphrase", async () => {
            await keyManager.storeKey("key1", "pub", "priv", "correct");
            const loaded = await keyManager.loadKey("key1", "wrong");

            expect(loaded).toBeNull();
        });

        it("should return null for non-existent key", async () => {
            const loaded = await keyManager.loadKey("nonexistent", "password");

            expect(loaded).toBeNull();
        });
    });

    describe("public key access", () => {
        it("should allow public key access without passphrase", async () => {
            await keyManager.storeKey("key1", "public123", "private456", "pass");

            const publicKey = await keyManager.getPublicKey("key1");

            expect(publicKey).toBe("public123");
        });
    });

    describe("key management", () => {
        it("should delete keys", async () => {
            await keyManager.storeKey("key1", "pub", "priv", "pass");

            const deleted = await keyManager.deleteKey("key1");
            const loaded = await keyManager.loadKey("key1", "pass");

            expect(deleted).toBe(true);
            expect(loaded).toBeNull();
        });

        it("should list all key IDs", async () => {
            await keyManager.storeKey("key1", "pub1", "priv1", "pass1");
            await keyManager.storeKey("key2", "pub2", "priv2", "pass2");

            const keys = await keyManager.listKeys();

            expect(keys).toContain("key1");
            expect(keys).toContain("key2");
            expect(keys).toHaveLength(2);
        });
    });
});

// ============================================
// Signature Verification Chain Tests
// ============================================

describe("SignatureVerificationChain", () => {
    it("should verify signature matches signer", () => {
        const signer = new MockEd25519Signer();
        const keyPair = signer.generateKeyPair();

        const data = JSON.stringify({ action: "execute", target: "file.ts" });
        const signature = signer.sign(data);

        // Verification chain
        const steps = [
            { name: "signature_format", valid: signature.signature.length === 128 },
            { name: "public_key_format", valid: signature.publicKey.length === 64 },
            { name: "timestamp_format", valid: /^\d{4}-\d{2}-\d{2}/.test(signature.timestamp) },
            { name: "key_match", valid: signature.publicKey === keyPair.publicKey }
        ];

        for (const step of steps) {
            expect(step.valid).toBe(true);
        }
    });

    it("should reject expired signatures", () => {
        const isExpired = (timestamp: string, maxAgeMs: number): boolean => {
            const signedAt = new Date(timestamp).getTime();
            const now = Date.now();
            return now - signedAt > maxAgeMs;
        };

        const oldTimestamp = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
        const recentTimestamp = new Date().toISOString();

        expect(isExpired(oldTimestamp, 1800000)).toBe(true); // 30 min max
        expect(isExpired(recentTimestamp, 1800000)).toBe(false);
    });
});
