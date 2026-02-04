/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Crypto Module Exports
 * =====================
 *
 * Cryptographic utilities for MACP protocol.
 */

export {
    Ed25519Signer,
    createEd25519Signer,
    createSignerWithNewKeys,
    verifySignature,
    quickSign,
    type SigningResult,
    type VerificationResult
} from "./ed25519-signer.js";

export {
    KeyManager,
    createKeyManager,
    createMemoryKeyManager,
    type KeyPair,
    type KeyManagerConfig
} from "./key-manager.js";
