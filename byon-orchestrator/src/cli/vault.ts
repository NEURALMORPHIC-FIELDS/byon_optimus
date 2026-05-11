/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON CLI - Vault Commands
 * =========================
 *
 * Manage secure vault for sensitive data.
 *
 * Usage:
 *   byon vault init                    Initialize vault
 *   byon vault store <name> <category> Store a secret
 *   byon vault list [category]         List vault entries
 *   byon vault get <id>                Get secret (requires approval)
 *   byon vault delete <id>             Delete vault entry
 *   byon vault status                  Show vault status
 *   byon vault approve <requestId>     Approve access request
 *   byon vault deny <requestId>        Deny access request
 *   byon vault pending                 List pending requests
 */

import * as readline from 'readline';
import {
    initializeVault,
    storeSecret,
    listEntries,
    requestAccess,
    deleteEntry,
    getVaultStatus,
    approveAccess,
    denyAccess,
    getPendingRequests,
    vaultEvents
} from '../vault/service.js';
import { VaultCategory, VaultAccessRequest } from '../vault/types.js';
import { CliResult } from './types.js';

const CATEGORIES: VaultCategory[] = ['credentials', 'keys', 'financial', 'documents', 'secrets'];

/**
 * Initialize vault
 */
export async function vaultInit(): Promise<CliResult> {
    console.log('🔐 Initializing BYON Secure Vault...\n');

    const result = await initializeVault();

    if (result.success) {
        console.log('✅ Vault initialized successfully!');
        console.log('\nVault features:');
        console.log('  • GPG/AES-256 encryption at rest');
        console.log('  • Human-in-the-loop approval (ask-always)');
        console.log('  • 30-second approval timeout');
        console.log('  • Complete audit trail');
        console.log('  • Desktop notifications');
        console.log('\nCategories available:');
        CATEGORIES.forEach(cat => console.log(`  • ${cat}`));
        return { success: true, message: 'Vault initialized' };
    } else {
        console.log(`❌ Failed to initialize vault: ${result.error}`);
        return { success: false, message: result.error || 'Init failed' };
    }
}

/**
 * Store secret interactively
 */
export async function vaultStore(name?: string, category?: string): Promise<CliResult> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = (prompt: string): Promise<string> =>
        new Promise(resolve => rl.question(prompt, resolve));

    try {
        // Get name
        const secretName = name || await question('Secret name: ');
        if (!secretName) {
            console.log('❌ Name is required');
            rl.close();
            return { success: false, message: 'Name required' };
        }

        // Get category
        let secretCategory = category as VaultCategory;
        if (!secretCategory || !CATEGORIES.includes(secretCategory)) {
            console.log('\nAvailable categories:');
            CATEGORIES.forEach((cat, i) => console.log(`  ${i + 1}. ${cat}`));
            const catIndex = await question('Select category (1-5): ');
            secretCategory = CATEGORIES[parseInt(catIndex) - 1];
        }

        if (!secretCategory) {
            console.log('❌ Invalid category');
            rl.close();
            return { success: false, message: 'Invalid category' };
        }

        // Get description
        const description = await question('Description (optional): ');

        // Get secret value (hidden input)
        console.log('Enter secret value (will be encrypted):');
        const secretValue = await question('> ');

        if (!secretValue) {
            console.log('❌ Secret value is required');
            rl.close();
            return { success: false, message: 'Value required' };
        }

        rl.close();

        console.log('\n🔒 Encrypting and storing...');
        const result = await storeSecret(secretName, secretCategory, secretValue, description || undefined);

        if (result.success) {
            console.log(`\n✅ Secret stored successfully!`);
            console.log(`   ID: ${result.data}`);
            console.log(`   Name: ${secretName}`);
            console.log(`   Category: ${secretCategory}`);
            return { success: true, message: `Stored: ${result.data}` };
        } else {
            console.log(`\n❌ Failed to store secret: ${result.error}`);
            return { success: false, message: result.error || 'Store failed' };
        }
    } catch (error) {
        rl.close();
        return { success: false, message: String(error) };
    }
}

/**
 * List vault entries
 */
