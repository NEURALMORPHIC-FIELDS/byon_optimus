/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Executor Signature Verifier
 * ===========================
 *
 * Verifies Ed25519 signatures on ExecutionOrders.
 * Only verified orders can be executed.
 *
 * AIR-GAPPED SECURITY:
 * - This module runs in the air-gapped executor
 * - Only needs the Auditor's public key
 * - Rejects any order with invalid signature
 */

import * as crypto from "crypto";
import { ExecutionOrder } from "../../types/protocol.js";

// ============================================================================
// TYPES
// ============================================================================

export interface VerificationResult {
    verified: boolean;
    order_id: string;
    signed_by: string;
    verified_at: string;
    error?: string;
    details?: {
        hash_valid: boolean;
        signature_valid: boolean;
        constraints_valid: boolean;
    };
}

export interface VerifierConfig {
    /** Trusted public keys (base64 encoded) */
    trusted_keys: string[];
    /** Require specific signer */
    required_signer?: string;
    /** Maximum order age in minutes */
    max_order_age_minutes: number;
    /** Verify constraints are within limits */
    verify_constraints: boolean;
}

// ============================================================================
// CONSTRAINT LIMITS
// ============================================================================

const ABSOLUTE_LIMITS = {
    max_iterations: 20,
    max_timeout_minutes: 60,
    max_memory_mb: 4096,
    max_disk_mb: 2048
};

// ============================================================================
// SIGNATURE VERIFIER
// ============================================================================

/**
 * Signature Verifier for ExecutionOrders
 *
 * Ensures only properly signed orders are executed.
 */
export class ExecutionOrderVerifier {
    private trustedKeys: Map<string, crypto.KeyObject> = new Map();
    private config: VerifierConfig;

    constructor(config: Partial<VerifierConfig> = {}) {
        this.config = {
            trusted_keys: config.trusted_keys || [],
            max_order_age_minutes: config.max_order_age_minutes ?? 60,
            verify_constraints: config.verify_constraints ?? true,
            required_signer: config.required_signer
        };

        // Load trusted keys
        for (const keyBase64 of this.config.trusted_keys) {
            this.addTrustedKey(keyBase64);
        }
    }

    /**
     * Add a trusted public key
     * Supports both raw Ed25519 (32 bytes) and SPKI DER formats
     */
    addTrustedKey(publicKeyBase64: string): void {
        try {
            const keyBuffer = Buffer.from(publicKeyBase64, "base64");
            let publicKey: crypto.KeyObject;

            // Check if it's a raw Ed25519 key (32 bytes)
            if (keyBuffer.length === 32) {
                // Wrap raw key in SPKI DER format
                // SPKI prefix for Ed25519: 302a300506032b6570032100
                const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
                const spkiDer = Buffer.concat([spkiPrefix, keyBuffer]);

                publicKey = crypto.createPublicKey({
                    key: spkiDer,
                    format: "der",
                    type: "spki"
                });
            } else {
                // Assume it's already SPKI DER format
                publicKey = crypto.createPublicKey({
                    key: keyBuffer,
                    format: "der",
                    type: "spki"
                });
            }

            this.trustedKeys.set(publicKeyBase64, publicKey);
        } catch (error) {
            throw new Error(`Invalid public key: ${error}`);
        }
    }

    /**
     * Remove a trusted key
     */
    removeTrustedKey(publicKeyBase64: string): boolean {
        return this.trustedKeys.delete(publicKeyBase64);
    }

