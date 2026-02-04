/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Secure Vault Types
 * ==================
 *
 * Type definitions for the BYON Secure Vault system.
 * Defense in depth with human-in-the-loop approval.
 */

/** Categories of sensitive data */
export type VaultCategory =
    | 'credentials'      // API keys, passwords, tokens
    | 'keys'            // SSH keys, GPG keys, crypto keys
    | 'financial'       // Banking, crypto wallets, trading
    | 'documents'       // Legal, medical, personal
    | 'secrets';        // Generic secrets

/** Vault entry metadata */
export interface VaultEntryMeta {
    id: string;
    name: string;
    category: VaultCategory;
    description?: string;
    createdAt: string;
    updatedAt: string;
    accessCount: number;
    lastAccessedAt?: string;
    lastAccessedBy?: string;
    tags?: string[];
}

/** Encrypted vault entry */
export interface VaultEntry {
    meta: VaultEntryMeta;
    encryptedData: string;  // GPG encrypted, base64 encoded
    checksum: string;       // SHA-256 of plaintext
}

/** Vault access request */
export interface VaultAccessRequest {
    requestId: string;
    entryId: string;
    entryName: string;
    category: VaultCategory;
    reason: string;
    requestedBy: string;
    requestedAt: string;
    expiresAt: string;      // 30s timeout
}

/** Vault access response */
export interface VaultAccessResponse {
    requestId: string;
    approved: boolean;
    approvedAt?: string;
    approvedBy?: string;
    denialReason?: string;
}

/** Vault audit log entry */
export interface VaultAuditEntry {
    id: string;
    timestamp: string;
    action: 'create' | 'read' | 'update' | 'delete' | 'access_request' | 'access_approved' | 'access_denied';
    entryId?: string;
    entryName?: string;
    category?: VaultCategory;
    requestedBy: string;
    approved?: boolean;
    reason?: string;
    ipAddress?: string;
    userAgent?: string;
}

/** Vault configuration */
export interface VaultConfig {
    vaultPath: string;              // Path to vault directory
    gpgKeyId?: string;              // GPG key ID for encryption
    approvalTimeoutMs: number;      // Timeout for approval (default 30s)
    requireApprovalFor: VaultCategory[];  // Categories requiring approval
    auditLogPath: string;           // Path to audit log
    notificationEnabled: boolean;   // Enable desktop notifications
}

/** Vault status */
export interface VaultStatus {
    initialized: boolean;
    entriesCount: number;
    categoryCounts: Record<VaultCategory, number>;
    lastAccess?: string;
    gpgAvailable: boolean;
    gpgKeyConfigured: boolean;
}

/** Result of vault operations */
export interface VaultResult<T> {
    success: boolean;
    data?: T;
    error?: string;
    auditId?: string;
}
