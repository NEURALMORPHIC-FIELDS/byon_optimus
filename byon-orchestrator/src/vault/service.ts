/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Secure Vault Service
 * ====================
 *
 * Main service for managing sensitive data with human-in-the-loop approval.
 *
 * SECURITY ARCHITECTURE:
 * 1. All data encrypted at rest (GPG or AES-256-GCM)
 * 2. Access requires explicit approval (ask-always policy)
 * 3. Complete audit trail for all operations
 * 4. 30-second timeout for approval requests
 * 5. Desktop notifications for access requests
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import {
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
import {
    isGpgAvailable,
    getGpgKeyId,
    encryptWithGpg,
    decryptWithGpg,
    encryptWithAes,
    decryptWithAes,
    calculateChecksum,
    verifyChecksum,
    secureWipe
} from './encryption.js';
import { logger } from '../utils/logger.js';

/** Default vault configuration */
const DEFAULT_CONFIG: VaultConfig = {
    vaultPath: process.env.BYON_VAULT_PATH || './vault',
    approvalTimeoutMs: 30000, // 30 seconds
    requireApprovalFor: ['credentials', 'keys', 'financial', 'documents', 'secrets'],
    auditLogPath: './vault/audit.log',
    notificationEnabled: true
};

/** Pending approval requests */
const pendingRequests = new Map<string, {
    request: VaultAccessRequest;
    resolve: (response: VaultAccessResponse) => void;
    timeout: NodeJS.Timeout;
}>();

/** Vault service events */
export const vaultEvents = new EventEmitter();

/**
 * Initialize vault directory structure
 */
export async function initializeVault(config: Partial<VaultConfig> = {}): Promise<VaultResult<void>> {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    try {
        // Create vault directory
        await fs.mkdir(cfg.vaultPath, { recursive: true });

        // Create subdirectories for each category
        const categories: VaultCategory[] = ['credentials', 'keys', 'financial', 'documents', 'secrets'];
        for (const category of categories) {
            await fs.mkdir(path.join(cfg.vaultPath, category), { recursive: true });
        }

        // Create audit log directory
        await fs.mkdir(path.dirname(cfg.auditLogPath), { recursive: true });

        // Create index file
        const indexPath = path.join(cfg.vaultPath, 'index.json');
        try {
            await fs.access(indexPath);
        } catch {
            await fs.writeFile(indexPath, JSON.stringify({ entries: [] }, null, 2));
        }

        await logAudit({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            action: 'create',
            requestedBy: 'system',
            reason: 'Vault initialized'
        }, cfg);

        logger.info('[Vault] Initialized successfully', { path: cfg.vaultPath });

        return { success: true };
    } catch (err) {
        logger.error('[Vault] Initialization failed', err instanceof Error ? err : new Error(String(err)));
        return { success: false, error: String(err) };
    }
}

/**
 * Store sensitive data in vault
 */
export async function storeSecret(
    name: string,
    category: VaultCategory,
    data: string,
    description?: string,
    config: Partial<VaultConfig> = {}
): Promise<VaultResult<string>> {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const entryId = crypto.randomUUID();

    try {
        // Encrypt data
        const gpgAvailable = isGpgAvailable();
        const gpgKeyId = gpgAvailable ? await getGpgKeyId() : null;

        let encryptedData: string;
        let method: 'gpg' | 'aes';

        if (gpgKeyId) {
            const result = await encryptWithGpg(data, gpgKeyId);
            encryptedData = result.encrypted;
            method = 'gpg';
        } else {
            // Fallback to AES with derived passphrase
            const passphrase = process.env.BYON_VAULT_KEY || 'byon-vault-default-key';
            const result = encryptWithAes(data, passphrase);
            encryptedData = result.encrypted;
            method = 'aes';
        }

        const checksum = calculateChecksum(data);

        // Create entry
        const entry: VaultEntry = {
            meta: {
                id: entryId,
                name,
                category,
                description,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                accessCount: 0,
                tags: []
            },
            encryptedData,
            checksum
        };

        // Save to file
        const entryPath = path.join(cfg.vaultPath, category, `${entryId}.vault`);
        await fs.writeFile(entryPath, JSON.stringify(entry, null, 2));

        // Update index
        await updateIndex(cfg.vaultPath, entry.meta);

        // Audit log
        await logAudit({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            action: 'create',
            entryId,
            entryName: name,
            category,
            requestedBy: 'user',
            reason: `Stored ${category} secret: ${name}`
        }, cfg);

        // Secure wipe original data from memory
        secureWipe(data);

        logger.info('[Vault] Secret stored', { id: entryId, name, category, method });

        return { success: true, data: entryId };
    } catch (err) {
        logger.error('[Vault] Store failed', err instanceof Error ? err : new Error(String(err)), { name, category });
        return { success: false, error: String(err) };
    }
}

/**
 * Request access to vault entry (requires approval)
 */
export async function requestAccess(
    entryId: string,
    reason: string,
    requestedBy: string = 'agent',
    config: Partial<VaultConfig> = {}
): Promise<VaultResult<string>> {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    try {
        // Load entry metadata
        const entry = await loadEntry(entryId, cfg.vaultPath);
        if (!entry) {
            return { success: false, error: 'Entry not found' };
        }

        // Check if approval is required
        if (!cfg.requireApprovalFor.includes(entry.meta.category)) {
            // Direct access allowed
            return await retrieveSecret(entryId, cfg);
        }

        // Create approval request
        const request: VaultAccessRequest = {
            requestId: crypto.randomUUID(),
            entryId,
            entryName: entry.meta.name,
            category: entry.meta.category,
            reason,
            requestedBy,
            requestedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + cfg.approvalTimeoutMs).toISOString()
        };

        // Audit log - access requested
        await logAudit({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            action: 'access_request',
            entryId,
            entryName: entry.meta.name,
            category: entry.meta.category,
            requestedBy,
            reason
        }, cfg);

        // Emit event for UI/notification
        vaultEvents.emit('access_request', request);

        // Send desktop notification if enabled
        if (cfg.notificationEnabled) {
            await sendNotification(
                '🔐 Vault Access Request',
                `${requestedBy} requests access to "${entry.meta.name}"\nReason: ${reason}\nCategory: ${entry.meta.category}`
            );
        }

        logger.info('[Vault] Access request created', {
            requestId: request.requestId,
            entryId,
            entryName: entry.meta.name
        });

        // Wait for approval
        const response = await waitForApproval(request, cfg.approvalTimeoutMs);

        if (response.approved) {
            // Audit log - approved
            await logAudit({
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                action: 'access_approved',
                entryId,
                entryName: entry.meta.name,
                category: entry.meta.category,
                requestedBy,
                approved: true
            }, cfg);

            // Retrieve and return secret
            return await retrieveSecret(entryId, cfg);
        } else {
            // Audit log - denied
            await logAudit({
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                action: 'access_denied',
                entryId,
                entryName: entry.meta.name,
                category: entry.meta.category,
                requestedBy,
                approved: false,
                reason: response.denialReason
            }, cfg);

            return {
                success: false,
                error: response.denialReason || 'Access denied by user'
            };
        }
    } catch (err) {
        logger.error('[Vault] Access request failed', err instanceof Error ? err : new Error(String(err)), { entryId });
        return { success: false, error: String(err) };
    }
}

