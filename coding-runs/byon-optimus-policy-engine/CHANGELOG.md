# Changelog

## [Unreleased] — P6: Final hardening for handoff

### Added

- `docs/ARCHITECTURE.md` — high-level architecture, module table, data-flow
  diagram, key invariants.
- `docs/SECURITY.md` — threat model, trusted vs untrusted input table, seven-layer
  explanation of how `policy_gate: bypass_all` is prevented, notes on
  REQ_AUDIT_APPEND_ONLY and REQ_PROD_REQUIRES_GRANT.
- `docs/LIMITATIONS.md` — explicit list of what the engine does not do (no real
  execution, no persistent audit by default, no parallelism, no retry, etc.).
- `docs/EXAMPLES.md` — five worked examples covering simple build, production
  gate enforcement, conditional steps, permissive mode, and plan inspection.

### Changed

- `README.md` — refreshed: "Run All Tests" command at top, documentation index
  table, built-in gates table, security summary, requirements status table.
- `CHANGELOG.md` — added P6 entry.

### Fixed