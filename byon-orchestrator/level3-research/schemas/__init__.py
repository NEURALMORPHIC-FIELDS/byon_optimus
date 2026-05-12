"""Schema definitions for the Level 3 natural-Omega research harness.

These schemas are frozen dataclasses. They define the SHAPE of the data the
research harness will produce and consume. They do NOT contain behaviour —
no Z metabolism, no summary policy, no coagulation interaction. Behaviour
lands in subsequent commits, each gated on a separate operator confirmation.

The four perspectives admitted in v1 (operator decision Q4) are:

  - factual
  - project_state
  - domain_verified
  - security_boundary

The other four perspectives from §5.1 of the design doc (`preference`, `style`,
`execution_boundary`, `narrative`) are NOT modelled in v1.

See `docs/LEVEL3_NATURAL_OMEGA_RESEARCH.md` for the design rationale and
`byon-orchestrator/level3-research/README.md` for the directory policy.
"""

from .perspective import Perspective, PERSPECTIVES_V1
from .memory_event import EventKind, ResolutionStatus, ProvenanceRecord, MemoryEvent
from .center_event_buffer import CenterEventBuffer
from .rolling_summary import (
    SummarisationPolicyVersion,
    SummaryProvenance,
    TombstoneRef,
    RollingCenterSummary,
    SummaryEvent,
)
from .z_counters import ZCounters

__all__ = [
    "Perspective",
    "PERSPECTIVES_V1",
    "EventKind",
    "ResolutionStatus",
    "ProvenanceRecord",
    "MemoryEvent",
    "CenterEventBuffer",
    "SummarisationPolicyVersion",
    "SummaryProvenance",
    "TombstoneRef",
    "RollingCenterSummary",
    "SummaryEvent",
    "ZCounters",
]