/**
 * Approve vault access request
 */
export function approveAccess(requestId: string, approvedBy: string = 'user'): boolean {
    const pending = pendingRequests.get(requestId);
    if (!pending) {
        logger.warn('[Vault] Approval request not found', { requestId });
        return false;
    }

    clearTimeout(pending.timeout);
    pending.resolve({
        requestId,
        approved: true,
        approvedAt: new Date().toISOString(),
        approvedBy
    });

    pendingRequests.delete(requestId);
    logger.info('[Vault] Access approved', { requestId, approvedBy });

    return true;
}

/**
 * Deny vault access request
 */
export function denyAccess(requestId: string, reason: string = 'Denied by user'): boolean {
    const pending = pendingRequests.get(requestId);
    if (!pending) {
        logger.warn('[Vault] Denial request not found', { requestId });
        return false;
    }

    clearTimeout(pending.timeout);
    pending.resolve({
        requestId,
        approved: false,
        denialReason: reason
    });

    pendingRequests.delete(requestId);
    logger.info('[Vault] Access denied', { requestId, reason });

    return true;
}

/**
 * List all vault entries
 */
export async function listEntries(
    category?: VaultCategory,
    config: Partial<VaultConfig> = {}
): Promise<VaultResult<VaultEntryMeta[]>> {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    try {
        const indexPath = path.join(cfg.vaultPath, 'index.json');
        const indexData = await fs.readFile(indexPath, 'utf8');
        const index = JSON.parse(indexData);

        let entries: VaultEntryMeta[] = index.entries || [];

        if (category) {
            entries = entries.filter((e: VaultEntryMeta) => e.category === category);
        }

        return { success: true, data: entries };
    } catch (err) {
        logger.error('[Vault] List entries failed', err instanceof Error ? err : new Error(String(err)));
        return { success: false, error: String(err) };
    }
}

