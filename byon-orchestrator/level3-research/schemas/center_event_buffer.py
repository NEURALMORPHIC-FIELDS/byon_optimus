"""CenterEventBuffer — per-center bounded buffer of MemoryEvent records.

One CenterEventBuffer per `(center_id, perspective)` pair. Events are kept in
insertion order; the buffer is bounded by `max_events` (and optionally
`max_age_seconds`). When an event is evicted from the head by the bound, it
MUST be archived (not deleted) to satisfy §C8.

The buffer is the input to:

  - the deterministic summarisation policy (RollingCenterSummary)
  - the Z accounting (ZCounters)
  - the PotentialOmegaCenter detector (advisory only)
  - the existing FCE-M coagulation observer (`check_coagulation`) — fed via
    the same public API surface, unchanged

This module defines the data shape only. Eviction policy, summarisation
policy, and Z metabolism are subsequent commits.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from .memory_event import MemoryEvent


@dataclass(frozen=True)
class CenterEventBuffer:
    """A per-center ring of raw MemoryEvents.

    Bounds:

      - `max_events`     — hard upper bound on how many events the buffer
                           retains in memory. Default 1024. When the buffer
                           is full and a new event arrives, the oldest event
                           is archived (status -> ARCHIVED, payload kept on
                           disk via `archive_path` per the harness storage
                           contract) before the head is freed.
      - `max_age_seconds`— optional; events older than this are archived
                           at the next ingest tick. Default None (no age
                           bound; only event-count bound).

    Note: this is a frozen dataclass. The `events` list is documented as
    "logically append-only with archival eviction"; the eviction is performed
    by replacing the buffer object via a `with_appended` / `with_evicted`
    helper that returns a new `CenterEventBuffer`. The helpers themselves
    are NOT in this commit — only the schema.
    """

    center_id: str
    perspective: str          # one of Perspective.value
    events: List[MemoryEvent] = field(default_factory=list)

    max_events: int = 1024
    max_age_seconds: Optional[int] = None

    def __post_init__(self) -> None:
        # Sanity checks at construction. Cheap to keep on; useful for tests.
        if not self.center_id:
            raise ValueError("CenterEventBuffer.center_id must be non-empty")
        if not self.perspective:
            raise ValueError("CenterEventBuffer.perspective must be non-empty")
        if self.max_events <= 0:
            raise ValueError("CenterEventBuffer.max_events must be > 0")
        if self.max_age_seconds is not None and self.max_age_seconds <= 0:
            raise ValueError(
                "CenterEventBuffer.max_age_seconds must be > 0 or None"
            )
