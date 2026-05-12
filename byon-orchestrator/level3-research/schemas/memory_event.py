"""MemoryEvent — the raw event record per center, per perspective.

A MemoryEvent records one projection of one user turn into one center on one
perspective slice. A single 500-turn transcript will therefore produce
between 500 and 2000 MemoryEvent rows (0–4 per turn, given the v1 fan-out
of 4 perspectives).

Hard rules:

  - `event_id` is unique. New events get a fresh UUID.
  - `provenance` is mandatory and non-empty (§C9).
  - `z_contribution` is the per-event delta added to `Z_total` at write time.
    Always non-negative.
  - `resolution_status` starts as "unresolved" and transitions only by:
       unresolved -> resolved   (some RollingCenterSummary marked it)
       resolved   -> archived   (a later summary archived its residue)
    The reverse paths (archived -> resolved -> unresolved) are NOT permitted
    via implicit code paths. Only an explicit operator revocation may
    re-activate; that operation is out of scope for this commit.
  - The raw event row is NEVER deleted on transition to `archived`. The row
    survives on disk so the harness can recover it (§C8, L3-G7).

This module defines the data shape only. There is no Z metabolism here —
that lands in a subsequent commit.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional


class EventKind(str, Enum):
    """The kind of signal this event carries on its center.

    Mirrors the FCE-M event taxonomy. String-valued for JSONL stability.
    """

    ALIGNED = "aligned"                   # expression confirms center's pattern
    TENSIONED = "tensioned"               # expression strains against center
    CONTESTED = "contested"               # explicit conflict with center
    CORRECTION = "correction"             # user corrects a prior event
    RECEIPT_SUCCESS = "receipt_success"   # action confirmed for this center
    RECEIPT_PARTIAL = "receipt_partial"   # partial confirmation
    RECEIPT_FAILURE = "receipt_failure"   # action failed
    SECURITY_REJECTED = "security_rejected"  # blocked by safety boundary


class ResolutionStatus(str, Enum):
    """The lifecycle status of a single event's residue.

    The `unresolved` state contributes to `Z_active`. `resolved` and
    `archived` contribute to `Z_resolved` and `Z_archived` respectively;
    neither feeds into the coagulation rule's residue input.

    Forward transitions only:
        unresolved -> resolved -> archived
    """

    UNRESOLVED = "unresolved"
    RESOLVED = "resolved"
    ARCHIVED = "archived"


@dataclass(frozen=True)
class ProvenanceRecord:
    """Mandatory provenance fields for every event.

    The harness will refuse to ingest an event whose ProvenanceRecord has
    any required field missing. This is the audit-trail anchor for
    L3-G7 (raw events recoverable) and L3-G8 (source_event_ids complete).
    """

    channel: str                # "harness" for the research harness;
                                #   "operator-cli" / "ab-bench" / "whatsapp" if
                                #   ever sourced from a live channel (out of
                                #   scope for v1)
    thread_id: str              # thread identifier in the transcript
    source: str                 # human-readable source label, e.g. "transcript_A"
    turn_index: int             # 0-based turn index within the transcript
    transcript_id: str          # "transcript_A_byon_arch" / "transcript_B_byon_arch"
    seed: int                   # 42 for Run 1, 1337 for Run 2 (Q6)

    def is_valid(self) -> bool:
        """Cheap sanity check used at ingest time."""
        return bool(
            self.channel
            and self.thread_id
            and self.source
            and isinstance(self.turn_index, int)
            and self.turn_index >= 0
            and self.transcript_id
            and isinstance(self.seed, int)
        )


@dataclass(frozen=True)
class MemoryEvent:
    """A single raw event projected into a single (center_id, perspective)."""

    event_id: str               # UUIDv4 string
    center_id: str              # stable identifier for the center on its
                                #   perspective slice (e.g.
                                #   "factual::macp_pipeline_three_agents")
    perspective: str            # one of Perspective.value (v1 admits 4)
    ts: str                     # ISO-8601 UTC, e.g. "2026-05-12T17:42:00Z"

    kind: str                   # one of EventKind.value
    text: str                   # the raw text excerpt (already extracted from
                                #   the user turn; bounded by harness, <=4000 chars)
    embedding: Optional[List[float]] = None  # 384-dim, L2-normalised; populated
                                             # by the harness via the
                                             # memory-service embed endpoint

    provenance: Optional[ProvenanceRecord] = None

    z_contribution: float = 0.0   # delta added to Z_total at write time;
                                  #   non-negative. The harness computes this
                                  #   from `kind` + the per-center expression
                                  #   signature (subsequent commit).

    resolution_status: str = ResolutionStatus.UNRESOLVED.value
    resolved_by_summary_id: Optional[str] = None    # filled when status flips
                                                    #   to RESOLVED
    archived_at_ts: Optional[str] = None            # filled on ARCHIVED
    archive_path: Optional[str] = None              # disk/store path where the
                                                    #   raw payload remains
                                                    #   recoverable (§C8)

    tags: List[str] = field(default_factory=list)   # free-form annotation
                                                    #   ("user_preference",
                                                    #   "correction_chain", ...)