/**
 * Get vault status
 */
export async function getVaultStatus(
    config: Partial<VaultConfig> = {}
): Promise<VaultResult<VaultStatus>> {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    try {
        const gpgAvailable = isGpgAvailable();
        const gpgKeyId = gpgAvailable ? await getGpgKeyId() : null;

        const entriesResult = await listEntries(undefined, cfg);
        const entries = entriesResult.data || [];

        const categoryCounts: Record<VaultCategory, number> = {
            credentials: 0,
            keys: 0,
            financial: 0,
            documents: 0,
            secrets: 0
        };

        for (const entry of entries) {
            categoryCounts[entry.category]++;
        }

        const status: VaultStatus = {
            initialized: true,
            entriesCount: entries.length,
            categoryCounts,
            gpgAvailable,
            gpgKeyConfigured: !!gpgKeyId
        };

        return { success: true, data: status };
    } catch (error) {
        return {
            success: true,
            data: {
                initialized: false,
                entriesCount: 0,
                categoryCounts: {
                    credentials: 0,
                    keys: 0,
                    financial: 0,
                    documents: 0,
                    secrets: 0
                },
                gpgAvailable: isGpgAvailable(),
                gpgKeyConfigured: false
            }
        };
    }
}

/**
 * Delete vault entry
 */
export async function deleteEntry(
    entryId: string,
    config: Partial<VaultConfig> = {}
): Promise<VaultResult<void>> {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    try {
        const entry = await loadEntry(entryId, cfg.vaultPath);
        if (!entry) {
            return { success: false, error: 'Entry not found' };
        }

        // Delete file
        const entryPath = path.join(cfg.vaultPath, entry.meta.category, `${entryId}.vault`);
        await fs.unlink(entryPath);

        // Update index
        await removeFromIndex(cfg.vaultPath, entryId);

        // Audit log
        await logAudit({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            action: 'delete',
            entryId,
            entryName: entry.meta.name,
            category: entry.meta.category,
            requestedBy: 'user',
            reason: 'Entry deleted'
        }, cfg);

        logger.info('[Vault] Entry deleted', { id: entryId, name: entry.meta.name });

        return { success: true };
    } catch (err) {
        logger.error('[Vault] Delete failed', err instanceof Error ? err : new Error(String(err)), { entryId });
        return { success: false, error: String(err) };
    }
}

// ============================================
// INTERNAL HELPERS
// ============================================

async function loadEntry(entryId: string, vaultPath: string): Promise<VaultEntry | null> {
    const categories: VaultCategory[] = ['credentials', 'keys', 'financial', 'documents', 'secrets'];

    for (const category of categories) {
        const entryPath = path.join(vaultPath, category, `${entryId}.vault`);
        try {
            const data = await fs.readFile(entryPath, 'utf8');
            return JSON.parse(data);
        } catch {
            continue;
        }
    }

    return null;
}

