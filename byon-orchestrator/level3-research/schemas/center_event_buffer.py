"""CenterEventBuffer — per-center bounded buffer of MemoryEvent records.

One CenterEventBuffer per `(center_id, perspective)` pair. Events are kept in
insertion order; the buffer's WORKING SET is bounded by `max_events`. When
an active event is evicted by the bound, it MUST be archived (not deleted)
to satisfy §C8. Archived events stay in the buffer's storage so that
`source_event_ids` and provenance remain recoverable per L3-G7 / L3-G8.

The buffer is the input to:

  - the deterministic summarisation policy (RollingCenterSummary)
  - the Z accounting (ZCounters)
  - the PotentialOmegaCenter detector (advisory only)
  - the existing FCE-M coagulation observer (`check_coagulation`) — fed via
    the same public API surface, unchanged

Operator constraints (commit 2 scope):

  - raw events are never deleted; archive flips `resolution_status` and
    fills `archived_at_ts` / `archive_path` on a frozen copy
  - duplicate `event_id` is rejected
  - center_id mismatch is rejected
  - perspective mismatch is rejected (this buffer is single-perspective)
  - archive requires a non-empty `reason`
  - archive of a non-existent event_id is rejected
  - eviction archives the OLDEST currently-active event; total event count
    never decreases (archived events remain in storage)
  - snapshot()/from_snapshot() roundtrip is exact

The class is mutable on purpose so the helper API matches a real
buffer (`append`, `archive_event`, etc.). The MemoryEvent rows it holds
remain frozen — archive operations produce a NEW immutable copy via
`dataclasses.replace`.

This module defines the buffer + helpers. The summarisation policy,
projection policy, Z metabolism, PotentialOmegaCenter detector, and
harness runner are subsequent commits — each gated on a separate
operator confirmation.
"""

from __future__ import annotations

import copy
import dataclasses
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

from .memory_event import MemoryEvent, ProvenanceRecord, ResolutionStatus


_ARCHIVED = ResolutionStatus.ARCHIVED.value


def _utc_now_iso() -> str:
    """Deterministic UTC ISO-8601 timestamp string (sub-second precision).

    Wrapped here so tests can monkeypatch it if needed.
    """
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _provenance_to_dict(p: Optional[ProvenanceRecord]) -> Optional[Dict[str, Any]]:
    if p is None:
        return None
    return dataclasses.asdict(p)


def _provenance_from_dict(d: Optional[Mapping[str, Any]]) -> Optional[ProvenanceRecord]:
    if d is None:
        return None
    return ProvenanceRecord(
        channel=d["channel"],
        thread_id=d["thread_id"],
        source=d["source"],
        turn_index=int(d["turn_index"]),
        transcript_id=d["transcript_id"],
        seed=int(d["seed"]),
    )


def _event_to_dict(e: MemoryEvent) -> Dict[str, Any]:
    return {
        "event_id": e.event_id,
        "center_id": e.center_id,
        "perspective": e.perspective,
        "ts": e.ts,
        "kind": e.kind,
        "text": e.text,
        "embedding": list(e.embedding) if e.embedding is not None else None,
        "provenance": _provenance_to_dict(e.provenance),
        "z_contribution": float(e.z_contribution),
        "resolution_status": e.resolution_status,
        "resolved_by_summary_id": e.resolved_by_summary_id,
        "archived_at_ts": e.archived_at_ts,
        "archive_path": e.archive_path,
        "tags": list(e.tags),
    }


def _event_from_dict(d: Mapping[str, Any]) -> MemoryEvent:
    return MemoryEvent(
        event_id=d["event_id"],
        center_id=d["center_id"],
        perspective=d["perspective"],
        ts=d["ts"],
        kind=d["kind"],
        text=d["text"],
        embedding=list(d["embedding"]) if d.get("embedding") is not None else None,
        provenance=_provenance_from_dict(d.get("provenance")),
        z_contribution=float(d.get("z_contribution", 0.0)),
        resolution_status=d.get("resolution_status", ResolutionStatus.UNRESOLVED.value),
        resolved_by_summary_id=d.get("resolved_by_summary_id"),
        archived_at_ts=d.get("archived_at_ts"),
        archive_path=d.get("archive_path"),
        tags=list(d.get("tags", [])),
    )


