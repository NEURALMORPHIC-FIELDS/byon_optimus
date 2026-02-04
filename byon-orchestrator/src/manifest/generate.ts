/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Manifest CLI Generator
 * ======================
 *
 * CLI entry point to generate handoff/manifest.json.
 *
 * Usage:
 *   npm run manifest
 *   # or
 *   ts-node --esm src/manifest/generate.ts
 */

import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateManifest, writeManifest } from "./project-manifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseDir = resolve(join(__dirname, "..", ".."));
const outputPath = join(baseDir, "handoff", "manifest.json");

console.log("[Manifest] Generating project manifest...");
console.log(`[Manifest] Base directory: ${baseDir}`);

const manifest = generateManifest(baseDir);
writeManifest(manifest, outputPath);

console.log(`[Manifest] Written to: ${outputPath}`);
console.log(`[Manifest] Components: ${manifest.components.length}`);
console.log(`[Manifest] Naming conventions: ${Object.keys(manifest.naming_conventions).length}`);
console.log(`[Manifest] Gitignored entries: ${manifest.gitignored_present.length}`);
console.log("[Manifest] Done.");
