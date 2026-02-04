/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Hash Chain
 * ==========
 *
 * Implements immutable hash chain for audit trail integrity.
 * Each entry links to the previous via SHA-256 hash.
 *
 * Properties:
 * - Tamper-evident: any modification breaks the chain
 * - Append-only: entries cannot be removed or modified
 * - Verifiable: chain integrity can be checked at any time
 */

import * as crypto from "crypto";

// ============================================================================
// TYPES
// ============================================================================

export interface HashChainEntry {
    /** Entry index in chain */
    index: number;
    /** Entry timestamp */
    timestamp: string;
    /** Entry type discriminator */
    entry_type: ChainEntryType;
    /** Document ID this entry refers to */
    document_id: string;
    /** Document type */
    document_type: string;
    /** Previous entry hash */
    previous_hash: string;
    /** Entry data hash (hash of the actual document) */
    data_hash: string;
    /** This entry's hash */
    hash: string;
    /** Optional metadata */
    metadata?: Record<string, unknown>;
}

export type ChainEntryType =
    | "document_created"
    | "document_updated"
    | "state_changed"
    | "document_deleted"
    | "checkpoint";

export interface ChainVerificationResult {
    /** Whether chain is valid */
    valid: boolean;
    /** Index of first invalid entry (if any) */
    invalidAtIndex?: number;
    /** Error message */
    error?: string;
    /** Number of entries verified */
    entriesVerified: number;
    /** Chain head hash */
    headHash: string;
}

export interface HashChainConfig {
    /** Algorithm for hashing */
    algorithm: "sha256" | "sha384" | "sha512";
    /** Genesis block hash */
    genesisHash: string;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: HashChainConfig = {
    algorithm: "sha256",
    genesisHash: "0".repeat(64) // Genesis block has all zeros
};

// ============================================================================
// HASH CHAIN
// ============================================================================

/**
 * Hash Chain Implementation
 *
 * Provides tamper-evident audit trail.
 */
export class HashChain {
    private config: HashChainConfig;
    private entries: HashChainEntry[];
    private headHash: string;

    constructor(config: Partial<HashChainConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.entries = [];
        this.headHash = this.config.genesisHash;
    }

    /**
     * Add entry to chain
     */
    addEntry(
        entryType: ChainEntryType,
        documentId: string,
        documentType: string,
        dataHash: string,
        metadata?: Record<string, unknown>
    ): HashChainEntry {
        const index = this.entries.length;
        const timestamp = new Date().toISOString();
        const previousHash = this.headHash;

        // Create entry without hash first
        const entryData = {
            index,
            timestamp,
            entry_type: entryType,
            document_id: documentId,
            document_type: documentType,
            previous_hash: previousHash,
            data_hash: dataHash,
            metadata
        };

        // Calculate entry hash
        const hash = this.calculateEntryHash(entryData);

        const entry: HashChainEntry = {
            ...entryData,
            hash
        };

        // Update chain
        this.entries.push(entry);
        this.headHash = hash;

        return entry;
    }

    /**
     * Calculate hash for entry
     */
    private calculateEntryHash(entry: Omit<HashChainEntry, "hash">): string {
        const content = JSON.stringify({
            index: entry.index,
            timestamp: entry.timestamp,
            entry_type: entry.entry_type,
            document_id: entry.document_id,
            document_type: entry.document_type,
            previous_hash: entry.previous_hash,
            data_hash: entry.data_hash,
            metadata: entry.metadata
        });

        return crypto
            .createHash(this.config.algorithm)
            .update(content)
            .digest("hex");
    }

    /**
     * Verify entire chain integrity
     */
    verify(): ChainVerificationResult {
        if (this.entries.length === 0) {
            return {
                valid: true,
                entriesVerified: 0,
                headHash: this.config.genesisHash
            };
        }

        let expectedPreviousHash = this.config.genesisHash;

        for (let i = 0; i < this.entries.length; i++) {
            const entry = this.entries[i];

            // Verify previous hash
            if (entry.previous_hash !== expectedPreviousHash) {
                return {
                    valid: false,
                    invalidAtIndex: i,
                    error: `Previous hash mismatch at index ${i}`,
                    entriesVerified: i,
                    headHash: this.headHash
                };
            }

            // Verify entry hash
            const calculatedHash = this.calculateEntryHash(entry);
            if (entry.hash !== calculatedHash) {
                return {
                    valid: false,
                    invalidAtIndex: i,
                    error: `Entry hash mismatch at index ${i}`,
                    entriesVerified: i,
                    headHash: this.headHash
                };
            }

            expectedPreviousHash = entry.hash;
        }

        return {
            valid: true,
            entriesVerified: this.entries.length,
            headHash: this.headHash
        };
    }

