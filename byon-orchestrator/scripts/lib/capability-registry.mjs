// ---------------------------------------------------------------------------
// Capability Registry
// ---------------------------------------------------------------------------
// Loads capability manifests from byon-orchestrator/config/capabilities/,
// validates schema, rejects duplicate ids, exposes lookup + listing.
//
// This is INFRASTRUCTURE for v0.7. It does not yet replace any v0.6.x runtime
// path. It is consumed by the new CapabilityRouter (sibling module).
//
// Sees use from:
//   - tests/unit/capability-archive.test.ts  (unit tests)
//   - scripts/lib/capability-router.mjs       (router uses the registry)
//   - future v0.7 wiring in runtime
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ORCHESTRATOR_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_DIR = path.join(ORCHESTRATOR_ROOT, "config", "capabilities");

// Required + optional fields for a manifest.
const REQUIRED_FIELDS = [
    "id", "version", "status", "description",
    "domains", "intents", "roles",
    "activation_keywords", "negative_keywords",
    "required_modules", "optional_modules",
    "memory_routes", "context_builder", "output_contract",
    "guards", "experience_log",
];

const VALID_STATUS = new Set(["active", "planned", "deprecated", "research"]);

// Forbidden tokens — must never appear positively in any manifest field.
const FORBIDDEN_TOKENS = [
    "LEVEL_3_REACHED",
    "OMEGA_CREATED_MANUALLY",
    "SYNTHETIC_OMEGA",
    "THRESHOLD_LOWERED",
];

export class ManifestValidationError extends Error {
    constructor(file, problems) {
        super(`Manifest validation failed for ${file}:\n  - ${problems.join("\n  - ")}`);
        this.name = "ManifestValidationError";
        this.file = file;
        this.problems = problems;
    }
}

export class DuplicateCapabilityError extends Error {
    constructor(id, files) {
        super(`Duplicate capability id "${id}" defined in: ${files.join(", ")}`);
        this.name = "DuplicateCapabilityError";
        this.duplicate_id = id;
        this.files = files;
    }
}

function validateManifest(m, file) {
    const problems = [];
    if (!m || typeof m !== "object" || Array.isArray(m)) {
        problems.push("manifest is not an object");
        return problems;
    }
    for (const k of REQUIRED_FIELDS) {
        if (!(k in m)) problems.push(`missing required field: ${k}`);
    }
    if (m.id !== undefined && (typeof m.id !== "string" || !m.id.trim())) {
        problems.push("id must be a non-empty string");
    }
    if (m.id !== undefined && !/^[a-z][a-z0-9_]*$/.test(m.id)) {
        problems.push(`id "${m.id}" must be lower_snake_case`);
    }
    if (m.version !== undefined && (typeof m.version !== "string" || !/^\d+\.\d+\.\d+/.test(m.version))) {
        problems.push(`version "${m.version}" must look like semver (X.Y.Z)`);
    }
    if (m.status !== undefined && !VALID_STATUS.has(m.status)) {
        problems.push(`status "${m.status}" not in {${[...VALID_STATUS].join("|")}}`);
    }
    for (const arrField of ["domains", "intents", "roles", "activation_keywords",
                             "negative_keywords", "required_modules", "optional_modules",
                             "memory_routes", "guards"]) {
        if (m[arrField] !== undefined && !Array.isArray(m[arrField])) {
            problems.push(`${arrField} must be an array`);
        }
    }
    if (m.context_builder !== undefined && typeof m.context_builder !== "string") {
        problems.push("context_builder must be a string");
    }
    if (m.output_contract !== undefined && typeof m.output_contract !== "string") {
        problems.push("output_contract must be a string");
    }
    if (m.experience_log !== undefined && typeof m.experience_log !== "boolean") {
        problems.push("experience_log must be a boolean");
    }
    if (m.level3_claim === true) {
        problems.push("level3_claim must not be true — Level 3 is not declared");
    }
    // Scan stringy fields for forbidden tokens.
    const flat = JSON.stringify(m);
    for (const tok of FORBIDDEN_TOKENS) {
        if (flat.includes(tok)) {
            problems.push(`manifest contains forbidden token "${tok}"`);
        }
    }
    return problems;
}

