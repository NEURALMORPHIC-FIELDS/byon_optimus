"""ZMetabolismRuntime — apply MemoryEvent / SummaryEvent over ZCounters.

This is the residue-accounting layer. It tracks per-(center_id, perspective)
Z counters:

    Z_total + Z_active + Z_resolved + Z_archived
    z_active + z_resolved + z_archived == z_total       (invariant)

It does NOT compute S_t. It does NOT call check_coagulation. It does NOT
register OmegaRecord. It does NOT detect PotentialOmegaCenter. It does NOT
mutate `OmegaRegistry`. It does NOT touch any production module.

Semantics (operator-locked for commit 4):

  apply_event(event):
    z_total    += event.z_contribution
    z_active   += event.z_contribution
    z_resolved unchanged
    z_archived unchanged

  apply_summary(summary_event):
    z_total    unchanged                   (history is never deleted)
    effective   = min(summary.z_reduction, z_active)   # clamp if needed
    z_active   -= effective
    # split `effective` between z_resolved / z_archived proportionally
    # to the counts of resolved-only vs archived events in the summary
    z_resolved += resolved_share
    z_archived += archived_share

  invariant_check:
    After every operation, ZCounters.conservation_holds() must be True
    (tolerance 1e-6 on float drift).

Idempotency: applying the same `event.event_id` twice raises ValueError.
Same for `summary.summary_id`. Duplicate application is a research-harness
bug, not a normal retry.
"""

from __future__ import annotations

import copy
import math
from dataclasses import replace
from typing import Any, Dict, List, Mapping, Optional, Set, Tuple, Union

from schemas import (
    MemoryEvent,
    Perspective,
    PERSPECTIVES_V1,
    SummaryEvent,
    ZCounters,
)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCHEMA_VERSION = "level3-research.z_runtime.v1"

_ADMITTED_PERSPECTIVES = frozenset(p.value for p in PERSPECTIVES_V1)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _normalize_perspective(perspective: Union[str, Perspective]) -> str:
    """Accept either a `Perspective` enum or a string; return the string value.

    Validates that the string belongs to the v1 admitted set (Q4).
    """
    if isinstance(perspective, Perspective):
        return perspective.value
    if not isinstance(perspective, str):
        raise TypeError(
            "perspective must be str or Perspective, got "
            f"{type(perspective).__name__}"
        )
    if perspective not in _ADMITTED_PERSPECTIVES:
        raise ValueError(
            f"perspective {perspective!r} not in v1 admitted set "
            f"{sorted(_ADMITTED_PERSPECTIVES)}"
        )
    return perspective


def _bucket_key(center_id: str, perspective: str) -> str:
    return f"{center_id}::{perspective}"


def _counters_to_dict(c: ZCounters) -> Dict[str, Any]:
    return {
        "center_id": c.center_id,
        "perspective": c.perspective,
        "z_total": c.z_total,
        "z_active": c.z_active,
        "z_resolved": c.z_resolved,
        "z_archived": c.z_archived,
        "last_updated_at_turn": c.last_updated_at_turn,
        "last_updated_at_ts": c.last_updated_at_ts,
    }


def _counters_from_dict(d: Mapping[str, Any]) -> ZCounters:
    """Reconstruct a ZCounters from a snapshot dict. ZCounters.__post_init__
    enforces the conservation invariant, so a malformed dict raises here.
    """
    return ZCounters(
        center_id=d["center_id"],
        perspective=d["perspective"],
        z_total=float(d["z_total"]),
        z_active=float(d["z_active"]),
        z_resolved=float(d["z_resolved"]),
        z_archived=float(d["z_archived"]),
        last_updated_at_turn=int(d.get("last_updated_at_turn", -1)),
        last_updated_at_ts=str(d.get("last_updated_at_ts", "")),
    )


