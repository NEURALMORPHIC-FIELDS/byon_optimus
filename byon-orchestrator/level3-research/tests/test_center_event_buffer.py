"""Tests for `CenterEventBuffer` helpers.

Required test cases (operator-locked for commit 2):

  1. append valid event
  2. reject duplicate event_id
  3. reject wrong center_id
  4. reject wrong perspective
  5. archive single event
  6. archive multiple events
  7. archive requires reason
  8. archive nonexistent event rejected
  9. eviction archives old events, does not delete them
 10. snapshot/from_snapshot roundtrip exact
 11. active + archived partition covers all events
 12. provenance remains recoverable after archive

Plus a few extras (atomic archive_events, idempotent archive, age-based
eviction, archive_path stability).
"""

from __future__ import annotations

import uuid
from typing import Optional

import pytest

from schemas import (
    CenterEventBuffer,
    EventKind,
    MemoryEvent,
    Perspective,
    ProvenanceRecord,
    ResolutionStatus,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _provenance(turn_index: int = 0) -> ProvenanceRecord:
    return ProvenanceRecord(
        channel="harness",
        thread_id="research-thread-1",
        source="transcript_A_byon_arch",
        turn_index=turn_index,
        transcript_id="transcript_A_byon_arch",
        seed=42,
    )


def _make_event(
    *,
    center_id: str = "factual::macp_pipeline",
    perspective: str = Perspective.FACTUAL.value,
    kind: str = EventKind.ALIGNED.value,
    text: str = "Worker plans; Auditor signs; Executor air-gap.",
    turn_index: int = 0,
    z_contribution: float = 0.0,
    provenance: Optional[ProvenanceRecord] = None,
) -> MemoryEvent:
    return MemoryEvent(
        event_id=str(uuid.uuid4()),
        center_id=center_id,
        perspective=perspective,
        ts=f"2026-05-12T17:00:{turn_index:02d}.000000Z",
        kind=kind,
        text=text,
        embedding=None,
        provenance=provenance if provenance is not None else _provenance(turn_index),
        z_contribution=z_contribution,
    )


def _empty_buffer(
    *,
    center_id: str = "factual::macp_pipeline",
    perspective: str = Perspective.FACTUAL.value,
    max_events: int = 1024,
    max_age_seconds: Optional[int] = None,
) -> CenterEventBuffer:
    return CenterEventBuffer(
        center_id=center_id,
        perspective=perspective,
        max_events=max_events,
        max_age_seconds=max_age_seconds,
    )


# ---------------------------------------------------------------------------
# Required tests (1–12)
# ---------------------------------------------------------------------------


def test_01_append_valid_event() -> None:
    """1. Appending a well-formed event makes it available via events()."""
    buf = _empty_buffer()
    ev = _make_event(turn_index=0)

    buf.append(ev)

    assert len(buf) == 1
    assert buf.events() == (ev,)
    assert buf.active_events() == (ev,)
    assert buf.archived_events() == ()
    assert ev.event_id in buf
    assert buf.get(ev.event_id) is ev


def test_02_reject_duplicate_event_id() -> None:
    """2. Appending the same event_id twice is rejected."""
    buf = _empty_buffer()
    ev = _make_event()
    buf.append(ev)

    # Build a second event with the SAME id but otherwise valid.
    dup = MemoryEvent(
        event_id=ev.event_id,
        center_id=ev.center_id,
        perspective=ev.perspective,
        ts="2026-05-12T17:00:01.000000Z",
        kind=EventKind.ALIGNED.value,
        text="different text",
        provenance=_provenance(turn_index=1),
    )

    with pytest.raises(ValueError, match="duplicate event_id"):
        buf.append(dup)

    # Buffer must remain unchanged after the rejected append.
    assert len(buf) == 1
    assert buf.events() == (ev,)


def test_03_reject_wrong_center_id() -> None:
    """3. An event whose center_id != buffer.center_id is rejected."""
    buf = _empty_buffer(center_id="factual::macp_pipeline")
    wrong = _make_event(center_id="factual::other_center")

    with pytest.raises(ValueError, match="does not match buffer.center_id"):
        buf.append(wrong)

    assert len(buf) == 0


def test_04_reject_wrong_perspective() -> None:
    """4. An event whose perspective != buffer.perspective is rejected.

    The buffer is single-perspective by design — cross-perspective
    fan-out lives in a HIGHER layer that maintains one buffer per
    perspective.
    """
    buf = _empty_buffer(perspective=Perspective.FACTUAL.value)
    wrong = _make_event(perspective=Perspective.SECURITY_BOUNDARY.value)

    with pytest.raises(ValueError, match="does not match buffer.perspective"):
        buf.append(wrong)

    assert len(buf) == 0


def test_05_archive_single_event() -> None:
    """5. archive_event flips status to archived and fills metadata."""
    buf = _empty_buffer()
    ev = _make_event()
    buf.append(ev)

    archived = buf.archive_event(ev.event_id, reason="superseded_by_correction_chain")

    assert archived.resolution_status == ResolutionStatus.ARCHIVED.value
    assert archived.archived_at_ts is not None and archived.archived_at_ts != ""
    assert archived.archive_path is not None
    # Reason is recorded in tags so the rationale is auditable.
    assert any(t.startswith("archive_reason:") for t in archived.tags)
    assert any("superseded_by_correction_chain" in t for t in archived.tags)

    # The buffer's view reflects the flip.
    assert buf.archived_events() == (archived,)
    assert buf.active_events() == ()
    # Lookup by id returns the archived (replaced) row.
    assert buf.get(ev.event_id) is archived


def test_06_archive_multiple_events() -> None:
    """6. archive_events archives a batch atomically."""
    buf = _empty_buffer()
    events = [_make_event(turn_index=i) for i in range(5)]
    for e in events:
        buf.append(e)

    ids = [e.event_id for e in events[:3]]
    archived = buf.archive_events(ids, reason="receipt_success_resolved_batch")

    assert len(archived) == 3
    for a in archived:
        assert a.resolution_status == ResolutionStatus.ARCHIVED.value
        assert any("receipt_success_resolved_batch" in t for t in a.tags)

    # The other 2 remain active.
    active_ids = {e.event_id for e in buf.active_events()}
    assert active_ids == {events[3].event_id, events[4].event_id}


def test_07_archive_requires_reason() -> None:
    """7. archive_event/archive_events with empty reason is rejected."""
    buf = _empty_buffer()
    ev = _make_event()
    buf.append(ev)

    with pytest.raises(ValueError, match="non-empty string"):
        buf.archive_event(ev.event_id, reason="")
    with pytest.raises(ValueError, match="non-empty string"):
        buf.archive_event(ev.event_id, reason="   ")
    with pytest.raises(ValueError, match="non-empty string"):
        buf.archive_event(ev.event_id, reason=None)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="non-empty string"):
        buf.archive_events([ev.event_id], reason="")

    # The event must NOT have been archived on any of those failed calls.
    assert buf.active_events() == (ev,)
    assert buf.archived_events() == ()


