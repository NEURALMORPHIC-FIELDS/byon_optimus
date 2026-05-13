// ---------------------------------------------------------------------------
// ArchitectureMap
// ---------------------------------------------------------------------------
// Derives the project shape from ExactFileStateStore + SymbolIndex:
//   * packages and modules
//   * each module's public APIs (top-level classes/functions, no underscore)
//   * dependency edges (import graph)
//   * known invariants (forbidden duplicate public APIs)
//   * CLI surface
//   * test surface
// Used by CodingContextBuilder to give the model a stable picture of the
// project, and by WorkspaceDiffGuard to detect drift from that picture.
// ---------------------------------------------------------------------------

import { SymbolKinds } from "./symbol-index.mjs";

// Public-API forbidden duplicates — never two of these in the same project.
export const FORBIDDEN_DUPLICATE_PUBLIC_APIS = [
    "PolicyEngine", "AuditLog", "WorkflowDefinition", "WorkflowStep",
    "ExecutionPlan", "PlanValidator", "PlanRenderer", "RollbackManager",
    "PermissionModel", "PolicyGate",
];

export class ArchitectureMap {
    constructor(fileStore, symbolIndex) {
        this.fileStore = fileStore;
        this.symbolIndex = symbolIndex;
        this._packages = new Map();      // package_path -> [modules]
        this._publicApis = new Map();    // module -> [public symbol names]
        this._depEdges = [];             // [{from_module, to_module}]
        this._cliCommands = [];
        this._tests = [];
        this._dirty = true;
    }

    rebuild() {
        this._packages.clear();
        this._publicApis.clear();
        this._depEdges = [];
        this._cliCommands = [];
        this._tests = [];

        for (const entry of this.fileStore.listExisting()) {
            if (entry.language !== "python") continue;
            const pkg = packageOf(entry.file_path);
            if (!this._packages.has(pkg)) this._packages.set(pkg, []);
            this._packages.get(pkg).push(entry.file_path);

            const fileSymbols = this.symbolIndex._byFile?.get?.(entry.file_path) || [];
            const pub = fileSymbols
                .filter(s => !s.name.startsWith("_"))
                .filter(s => [SymbolKinds.CLASS, SymbolKinds.DATACLASS, SymbolKinds.ENUM, SymbolKinds.FUNCTION, SymbolKinds.CLI_COMMAND].includes(s.kind))
                .map(s => ({ name: s.name, kind: s.kind, line: s.line }));
            this._publicApis.set(entry.file_path, pub);

            for (const t of fileSymbols.filter(s => s.kind === SymbolKinds.TEST)) {
                this._tests.push({ file: entry.file_path, name: t.name });
            }
            for (const c of fileSymbols.filter(s => s.kind === SymbolKinds.CLI_COMMAND)) {
                this._cliCommands.push({ file: entry.file_path, name: c.name });
            }

            for (const imp of this.symbolIndex.importsOf(entry.file_path)) {
                if (imp.from && imp.from.startsWith(".")) continue; // relative import — local
                this._depEdges.push({ from_module: entry.file_path, to_module: imp.from || imp.import });
            }
        }
        this._dirty = false;
    }

    /** Returns symbols defined more than once across the public surface. */
    forbiddenDuplicatePublicApis() {
        if (this._dirty) this.rebuild();
        const dups = this.symbolIndex.duplicates();
        return dups.filter(d => FORBIDDEN_DUPLICATE_PUBLIC_APIS.includes(d.name));
    }

    /** Returns all duplicates as a sorted list (any kind). */
    duplicatePublicApis() {
        if (this._dirty) this.rebuild();
        return this.symbolIndex.duplicates();
    }

    markDirty() { this._dirty = true; }

    snapshot() {
        if (this._dirty) this.rebuild();
        return {
            packages: [...this._packages.entries()].map(([p, mods]) => ({ package: p, modules: mods })),
            modules: [...this._publicApis.keys()].sort(),
            public_apis: Object.fromEntries(this._publicApis),
            cli_commands: this._cliCommands.slice(),
            tests: this._tests.slice(),
            dep_edges: this._depEdges.slice(),
            forbidden_duplicate_public_apis: this.forbiddenDuplicatePublicApis(),
            duplicate_public_apis: this.duplicatePublicApis(),
            invariants: FORBIDDEN_DUPLICATE_PUBLIC_APIS.slice(),
        };
    }
}

function packageOf(filePath) {
    const parts = filePath.split("/");
    if (parts.length <= 1) return "<root>";
    return parts.slice(0, -1).join("/");
}