    /**
     * Verify chain from specific index
     */
    verifyFrom(startIndex: number): ChainVerificationResult {
        if (startIndex < 0 || startIndex >= this.entries.length) {
            return {
                valid: false,
                error: `Invalid start index: ${startIndex}`,
                entriesVerified: 0,
                headHash: this.headHash
            };
        }

        const expectedPreviousHash = startIndex === 0
            ? this.config.genesisHash
            : this.entries[startIndex - 1].hash;

        let currentPreviousHash = expectedPreviousHash;

        for (let i = startIndex; i < this.entries.length; i++) {
            const entry = this.entries[i];

            if (entry.previous_hash !== currentPreviousHash) {
                return {
                    valid: false,
                    invalidAtIndex: i,
                    error: `Previous hash mismatch at index ${i}`,
                    entriesVerified: i - startIndex,
                    headHash: this.headHash
                };
            }

            const calculatedHash = this.calculateEntryHash(entry);
            if (entry.hash !== calculatedHash) {
                return {
                    valid: false,
                    invalidAtIndex: i,
                    error: `Entry hash mismatch at index ${i}`,
                    entriesVerified: i - startIndex,
                    headHash: this.headHash
                };
            }

            currentPreviousHash = entry.hash;
        }

        return {
            valid: true,
            entriesVerified: this.entries.length - startIndex,
            headHash: this.headHash
        };
    }

    /**
     * Get entry by index
     */
    getEntry(index: number): HashChainEntry | undefined {
        return this.entries[index];
    }

    /**
     * Get entries by document ID
     */
    getEntriesForDocument(documentId: string): HashChainEntry[] {
        return this.entries.filter(e => e.document_id === documentId);
    }

    /**
     * Get entries by type
     */
    getEntriesByType(entryType: ChainEntryType): HashChainEntry[] {
        return this.entries.filter(e => e.entry_type === entryType);
    }

    /**
     * Get entries in time range
     */
    getEntriesInRange(startTime: Date, endTime: Date): HashChainEntry[] {
        return this.entries.filter(e => {
            const entryTime = new Date(e.timestamp);
            return entryTime >= startTime && entryTime <= endTime;
        });
    }

    /**
     * Get chain head hash
     */
    getHeadHash(): string {
        return this.headHash;
    }

    /**
     * Get chain length
     */
    getLength(): number {
        return this.entries.length;
    }

    /**
     * Get all entries
     */
    getAllEntries(): HashChainEntry[] {
        return [...this.entries];
    }

    /**
     * Get last N entries
     */
    getLastEntries(n: number): HashChainEntry[] {
        return this.entries.slice(-n);
    }

    /**
     * Create checkpoint entry
     */
    createCheckpoint(metadata?: Record<string, unknown>): HashChainEntry {
        const checkpointData = {
            chain_length: this.entries.length,
            head_hash: this.headHash,
            timestamp: new Date().toISOString()
        };

        const dataHash = crypto
            .createHash(this.config.algorithm)
            .update(JSON.stringify(checkpointData))
            .digest("hex");

        return this.addEntry(
            "checkpoint",
            `checkpoint_${this.entries.length}`,
            "checkpoint",
            dataHash,
            { ...metadata, checkpoint_data: checkpointData }
        );
    }

    /**
     * Export chain to JSON
     */
    export(): {
        config: HashChainConfig;
        entries: HashChainEntry[];
        headHash: string;
    } {
        return {
            config: this.config,
            entries: [...this.entries],
            headHash: this.headHash
        };
    }

    /**
     * Import chain from JSON
     */
    static import(data: {
        config: HashChainConfig;
        entries: HashChainEntry[];
        headHash: string;
    }): HashChain {
        const chain = new HashChain(data.config);
        chain.entries = [...data.entries];
        chain.headHash = data.headHash;

        // Verify imported chain
        const verification = chain.verify();
        if (!verification.valid) {
            throw new Error(`Imported chain is invalid: ${verification.error}`);
        }

        return chain;
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create hash chain
 */
export function createHashChain(
    config?: Partial<HashChainConfig>
): HashChain {
    return new HashChain(config);
}

/**
 * Calculate document hash
 */
export function calculateDocumentHash(
    document: unknown,
    algorithm: "sha256" | "sha384" | "sha512" = "sha256"
): string {
    const content = JSON.stringify(document);
    return crypto.createHash(algorithm).update(content).digest("hex");
}

/**
 * Verify chain from exported data
 */
export function verifyExportedChain(data: {
    config: HashChainConfig;
    entries: HashChainEntry[];
    headHash: string;
}): ChainVerificationResult {
    const chain = new HashChain(data.config);
    chain["entries"] = [...data.entries];
    chain["headHash"] = data.headHash;
    return chain.verify();
}