    /**
     * Verify an ExecutionOrder
     */
    verify(order: ExecutionOrder): VerificationResult {
        const verifiedAt = new Date().toISOString();
        const details = {
            hash_valid: false,
            signature_valid: false,
            constraints_valid: false
        };

        // Check we have trusted keys
        if (this.trustedKeys.size === 0) {
            return {
                verified: false,
                order_id: order.order_id,
                signed_by: order.approved_by,
                verified_at: verifiedAt,
                error: "No trusted keys configured",
                details
            };
        }

        // Step 1: Verify hash
        const { signature, hash, ...content } = order;
        const expectedHash = this.calculateHash(content);

        if (hash !== expectedHash) {
            return {
                verified: false,
                order_id: order.order_id,
                signed_by: order.approved_by,
                verified_at: verifiedAt,
                error: "Hash mismatch - order may have been tampered",
                details
            };
        }
        details.hash_valid = true;

        // Step 2: Verify signature against trusted keys
        let signatureValid = false;
        let signingKey: string | null = null;

        for (const [keyBase64, publicKey] of this.trustedKeys) {
            try {
                const valid = crypto.verify(
                    null,
                    Buffer.from(hash),
                    publicKey,
                    Buffer.from(signature, "base64")
                );
                if (valid) {
                    signatureValid = true;
                    signingKey = keyBase64;
                    break;
                }
            } catch {
                // Try next key
            }
        }

        if (!signatureValid) {
            return {
                verified: false,
                order_id: order.order_id,
                signed_by: order.approved_by,
                verified_at: verifiedAt,
                error: "Invalid signature - not signed by trusted key",
                details
            };
        }
        details.signature_valid = true;

        // Step 3: Check order age
        const orderAge = Date.now() - new Date(order.timestamp).getTime();
        const maxAge = this.config.max_order_age_minutes * 60 * 1000;

        if (orderAge > maxAge) {
            return {
                verified: false,
                order_id: order.order_id,
                signed_by: order.approved_by,
                verified_at: verifiedAt,
                error: `Order too old: ${Math.round(orderAge / 60000)} minutes`,
                details
            };
        }

        // Step 4: Verify constraints if enabled
        if (this.config.verify_constraints) {
            const constraintErrors = this.verifyConstraints(order.constraints);
            if (constraintErrors.length > 0) {
                return {
                    verified: false,
                    order_id: order.order_id,
                    signed_by: order.approved_by,
                    verified_at: verifiedAt,
                    error: `Invalid constraints: ${constraintErrors.join(", ")}`,
                    details
                };
            }
        }
        details.constraints_valid = true;

        // Step 5: Check required signer if specified
        if (this.config.required_signer && order.approved_by !== this.config.required_signer) {
            return {
                verified: false,
                order_id: order.order_id,
                signed_by: order.approved_by,
                verified_at: verifiedAt,
                error: `Wrong signer: expected ${this.config.required_signer}`,
                details
            };
        }

        // All checks passed
        return {
            verified: true,
            order_id: order.order_id,
            signed_by: order.approved_by,
            verified_at: verifiedAt,
            details
        };
    }

    /**
     * Verify constraints are within absolute limits
     */
    private verifyConstraints(constraints: ExecutionOrder["constraints"]): string[] {
        const errors: string[] = [];

        if (constraints.max_iterations > ABSOLUTE_LIMITS.max_iterations) {
            errors.push(
                `max_iterations ${constraints.max_iterations} exceeds limit ${ABSOLUTE_LIMITS.max_iterations}`
            );
        }

        if (constraints.timeout_minutes !== undefined && constraints.timeout_minutes > ABSOLUTE_LIMITS.max_timeout_minutes) {
            errors.push(
                `timeout_minutes ${constraints.timeout_minutes} exceeds limit ${ABSOLUTE_LIMITS.max_timeout_minutes}`
            );
        }

        if (constraints.memory_limit_mb !== undefined && constraints.memory_limit_mb > ABSOLUTE_LIMITS.max_memory_mb) {
            errors.push(
                `memory_limit_mb ${constraints.memory_limit_mb} exceeds limit ${ABSOLUTE_LIMITS.max_memory_mb}`
            );
        }

        if (constraints.disk_limit_mb !== undefined && constraints.disk_limit_mb > ABSOLUTE_LIMITS.max_disk_mb) {
            errors.push(
                `disk_limit_mb ${constraints.disk_limit_mb} exceeds limit ${ABSOLUTE_LIMITS.max_disk_mb}`
            );
        }

        return errors;
    }

    /**
     * Calculate SHA256 hash
     */
    private calculateHash(content: unknown): string {
        const json = JSON.stringify(content, Object.keys(content as object).sort());
        return crypto.createHash("sha256").update(json).digest("hex");
    }

    /**
     * Get list of trusted key fingerprints
     */
    getTrustedKeyFingerprints(): string[] {
        return Array.from(this.trustedKeys.keys()).map(key => {
            const hash = crypto.createHash("sha256").update(key).digest("hex");
            return hash.substring(0, 16);
        });
    }

    /**
     * Check if a key is trusted
     */
    isKeyTrusted(publicKeyBase64: string): boolean {
        return this.trustedKeys.has(publicKeyBase64);
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create verifier with trusted keys
 */
export function createVerifier(trustedKeys: string[]): ExecutionOrderVerifier {
    return new ExecutionOrderVerifier({ trusted_keys: trustedKeys });
}

/**
 * Create verifier from Auditor public key
 */
export function createVerifierFromAuditor(auditorPublicKey: string): ExecutionOrderVerifier {
    return new ExecutionOrderVerifier({
        trusted_keys: [auditorPublicKey]
    });
}
