"""Potential Omega Center detector for the Level 3 research package.

ADVISORY ONLY. The detector emits `PotentialOmegaSignal` rows when a
(center_id, perspective) bucket exhibits all of:

  - rising or sustained-high S_t over a K=12-cycle window
  - stable AR_t (low std)
  - stable kappa_t (low std)
  - falling Z_active
  - rising B_t

It does NOT call `check_coagulation`. It does NOT register OmegaRecord.
It does NOT create ReferenceField. It does NOT mutate ZCounters,
CenterEventBuffer, or SummaryEvent. The detector is a pure read of
incoming cycle measurements; its only output is a telemetry signal.

Every `PotentialOmegaSignal` carries `advisory_only = True`. This flag
exists to make the policy explicit at the type level; the harness MUST
NOT promote an advisory signal into an Omega creation.

Public surface:

    @dataclass(frozen=True)
    class PotentialOmegaSignal

    class PotentialOmegaDetector
        observe_cycle(...) -> list[PotentialOmegaSignal]
        snapshot() -> dict
        from_snapshot(payload) -> PotentialOmegaDetector
        emitted_signal_ids -> set[str]    (read-only property)
"""

from .detector import (
    POLICY_VERSION,
    SCHEMA_VERSION,
    PotentialOmegaSignal,
    PotentialOmegaDetector,
)

__all__ = [
    "POLICY_VERSION",
    "SCHEMA_VERSION",
    "PotentialOmegaSignal",
    "PotentialOmegaDetector",
]
