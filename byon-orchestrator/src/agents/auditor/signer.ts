/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Auditor Signer
 * ==============
 *
 * Ed25519 digital signature for ExecutionOrders.
 * Ensures only approved plans can be executed.
 *
 * SECURITY:
 * - Private key MUST be protected
 * - Only Auditor can sign ExecutionOrders
 * - Executor verifies signature before execution
 * - Signature covers hash of order content
 */

import * as crypto from "crypto";
import {
    ExecutionOrder,
    PlanDraft,
    Action,
    RiskLevel
} from "../../types/protocol.js";

// ============================================================================
// TYPES
// ============================================================================

export interface KeyPair {
    publicKey: string;  // Base64 encoded
    privateKey: string; // Base64 encoded (PROTECT THIS!)
}

export interface SignerConfig {
    /** Pre-generated key pair (optional) */
    key_pair?: KeyPair;
    /** Generate new key pair if not provided */
    auto_generate: boolean;
}

export interface SigningResult {
    order: ExecutionOrder;
    signed_at: string;
    public_key: string;
}

export interface VerificationResult {
    valid: boolean;
    order_id: string;
    signed_by: string;
    error?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default constraints by risk level */
const DEFAULT_CONSTRAINTS: Record<RiskLevel, ExecutionOrder["constraints"]> = {
    low: {
        max_iterations: 10,
        timeout_minutes: 30,
        memory_limit_mb: 1024,
        disk_limit_mb: 512
    },
    medium: {
        max_iterations: 5,
        timeout_minutes: 15,
        memory_limit_mb: 512,
        disk_limit_mb: 256
    },
    high: {
        max_iterations: 3,
        timeout_minutes: 10,
        memory_limit_mb: 256,
        disk_limit_mb: 128
    }
};

// ============================================================================
// ED25519 SIGNER
// ============================================================================

/**
 * Ed25519 Signer for ExecutionOrders
 *
 * IMPORTANT: Private key must be kept secure.
 * Only the Auditor should have access to the signer.
 */
export class ExecutionOrderSigner {
    private publicKey: crypto.KeyObject;
    private privateKey: crypto.KeyObject;
    private publicKeyBase64: string;

    constructor(config: Partial<SignerConfig> = {}) {
        if (config.key_pair) {
            // Use provided key pair - supports both raw Ed25519 and DER formats
            const privateKeyBuffer = Buffer.from(config.key_pair.privateKey, "base64");
            const publicKeyBuffer = Buffer.from(config.key_pair.publicKey, "base64");

            // Handle raw Ed25519 private key (32 bytes)
            if (privateKeyBuffer.length === 32) {
                // Wrap raw private key in PKCS8 DER format
                // PKCS8 prefix for Ed25519: 302e020100300506032b657004220420
                const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
                const pkcs8Der = Buffer.concat([pkcs8Prefix, privateKeyBuffer]);
                this.privateKey = crypto.createPrivateKey({
                    key: pkcs8Der,
                    format: "der",
                    type: "pkcs8"
                });
            } else {
                // Assume already PKCS8 DER format
                this.privateKey = crypto.createPrivateKey({
                    key: privateKeyBuffer,
                    format: "der",
                    type: "pkcs8"
                });
            }

            // Handle raw Ed25519 public key (32 bytes)
            if (publicKeyBuffer.length === 32) {
                // Wrap raw public key in SPKI DER format
                // SPKI prefix for Ed25519: 302a300506032b6570032100
                const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
                const spkiDer = Buffer.concat([spkiPrefix, publicKeyBuffer]);
                this.publicKey = crypto.createPublicKey({
                    key: spkiDer,
                    format: "der",
                    type: "spki"
                });
            } else {
                // Assume already SPKI DER format
                this.publicKey = crypto.createPublicKey({
                    key: publicKeyBuffer,
                    format: "der",
                    type: "spki"
                });
            }

            this.publicKeyBase64 = config.key_pair.publicKey;
        } else if (config.auto_generate !== false) {
            // Generate new key pair
            const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
            this.publicKey = publicKey;
            this.privateKey = privateKey;
            this.publicKeyBase64 = publicKey
                .export({ type: "spki", format: "der" })
                .toString("base64");
        } else {
            throw new Error("No key pair provided and auto_generate is disabled");
        }
    }

    /**
     * Get public key (safe to share)
     */
    getPublicKey(): string {
        return this.publicKeyBase64;
    }

    /**
     * Export key pair (PROTECT PRIVATE KEY!)
     */
    exportKeyPair(): KeyPair {
        return {
            publicKey: this.publicKeyBase64,
            privateKey: this.privateKey
                .export({ type: "pkcs8", format: "der" })
                .toString("base64")
        };
    }

