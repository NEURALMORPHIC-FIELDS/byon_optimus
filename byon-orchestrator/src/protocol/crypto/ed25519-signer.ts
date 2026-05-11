/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Ed25519 Signer
 * ==============
 *
 * Cryptographic signing for ExecutionOrders using Ed25519.
 * Ensures integrity and authenticity of execution commands.
 *
 * Features:
 * - Ed25519 key generation
 * - Document signing
 * - Signature verification
 * - Base64 encoding/decoding
 */

import crypto from "crypto";

// ============================================================================
// TYPES
// ============================================================================

export interface SigningResult {
    /** Base64 encoded signature */
    signature: string;
    /** Public key used (for verification) */
    publicKey: string;
    /** Timestamp of signing */
    signedAt: string;
}

export interface VerificationResult {
    /** Whether signature is valid */
    valid: boolean;
    /** Error message if invalid */
    error?: string;
}

// ============================================================================
// ED25519 SIGNER
// ============================================================================

/**
 * Ed25519 Signer
 *
 * Handles cryptographic operations for MACP protocol.
 */
export class Ed25519Signer {
    private privateKey: crypto.KeyObject | null = null;
    private publicKey: crypto.KeyObject | null = null;

    /**
     * Initialize with existing key pair
     */
    constructor(
        privateKeyPem?: string,
        publicKeyPem?: string
    ) {
        if (privateKeyPem) {
            this.privateKey = crypto.createPrivateKey(privateKeyPem);
        }
        if (publicKeyPem) {
            this.publicKey = crypto.createPublicKey(publicKeyPem);
        }
    }

    /**
     * Generate new key pair
     */
    generateKeyPair(): {
        privateKey: string;
        publicKey: string;
    } {
        const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519", {
            privateKeyEncoding: {
                type: "pkcs8",
                format: "pem"
            },
            publicKeyEncoding: {
                type: "spki",
                format: "pem"
            }
        });

        this.privateKey = crypto.createPrivateKey(privateKey);
        this.publicKey = crypto.createPublicKey(publicKey);

        return {
            privateKey,
            publicKey
        };
    }

    /**
     * Load private key from PEM
     */
    loadPrivateKey(pem: string): void {
        this.privateKey = crypto.createPrivateKey(pem);
        // Derive public key from private
        this.publicKey = crypto.createPublicKey(this.privateKey);
    }

    /**
     * Load public key from PEM
     */
    loadPublicKey(pem: string): void {
        this.publicKey = crypto.createPublicKey(pem);
    }

    /**
     * Sign content
     */
    sign(content: string): SigningResult {
        if (!this.privateKey) {
            throw new Error("Private key not loaded");
        }

        const signature = crypto.sign(
            null, // Ed25519 doesn't need algorithm specification
            Buffer.from(content, "utf8"),
            this.privateKey
        );

        return {
            signature: signature.toString("base64"),
            publicKey: this.getPublicKeyPem(),
            signedAt: new Date().toISOString()
        };
    }

    /**
     * Sign object (serialized to JSON)
     */
    signObject(obj: Record<string, unknown>): SigningResult {
        const content = JSON.stringify(obj);
        return this.sign(content);
    }

    /**
     * Verify signature
     */
    verify(
        content: string,
        signatureBase64: string,
        publicKeyPem?: string
    ): VerificationResult {
        try {
            const pubKey = publicKeyPem
                ? crypto.createPublicKey(publicKeyPem)
                : this.publicKey;

            if (!pubKey) {
                return {
                    valid: false,
                    error: "Public key not available"
                };
            }

            const signature = Buffer.from(signatureBase64, "base64");
            const isValid = crypto.verify(
                null,
                Buffer.from(content, "utf8"),
                pubKey,
                signature
            );

            return {
                valid: isValid,
                error: isValid ? undefined : "Signature verification failed"
            };
        } catch (error) {
            return {
                valid: false,
                error: `Verification error: ${(error as Error).message}`
            };
        }
    }

    /**
     * Verify object signature
     */
    verifyObject(
        obj: Record<string, unknown>,
        signatureBase64: string,
        publicKeyPem?: string
    ): VerificationResult {
        const content = JSON.stringify(obj);
        return this.verify(content, signatureBase64, publicKeyPem);
    }

    /**
     * Get public key PEM
     */
    getPublicKeyPem(): string {
        if (!this.publicKey) {
            throw new Error("Public key not available");
        }

        return this.publicKey.export({
            type: "spki",
            format: "pem"
        }) as string;
    }

    /**
     * Get private key PEM (be careful with this!)
     */
    getPrivateKeyPem(): string {
        if (!this.privateKey) {
            throw new Error("Private key not loaded");
        }

        return this.privateKey.export({
            type: "pkcs8",
            format: "pem"
        }) as string;
    }

    /**
     * Check if signer has private key (can sign)
     */
    canSign(): boolean {
        return this.privateKey !== null;
    }

    /**
     * Check if signer has public key (can verify)
     */
    canVerify(): boolean {
        return this.publicKey !== null;
    }

    /**
     * Get key fingerprint (for identification)
     */
    getKeyFingerprint(): string {
        if (!this.publicKey) {
            throw new Error("Public key not available");
        }

        const publicKeyDer = this.publicKey.export({
            type: "spki",
            format: "der"
        });

        return crypto
            .createHash("sha256")
            .update(publicKeyDer)
            .digest("hex")
            .substring(0, 16);
    }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create Ed25519 signer
 */
export function createEd25519Signer(
    privateKeyPem?: string,
    publicKeyPem?: string
): Ed25519Signer {
    return new Ed25519Signer(privateKeyPem, publicKeyPem);
}

/**
 * Create signer with new key pair
 */
export function createSignerWithNewKeys(): {
    signer: Ed25519Signer;
    privateKey: string;
    publicKey: string;
} {
    const signer = new Ed25519Signer();
    const keys = signer.generateKeyPair();

    return {
        signer,
        privateKey: keys.privateKey,
        publicKey: keys.publicKey
    };
}

/**
 * Verify signature (standalone function)
 */
export function verifySignature(
    content: string,
    signatureBase64: string,
    publicKeyPem: string
): boolean {
    const signer = new Ed25519Signer(undefined, publicKeyPem);
    return signer.verify(content, signatureBase64).valid;
}

/**
 * Quick sign (creates temporary signer)
 */
export function quickSign(
    content: string,
    privateKeyPem: string
): string {
    const signer = new Ed25519Signer(privateKeyPem);
    return signer.sign(content).signature;
}
