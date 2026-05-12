"""ZCounters — residue accounting per center.

Four counters per (center_id, perspective):

  Z_total     — all-time residue mass ever added to this center.
                Monotonic non-decreasing. Never reduced by summarisation.
                Audit-only.

  Z_active    — residue mass still carried by UNRESOLVED events.
                INPUT to the coagulation rule: B_t = 1 / (1 + Z_active).
                Increases on new tensioned/contested events.
                Decreases when a RollingCenterSummary marks events resolved
                or archived.

  Z_resolved  — residue mass for events the summary policy marked RESOLVED
                but not yet ARCHIVED.

  Z_archived  — residue mass for events the summary policy marked ARCHIVED.

Invariant (mandatory at all times, all centers):

    Z_active + Z_resolved + Z_archived  ==  Z_total

Operator-locked behaviour:

  - Z_total is monotonic non-decreasing per center (§C9).
  - A summary may shift mass from Z_active -> Z_resolved (and later ->
    Z_archived). The shift conserves total. Summaries do NOT change the
    coagulation rule, the thresholds, or the registry.
  - The only path BACK from archived/resolved to active is explicit
    operator revocation. That path is OUT OF SCOPE for this commit.
  - `theta_s = 0.28` and `tau_coag = 12` are read-only here. They are
    NOT defined or overridden in this module; they live in the vendored
    FCE-M Config (`facade/config.py`).

This module defines the data shape + the invariant checker. The actual
Z metabolism (apply_event, apply_summary) lands in a subsequent commit.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ZCounters:
    """Residue counters for one (center_id, perspective) pair."""

    center_id: str
    perspective: str           # Perspective.value

    z_total: float = 0.0       # >= 0, monotonic non-decreasing
    z_active: float = 0.0      # >= 0; INPUT to B_t = 1/(1 + z_active)
    z_resolved: float = 0.0    # >= 0
    z_archived: float = 0.0    # >= 0

    last_updated_at_turn: int = -1
    last_updated_at_ts: str = ""

    # Numerical tolerance for the conservation invariant. Floats summed
    # across many event applications can drift by epsilon; tolerate up to
    # 1e-6 absolute.
    _conservation_tolerance: float = 1.0e-6

    def __post_init__(self) -> None:
        if not self.center_id:
            raise ValueError("ZCounters.center_id must be non-empty")
        if not self.perspective:
            raise ValueError("ZCounters.perspective must be non-empty")
        if self.z_total < 0 or self.z_active < 0 or self.z_resolved < 0 or self.z_archived < 0:
            raise ValueError(
                "ZCounters: all Z values must be >= 0 "
                f"(z_total={self.z_total}, z_active={self.z_active}, "
                f"z_resolved={self.z_resolved}, z_archived={self.z_archived})"
            )
        # Conservation invariant: z_active + z_resolved + z_archived == z_total
        bucket_sum = self.z_active + self.z_resolved + self.z_archived
        if abs(bucket_sum - self.z_total) > self._conservation_tolerance:
            raise ValueError(
                "ZCounters conservation invariant violated: "
                f"z_active + z_resolved + z_archived = {bucket_sum} "
                f"!= z_total = {self.z_total} "
                f"(tolerance {self._conservation_tolerance})"
            )

    def conservation_holds(self) -> bool:
        """Return True iff z_active + z_resolved + z_archived == z_total."""
        bucket_sum = self.z_active + self.z_resolved + self.z_archived
        return abs(bucket_sum - self.z_total) <= self._conservation_tolerance

    def b_t(self) -> float:
        """The B_t input to the coagulation rule: 1 / (1 + z_active).

        Important: this uses Z_ACTIVE, NOT z_total. That is the entire
        load-bearing semantic change vs Level 2 (§4 of the design doc).

        Returns a value in (0, 1]. Equal to 1.0 when z_active == 0.

        Note: this method only RETURNS the value. It does NOT call
        `check_coagulation`. It does NOT register Omega. It does NOT
        influence any production code path.
        """
        return 1.0 / (1.0 + self.z_active)