def test_08_archive_nonexistent_event_rejected() -> None:
    """8. Archiving an unknown event_id raises KeyError."""
    buf = _empty_buffer()
    ev = _make_event()
    buf.append(ev)

    with pytest.raises(KeyError, match="is not in this buffer"):
        buf.archive_event("not-a-real-id", reason="just-checking")

    # archive_events is atomic: if ANY id is unknown, NOTHING is archived.
    with pytest.raises(KeyError, match="event_ids not in buffer"):
        buf.archive_events([ev.event_id, "also-unknown"], reason="batch-test")

    assert buf.active_events() == (ev,)
    assert buf.archived_events() == ()


def test_09_eviction_archives_old_events_not_deletes() -> None:
    """9. When the bound is exceeded, oldest active events become archived.

    Total event count after eviction MUST equal total events appended
    (no deletion). active_events() must drop to max_events; the rest
    are visible in archived_events().
    """
    buf = _empty_buffer(max_events=3)
    appended = []
    for i in range(5):
        e = _make_event(turn_index=i)
        appended.append(e)
        buf.append(e)

    # All 5 still present in storage; oldest 2 archived; newest 3 active.
    assert buf.total_count() == 5
    assert buf.active_count() == 3
    assert buf.archived_count() == 2

    archived_ids = [e.event_id for e in buf.archived_events()]
    active_ids = [e.event_id for e in buf.active_events()]
    assert archived_ids == [appended[0].event_id, appended[1].event_id]
    assert active_ids == [appended[2].event_id, appended[3].event_id, appended[4].event_id]

    # Eviction tags must reflect the bound reason.
    for a in buf.archived_events():
        assert any("evicted_by_buffer_bound" in t for t in a.tags)
        assert a.resolution_status == ResolutionStatus.ARCHIVED.value