async function retrieveSecret(
    entryId: string,
    config: VaultConfig
): Promise<VaultResult<string>> {
    try {
        const entry = await loadEntry(entryId, config.vaultPath);
        if (!entry) {
            return { success: false, error: 'Entry not found' };
        }

        // Decrypt
        let decrypted: string;
        const gpgKeyId = await getGpgKeyId();

        if (gpgKeyId && entry.encryptedData.includes('BEGIN PGP')) {
            decrypted = await decryptWithGpg(entry.encryptedData);
        } else {
            const passphrase = process.env.BYON_VAULT_KEY || 'byon-vault-default-key';
            decrypted = decryptWithAes(entry.encryptedData, passphrase);
        }

        // Verify checksum
        if (!verifyChecksum(decrypted, entry.checksum)) {
            return { success: false, error: 'Checksum verification failed - data may be corrupted' };
        }

        // Update access count
        entry.meta.accessCount++;
        entry.meta.lastAccessedAt = new Date().toISOString();
        const entryPath = path.join(config.vaultPath, entry.meta.category, `${entryId}.vault`);
        await fs.writeFile(entryPath, JSON.stringify(entry, null, 2));

        return { success: true, data: decrypted };
    } catch (error) {
        return { success: false, error: String(error) };
    }
}

async function waitForApproval(
    request: VaultAccessRequest,
    timeoutMs: number
): Promise<VaultAccessResponse> {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            pendingRequests.delete(request.requestId);
            resolve({
                requestId: request.requestId,
                approved: false,
                denialReason: 'Request timed out (30s)'
            });
        }, timeoutMs);

        pendingRequests.set(request.requestId, { request, resolve, timeout });
    });
}

async function updateIndex(vaultPath: string, meta: VaultEntryMeta): Promise<void> {
    const indexPath = path.join(vaultPath, 'index.json');
    let index = { entries: [] as VaultEntryMeta[] };

    try {
        const data = await fs.readFile(indexPath, 'utf8');
        index = JSON.parse(data);
    } catch {}

    // Remove existing entry with same ID
    index.entries = index.entries.filter((e: VaultEntryMeta) => e.id !== meta.id);
    index.entries.push(meta);

    await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
}

async function removeFromIndex(vaultPath: string, entryId: string): Promise<void> {
    const indexPath = path.join(vaultPath, 'index.json');

    try {
        const data = await fs.readFile(indexPath, 'utf8');
        const index = JSON.parse(data);
        index.entries = index.entries.filter((e: VaultEntryMeta) => e.id !== entryId);
        await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
    } catch {}
}

async function logAudit(entry: VaultAuditEntry, config: VaultConfig): Promise<void> {
    try {
        const logLine = JSON.stringify(entry) + '\n';
        await fs.appendFile(config.auditLogPath, logLine);
    } catch (err) {
        logger.error('[Vault] Audit log failed', err instanceof Error ? err : new Error(String(err)));
    }
}

async function sendNotification(title: string, message: string): Promise<void> {
    try {
        // Cross-platform notification
        if (process.platform === 'win32') {
            const { exec } = await import('child_process');
            const ps = `
                [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
                $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
                $textNodes = $template.GetElementsByTagName("text")
                $textNodes.Item(0).AppendChild($template.CreateTextNode("${title.replace(/"/g, '`"')}")) | Out-Null
                $textNodes.Item(1).AppendChild($template.CreateTextNode("${message.replace(/"/g, '`"')}")) | Out-Null
                $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("BYON Vault")
                $notifier.Show([Windows.UI.Notifications.ToastNotification]::new($template))
            `;
            exec(`powershell -Command "${ps}"`);
        } else if (process.platform === 'darwin') {
            const { exec } = await import('child_process');
            exec(`osascript -e 'display notification "${message}" with title "${title}"'`);
        } else {
            const { exec } = await import('child_process');
            exec(`notify-send "${title}" "${message}"`);
        }
    } catch {
        // Notifications are optional
    }
}

/**
 * Get pending approval requests
 */
export function getPendingRequests(): VaultAccessRequest[] {
    return Array.from(pendingRequests.values()).map(p => p.request);
}
