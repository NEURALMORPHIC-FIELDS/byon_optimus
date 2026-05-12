"""Deterministic summary policy v1.

Three admissible patterns (operator-locked for v1):

  A. correction_chain
     A tension event (CONTESTED / TENSIONED / RECEIPT_FAILURE /
     SECURITY_REJECTED) on the buffer's (center_id, perspective)
     followed by a resolution event later in the same buffer.
     Resolution rules differ for adversarial vs plain contradictions:
       - adversarial event (CONTESTED, z>=0.95) and SECURITY_REJECTED
         require STRONG resolution: CORRECTION or RECEIPT_SUCCESS only
         (a coherent ALIGNED restatement is NOT enough to summarise an
         unresolved adversarial claim)
       - plain contradiction / TENSIONED / RECEIPT_FAILURE accepts
         CORRECTION, RECEIPT_SUCCESS, or ALIGNED (coherent restatement)
     Result: all events in [tension..resolution] are RESOLVED.

  B. receipt_success_chain
     A RECEIPT_SUCCESS (or RECEIPT_PARTIAL) event preceded by 2+ events
     on the same (center_id, perspective). The receipt confirms the
     chain; all events [first..receipt] are RESOLVED.

  C. expression_pattern_stable
     All active events are ALIGNED (no tension, no correction, no
     receipt). Minimum 3 events. The NEWEST event is RESOLVED (stable
     representation); older redundant copies are ARCHIVED (with
     mandatory TombstoneRef for each).

Determinism contract:

  - same buffer state + same `summary_id_seed` -> identical SummaryEvent
  - same buffer state + different `summary_id_seed` -> identical content
    (source_event_ids, resolved_event_ids, archived_event_ids,
    z_reduction, summary_text), but a different `summary_id` and a
    different `provenance.seed`
  - no LLM, no embeddings, no clustering, no clock reads

What this module does NOT do (operator constraint, commit-5 scope):

  - does NOT call check_coagulation
  - does NOT mutate OmegaRegistry
  - does NOT create OmegaRecord, ReferenceField, or PotentialOmega
  - does NOT run a full harness
  - does NOT import from production memory-service paths
  - does NOT read ZMetabolismRuntime counters (it operates on the
    buffer's events directly; the apply_summary clamp is the runtime's
    job)
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import List, Mapping, Optional, Sequence, Tuple

from schemas import (
    CenterEventBuffer,
    EventKind,
    MemoryEvent,
    Perspective,
    PERSPECTIVES_V1,
    ResolutionStatus,
    RollingCenterSummary,
    SummarisationPolicyVersion,
    SummaryEvent,
    SummaryProvenance,
    TombstoneRef,
)


# ---------------------------------------------------------------------------
# Constants (operator-locked)
# ---------------------------------------------------------------------------

POLICY_VERSION = SummarisationPolicyVersion.DETERMINISTIC_V1.value

REASON_CORRECTION = "resolved_by_correction_chain"
REASON_RECEIPT = "confirmed_by_receipt_success"
REASON_STABLE_PATTERN = "compressed_stable_expression_pattern"

# Event-kind groups.
_TENSION_KINDS = frozenset({
    EventKind.CONTESTED.value,
    EventKind.TENSIONED.value,
    EventKind.RECEIPT_FAILURE.value,
    EventKind.SECURITY_REJECTED.value,
})

_STRONG_RESOLUTION_KINDS = frozenset({
    # Adversarial / security-rejected tensions require these.
    EventKind.CORRECTION.value,
    EventKind.RECEIPT_SUCCESS.value,
})

_WEAK_RESOLUTION_KINDS = frozenset({
    # Plain contradictions / tensioned events accept these.
    EventKind.CORRECTION.value,
    EventKind.RECEIPT_SUCCESS.value,
    EventKind.ALIGNED.value,
})

_RECEIPT_RESOLUTION_KINDS = frozenset({
    EventKind.RECEIPT_SUCCESS.value,
    EventKind.RECEIPT_PARTIAL.value,
})

_STABLE_KINDS = frozenset({
    EventKind.ALIGNED.value,
})

# Adversarial discrimination: the projection assigns z_contribution = 1.0
# to adversarial claim-to-rule (commit 3 §6). Plain contradiction is 0.8.
# The threshold below comfortably separates the two.
_ADVERSARIAL_Z_THRESHOLD = 0.95


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class NoSummaryCandidate(ValueError):
    """Raised by `build_summary` when the buffer has no admissible pattern.

    The caller can either:
      (a) gate with `should_summarize(buffer)` before calling, OR
      (b) catch this exception.
    """


# ---------------------------------------------------------------------------
# Internal candidate representation
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _CandidatePattern:
    """An internal description of the pattern the policy detected."""

    pattern_name: str   # "correction_chain" | "receipt_success_chain" |
                        # "expression_pattern_stable"
    source_event_ids: Tuple[str, ...]
    resolved_event_ids: Tuple[str, ...]
    archived_event_ids: Tuple[str, ...]
    z_reduction: float
    summary_text: str
    tombstone_reason: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _is_adversarial(event: MemoryEvent) -> bool:
    """Detect adversarial events. The projection sets z=1.0 + CONTESTED for
    adversarial claim-to-rule; plain contradiction gets z=0.8 + CONTESTED.
    The 0.95 threshold cleanly separates the two."""
    return (
        event.kind == EventKind.CONTESTED.value
        and float(event.z_contribution) >= _ADVERSARIAL_Z_THRESHOLD
    )


def _requires_strong_resolution(event: MemoryEvent) -> bool:
    """Adversarial events and SECURITY_REJECTED tensions require strong
    resolution (CORRECTION or RECEIPT_SUCCESS only; ALIGNED restatement
    is NOT enough)."""
    if event.kind == EventKind.SECURITY_REJECTED.value:
        return True
    return _is_adversarial(event)


def _sum_z(events: Sequence[MemoryEvent]) -> float:
    return float(sum(e.z_contribution for e in events))


def _format_summary_text(
    pattern_phrase: str,
    *,
    center_id: str,
    n_events: int,
) -> str:
    """Build a deterministic, audit-friendly summary_text bounded to 280 chars."""
    text = f"{pattern_phrase} for {center_id} over {n_events} events"
    if len(text) > 280:
        text = text[:277] + "..."
    return text


def _deterministic_summary_id(
    *,
    pattern_name: str,
    buffer_center_id: str,
    buffer_perspective: str,
    source_event_ids: Sequence[str],
    resolved_event_ids: Sequence[str],
    archived_event_ids: Sequence[str],
    z_reduction: float,
    seed: int,
) -> str:
    """Hash inputs to a UUID-shaped id. Same inputs -> same id; seed enters
    the hash so different seeds produce different ids for the same content.
    """
    parts = [
        "level3_research.summary_policy.v1",
        pattern_name,
        buffer_center_id,
        buffer_perspective,
        "|".join(source_event_ids),
        "|".join(resolved_event_ids),
        "|".join(archived_event_ids),
        f"{z_reduction:.10f}",
        str(int(seed)),
    ]
    raw = "::".join(parts)
    h = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


# ---------------------------------------------------------------------------
# Policy
# ---------------------------------------------------------------------------


class DeterministicSummaryPolicyV1:
    """The v1 deterministic summary policy."""

    POLICY_VERSION = POLICY_VERSION
    MIN_ACTIVE_EVENTS = 3

    def should_summarize(self, buffer: CenterEventBuffer) -> bool:
        """Quick gate: returns True iff at least one admissible pattern
        fits the buffer. Catches every NoSummaryCandidate case silently."""
        try:
            self._validate_buffer(buffer)
        except (NoSummaryCandidate, ValueError, TypeError):
            return False
        return self._detect_pattern(buffer) is not None

    def build_summary(
        self,
        buffer: CenterEventBuffer,
        *,
        summary_id_seed: int,
        episode_index: Optional[int] = None,
    ) -> SummaryEvent:
        """Build a SummaryEvent from the buffer's active events.

        Raises:
            NoSummaryCandidate: if the buffer state is invalid or no
              admissible pattern fits.
            TypeError: if the inputs have wrong types.
        """
        if not isinstance(buffer, CenterEventBuffer):
            raise TypeError(
                "build_summary: buffer must be CenterEventBuffer, got "
                f"{type(buffer).__name__}"
            )
        if not isinstance(summary_id_seed, int):
            raise TypeError(
                "build_summary: summary_id_seed must be int, got "
                f"{type(summary_id_seed).__name__}"
            )

        self._validate_buffer(buffer)
        pattern = self._detect_pattern(buffer)
        if pattern is None:
            raise NoSummaryCandidate(
                f"deterministic_v1: no admissible summary pattern fits "
                f"buffer {buffer.center_id!r}/{buffer.perspective!r} "
                f"({buffer.active_count()} active events)"
            )
        return self._materialize(
            buffer,
            pattern,
            summary_id_seed=summary_id_seed,
            episode_index=episode_index,
        )

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    def _validate_buffer(self, buffer: CenterEventBuffer) -> None:
        if not isinstance(buffer, CenterEventBuffer):
            raise TypeError(
                "buffer must be CenterEventBuffer, got "
                f"{type(buffer).__name__}"
            )

        active = buffer.active_events()
        if len(active) < self.MIN_ACTIVE_EVENTS:
            raise NoSummaryCandidate(
                f"need at least {self.MIN_ACTIVE_EVENTS} active events "
                f"to summarise (have {len(active)})"
            )

        # All events on the same (center_id, perspective).
        cids = {e.center_id for e in active}
        prs = {e.perspective for e in active}
        if len(cids) != 1 or len(prs) != 1:
            raise NoSummaryCandidate(
                "buffer has mixed center_id or perspective among active "
                f"events: cids={sorted(cids)} prs={sorted(prs)}"
            )

        # Center / perspective must match the buffer itself.
        only_cid = next(iter(cids))
        only_p = next(iter(prs))
        if only_cid != buffer.center_id:
            raise NoSummaryCandidate(
                f"active event center_id {only_cid!r} does not match "
                f"buffer.center_id {buffer.center_id!r}"
            )
        if only_p != buffer.perspective:
            raise NoSummaryCandidate(
                f"active event perspective {only_p!r} does not match "
                f"buffer.perspective {buffer.perspective!r}"
            )
        if only_p not in {p.value for p in PERSPECTIVES_V1}:
            raise NoSummaryCandidate(
                f"perspective {only_p!r} is not in the v1 admitted set"
            )

        # Every active event has provenance.
        for e in active:
            if e.provenance is None or not e.provenance.is_valid():
                raise NoSummaryCandidate(
                    f"event {e.event_id!r} has missing or invalid "
                    f"provenance"
                )

        # The LAST active event must NOT be a tension event — that would
        # mean the conflict is still open at the head of the buffer.
        if active[-1].kind in _TENSION_KINDS:
            raise NoSummaryCandidate(
                "buffer ends with an unresolved tension event "
                f"({active[-1].kind})"
            )

        # An adversarial event anywhere in the active set MUST have a
        # strong resolution AFTER it. If we cannot find one, refuse.
        for i, e in enumerate(active):
            if not _requires_strong_resolution(e):
                continue
            has_strong_after = any(
                a.kind in _STRONG_RESOLUTION_KINDS
                for a in active[i + 1:]
            )
            if not has_strong_after:
                raise NoSummaryCandidate(
                    "buffer contains an adversarial / security-rejected "
                    f"event {e.event_id!r} without a subsequent CORRECTION "
                    f"or RECEIPT_SUCCESS"
                )

    # ------------------------------------------------------------------
    # Pattern detection (priority A > B > C)
    # ------------------------------------------------------------------

    def _detect_pattern(
        self, buffer: CenterEventBuffer
    ) -> Optional[_CandidatePattern]:
        active = buffer.active_events()

        pat = self._detect_correction_chain(buffer, active)
        if pat is not None:
            return pat

        pat = self._detect_receipt_chain(buffer, active)
        if pat is not None:
            return pat

        pat = self._detect_stable_pattern(buffer, active)
        if pat is not None:
            return pat

        return None

    def _detect_correction_chain(
        self,
        buffer: CenterEventBuffer,
        active: Tuple[MemoryEvent, ...],
    ) -> Optional[_CandidatePattern]:
        # First tension event index.
        tension_idx = None
        for i, e in enumerate(active):
            if e.kind in _TENSION_KINDS:
                tension_idx = i
                break
        if tension_idx is None:
            return None
        tension = active[tension_idx]
        # Choose resolution-kind set based on whether the tension is
        # adversarial / security-rejected.
        allowed = (
            _STRONG_RESOLUTION_KINDS
            if _requires_strong_resolution(tension)
            else _WEAK_RESOLUTION_KINDS
        )
        # First resolution event AFTER the tension.
        resolution_idx = None
        for j in range(tension_idx + 1, len(active)):
            if active[j].kind in allowed:
                resolution_idx = j
                break
        if resolution_idx is None:
            return None
        chain = active[: resolution_idx + 1]
        if len(chain) < self.MIN_ACTIVE_EVENTS:
            return None
        z_red = _sum_z(chain)
        if z_red <= 0.0:
            return None
        source_ids = tuple(e.event_id for e in chain)
        text = _format_summary_text(
            "resolved correction chain",
            center_id=buffer.center_id,
            n_events=len(chain),
        )
        return _CandidatePattern(
            pattern_name="correction_chain",
            source_event_ids=source_ids,
            resolved_event_ids=source_ids,
            archived_event_ids=(),
            z_reduction=z_red,
            summary_text=text,
            tombstone_reason=REASON_CORRECTION,
        )

    def _detect_receipt_chain(
        self,
        buffer: CenterEventBuffer,
        active: Tuple[MemoryEvent, ...],
    ) -> Optional[_CandidatePattern]:
        # First receipt-success / receipt-partial event.
        receipt_idx = None
        for i, e in enumerate(active):
            if e.kind in _RECEIPT_RESOLUTION_KINDS:
                receipt_idx = i
                break
        if receipt_idx is None:
            return None
        chain = active[: receipt_idx + 1]
        if len(chain) < self.MIN_ACTIVE_EVENTS:
            return None
        # The chain must NOT contain a tension that isn't already
        # resolved by THIS receipt. We treat the receipt as the
        # resolution for any tension in [0..receipt_idx]. But if the
        # tension is adversarial / security-rejected, that case is
        # already captured by `_detect_correction_chain` (which has
        # priority A and runs first). So if we're here, no adversarial
        # is unresolved.
        z_red = _sum_z(chain)
        if z_red <= 0.0:
            return None
        source_ids = tuple(e.event_id for e in chain)
        text = _format_summary_text(
            "stable receipt chain",
            center_id=buffer.center_id,
            n_events=len(chain),
        )
        return _CandidatePattern(
            pattern_name="receipt_success_chain",
            source_event_ids=source_ids,
            resolved_event_ids=source_ids,
            archived_event_ids=(),
            z_reduction=z_red,
            summary_text=text,
            tombstone_reason=REASON_RECEIPT,
        )

    def _detect_stable_pattern(
        self,
        buffer: CenterEventBuffer,
        active: Tuple[MemoryEvent, ...],
    ) -> Optional[_CandidatePattern]:
        # All active events must be ALIGNED (the stable kind). One
        # tension anywhere in the window disqualifies the pattern.
        if not all(e.kind in _STABLE_KINDS for e in active):
            return None
        if len(active) < self.MIN_ACTIVE_EVENTS:
            return None
        z_red = _sum_z(active)
        if z_red <= 0.0:
            return None
        # The NEWEST event is the canonical stable representation
        # (RESOLVED). Older redundant copies are ARCHIVED.
        source_ids = tuple(e.event_id for e in active)
        newest = active[-1]
        older = active[:-1]
        resolved_ids = (newest.event_id,)
        archived_ids = tuple(e.event_id for e in older)
        text = _format_summary_text(
            "stable expression pattern",
            center_id=buffer.center_id,
            n_events=len(active),
        )
        return _CandidatePattern(
            pattern_name="expression_pattern_stable",
            source_event_ids=source_ids,
            resolved_event_ids=resolved_ids,
            archived_event_ids=archived_ids,
            z_reduction=z_red,
            summary_text=text,
            tombstone_reason=REASON_STABLE_PATTERN,
        )

    # ------------------------------------------------------------------
    # Materialisation
    # ------------------------------------------------------------------

    def _materialize(
        self,
        buffer: CenterEventBuffer,
        pattern: _CandidatePattern,
        *,
        summary_id_seed: int,
        episode_index: Optional[int],
    ) -> SummaryEvent:
        summary_id = _deterministic_summary_id(
            pattern_name=pattern.pattern_name,
            buffer_center_id=buffer.center_id,
            buffer_perspective=buffer.perspective,
            source_event_ids=pattern.source_event_ids,
            resolved_event_ids=pattern.resolved_event_ids,
            archived_event_ids=pattern.archived_event_ids,
            z_reduction=pattern.z_reduction,
            seed=summary_id_seed,
        )

        active = buffer.active_events()
        first_active = active[0]
        latest_active = active[-1]
        transcript_id = (
            first_active.provenance.transcript_id
            if first_active.provenance is not None
            else "unknown_transcript"
        )

        produced_at_ts = latest_active.ts
        produced_at_turn = (
            episode_index
            if episode_index is not None
            else (
                latest_active.provenance.turn_index
                if latest_active.provenance is not None
                else -1
            )
        )

        provenance = SummaryProvenance(
            policy_version=POLICY_VERSION,
            parent_summary_id=None,
            produced_at_ts=produced_at_ts,
            produced_at_turn=produced_at_turn,
            transcript_id=transcript_id,
            seed=int(summary_id_seed),
        )

        rcs = RollingCenterSummary(
            summary_id=summary_id,
            center_id=buffer.center_id,
            perspective=buffer.perspective,
            summary_text=pattern.summary_text,
            source_event_ids=list(pattern.source_event_ids),
            resolved_event_ids=list(pattern.resolved_event_ids),
            archived_event_ids=list(pattern.archived_event_ids),
            z_reduction=pattern.z_reduction,
            provenance=provenance,
        )

        # Build one TombstoneRef per archived id.
        # Find each archived event so we can record its ts and turn.
        events_by_id = {e.event_id: e for e in buffer.events()}
        tombstones: List[TombstoneRef] = []
        for aid in pattern.archived_event_ids:
            e = events_by_id.get(aid)
            archived_at_ts = e.ts if e is not None else produced_at_ts
            archived_at_turn = (
                e.provenance.turn_index
                if (e is not None and e.provenance is not None)
                else produced_at_turn
            )
            recovery_path = (
                f"level3-research/archive/{buffer.perspective}/"
                f"{buffer.center_id}/{aid}.json"
            )
            tombstones.append(
                TombstoneRef(
                    archived_event_id=aid,
                    archived_at_ts=archived_at_ts,
                    recovery_path=recovery_path,
                    reason=pattern.tombstone_reason,
                    summary_id=summary_id,
                    archived_at_turn=int(archived_at_turn),
                    source_event_ids=tuple(pattern.source_event_ids),
                )
            )

        return SummaryEvent(summary=rcs, tombstone_pointers=tombstones)