def test_10_snapshot_from_snapshot_roundtrip_exact() -> None:
    """10. snapshot/from_snapshot roundtrip preserves every field exactly."""
    buf = _empty_buffer(max_events=4)
    for i in range(4):
        buf.append(_make_event(turn_index=i, z_contribution=0.5 + i * 0.1))

    # Archive one event so the snapshot exercises the archived path too.
    target_id = buf.events()[1].event_id
    buf.archive_event(target_id, reason="round-trip-test")

    snap = buf.snapshot()

    # Snapshot is a plain dict — JSON-friendly.
    import json
    reserialised = json.loads(json.dumps(snap))
    rebuilt = CenterEventBuffer.from_snapshot(reserialised)

    # Buffer-level scalars match.
    assert rebuilt.center_id == buf.center_id
    assert rebuilt.perspective == buf.perspective
    assert rebuilt.max_events == buf.max_events
    assert rebuilt.max_age_seconds == buf.max_age_seconds

    # Event-by-event equality (frozen dataclasses support __eq__).
    assert rebuilt.events() == buf.events()
    # Index is rebuilt correctly.
    for e in buf.events():
        assert rebuilt.get(e.event_id) == e


def test_11_active_archived_partition_covers_all_events() -> None:
    """11. active_events() ∪ archived_events() == events() ; intersection == ∅.

    MemoryEvent contains List fields (`embedding`, `tags`) which are
    unhashable, so we compare by `event_id` sets rather than object sets.
    The partition contract holds either way.
    """
    buf = _empty_buffer(max_events=10)
    for i in range(7):
        buf.append(_make_event(turn_index=i))
    # Archive 3 in the middle.
    mid_ids = [buf.events()[2].event_id, buf.events()[3].event_id, buf.events()[5].event_id]
    buf.archive_events(mid_ids, reason="manual-archive-partition-test")

    all_ids = {e.event_id for e in buf.events()}
    active_ids = {e.event_id for e in buf.active_events()}
    archived_ids = {e.event_id for e in buf.archived_events()}

    assert active_ids | archived_ids == all_ids, "union must cover all events"
    assert active_ids & archived_ids == set(), "active and archived must be disjoint"
    # Counts add up too.
    assert buf.active_count() + buf.archived_count() == buf.total_count() == 7
    # The mid_ids are exactly the archived set.
    assert archived_ids == set(mid_ids)


def test_12_provenance_remains_recoverable_after_archive() -> None:
    """12. Archive must NOT scrub provenance. L3-G7 / L3-G8 hold."""
    prov = _provenance(turn_index=42)
    buf = _empty_buffer()
    ev = _make_event(provenance=prov)
    buf.append(ev)
    buf.archive_event(ev.event_id, reason="prov-recoverable-test")

    archived = buf.get(ev.event_id)
    assert archived is not None
    assert archived.provenance is not None
    assert archived.provenance.channel == prov.channel
    assert archived.provenance.thread_id == prov.thread_id
    assert archived.provenance.source == prov.source
    assert archived.provenance.turn_index == prov.turn_index
    assert archived.provenance.transcript_id == prov.transcript_id
    assert archived.provenance.seed == prov.seed
    # Original text + ts also preserved.
    assert archived.text == ev.text
    assert archived.ts == ev.ts
    # Archive metadata is ADDITIVE; nothing original is lost.
    assert archived.archived_at_ts is not None
    assert archived.archive_path is not None


# ---------------------------------------------------------------------------
# Extras
# ---------------------------------------------------------------------------


