// ---------------------------------------------------------------------------
// ExactFileStateStore
// ---------------------------------------------------------------------------
// Byte-exact memory of every file in the coding workspace.
// Anti-drift: semantic summaries are NOT the source of truth — the full
// content is. Coding context built from this store contains exact prior
// file contents.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";

export class ExactFileStateStore {
    constructor() {
        this._byPath = new Map(); // path -> entry
    }

    /**
     * @param {string} filePath
     * @param {string} content
     * @param {Object} meta - { phase, role?, test_related?, language? }
     */
    set(filePath, content, meta = {}) {
        const phase = meta.phase ?? "unknown";
        const prev = this._byPath.get(filePath);
        const hash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
        const lang = meta.language || inferLanguage(filePath);
        const role = meta.role || inferRole(filePath);
        const test_related = meta.test_related ?? isTestRelated(filePath);
        const entry = {
            file_path: filePath,
            full_content: content,
            content_hash: hash,
            last_seen_phase: phase,
            last_modified_phase: prev && prev.content_hash === hash ? prev.last_modified_phase : phase,
            language: lang,
            role,
            test_related,
            exists: true,
        };
        this._byPath.set(filePath, entry);
        return entry;
    }

    /** Mark a file as deleted/missing while preserving its last-known state. */
    markMissing(filePath, phase = "unknown") {
        const prev = this._byPath.get(filePath);
        if (prev) {
            prev.exists = false;
            prev.last_seen_phase = phase;
            return prev;
        }
        const entry = {
            file_path: filePath,
            full_content: "",
            content_hash: "",
            last_seen_phase: phase,
            last_modified_phase: phase,
            language: inferLanguage(filePath),
            role: inferRole(filePath),
            test_related: isTestRelated(filePath),
            exists: false,
        };
        this._byPath.set(filePath, entry);
        return entry;
    }

    get(filePath) { return this._byPath.get(filePath) || null; }
    has(filePath) { return this._byPath.has(filePath); }
    size() { return this._byPath.size; }

    listExisting() { return [...this._byPath.values()].filter(e => e.exists); }
    listDeleted()  { return [...this._byPath.values()].filter(e => !e.exists); }
    listPaths()    { return [...this._byPath.keys()].sort(); }

    /**
     * Return exact files relevant to a coding task, prioritised by role/test.
     * Returns up to `maxFiles` entries. NEVER returns a semantic summary —
     * always returns full_content.
     */
    relevantFiles({ maxFiles = 25, includeTests = true } = {}) {
        const existing = this.listExisting();
        const sorted = existing.sort((a, b) => priority(a) - priority(b) || a.file_path.localeCompare(b.file_path));
        const out = [];
        for (const e of sorted) {
            if (!includeTests && e.test_related) continue;
            out.push(e);
            if (out.length >= maxFiles) break;
        }
        return out;
    }

    /** Serialise to a JSON-safe object (for telemetry artifacts). */
    snapshot() {
        return {
            total: this._byPath.size,
            existing: this.listExisting().length,
            deleted: this.listDeleted().length,
            files: [...this._byPath.values()].map(e => ({
                file_path: e.file_path,
                content_hash: e.content_hash,
                last_seen_phase: e.last_seen_phase,
                last_modified_phase: e.last_modified_phase,
                language: e.language,
                role: e.role,
                test_related: e.test_related,
                exists: e.exists,
                bytes: Buffer.byteLength(e.full_content, "utf-8"),
            })),
        };
    }
}

function inferLanguage(p) {
    if (p.endsWith(".py")) return "python";
    if (p.endsWith(".mjs") || p.endsWith(".js")) return "javascript";
    if (p.endsWith(".ts") || p.endsWith(".tsx")) return "typescript";
    if (p.endsWith(".yaml") || p.endsWith(".yml")) return "yaml";
    if (p.endsWith(".json")) return "json";
    if (p.endsWith(".toml")) return "toml";
    if (p.endsWith(".md")) return "markdown";
    return "text";
}

function inferRole(p) {
    if (p.startsWith("tests/") || p.startsWith("test/") || p.includes("/tests/")) return "test";
    if (p.startsWith("docs/") || p === "README.md" || p.endsWith("CHANGELOG.md")) return "doc";
    if (p.startsWith("examples/")) return "example";
    if (p === "pyproject.toml" || p.endsWith(".cfg") || p.endsWith(".ini")) return "config";
    if (p.endsWith(".py")) return "source";
    if (p.endsWith(".yaml") || p.endsWith(".yml") || p.endsWith(".json")) return "data";
    return "other";
}

function isTestRelated(p) {
    return p.startsWith("tests/") || p.startsWith("test/") || /\btest_\w+\.py$/.test(p) || /_test\.py$/.test(p);
}

function priority(e) {
    if (e.role === "source") return 1;
    if (e.role === "test")   return 2;
    if (e.role === "config") return 3;
    if (e.role === "doc")    return 4;
    if (e.role === "example") return 5;
    return 9;
}
