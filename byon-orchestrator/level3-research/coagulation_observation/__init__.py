"""Controlled coagulation observation package (research, isolated).

Observes whether candidate buckets that emit PotentialOmega signals
*would* satisfy the production temporal coagulation rule
(`S_t >= theta_s for tau_coag consecutive cycles`), using only the
research surrogate metric and a LOCAL audit re-implementation of the
rule.

This package does NOT:

  * import or call production `check_coagulation`
  * import FCE-M vendor code (production path)
  * create OmegaRecord
  * call OmegaRegistry.register
  * create ReferenceField
  * set is_omega_anchor
  * lower theta_s or tau_coag
  * declare Level 3
  * touch byon-orchestrator/src/, scripts/, or memory-service/

Two observation modes are reported per (bucket × transcript):

  Mode A - surrogate feasibility
    Uses research_surrogate_v1_not_fce_production s_t. Tells you whether
    the surrogate shape satisfies the temporal pattern. Not a Level 3
    claim.

  Mode B - isolated rule observation
    Applies a minimal local re-implementation of the same temporal rule
    (`S_t >= theta_s for tau_coag consecutive cycles`) to the surrogate
    series. Auditable in this module. NOT the production function.

Both modes operate on the same surrogate input series, so they agree
mathematically. The DIFFERENCE is the label and the audit framing:
Mode A says "the data has feasibility shape"; Mode B says "the same
temporal rule production uses, applied auditably here in research,
would emit". Neither creates Omega.

Public surface:

    THETA_S
    TAU_COAG
    CANDIDATE_BUCKETS
    isolated_temporal_rule(s_series, theta_s, tau_coag) -> bool
    longest_run_above_threshold(s_series, theta_s) -> int
    observe_bucket(...) -> dict
    run_observation(*, commit_sha=None) -> dict
    write_reports(out_dir, *, commit_sha=None) -> tuple[Path, Path]
"""

from .runner import (
    CANDIDATE_BUCKETS,
    SCHEMA_VERSION,
    TAU_COAG,
    THETA_S,
    THETA_S_SOURCE,
    TAU_COAG_SOURCE,
    isolated_temporal_rule,
    longest_run_above_threshold,
    observe_bucket,
    run_observation,
)
from .report import render_json, render_markdown, write_reports

__all__ = [
    "CANDIDATE_BUCKETS",
    "SCHEMA_VERSION",
    "TAU_COAG",
    "THETA_S",
    "THETA_S_SOURCE",
    "TAU_COAG_SOURCE",
    "isolated_temporal_rule",
    "longest_run_above_threshold",
    "observe_bucket",
    "run_observation",
    "render_json",
    "render_markdown",
    "write_reports",
]