def test_extra_idempotent_archive_no_double_tag() -> None:
    """Archiving an already-archived event is a no-op (idempotent).

    The audit trail captures the FIRST archive event; re-archiving the
    same row does NOT re-stamp `archived_at_ts` and does NOT add a
    second `archive_reason:` tag.
    """
    buf = _empty_buffer()
    ev = _make_event()
    buf.append(ev)

    first = buf.archive_event(ev.event_id, reason="first")
    second = buf.archive_event(ev.event_id, reason="second-call")

    assert first is second
    # exactly ONE archive_reason tag, NOT two
    assert sum(1 for t in second.tags if t.startswith("archive_reason:")) == 1
    assert "archive_reason:first" in second.tags
    assert "archive_reason:second-call" not in second.tags


def test_extra_archive_events_is_atomic_on_bad_id() -> None:
    """archive_events: if any id is unknown, NO events flip status."""
    buf = _empty_buffer()
    evs = [_make_event(turn_index=i) for i in range(3)]
    for e in evs:
        buf.append(e)

    bad_batch = [evs[0].event_id, evs[1].event_id, "phantom-id"]
    with pytest.raises(KeyError):
        buf.archive_events(bad_batch, reason="atomicity-test")

    # All three originals remain active.
    assert buf.active_count() == 3
    assert buf.archived_count() == 0


def test_extra_evict_age_based() -> None:
    """When max_age_seconds is set, old active events are archived on evict.

    We construct an event with a `ts` deep in the past so it deterministically
    exceeds the age bound.
    """
    buf = _empty_buffer(max_age_seconds=1)
    old = MemoryEvent(
        event_id=str(uuid.uuid4()),
        center_id=buf.center_id,
        perspective=buf.perspective,
        ts="2020-01-01T00:00:00.000000Z",   # well > 1 second old
        kind=EventKind.ALIGNED.value,
        text="very old",
        provenance=_provenance(turn_index=0),
    )
    buf.append(old)

    archived_ids = buf.evict_if_needed()
    assert old.event_id in archived_ids

    archived = buf.get(old.event_id)
    assert archived is not None
    assert archived.resolution_status == ResolutionStatus.ARCHIVED.value
    assert any("evicted_by_buffer_age" in t for t in archived.tags)


def test_extra_from_snapshot_rejects_unknown_schema_version() -> None:
    """from_snapshot rejects an unknown schema_version."""
    bad = {
        "schema_version": "level3-research.buffer.vXX",
        "center_id": "c1",
        "perspective": Perspective.FACTUAL.value,
        "max_events": 1024,
        "max_age_seconds": None,
        "events": [],
    }
    with pytest.raises(ValueError, match="unknown schema_version"):
        CenterEventBuffer.from_snapshot(bad)


def test_extra_from_snapshot_rejects_duplicate_event_ids() -> None:
    """from_snapshot rejects a snapshot with duplicate event ids."""
    e1 = _make_event(turn_index=0)
    buf = _empty_buffer()
    buf.append(e1)
    snap = buf.snapshot()
    # Inject a duplicate row into the events list.
    snap["events"].append(dict(snap["events"][0]))

    with pytest.raises(ValueError, match="duplicate event_id"):
        CenterEventBuffer.from_snapshot(snap)


def test_extra_append_requires_provenance() -> None:
    """append rejects events without a valid ProvenanceRecord (§C9)."""
    buf = _empty_buffer()
    # ProvenanceRecord with empty channel -> is_valid() == False
    bad_prov = ProvenanceRecord(
        channel="",
        thread_id="t1",
        source="s",
        turn_index=0,
        transcript_id="x",
        seed=42,
    )
    ev = _make_event(provenance=bad_prov)
    with pytest.raises(ValueError, match="mandatory provenance"):
        buf.append(ev)


def test_extra_total_count_includes_archived() -> None:
    """total_count = active_count + archived_count; never decreases."""
    buf = _empty_buffer(max_events=2)
    for i in range(5):
        buf.append(_make_event(turn_index=i))

    assert buf.total_count() == 5
    assert buf.active_count() == 2
    assert buf.archived_count() == 3
    assert buf.total_count() == buf.active_count() + buf.archived_count()