def _split_z_reduction(
    effective: float,
    *,
    archived_count: int,
    resolved_only_count: int,
) -> Tuple[float, float]:
    """Split `effective` Z mass between (resolved_share, archived_share).

    Rules (deterministic, no randomness):
      - archived_count = 0 AND resolved_only_count = 0
          -> route all to resolved (defensive default; summary with
             z_reduction > 0 but no resolved/archived ids is unusual)
      - archived_count = 0
          -> all resolved
      - resolved_only_count = 0
          -> all archived
      - otherwise: proportional split by count, with
            archived_share = effective * (archived_count / total)
            resolved_share = effective - archived_share
        (subtraction-based so the two shares sum EXACTLY to `effective`
        in float arithmetic.)
    """
    total = archived_count + resolved_only_count
    if effective <= 0.0:
        return (0.0, 0.0)
    if total == 0:
        return (effective, 0.0)
    if archived_count == 0:
        return (effective, 0.0)
    if resolved_only_count == 0:
        return (0.0, effective)
    archived_share = effective * (archived_count / total)
    resolved_share = effective - archived_share
    return (resolved_share, archived_share)


# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------


class ZMetabolismRuntime:
    """Per-process Z accounting state. NOT thread-safe (single-thread harness)."""

    def __init__(self) -> None:
        self._counters: Dict[str, ZCounters] = {}
        self._applied_event_ids: Set[str] = set()
        self._applied_summary_ids: Set[str] = set()
        self._audit_log: List[Dict[str, Any]] = []

    # ------------------------------------------------------------------
    # Read-side
    # ------------------------------------------------------------------

    def counters_for(
        self,
        center_id: str,
        perspective: Union[str, Perspective],
    ) -> ZCounters:
        """Return the ZCounters for (center_id, perspective).

        Lazy-initialises to a zero-filled ZCounters if this bucket has
        not been touched yet.
        """
        if not center_id or not isinstance(center_id, str):
            raise ValueError("counters_for: center_id must be a non-empty string")
        p = _normalize_perspective(perspective)
        k = _bucket_key(center_id, p)
        if k not in self._counters:
            self._counters[k] = ZCounters(
                center_id=center_id,
                perspective=p,
                z_total=0.0,
                z_active=0.0,
                z_resolved=0.0,
                z_archived=0.0,
                last_updated_at_turn=-1,
                last_updated_at_ts="",
            )
        return self._counters[k]

    def b_t(
        self,
        center_id: str,
        perspective: Union[str, Perspective],
    ) -> float:
        """Return B_t = 1 / (1 + Z_active) for the given bucket.

        Uses Z_active ONLY, not Z_total. This is the load-bearing semantic
        change vs Level 2 (see design doc §4). Returns the value; does
        NOT call check_coagulation; does NOT compute S_t.
        """
        return self.counters_for(center_id, perspective).b_t()

    def audit_log(self) -> List[Dict[str, Any]]:
        """Return a deep copy of the audit log (so the caller cannot mutate
        the runtime's internal state)."""
        return copy.deepcopy(self._audit_log)

    @property
    def applied_event_ids(self) -> Set[str]:
        return set(self._applied_event_ids)

    @property
    def applied_summary_ids(self) -> Set[str]:
        return set(self._applied_summary_ids)

    # ------------------------------------------------------------------
    # Write-side: apply_event
    # ------------------------------------------------------------------

    def apply_event(self, event: MemoryEvent) -> ZCounters:
        """Apply a MemoryEvent to Z counters.

        Effects:
          z_total    += event.z_contribution
          z_active   += event.z_contribution
          z_resolved, z_archived: unchanged.

        Idempotency: re-applying the same `event_id` raises ValueError.

        Invariant: the new ZCounters satisfies conservation. The ZCounters
        constructor enforces this; if for any reason a violation slips
        through, RuntimeError is raised.
        """
        if not isinstance(event, MemoryEvent):
            raise TypeError(
                f"apply_event: event must be MemoryEvent, got "
                f"{type(event).__name__}"
            )
        if event.event_id in self._applied_event_ids:
            raise ValueError(
                "apply_event: duplicate event_id "
                f"{event.event_id!r} (research harness must not re-apply)"
            )
        if event.provenance is None or not event.provenance.is_valid():
            raise ValueError(
                "apply_event: event must carry a valid ProvenanceRecord"
            )

        delta = float(event.z_contribution)
        if math.isnan(delta) or math.isinf(delta):
            raise ValueError(
                f"apply_event: event.z_contribution must be finite, got {delta}"
            )
        if delta < 0.0:
            raise ValueError(
                f"apply_event: event.z_contribution must be >= 0, got {delta}"
            )

        p = _normalize_perspective(event.perspective)
        z_before = self.counters_for(event.center_id, p)

        new_counters = replace(
            z_before,
            z_total=z_before.z_total + delta,
            z_active=z_before.z_active + delta,
            # z_resolved, z_archived unchanged
            last_updated_at_turn=event.provenance.turn_index,
            last_updated_at_ts=event.ts,
        )

        invariant_ok = new_counters.conservation_holds()
        if not invariant_ok:
            # Should be unreachable: ZCounters.__post_init__ raises before
            # we get here. Keep the defensive branch + audit entry for
            # diagnostic clarity.
            raise RuntimeError(
                "apply_event: post-application invariant violated "
                f"for bucket {_bucket_key(event.center_id, p)!r}"
            )

        k = _bucket_key(event.center_id, p)
        self._counters[k] = new_counters
        self._applied_event_ids.add(event.event_id)
        self._audit_log.append({
            "operation_id": f"op_{len(self._audit_log):08d}",
            "operation_type": "apply_event",
            "center_id": event.center_id,
            "perspective": p,
            "z_before": _counters_to_dict(z_before),
            "z_after": _counters_to_dict(new_counters),
            "source_event_id": event.event_id,
            "summary_id": None,
            "clamped": False,
            "invariant_ok": invariant_ok,
            "ts": event.ts,
        })
        return new_counters

    # ------------------------------------------------------------------
    # Write-side: apply_summary
    # ------------------------------------------------------------------

    def apply_summary(self, summary_event: SummaryEvent) -> ZCounters:
        """Apply a SummaryEvent (wrapping a RollingCenterSummary) to Z counters.

        Effects:
          - z_total unchanged (history is never deleted)
          - z_active decreases by `effective = min(summary.z_reduction, z_active)`
          - the `effective` mass is split between z_resolved and z_archived
            proportionally to the count of resolved-only vs archived event ids
            on the summary

        Clamping: if `summary.z_reduction > z_active`, the call clamps to the
        available z_active and marks `clamped=True` in the audit log. The
        operation does NOT fail.

        Idempotency: re-applying the same `summary_id` raises ValueError.

        Invariant: the new ZCounters satisfies conservation (tolerance 1e-6).
        """
        if not isinstance(summary_event, SummaryEvent):
            raise TypeError(
                "apply_summary: summary_event must be SummaryEvent, got "
                f"{type(summary_event).__name__}"
            )
        s = summary_event.summary
        if s.summary_id in self._applied_summary_ids:
            raise ValueError(
                "apply_summary: duplicate summary_id "
                f"{s.summary_id!r} (research harness must not re-apply)"
            )

        z_reduction = float(s.z_reduction)
        if math.isnan(z_reduction) or math.isinf(z_reduction):
            raise ValueError(
                f"apply_summary: summary.z_reduction must be finite, got {z_reduction}"
            )
        if z_reduction < 0.0:
            # Should have been caught by RollingCenterSummary.__post_init__,
            # but keep the defensive check.
            raise ValueError(
                f"apply_summary: summary.z_reduction must be >= 0, got {z_reduction}"
            )

        p = _normalize_perspective(s.perspective)
        z_before = self.counters_for(s.center_id, p)

        # Clamp.
        clamped = z_reduction > z_before.z_active
        effective = min(z_reduction, z_before.z_active)

        # Split between resolved / archived buckets.
        archived_set = set(s.archived_event_ids)
        # resolved-only = resolved events NOT also in archived.
        resolved_only_set = set(s.resolved_event_ids) - archived_set
        resolved_share, archived_share = _split_z_reduction(
            effective,
            archived_count=len(archived_set),
            resolved_only_count=len(resolved_only_set),
        )

        # Determine which turn / ts this summary's ZCounters update belongs to.
        if s.provenance is not None and s.provenance.is_valid():
            turn = s.provenance.produced_at_turn
            ts = s.provenance.produced_at_ts
        else:
            turn = z_before.last_updated_at_turn
            ts = z_before.last_updated_at_ts

        new_counters = replace(
            z_before,
            # z_total unchanged
            z_active=z_before.z_active - effective,
            z_resolved=z_before.z_resolved + resolved_share,
            z_archived=z_before.z_archived + archived_share,
            last_updated_at_turn=turn,
            last_updated_at_ts=ts,
        )

        invariant_ok = new_counters.conservation_holds()
        if not invariant_ok:
            raise RuntimeError(
                "apply_summary: post-application invariant violated "
                f"for bucket {_bucket_key(s.center_id, p)!r}"
            )

        k = _bucket_key(s.center_id, p)
        self._counters[k] = new_counters
        self._applied_summary_ids.add(s.summary_id)
        self._audit_log.append({
            "operation_id": f"op_{len(self._audit_log):08d}",
            "operation_type": "apply_summary",
            "center_id": s.center_id,
            "perspective": p,
            "z_before": _counters_to_dict(z_before),
            "z_after": _counters_to_dict(new_counters),
            "source_event_id": None,
            "summary_id": s.summary_id,
            "clamped": clamped,
            "invariant_ok": invariant_ok,
            "effective_reduction": effective,
            "requested_reduction": z_reduction,
            "resolved_share": resolved_share,
            "archived_share": archived_share,
            "ts": ts,
        })
        return new_counters

    # ------------------------------------------------------------------
    # Serialisation
    # ------------------------------------------------------------------

    def snapshot(self) -> Dict[str, Any]:
        """Serialise the runtime to a JSON-friendly dict.

        Includes counters, applied event/summary ids, and the audit log.
        `from_snapshot` validates: schema_version, no duplicate applied
        ids, every counter satisfies the conservation invariant.
        """
        return {
            "schema_version": SCHEMA_VERSION,
            "counters": {
                k: _counters_to_dict(v) for k, v in self._counters.items()
            },
            "applied_event_ids": sorted(self._applied_event_ids),
            "applied_summary_ids": sorted(self._applied_summary_ids),
            "audit_log": copy.deepcopy(self._audit_log),
        }

    @classmethod
    def from_snapshot(cls, payload: Mapping[str, Any]) -> "ZMetabolismRuntime":
        """Reconstruct a ZMetabolismRuntime from a snapshot dict.

        Rejects:
          - unknown / missing schema_version
          - duplicate applied event_ids
          - duplicate applied summary_ids
          - any counter whose conservation invariant is violated (the
            ZCounters constructor enforces this and raises ValueError;
            we surface that)
        """
        if not isinstance(payload, Mapping):
            raise TypeError(
                "from_snapshot: payload must be a Mapping (dict)"
            )

        version = payload.get("schema_version")
        if version != SCHEMA_VERSION:
            raise ValueError(
                "from_snapshot: unknown schema_version "
                f"{version!r} (expected {SCHEMA_VERSION!r})"
            )

        ev_ids = list(payload.get("applied_event_ids", []) or [])
        sm_ids = list(payload.get("applied_summary_ids", []) or [])
        if len(ev_ids) != len(set(ev_ids)):
            seen, dup = set(), []
            for eid in ev_ids:
                if eid in seen:
                    dup.append(eid)
                seen.add(eid)
            raise ValueError(
                "from_snapshot: duplicate applied_event_ids: "
                f"{sorted(set(dup))}"
            )
        if len(sm_ids) != len(set(sm_ids)):
            seen, dup = set(), []
            for sid in sm_ids:
                if sid in seen:
                    dup.append(sid)
                seen.add(sid)
            raise ValueError(
                "from_snapshot: duplicate applied_summary_ids: "
                f"{sorted(set(dup))}"
            )

        rt = cls()
        for k, d in (payload.get("counters", {}) or {}).items():
            # ZCounters.__post_init__ validates conservation. A snapshot
            # whose counters do not conserve raises ValueError here, which
            # is what we want.
            zc = _counters_from_dict(d)
            # Re-derive the bucket key from the counters themselves and
            # check it matches the snapshot key, so a tampered snapshot
            # that mismatches keys cannot survive a roundtrip.
            derived = _bucket_key(zc.center_id, zc.perspective)
            if derived != k:
                raise ValueError(
                    "from_snapshot: counter key mismatch — snapshot key "
                    f"{k!r} does not match derived key {derived!r} from "
                    f"center_id / perspective"
                )
            rt._counters[k] = zc

        rt._applied_event_ids = set(ev_ids)
        rt._applied_summary_ids = set(sm_ids)
        rt._audit_log = copy.deepcopy(list(payload.get("audit_log", []) or []))
        return rt