export async function vaultList(category?: string): Promise<CliResult> {
    console.log('🔐 Vault Entries\n');

    const cat = category as VaultCategory | undefined;
    if (cat && !CATEGORIES.includes(cat)) {
        console.log(`❌ Invalid category: ${category}`);
        console.log(`Valid categories: ${CATEGORIES.join(', ')}`);
        return { success: false, message: 'Invalid category' };
    }

    const result = await listEntries(cat);

    if (!result.success) {
        console.log(`❌ Failed to list entries: ${result.error}`);
        return { success: false, message: result.error || 'List failed' };
    }

    const entries = result.data || [];

    if (entries.length === 0) {
        console.log('No entries found.');
        if (cat) {
            console.log(`Category filter: ${cat}`);
        }
        return { success: true, message: 'No entries' };
    }

    // Group by category
    const grouped = new Map<VaultCategory, typeof entries>();
    for (const entry of entries) {
        const catEntries = grouped.get(entry.category) || [];
        catEntries.push(entry);
        grouped.set(entry.category, catEntries);
    }

    for (const [catName, catEntries] of grouped) {
        console.log(`\n📁 ${catName.toUpperCase()} (${catEntries.length})`);
        console.log('─'.repeat(50));
        for (const entry of catEntries) {
            console.log(`  ID: ${entry.id}`);
            console.log(`  Name: ${entry.name}`);
            if (entry.description) {
                console.log(`  Desc: ${entry.description}`);
            }
            console.log(`  Created: ${entry.createdAt}`);
            console.log(`  Accesses: ${entry.accessCount}`);
            console.log('');
        }
    }

    console.log(`\nTotal: ${entries.length} entries`);
    return { success: true, message: `Listed ${entries.length} entries` };
}

/**
 * Get secret (requires approval)
 */
export async function vaultGet(entryId: string): Promise<CliResult> {
    if (!entryId) {
        console.log('❌ Entry ID is required');
        return { success: false, message: 'ID required' };
    }

    console.log('🔐 Requesting access to vault entry...');
    console.log('⏳ Waiting for approval (30s timeout)...\n');

    // Set up approval listener
    vaultEvents.once('access_request', (request: VaultAccessRequest) => {
        console.log('📬 Access request sent:');
        console.log(`   Entry: ${request.entryName}`);
        console.log(`   Category: ${request.category}`);
        console.log(`   Request ID: ${request.requestId}`);
        console.log('\n👆 Approve with: byon vault approve ' + request.requestId);
        console.log('👇 Deny with: byon vault deny ' + request.requestId);
    });

    const result = await requestAccess(entryId, 'CLI access request', 'cli-user');

    if (result.success) {
        console.log('\n✅ Access granted!\n');
        console.log('─'.repeat(50));
        console.log(result.data);
        console.log('─'.repeat(50));
        return { success: true, message: 'Access granted' };
    } else {
        console.log(`\n❌ Access denied: ${result.error}`);
        return { success: false, message: result.error || 'Access denied' };
    }
}

/**
 * Delete vault entry
 */
