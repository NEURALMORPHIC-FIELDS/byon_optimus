// ---------------------------------------------------------------------------
// SymbolIndex
// ---------------------------------------------------------------------------
// Regex-based Python symbol extraction. Pure JS — no Python required at
// extraction time. Reliable enough for the coding-benchmark surface
// (PEP-8 source). Each symbol records its file + line + kind.
//
// Anti-drift: the index detects duplicate class / dataclass / function
// names across files. WorkspaceDiffGuard uses this to refuse a patch that
// introduces a redefinition of `PolicyEngine` / `AuditLog` / etc.
// ---------------------------------------------------------------------------

const RE_CLASS     = /^[ \t]*class[ \t]+(\w+)\b/;
const RE_DEF       = /^[ \t]*def[ \t]+(\w+)\b/;
const RE_ASYNCDEF  = /^[ \t]*async[ \t]+def[ \t]+(\w+)\b/;
const RE_FROM_IMP  = /^[ \t]*from[ \t]+([\w\.]+)[ \t]+import[ \t]+(.+?)\s*$/;
const RE_IMPORT    = /^[ \t]*import[ \t]+([\w\.,\s]+?)\s*$/;
const RE_DATACLASS = /^[ \t]*@(?:dataclasses\.)?dataclass\b/;
const RE_ENUM_BASE = /class\s+\w+\s*\(\s*(?:enum\.)?Enum\s*\)/;
const RE_TEST_FN   = /^[ \t]*def[ \t]+(test_\w+)\b/;
const RE_FIXTURE   = /^[ \t]*@pytest\.fixture\b/;
const RE_CLICK_CMD = /^[ \t]*@(?:click\.)?command\b/;
const RE_ARGPARSE_SUBPARSER = /add_parser\(\s*['"](\w+)['"]/g;

export const SymbolKinds = Object.freeze({
    CLASS: "class",
    DATACLASS: "dataclass",
    ENUM: "enum",
    FUNCTION: "function",
    TEST: "test",
    FIXTURE: "fixture",
    CLI_COMMAND: "cli_command",
    IMPORT: "import",
});

export class SymbolIndex {
    constructor() {
        this._byName = new Map();   // name -> [{file, kind, line}]
        this._byFile = new Map();   // file -> [{name, kind, line}]
        this._imports = new Map();  // file -> [{from?: , import: }]
    }

    indexFile(filePath, content) {
        if (!filePath || typeof content !== "string") return;
        if (!filePath.endsWith(".py")) return;
        this._byFile.set(filePath, []);
        this._imports.set(filePath, []);
        const lines = content.split(/\r?\n/);
        let prevWasDataclassDeco = false;
        let prevWasFixtureDeco = false;
        let prevWasClickCmd = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNo = i + 1;

            if (RE_DATACLASS.test(line)) { prevWasDataclassDeco = true; continue; }
            if (RE_FIXTURE.test(line))   { prevWasFixtureDeco = true; continue; }
            if (RE_CLICK_CMD.test(line)) { prevWasClickCmd = true; continue; }

            const mClass = line.match(RE_CLASS);
            if (mClass) {
                const name = mClass[1];
                let kind = SymbolKinds.CLASS;
                if (prevWasDataclassDeco) kind = SymbolKinds.DATACLASS;
                else if (RE_ENUM_BASE.test(line)) kind = SymbolKinds.ENUM;
                this._addSymbol(filePath, name, kind, lineNo);
                prevWasDataclassDeco = false;
                continue;
            }

            const mAsync = line.match(RE_ASYNCDEF);
            const mDef = mAsync || line.match(RE_DEF);
            if (mDef) {
                const name = mDef[1];
                let kind = SymbolKinds.FUNCTION;
                if (RE_TEST_FN.test(line))         kind = SymbolKinds.TEST;
                else if (prevWasFixtureDeco)       kind = SymbolKinds.FIXTURE;
                else if (prevWasClickCmd)          kind = SymbolKinds.CLI_COMMAND;
                this._addSymbol(filePath, name, kind, lineNo);
                prevWasFixtureDeco = false;
                prevWasClickCmd = false;
                continue;
            }

            const mFrom = line.match(RE_FROM_IMP);
            if (mFrom) {
                const fromMod = mFrom[1];
                const items = mFrom[2].split(/[\s,()]+/).filter(Boolean);
                for (const it of items) this._imports.get(filePath).push({ from: fromMod, import: it });
                continue;
            }
            const mImp = line.match(RE_IMPORT);
            if (mImp) {
                const mods = mImp[1].split(/[\s,]+/).filter(Boolean);
                for (const it of mods) this._imports.get(filePath).push({ from: null, import: it });
                continue;
            }

            prevWasDataclassDeco = false;
            prevWasFixtureDeco = false;
            prevWasClickCmd = false;
        }

        // argparse subparsers in CLI files
        let subMatch;
        while ((subMatch = RE_ARGPARSE_SUBPARSER.exec(content)) !== null) {
            this._addSymbol(filePath, subMatch[1], SymbolKinds.CLI_COMMAND,
                content.slice(0, subMatch.index).split(/\r?\n/).length);
        }
        RE_ARGPARSE_SUBPARSER.lastIndex = 0;
    }

    _addSymbol(file, name, kind, line) {
        if (!this._byName.has(name)) this._byName.set(name, []);
        this._byName.get(name).push({ file, kind, line });
        this._byFile.get(file).push({ name, kind, line });
    }

    /** Remove all entries from a file (call before re-indexing the file). */
    forgetFile(filePath) {
        const prev = this._byFile.get(filePath) || [];
        for (const s of prev) {
            const arr = this._byName.get(s.name) || [];
            this._byName.set(s.name, arr.filter(r => r.file !== filePath));
            if ((this._byName.get(s.name) || []).length === 0) this._byName.delete(s.name);
        }
        this._byFile.delete(filePath);
        this._imports.delete(filePath);
    }

    locations(name) { return (this._byName.get(name) || []).slice(); }
    has(name)       { return this._byName.has(name); }
    listFiles()     { return [...this._byFile.keys()].sort(); }
    importsOf(file) { return (this._imports.get(file) || []).slice(); }

    /**
     * @returns Array<{name, kind, locations: [{file, line}]}>
     *   for every name that has >1 definition where kind is class/dataclass/enum/function
     *   (imports excluded — they're meant to be repeated).
     */
    duplicates() {
        const out = [];
        for (const [name, locs] of this._byName.entries()) {
            const real = locs.filter(l => l.kind !== SymbolKinds.IMPORT);
            if (real.length > 1) {
                out.push({ name, kind: real[0].kind, locations: real.slice() });
            }
        }
        return out.sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Duplicates restricted to a kind, e.g. only duplicate dataclasses.
     */
    duplicatesByKind(kind) {
        return this.duplicates().filter(d => d.kind === kind);
    }

    /** Compact snapshot for telemetry. */
    snapshot() {
        const totals = { files: this._byFile.size, names: this._byName.size };
        const byKind = {};
        for (const arr of this._byName.values()) {
            for (const s of arr) byKind[s.kind] = (byKind[s.kind] || 0) + 1;
        }
        return {
            totals,
            by_kind: byKind,
            duplicates: this.duplicates(),
        };
    }
}
