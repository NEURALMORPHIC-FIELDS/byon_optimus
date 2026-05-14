#!/usr/bin/env node
/**
 * BYON Optimus - Full Source Organism Activation Test
 * Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
 *
 * HandoffWorkspaceManager
 * =======================
 *
 * Creates an isolated workspace for one FSOAT run. The workspace contains:
 *   <root>/handoff/{inbox,worker_to_auditor,auditor_to_user,auditor_to_executor,executor_to_worker}
 *   <root>/project/                  (Executor's writable workspace)
 *   <root>/keys/{auditor.private.pem,auditor.public.pem,public/}
 *   <root>/audit_logs/{worker,auditor,executor}
 *   <root>/output/                   (artifact output: matrices, jsonl, verdict)
 *
 * The manager never touches the repo's top-level handoff/ or keys/ directories. Every
 * FSOAT run is hermetic.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const HANDOFF_SUBDIRS = Object.freeze([
    "inbox",
    "worker_to_auditor",
    "auditor_to_user",
    "auditor_to_executor",
    "executor_to_worker"
]);

const AUDIT_SUBDIRS = Object.freeze(["worker", "auditor", "executor"]);

export class HandoffWorkspaceManager {
    constructor(rootDir) {
        if (!rootDir) {
            throw new Error("HandoffWorkspaceManager requires rootDir");
        }
        this.rootDir = path.resolve(rootDir);
        this.handoffDir = path.join(this.rootDir, "handoff");
        this.projectDir = path.join(this.rootDir, "project");
        this.keysDir = path.join(this.rootDir, "keys");
        this.auditDir = path.join(this.rootDir, "audit_logs");
        this.outputDir = path.join(this.rootDir, "output");
    }

    setup() {
        this._ensureDir(this.rootDir);
        this._ensureDir(this.handoffDir);
        for (const sub of HANDOFF_SUBDIRS) {
            this._ensureDir(path.join(this.handoffDir, sub));
        }
        this._ensureDir(this.projectDir);
        this._ensureDir(this.keysDir);
        this._ensureDir(path.join(this.keysDir, "public"));
        this._ensureDir(this.auditDir);
        for (const sub of AUDIT_SUBDIRS) {
            this._ensureDir(path.join(this.auditDir, sub));
        }
        this._ensureDir(this.outputDir);
        return this.paths();
    }

    /**
     * Install an Ed25519 keypair into <root>/keys/. Accepts either:
     *   { privatePem, publicPem }  - PEM strings
     *   { privatePath, publicPath } - paths to existing PEMs to copy
     */
    installKeyPair(keys) {
        const priv = path.join(this.keysDir, "auditor.private.pem");
        const pub = path.join(this.keysDir, "auditor.public.pem");
        const pubCopy = path.join(this.keysDir, "public", "auditor.public.pem");

        if (keys.privatePem) {
            fs.writeFileSync(priv, keys.privatePem, { encoding: "utf-8", mode: 0o600 });
        } else if (keys.privatePath) {
            fs.copyFileSync(keys.privatePath, priv);
            fs.chmodSync(priv, 0o600);
        } else {
            throw new Error("installKeyPair requires privatePem or privatePath");
        }

        if (keys.publicPem) {
            fs.writeFileSync(pub, keys.publicPem, { encoding: "utf-8" });
            fs.writeFileSync(pubCopy, keys.publicPem, { encoding: "utf-8" });
        } else if (keys.publicPath) {
            fs.copyFileSync(keys.publicPath, pub);
            fs.copyFileSync(keys.publicPath, pubCopy);
        } else {
            throw new Error("installKeyPair requires publicPem or publicPath");
        }

        return { privatePath: priv, publicPath: pub };
    }

    paths() {
        return {
            root: this.rootDir,
            handoff: this.handoffDir,
            inbox: path.join(this.handoffDir, "inbox"),
            worker_to_auditor: path.join(this.handoffDir, "worker_to_auditor"),
            auditor_to_user: path.join(this.handoffDir, "auditor_to_user"),
            auditor_to_executor: path.join(this.handoffDir, "auditor_to_executor"),
            executor_to_worker: path.join(this.handoffDir, "executor_to_worker"),
            project: this.projectDir,
            keys: this.keysDir,
            audit: this.auditDir,
            audit_worker: path.join(this.auditDir, "worker"),
            audit_auditor: path.join(this.auditDir, "auditor"),
            audit_executor: path.join(this.auditDir, "executor"),
            output: this.outputDir
        };
    }

    listInboxFiles() {
        return this._listDir(path.join(this.handoffDir, "inbox"));
    }

    listSubdirFiles(subdir) {
        if (!HANDOFF_SUBDIRS.includes(subdir)) {
            throw new Error(`unknown handoff subdir: ${subdir}`);
        }
        return this._listDir(path.join(this.handoffDir, subdir));
    }

    snapshotChain() {
        const snapshot = {};
        for (const sub of HANDOFF_SUBDIRS) {
            snapshot[sub] = this._listDir(path.join(this.handoffDir, sub));
        }
        return snapshot;
    }

    writeInboxMessage(messageId, payload) {
        const filename = `${messageId}.json`;
        const filepath = path.join(this.handoffDir, "inbox", filename);
        fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), "utf-8");
        return filepath;
    }

    teardown(opts = {}) {
        if (opts.preserve) {
            return;
        }
        if (fs.existsSync(this.rootDir)) {
            fs.rmSync(this.rootDir, { recursive: true, force: true });
        }
    }

    _ensureDir(p) {
        if (!fs.existsSync(p)) {
            fs.mkdirSync(p, { recursive: true });
        }
    }

    _listDir(dir) {
        if (!fs.existsSync(dir)) {
            return [];
        }
        return fs.readdirSync(dir).map((name) => {
            const full = path.join(dir, name);
            const stat = fs.statSync(full);
            let content = null;
            if (stat.isFile() && (name.endsWith(".json") || name.endsWith(".jsonl"))) {
                try {
                    const raw = fs.readFileSync(full, "utf-8");
                    content = name.endsWith(".jsonl")
                        ? raw.split("\n").filter(Boolean).map((line) => safeParse(line))
                        : safeParse(raw);
                } catch {
                    content = null;
                }
            }
            return {
                name,
                path: full,
                size: stat.size,
                mtime: stat.mtime.toISOString(),
                content
            };
        });
    }
}

function safeParse(s) {
    try {
        return JSON.parse(s);
    } catch {
        return null;
    }
}

export function createHandoffWorkspaceManager(rootDir) {
    return new HandoffWorkspaceManager(rootDir);
}