export async function vaultDelete(entryId: string): Promise<CliResult> {
    if (!entryId) {
        console.log('❌ Entry ID is required');
        return { success: false, message: 'ID required' };
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const confirm = await new Promise<string>(resolve =>
        rl.question(`⚠️  Delete entry ${entryId}? (yes/no): `, resolve)
    );
    rl.close();

    if (confirm.toLowerCase() !== 'yes') {
        console.log('Cancelled.');
        return { success: false, message: 'Cancelled' };
    }

    const result = await deleteEntry(entryId);

    if (result.success) {
        console.log('✅ Entry deleted successfully');
        return { success: true, message: 'Deleted' };
    } else {
        console.log(`❌ Failed to delete: ${result.error}`);
        return { success: false, message: result.error || 'Delete failed' };
    }
}

/**
 * Show vault status
 */
export async function vaultStatus(): Promise<CliResult> {
    console.log('🔐 BYON Secure Vault Status\n');

    const result = await getVaultStatus();

    if (!result.success || !result.data) {
        console.log('❌ Vault not initialized');
        console.log('\nRun: byon vault init');
        return { success: false, message: 'Not initialized' };
    }

    const status = result.data;

    console.log(`Initialized: ${status.initialized ? '✅ Yes' : '❌ No'}`);
    console.log(`GPG Available: ${status.gpgAvailable ? '✅ Yes' : '❌ No (using AES fallback)'}`);
    console.log(`GPG Key Configured: ${status.gpgKeyConfigured ? '✅ Yes' : '❌ No'}`);
    console.log(`\nTotal Entries: ${status.entriesCount}`);

    console.log('\nBy Category:');
    for (const [cat, count] of Object.entries(status.categoryCounts)) {
        console.log(`  ${cat}: ${count}`);
    }

    // Pending requests
    const pending = getPendingRequests();
    if (pending.length > 0) {
        console.log(`\n⏳ Pending Requests: ${pending.length}`);
        for (const req of pending) {
            console.log(`  - ${req.entryName} (${req.requestId})`);
        }
    }

    return { success: true, message: 'Status shown' };
}

/**
 * Approve access request
 */
export async function vaultApprove(requestId: string): Promise<CliResult> {
    if (!requestId) {
        console.log('❌ Request ID is required');
        return { success: false, message: 'ID required' };
    }

    const success = approveAccess(requestId, 'cli-user');

    if (success) {
        console.log('✅ Access approved!');
        return { success: true, message: 'Approved' };
    } else {
        console.log('❌ Request not found or already processed');
        return { success: false, message: 'Not found' };
    }
}

/**
 * Deny access request
 */
export async function vaultDeny(requestId: string, reason?: string): Promise<CliResult> {
    if (!requestId) {
        console.log('❌ Request ID is required');
        return { success: false, message: 'ID required' };
    }

    const success = denyAccess(requestId, reason || 'Denied by user');

    if (success) {
        console.log('✅ Access denied');
        return { success: true, message: 'Denied' };
    } else {
        console.log('❌ Request not found or already processed');
        return { success: false, message: 'Not found' };
    }
}

/**
 * List pending approval requests
 */
export async function vaultPending(): Promise<CliResult> {
    console.log('⏳ Pending Approval Requests\n');

    const pending = getPendingRequests();

    if (pending.length === 0) {
        console.log('No pending requests.');
        return { success: true, message: 'No pending' };
    }

    for (const req of pending) {
        console.log('─'.repeat(50));
        console.log(`Request ID: ${req.requestId}`);
        console.log(`Entry: ${req.entryName}`);
        console.log(`Category: ${req.category}`);
        console.log(`Reason: ${req.reason}`);
        console.log(`Requested by: ${req.requestedBy}`);
        console.log(`Requested at: ${req.requestedAt}`);
        console.log(`Expires at: ${req.expiresAt}`);
        console.log('');
        console.log(`  Approve: byon vault approve ${req.requestId}`);
        console.log(`  Deny: byon vault deny ${req.requestId}`);
    }

    console.log('─'.repeat(50));
    console.log(`\nTotal: ${pending.length} pending requests`);

    return { success: true, message: `${pending.length} pending` };
}

/**
 * Main vault command handler
 */
export async function handleVaultCommand(args: string[]): Promise<CliResult> {
    const subcommand = args[0];
    const params = args.slice(1);

    switch (subcommand) {
        case 'init':
            return vaultInit();
        case 'store':
            return vaultStore(params[0], params[1]);
        case 'list':
            return vaultList(params[0]);
        case 'get':
            return vaultGet(params[0]);
        case 'delete':
            return vaultDelete(params[0]);
        case 'status':
            return vaultStatus();
        case 'approve':
            return vaultApprove(params[0]);
        case 'deny':
            return vaultDeny(params[0], params[1]);
        case 'pending':
            return vaultPending();
        default:
            console.log('🔐 BYON Secure Vault\n');
            console.log('Usage:');
            console.log('  byon vault init                    Initialize vault');
            console.log('  byon vault store [name] [category] Store a secret');
            console.log('  byon vault list [category]         List entries');
            console.log('  byon vault get <id>                Get secret (needs approval)');
            console.log('  byon vault delete <id>             Delete entry');
            console.log('  byon vault status                  Show status');
            console.log('  byon vault approve <requestId>     Approve request');
            console.log('  byon vault deny <requestId>        Deny request');
            console.log('  byon vault pending                 List pending requests');
            console.log('\nCategories: credentials, keys, financial, documents, secrets');
            return { success: true, message: 'Help shown' };
    }
}