@dataclass
class CenterEventBuffer:
    """A per-center ring of raw MemoryEvents.

    Bounds:

      - `max_events` — hard upper bound on how many ACTIVE (not-archived)
        events the buffer retains. Default 1024. When the active count
        would exceed this on `append`, the oldest active event is archived
        (its payload remains in `_events`).
      - `max_age_seconds` — optional; events older than this MAY be archived
        on `evict_if_needed`. Default None (no age bound; only event-count
        bound). The age check is wall-clock, in seconds, against
        `MemoryEvent.ts` parsed as ISO-8601.

    The class is mutable so the helper surface (`append`, `archive_event`,
    ...) matches a real buffer. The events themselves are frozen
    `MemoryEvent` instances; archive operations create a new frozen copy
    via `dataclasses.replace` and substitute it at the same position.
    """

    center_id: str
    perspective: str
    max_events: int = 1024
    max_age_seconds: Optional[int] = None

    # Internal storage. Insertion order is preserved. `_events` holds every
    # event ever appended; archived events stay here with their flipped
    # resolution_status. `_index` maps event_id -> position in `_events`
    # for O(1) lookup during archive operations.
    _events: List[MemoryEvent] = field(default_factory=list, repr=False)
    _index: Dict[str, int] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
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
        # Rebuild the index if events were supplied via `_events=[...]`
        # (used by `from_snapshot`). Otherwise `_index` stays empty.
        if self._events and not self._index:
            self._index = {e.event_id: i for i, e in enumerate(self._events)}

    # ------------------------------------------------------------------
    # Read-side helpers
    # ------------------------------------------------------------------

    def events(self) -> Tuple[MemoryEvent, ...]:
        """Return ALL events in insertion order (active + archived).

        Returned as a tuple so callers cannot mutate the buffer's
        internal list through this handle.
        """
        return tuple(self._events)

    def active_events(self) -> Tuple[MemoryEvent, ...]:
        """Return events whose `resolution_status` is NOT 'archived'."""
        return tuple(e for e in self._events if e.resolution_status != _ARCHIVED)

    def archived_events(self) -> Tuple[MemoryEvent, ...]:
        """Return events whose `resolution_status` IS 'archived'."""
        return tuple(e for e in self._events if e.resolution_status == _ARCHIVED)

    def active_count(self) -> int:
        return sum(1 for e in self._events if e.resolution_status != _ARCHIVED)

    def archived_count(self) -> int:
        return sum(1 for e in self._events if e.resolution_status == _ARCHIVED)

    def total_count(self) -> int:
        return len(self._events)

    def __len__(self) -> int:
        return len(self._events)

    def __contains__(self, event_id: object) -> bool:
        return isinstance(event_id, str) and event_id in self._index

    def get(self, event_id: str) -> Optional[MemoryEvent]:
        """Return the event with `event_id`, or None if not present."""
        pos = self._index.get(event_id)
        if pos is None:
            return None
        return self._events[pos]

    # ------------------------------------------------------------------
    # Write-side helpers
    # ------------------------------------------------------------------

    def append(self, event: MemoryEvent) -> None:
        """Append a new event to the buffer.

        Validates:
          - `event.event_id` is not already present (duplicate rejected).
          - `event.center_id == self.center_id` (mismatch rejected).
          - `event.perspective == self.perspective` (mismatch rejected).
          - `event.provenance` is present and valid (§C9).

        After append, calls `evict_if_needed()` so the active working set
        stays bounded.
        """
        if not isinstance(event, MemoryEvent):
            raise TypeError(
                f"CenterEventBuffer.append expects a MemoryEvent, got "
                f"{type(event).__name__}"
            )
        if event.event_id in self._index:
            raise ValueError(
                f"CenterEventBuffer.append: duplicate event_id {event.event_id!r}"
            )
        if event.center_id != self.center_id:
            raise ValueError(
                "CenterEventBuffer.append: event.center_id "
                f"{event.center_id!r} does not match buffer.center_id "
                f"{self.center_id!r}"
            )
        if event.perspective != self.perspective:
            raise ValueError(
                "CenterEventBuffer.append: event.perspective "
                f"{event.perspective!r} does not match buffer.perspective "
                f"{self.perspective!r}"
            )
        if event.provenance is None or not event.provenance.is_valid():
            raise ValueError(
                "CenterEventBuffer.append: event must carry a valid "
                "ProvenanceRecord (§C9 mandatory provenance)"
            )

        self._index[event.event_id] = len(self._events)
        self._events.append(event)
        # Append-time eviction is COUNT-BASED only (fast path, runs on
        # every write). Age-based eviction is the harness's job and lives
        # in `evict_if_needed()`. This separation lets a caller test the
        # age path explicitly without `append` having already archived
        # everything during its own auto-evict.
        self._evict_by_count()

    def archive_event(self, event_id: str, reason: str) -> MemoryEvent:
        """Archive a single event by id.

        - `reason` MUST be non-empty (operator constraint).
        - `event_id` MUST already be present (non-existent rejected).
        - Already-archived events are accepted as a no-op; the existing
          archive metadata is preserved (idempotent on the audit trail).

        Returns the archived (frozen) MemoryEvent.

        The archive operation:
          - flips `resolution_status` -> 'archived'
          - sets `archived_at_ts` to `_utc_now_iso()` if not already set
          - appends the reason to `tags` as `archive_reason:<reason>` so
            the rationale is auditable
          - sets `archive_path` to a stable, deterministic ref (the
            harness storage layer may override at run-time; see §C8)
        """
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError(
                "CenterEventBuffer.archive_event: reason must be a "
                "non-empty string (operator constraint, no silent archive)"
            )
        pos = self._index.get(event_id)
        if pos is None:
            raise KeyError(
                f"CenterEventBuffer.archive_event: event_id {event_id!r} "
                f"is not in this buffer"
            )

        current = self._events[pos]
        if current.resolution_status == _ARCHIVED:
            # Idempotent: do not mutate timestamps or re-tag, but return
            # the existing archived event so the caller's contract holds.
            return current

        archived_ts = _utc_now_iso()
        new_tags = list(current.tags)
        new_tags.append(f"archive_reason:{reason.strip()}")

        archived = replace(
            current,
            resolution_status=_ARCHIVED,
            archived_at_ts=archived_ts,
            archive_path=current.archive_path
            or f"level3-research/archive/{self.perspective}/{self.center_id}/{event_id}.json",
            tags=new_tags,
        )
        self._events[pos] = archived
        return archived

    def archive_events(self, event_ids: Iterable[str], reason: str) -> List[MemoryEvent]:
        """Archive multiple events with a shared reason.

        Validates ALL ids exist before mutating ANY of them so the
        operation is atomic (no partial archive on bad input). If any
        id is unknown, raises KeyError naming the first missing id.

        Returns the list of archived MemoryEvents in the same order as
        `event_ids` (with idempotent re-archives returning the existing
        archived row).
        """
        ids = list(event_ids)
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError(
                "CenterEventBuffer.archive_events: reason must be a "
                "non-empty string (operator constraint, no silent archive)"
            )
        missing = [eid for eid in ids if eid not in self._index]
        if missing:
            raise KeyError(
                "CenterEventBuffer.archive_events: event_ids not in buffer: "
                f"{missing}"
            )
        return [self.archive_event(eid, reason) for eid in ids]

    def evict_if_needed(self) -> List[str]:
        """Run BOTH count-based and age-based eviction.

        Returns the list of event_ids that were archived by THIS call
        (an empty list when nothing needed eviction). The list preserves
        archive order: count-based archives first, then age-based.

        Eviction reasons recorded in the archived event's tags:
          - `archive_reason:evicted_by_buffer_bound:max_events=<N>`
          - `archive_reason:evicted_by_buffer_age:max_age_seconds=<S>`

        Note: `append` calls `_evict_by_count` automatically so the
        count bound is enforced on every write. Age-based eviction does
        NOT run during `append` — call `evict_if_needed` explicitly
        when you want the time bound checked.
        """
        archived_now: List[str] = []
        archived_now.extend(self._evict_by_count())
        archived_now.extend(self._evict_by_age())
        return archived_now

    def _evict_by_count(self) -> List[str]:
        """Archive oldest active events until active_count <= max_events."""
        archived_now: List[str] = []
        excess = self.active_count() - self.max_events
        if excess <= 0:
            return archived_now
        reason = f"evicted_by_buffer_bound:max_events={self.max_events}"
        for e in list(self._events):
            if excess <= 0:
                break
            if e.resolution_status != _ARCHIVED:
                self.archive_event(e.event_id, reason)
                archived_now.append(e.event_id)
                excess -= 1
        return archived_now

    def _evict_by_age(self) -> List[str]:
        """Archive active events whose `ts` exceeds `max_age_seconds`.

        Best-effort: events whose `ts` cannot be parsed as ISO-8601 are
        silently skipped (no archive, no exception). No-op when
        `max_age_seconds is None`.
        """
        if self.max_age_seconds is None:
            return []
        archived_now: List[str] = []
        now = datetime.now(timezone.utc)
        reason = f"evicted_by_buffer_age:max_age_seconds={self.max_age_seconds}"
        for e in list(self._events):
            if e.resolution_status == _ARCHIVED:
                continue
            try:
                ts = e.ts.rstrip("Z")
                parsed = datetime.fromisoformat(ts).replace(tzinfo=timezone.utc)
            except (ValueError, AttributeError):
                continue
            age_sec = (now - parsed).total_seconds()
            if age_sec > self.max_age_seconds:
                self.archive_event(e.event_id, reason)
                archived_now.append(e.event_id)
        return archived_now

    # ------------------------------------------------------------------
    # Serialisation
    # ------------------------------------------------------------------

    def snapshot(self) -> Dict[str, Any]:
        """Serialise the buffer to a JSON-friendly dict.

        Roundtrip with `from_snapshot` is exact: every field of every
        event is preserved. The dict is deep-copied at the boundary so
        downstream mutations do not leak back into the buffer.
        """
        return {
            "schema_version": "level3-research.buffer.v1",
            "center_id": self.center_id,
            "perspective": self.perspective,
            "max_events": self.max_events,
            "max_age_seconds": self.max_age_seconds,
            "events": [_event_to_dict(e) for e in self._events],
        }

    @classmethod
    def from_snapshot(cls, snap: Mapping[str, Any]) -> "CenterEventBuffer":
        """Reconstruct a CenterEventBuffer from a snapshot dict.

        Validates the schema_version. Rebuilds the index from the events
        list. Raises ValueError on malformed input.
        """
        if not isinstance(snap, Mapping):
            raise TypeError(
                "CenterEventBuffer.from_snapshot: snap must be a Mapping"
            )
        version = snap.get("schema_version")
        if version != "level3-research.buffer.v1":
            raise ValueError(
                "CenterEventBuffer.from_snapshot: unknown schema_version "
                f"{version!r} (expected 'level3-research.buffer.v1')"
            )
        snap = copy.deepcopy(dict(snap))   # defensive: do not alias caller state

        events_raw = snap.get("events", [])
        if not isinstance(events_raw, list):
            raise ValueError(
                "CenterEventBuffer.from_snapshot: 'events' must be a list"
            )
        events = [_event_from_dict(e) for e in events_raw]

        # Detect duplicate ids in the snapshot (would otherwise produce a
        # silently-broken index after construction).
        seen = set()
        for e in events:
            if e.event_id in seen:
                raise ValueError(
                    "CenterEventBuffer.from_snapshot: duplicate event_id "
                    f"{e.event_id!r} in snapshot"
                )
            seen.add(e.event_id)

        return cls(
            center_id=snap["center_id"],
            perspective=snap["perspective"],
            max_events=int(snap.get("max_events", 1024)),
            max_age_seconds=(
                int(snap["max_age_seconds"])
                if snap.get("max_age_seconds") is not None
                else None
            ),
            _events=events,
            _index={e.event_id: i for i, e in enumerate(events)},
        )