    /**
     * Create and sign an ExecutionOrder from approved PlanDraft
     */
    signOrder(
        plan: PlanDraft,
        approvedBy: string,
        constraintsOverride?: Partial<ExecutionOrder["constraints"]>
    ): SigningResult {
        const orderId = `order_${crypto.randomUUID().replace(/-/g, "")}`;
        const timestamp = new Date().toISOString();
        const approvedAt = timestamp;

        // Determine constraints based on risk level
        const baseConstraints = DEFAULT_CONSTRAINTS[plan.risk_level];
        const constraints = constraintsOverride
            ? { ...baseConstraints, ...constraintsOverride }
            : baseConstraints;

        // Build order content (without signature and hash)
        const orderContent: Omit<ExecutionOrder, "signature" | "hash"> = {
            document_type: "EXECUTION_ORDER",
            document_version: "1.0",
            order_id: orderId,
            timestamp,
            based_on_plan: plan.plan_id,
            approved_by: approvedBy,
            approved_at: approvedAt,
            actions: plan.actions,
            constraints,
            rollback: {
                enabled: plan.rollback_possible,
                instructions: plan.rollback_possible
                    ? "Rollback by reverting file changes"
                    : undefined
            }
        };

        // Calculate content hash
        const contentHash = this.calculateHash(orderContent);

        // Sign the hash
        const signature = this.sign(contentHash);

        // Assemble final order
        const order: ExecutionOrder = {
            ...orderContent,
            hash: contentHash,
            signature
        };

        return {
            order,
            signed_at: timestamp,
            public_key: this.publicKeyBase64
        };
    }

    /**
     * Sign data with private key
     */
    sign(data: string): string {
        const signature = crypto.sign(null, Buffer.from(data), this.privateKey);
        return signature.toString("base64");
    }

    /**
     * Verify signature with public key
     */
    verify(data: string, signature: string): boolean {
        try {
            return crypto.verify(
                null,
                Buffer.from(data),
                this.publicKey,
                Buffer.from(signature, "base64")
            );
        } catch {
            return false;
        }
    }

    /**
     * Verify an ExecutionOrder
     */
    verifyOrder(order: ExecutionOrder): VerificationResult {
        // Recalculate hash
        const { signature, hash, ...content } = order;
        const expectedHash = this.calculateHash(content);

        // Check hash matches
        if (hash !== expectedHash) {
            return {
                valid: false,
                order_id: order.order_id,
                signed_by: order.approved_by,
                error: "Hash mismatch - order may have been tampered"
            };
        }

        // Verify signature
        const signatureValid = this.verify(hash, signature);

        if (!signatureValid) {
            return {
                valid: false,
                order_id: order.order_id,
                signed_by: order.approved_by,
                error: "Invalid signature"
            };
        }

        return {
            valid: true,
            order_id: order.order_id,
            signed_by: order.approved_by
        };
    }

    /**
     * Calculate SHA256 hash
     */
    private calculateHash(content: unknown): string {
        const json = JSON.stringify(content, Object.keys(content as object).sort());
        return crypto.createHash("sha256").update(json).digest("hex");
    }
}

// ============================================================================
// SIGNATURE VERIFIER (for Executor)
// ============================================================================

/**
 * Signature Verifier for ExecutionOrders
 *
 * Used by Executor to verify orders before execution.
 * Only needs the public key.
 */
export class SignatureVerifier {
    private publicKey: crypto.KeyObject;

    constructor(publicKeyBase64: string) {
        const keyBuffer = Buffer.from(publicKeyBase64, "base64");

        // Handle raw Ed25519 public key (32 bytes)
        if (keyBuffer.length === 32) {
            // Wrap raw public key in SPKI DER format
            // SPKI prefix for Ed25519: 302a300506032b6570032100
            const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
            const spkiDer = Buffer.concat([spkiPrefix, keyBuffer]);
            this.publicKey = crypto.createPublicKey({
                key: spkiDer,
                format: "der",
                type: "spki"
            });
        } else {
            // Assume already SPKI DER format
            this.publicKey = crypto.createPublicKey({
                key: keyBuffer,
                format: "der",
                type: "spki"
            });
        }
    }

    /**
     * Verify signature
     */
    verify(data: string, signature: string): boolean {
        try {
            return crypto.verify(
                null,
                Buffer.from(data),
                this.publicKey,
                Buffer.from(signature, "base64")
            );
        } catch {
            return false;
        }
    }

    /**
     * Verify ExecutionOrder
     */
    verifyOrder(order: ExecutionOrder): VerificationResult {
        // Recalculate hash from content
        const { signature, hash, ...content } = order;
        const expectedHash = crypto
            .createHash("sha256")
            .update(JSON.stringify(content, Object.keys(content).sort()))
            .digest("hex");

        // Check hash
        if (hash !== expectedHash) {
            return {
                valid: false,
                order_id: order.order_id,
                signed_by: order.approved_by,
                error: "Hash mismatch"
            };
        }

        // Verify signature
        if (!this.verify(hash, signature)) {
            return {
                valid: false,
                order_id: order.order_id,
                signed_by: order.approved_by,
                error: "Invalid signature"
            };
        }

        return {
            valid: true,
            order_id: order.order_id,
            signed_by: order.approved_by
        };
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create signer with new key pair
 */
export function createSigner(): ExecutionOrderSigner {
    return new ExecutionOrderSigner({ auto_generate: true });
}

/**
 * Create signer from existing key pair
 */
export function createSignerFromKeyPair(keyPair: KeyPair): ExecutionOrderSigner {
    return new ExecutionOrderSigner({ key_pair: keyPair });
}

/**
 * Create verifier from public key
 */
export function createVerifier(publicKeyBase64: string): SignatureVerifier {
    return new SignatureVerifier(publicKeyBase64);
}

/**
 * Generate new key pair
 */
export function generateKeyPair(): KeyPair {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");

    return {
        publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
        privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64")
    };
}
