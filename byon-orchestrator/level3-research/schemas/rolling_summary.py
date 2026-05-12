"""RollingCenterSummary, SummaryEvent, TombstoneRef — summarisation schemas.

A RollingCenterSummary is a compact view of a center's resolved positions.
It marks raw events `resolved` (and later `archived`) so they no longer
contribute to `Z_active`. The summary text itself does NOT enter FAISS, does
NOT enter `OmegaRegistry`, and does NOT participate in coagulation as a
center on its own.

Operator decision Q3 (2026-05-12): v1 summary policy is DETERMINISTIC. No
LLM-generated summaries in v1. The policy version field below tracks this;
a future v2 that admits LLM summaries would carry a different policy
version AND requires a separate adversarial-summary-test design before any
implementation work.

Hard invariants enforced at construction (see `__post_init__`):

  - `source_event_ids` MUST be non-empty (§C9, L3-G8).
  - `resolved_event_ids` ⊆ `source_event_ids`.
  - `archived_event_ids` ⊆ `resolved_event_ids` ∪ `source_event_ids`.
  - `z_reduction` ≥ 0 (a summary may decrease `Z_active`, never increase it).
  - `summary_text` length ≤ 280 chars (compact-form rule).

SummaryEvent is the on-disk record: it bundles the summary with the
tombstone pointers needed to recover the archived raw events from disk
(§C8 raw events never deleted; L3-G7 raw events recoverable).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional


class SummarisationPolicyVersion(str, Enum):
    """Version of the summarisation policy that produced this summary.

    v1 (operator-locked): deterministic only. No LLM.
    v2: reserved for future research; admits LLM summaries only under a
        separate adversarial-test design (not in this branch).
    """

    DETERMINISTIC_V1 = "deterministic_v1"
    # No other values admitted in v1. Future values land via amendment.


@dataclass(frozen=True)
class SummaryProvenance:
    """Per-summary provenance: which policy produced it, chained parents.

    `parent_summary_id` is non-None when this summary supersedes / refines an
    earlier summary on the same center. The chain is append-only on disk.
    """

    policy_version: str         # SummarisationPolicyVersion.value
    parent_summary_id: Optional[str] = None
    produced_at_ts: str = ""    # ISO-8601 UTC
    produced_at_turn: int = -1  # 0-based turn index when summary fired
    transcript_id: str = ""     # for cross-run audit
    seed: int = 0               # the harness seed in effect (Q6: 42 / 1337)

    def is_valid(self) -> bool:
        return bool(
            self.policy_version
            and self.produced_at_ts
            and self.produced_at_turn >= 0
            and self.transcript_id
        )


@dataclass(frozen=True)
class TombstoneRef:
    """Pointer to an archived raw event.

    Stored alongside each SummaryEvent so a future replay (or audit) can
    recover the raw payload that the summary digested away. Mandatory for
    L3-G7 (raw events recoverable).

    Commit-5 additions (`reason`, `summary_id`, `archived_at_turn`,
    `source_event_ids`) are OPTIONAL with safe defaults — every existing
    construction site that supplied only the original 3 fields continues
    to work unchanged. The new fields let the summary policy attach the
    rationale of the archive directly to the tombstone, so a replay can
    audit "why was this event archived" without consulting the summary.
    """

    archived_event_id: str
    archived_at_ts: str          # ISO-8601 UTC
    recovery_path: str           # disk path or memory-service ref to the
                                 # full payload of the archived event
    # v0.6.9.1 commit-5 (deterministic summary policy v1) additions:
    reason: str = ""             # operator-locked: "resolved_by_correction_chain"
                                 # | "confirmed_by_receipt_success"
                                 # | "compressed_stable_expression_pattern"
                                 # | "" (legacy / unspecified)
    summary_id: str = ""         # the RollingCenterSummary.summary_id that
                                 # created this tombstone (back-pointer)
    archived_at_turn: int = -1   # turn index when the archive happened
                                 # (-1 = unknown)
    source_event_ids: tuple = () # the source_event_ids of the summary that
                                 # archived this event (provenance trail)


@dataclass(frozen=True)
class RollingCenterSummary:
    """A compact, append-only digest of a center's resolved positions."""

    summary_id: str             # UUIDv4
    center_id: str              # the center being summarised
    perspective: str            # one of Perspective.value (v1: 4 admitted)
    summary_text: str           # <= 280 chars; structured digest

    source_event_ids: List[str] = field(default_factory=list)
    resolved_event_ids: List[str] = field(default_factory=list)
    archived_event_ids: List[str] = field(default_factory=list)

    z_reduction: float = 0.0    # numeric decrease applied to Z_active
                                # when this summary fired; >= 0

    provenance: Optional[SummaryProvenance] = None

    def __post_init__(self) -> None:
        if not self.summary_id:
            raise ValueError("RollingCenterSummary.summary_id must be non-empty")
        if not self.center_id:
            raise ValueError("RollingCenterSummary.center_id must be non-empty")
        if not self.perspective:
            raise ValueError("RollingCenterSummary.perspective must be non-empty")
        if len(self.summary_text) > 280:
            raise ValueError(
                "RollingCenterSummary.summary_text must be <= 280 chars "
                f"(got {len(self.summary_text)})"
            )
        if not self.source_event_ids:
            raise ValueError(
                "RollingCenterSummary.source_event_ids must be non-empty "
                "(§C9 / L3-G8 mandatory provenance)"
            )
        # Subset checks (cheap; use sets only locally).
        src = set(self.source_event_ids)
        if not set(self.resolved_event_ids).issubset(src):
            raise ValueError(
                "RollingCenterSummary.resolved_event_ids must be a subset of "
                "source_event_ids"
            )
        if not set(self.archived_event_ids).issubset(
            src | set(self.resolved_event_ids)
        ):
            raise ValueError(
                "RollingCenterSummary.archived_event_ids must be a subset of "
                "source_event_ids ∪ resolved_event_ids"
            )
        if self.z_reduction < 0:
            raise ValueError(
                "RollingCenterSummary.z_reduction must be >= 0 "
                f"(got {self.z_reduction})"
            )


@dataclass(frozen=True)
class SummaryEvent:
    """On-disk record for a fired RollingCenterSummary.

    Pairs the summary with the tombstone pointers needed to recover the
    archived raw events. The harness persists one SummaryEvent per
    `RollingCenterSummary.summary_id`. Replay reconstructs `Z_active`
    from raw events alone and verifies the `z_reduction` claim mathematically.
    """

    summary: RollingCenterSummary
    tombstone_pointers: List[TombstoneRef] = field(default_factory=list)

    def __post_init__(self) -> None:
        # If the summary archived any events, every archived id MUST have a
        # corresponding tombstone pointer (so the raw payload stays
        # recoverable per §C8 / L3-G7).
        archived_ids = set(self.summary.archived_event_ids)
        pointer_ids = {p.archived_event_id for p in self.tombstone_pointers}
        missing = archived_ids - pointer_ids
        if missing:
            raise ValueError(
                "SummaryEvent: missing tombstone_pointer for archived events: "
                f"{sorted(missing)}"
            )