export class CapabilityRegistry {
    constructor() {
        this._byId = new Map();           // id -> manifest
        this._sourceById = new Map();     // id -> filename
        this._invalid = [];               // [{file, problems}]
    }

    static fromDirectory(dir = DEFAULT_DIR, { throwOnInvalid = true } = {}) {
        const reg = new CapabilityRegistry();
        reg.loadDirectory(dir, { throwOnInvalid });
        return reg;
    }

    loadDirectory(dir, { throwOnInvalid = true } = {}) {
        if (!fs.existsSync(dir)) {
            if (throwOnInvalid) throw new Error(`capability dir not found: ${dir}`);
            return this;
        }
        const files = fs.readdirSync(dir)
            .filter(f => f.endsWith(".json"))
            .map(f => path.join(dir, f))
            .sort();
        for (const file of files) {
            this.loadFile(file, { throwOnInvalid });
        }
        return this;
    }

    loadFile(file, { throwOnInvalid = true } = {}) {
        let raw;
        try {
            raw = fs.readFileSync(file, "utf-8");
        } catch (e) {
            this._invalid.push({ file, problems: [`read error: ${e.message}`] });
            if (throwOnInvalid) throw e;
            return null;
        }
        let m;
        try {
            m = JSON.parse(raw);
        } catch (e) {
            this._invalid.push({ file, problems: [`json parse error: ${e.message}`] });
            if (throwOnInvalid) throw new ManifestValidationError(file, [`json parse error: ${e.message}`]);
            return null;
        }
        const problems = validateManifest(m, file);
        if (problems.length) {
            this._invalid.push({ file, problems });
            if (throwOnInvalid) throw new ManifestValidationError(file, problems);
            return null;
        }
        if (this._byId.has(m.id)) {
            const existingFile = this._sourceById.get(m.id);
            throw new DuplicateCapabilityError(m.id, [existingFile, file]);
        }
        this._byId.set(m.id, m);
        this._sourceById.set(m.id, file);
        return m;
    }

    /**
     * Register a manifest from memory (not a file).
     * Used by tests; performs the same validation + dup-id rejection.
     */
    register(manifest, sourceLabel = "<in-memory>") {
        const problems = validateManifest(manifest, sourceLabel);
        if (problems.length) throw new ManifestValidationError(sourceLabel, problems);
        if (this._byId.has(manifest.id)) {
            throw new DuplicateCapabilityError(manifest.id, [this._sourceById.get(manifest.id), sourceLabel]);
        }
        this._byId.set(manifest.id, manifest);
        this._sourceById.set(manifest.id, sourceLabel);
        return manifest;
    }

    get(id) { return this._byId.get(id) || null; }
    has(id) { return this._byId.has(id); }
    size()  { return this._byId.size; }
    listIds() { return [...this._byId.keys()].sort(); }
    listActive()  { return [...this._byId.values()].filter(m => m.status === "active"); }
    listPlanned() { return [...this._byId.values()].filter(m => m.status === "planned"); }
    listInactive() { return [...this._byId.values()].filter(m => m.status !== "active"); }
    invalid() { return this._invalid.slice(); }

    /**
     * For a given manifest, return modules whose `module_status` is anything
     * other than "active" — i.e. modules declared as required but not yet
     * implemented. Reported honestly via router as `missing_required_modules`.
     */
    missingRequiredModules(id) {
        const m = this.get(id);
        if (!m) return [];
        const status = m.module_status || {};
        return (m.required_modules || []).filter(name => {
            const s = status[name];
            return s && s !== "active";
        });
    }
}

export { DEFAULT_DIR, REQUIRED_FIELDS, VALID_STATUS, FORBIDDEN_TOKENS, validateManifest };
