#!/usr/bin/env node
/**
 * BYON Optimus - FSOAT utilities
 * Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
 *
 * Run ID and output directory helpers. Mirrors the existing test-results layout
 * used by byon-orchestrator/test-results/full-organism-capability-benchmark/.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function generateRunId() {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z");
    const suffix = Array.from(crypto.randomBytes(3))
        .map((b) => ALPHABET[b % ALPHABET.length])
        .join("");
    return `${ts}-${suffix}`;
}

export function ensureTestResultsRoot(orchestratorRoot, baseDirName = "full-source-organism-activation") {
    const root = path.join(orchestratorRoot, "test-results", baseDirName);
    fs.mkdirSync(root, { recursive: true });
    return root;
}

export function createRunDir(orchestratorRoot, runId, baseDirName = "full-source-organism-activation") {
    const root = ensureTestResultsRoot(orchestratorRoot, baseDirName);
    const runDir = path.join(root, runId);
    fs.mkdirSync(runDir, { recursive: true });
    return runDir;
}

export function writeJson(filepath, data) {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
    return filepath;
}

export function writeJsonl(filepath, lines) {
    const body = Array.isArray(lines) ? lines.join("\n") : String(lines || "");
    fs.writeFileSync(filepath, body + (body.endsWith("\n") || body.length === 0 ? "" : "\n"), "utf-8");
    return filepath;
}

export function writeText(filepath, content) {
    fs.writeFileSync(filepath, content, "utf-8");
    return filepath;
}
