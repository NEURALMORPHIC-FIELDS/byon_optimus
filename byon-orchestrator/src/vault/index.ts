/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON Secure Vault Module
 * ========================
 *
 * Secure storage for sensitive data with human-in-the-loop approval.
 *
 * Features:
 * - GPG/AES-256 encryption at rest
 * - Ask-always access policy
 * - 30-second approval timeout
 * - Complete audit trail
 * - Desktop notifications
 * - Rate limiting
 *
 * Usage:
 *   import { initializeVault, storeSecret, requestAccess } from './vault';
 *
 *   // Initialize
 *   await initializeVault();
 *
 *   // Store secret
 *   await storeSecret('api-key', 'credentials', 'my-secret-key');
 *
 *   // Request access (requires approval)
 *   const result = await requestAccess(entryId, 'Need for API call');
 */

// Types
export {
    VaultCategory,
    VaultEntry,
    VaultEntryMeta,
    VaultAccessRequest,
    VaultAccessResponse,
    VaultAuditEntry,
    VaultConfig,
    VaultStatus,
    VaultResult
} from './types.js';

// Service
export {
    initializeVault,
    storeSecret,
    requestAccess,
    approveAccess,
    denyAccess,
    listEntries,
    deleteEntry,
    getVaultStatus,
    getPendingRequests,
    vaultEvents
} from './service.js';

// Policy
export {
    VaultPolicy,
    ASK_ALWAYS_POLICY,
    READ_ONLY_POLICY,
    EMERGENCY_POLICY,
    checkPolicy,
    getPolicy,
    createPolicy,
    validatePolicy,
    resetRateLimits
} from './policy.js';

// Encryption utilities
export {
    isGpgAvailable,
    getGpgKeyId,
    calculateChecksum,
    verifyChecksum
} from './encryption.js';
