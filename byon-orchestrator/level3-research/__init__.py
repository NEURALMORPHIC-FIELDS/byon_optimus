"""
Level 3 — Natural Omega Research package.

================================================================================
ISOLATION POLICY — MANDATORY
================================================================================

This package lives on branch `research/level-3-natural-omega`. It MUST NOT be
imported by any production code on `main` or by any module under
`byon-orchestrator/src/`, `byon-orchestrator/scripts/`, or
`byon-orchestrator/memory-service/` outside this directory.

Specifically:

  - No `from level3_research import ...` in production modules.
  - No `import level3_research` in production modules.
  - No relative imports from `..` into this package.
  - No FCE-M facade hooks. No feature-flagged production paths.
  - No mutation of `OmegaRegistry` from anywhere in this package.

The package is *experiment-only*. It re-uses FCE-M numerics and embeddings via
documented public APIs (read-only) when it needs them; it never reaches around
the public surface.

================================================================================
RUNTIME GUARD
================================================================================

If this package is imported from a module path that suggests production usage,
the import emits a `UserWarning`. The guard is best-effort; it does not raise
(to keep tests and tooling that legitimately import schemas working) but it
makes the violation visible at runtime.

================================================================================
SCOPE
================================================================================

See `docs/LEVEL3_NATURAL_OMEGA_RESEARCH.md` and `byon-orchestrator/
level3-research/README.md` for the design and operator-locked decisions
(Q1–Q8 §0.1 Decision Log).

Hard constraints (restated):

  - `theta_s = 0.28` unchanged.
  - `tau_coag = 12` unchanged.
  - OmegaRecord appears ONLY via `check_coagulation`.
  - No LLM-created Omega.
  - No manual `registry.register(...)`.
  - No `is_omega_anchor=True`.
  - RollingCenterSummary v1 is deterministic only (no LLM summaries).
  - Raw events archived, never deleted.
  - Full provenance mandatory.
  - `main` stays Level 2 of 4 until L3-G10 holds AND operator approves.

================================================================================

Patent: EP25216372.0 — Omni-Qube-Vault —
Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
"""

import sys
import warnings

__all__ = ["__version__", "ISOLATION_NOTICE"]
__version__ = "0.0.1-research"

ISOLATION_NOTICE = (
    "level3-research is a research-only package. It must not be imported by "
    "production code on main. See byon-orchestrator/level3-research/__init__.py."
)


def _check_caller_isolation() -> None:
    """Best-effort: emit a warning if this package is imported from a module
    path that suggests production usage.

    The check inspects the immediate caller frame; it intentionally does NOT
    raise (so that tests, schemas, and tooling that legitimately reach in
    keep working). It does make any production-path import visible.
    """
    try:
        # Frame 0 = this function. Frame 1 = the caller (= the import site).
        caller = sys._getframe(1)
        caller_file = caller.f_globals.get("__file__", "") or ""
        # Heuristic: production sits under src/ or scripts/ or memory-service/.
        # The level3-research package itself, and tests/ anywhere, are fine.
        suspicious_markers = (
            "/byon-orchestrator/src/",
            "/byon-orchestrator/scripts/",
            "/byon-orchestrator/memory-service/",
            "\\byon-orchestrator\\src\\",
            "\\byon-orchestrator\\scripts\\",
            "\\byon-orchestrator\\memory-service\\",
        )
        allowed_markers = (
            "/level3-research/",
            "\\level3-research\\",
            "/tests/",
            "\\tests\\",
        )
        if any(m in caller_file for m in suspicious_markers) and not any(
            m in caller_file for m in allowed_markers
        ):
            warnings.warn(
                f"level3-research imported from {caller_file!r}. "
                + ISOLATION_NOTICE,
                stacklevel=2,
            )
    except Exception:  # pragma: no cover - guard never blocks import
        pass


_check_caller_isolation()
