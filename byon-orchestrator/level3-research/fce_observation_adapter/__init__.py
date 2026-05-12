"""Isolated real-FCE-M observation adapter (research, isolated).

Replaces the surrogate metric in commit 11 with a REAL FCE-M Agent
stepped read-only. Per-bucket, per-transcript, an isolated Agent is
instantiated, fed a deterministic sequence of field vectors derived
from the transcript's cycle metadata, and its `step(...)` method
returns REAL FCE-M `S_t` via the production `self_index` formula.

ADVISORY ONLY. The adapter:

  * Imports FCE-M vendor primitives read-only (`Agent`, `self_index`,
    `autoreferential_measure`, `check_coagulation`). Module imports
    have been verified to have no side effects on load — only a
    `sys.path.insert` to make the vendored source resolvable.
  * Does NOT call the production `FceOmegaObserver.step()` (which
    writes to `OmegaRegistry` and creates `ReferenceField`).
  * Does NOT call `agent.check_coagulation(...)` (which mutates the
    in-memory `agent.Omega` bit). The temporal rule is evaluated via a
    LOCAL audit re-implementation identical to commit 11.
  * Does NOT write to any OmegaRegistry; does NOT create OmegaRecord;
    does NOT create ReferenceField; does NOT set `is_omega_anchor`.
  * Does NOT modify the FCE-M vendor source.
  * Does NOT modify production config; `theta_s` and `tau_coag` remain
    operator-locked literals (0.28 and 12) inside this module.

Field vectors are deterministic hashes of `cycle_id`; the anchor is a
deterministic mapping of the surrogate cycle telemetry. This is an
honest research observation: the FCE-M math is real (production
formulas), but the inputs are derived from research event metadata
rather than a production semantic encoder. The divergence from
production is documented in every report this module emits.
"""

from .adapter import (
    AGENT_FIELD_DIM,
    AGENT_KAPPA_0,
    AGENT_ALPHA_0,
    AGENT_LAMBDA_0,
    AGENT_RHO_0,
    CANDIDATE_BUCKETS,
    METRIC_SOURCE_REAL_FCE,
    SCHEMA_VERSION,
    TAU_COAG,
    THETA_S,
    THETA_S_SOURCE,
    TAU_COAG_SOURCE,
    isolated_temporal_rule,
    longest_run_above_threshold,
    observe_bucket_real_fce,
    run_real_fce_observation,
)
from .report import render_json, render_markdown, write_reports

__all__ = [
    "AGENT_FIELD_DIM",
    "AGENT_KAPPA_0",
    "AGENT_ALPHA_0",
    "AGENT_LAMBDA_0",
    "AGENT_RHO_0",
    "CANDIDATE_BUCKETS",
    "METRIC_SOURCE_REAL_FCE",
    "SCHEMA_VERSION",
    "TAU_COAG",
    "THETA_S",
    "THETA_S_SOURCE",
    "TAU_COAG_SOURCE",
    "isolated_temporal_rule",
    "longest_run_above_threshold",
    "observe_bucket_real_fce",
    "run_real_fce_observation",
    "render_json",
    "render_markdown",
    "write_reports",
]
