"""Surrogate metrics + serialisation helpers for the Level 3 harness.

Surrogate metrics — research_surrogate_v1, NOT FCE production
==============================================================

This module computes three surrogate metrics PER cycle:

    ar_t    — alignment ratio over the current buffer's active events
    kappa_t — expression-pattern stability (dominant-kind share)
    s_t     — bounded function of (ar_t, kappa_t, b_t)

These are NOT the FCE-M production `S_t`, `AR`, or `κ` values. The harness
labels every emitted telemetry record with

    metric_source = "research_surrogate_v1_not_fce_production"

so an outside reader cannot accidentally interpret them as a coagulation
test result. Commit 7 explicitly does NOT claim natural coagulation.
Surrogate metrics are deterministic, bounded in [0, 1], and depend only
on the buffer's active event population at the moment of observation.

Definitions
-----------

    ar_t = aligned_count / (aligned_count + tension_count)
        where:
          aligned-like kinds: ALIGNED, CORRECTION, RECEIPT_SUCCESS,
                              RECEIPT_PARTIAL
          tension-like kinds: CONTESTED, TENSIONED, RECEIPT_FAILURE,
                              SECURITY_REJECTED
        empty active set -> ar_t = 1.0 (max-stable default)

    kappa_t = max_kind_count / total_kinds_count
        the dominant kind's share of the active population
        empty active set -> kappa_t = 1.0

    s_t = (ar_t + kappa_t + b_t) / 3.0
        arithmetic mean; bounded in [0, 1] when each component is

All three are deterministic functions of the buffer's active event
list. No clocks, no random, no LLM, no embeddings.

Serialisation helpers
---------------------

    summary_event_to_dict(se)    -> dict   (JSON-friendly)
    signal_to_dict(signal)       -> dict   (JSON-friendly)
"""

from __future__ import annotations

import dataclasses
from collections import Counter
from typing import Any, Dict, Iterable, Mapping, Sequence

from potential_omega import PotentialOmegaSignal
from schemas import EventKind, MemoryEvent, SummaryEvent


METRIC_SOURCE = "research_surrogate_v1_not_fce_production"


# ---------------------------------------------------------------------------
# Surrogate metric computation
# ---------------------------------------------------------------------------


_ALIGNED_LIKE_KINDS = frozenset({
    EventKind.ALIGNED.value,
    EventKind.CORRECTION.value,
    EventKind.RECEIPT_SUCCESS.value,
    EventKind.RECEIPT_PARTIAL.value,
})

_TENSION_LIKE_KINDS = frozenset({
    EventKind.CONTESTED.value,
    EventKind.TENSIONED.value,
    EventKind.RECEIPT_FAILURE.value,
    EventKind.SECURITY_REJECTED.value,
})


def compute_ar_t(active_events: Sequence[MemoryEvent]) -> float:
    """Surrogate alignment ratio. Bounded in [0, 1].

    Empty active set returns 1.0 (the maximally-stable default).
    """
    aligned = sum(1 for e in active_events if e.kind in _ALIGNED_LIKE_KINDS)
    tension = sum(1 for e in active_events if e.kind in _TENSION_LIKE_KINDS)
    total = aligned + tension
    if total == 0:
        return 1.0
    return aligned / total


def compute_kappa_t(active_events: Sequence[MemoryEvent]) -> float:
    """Surrogate expression-pattern stability: the dominant kind's share.
    Bounded in [0, 1].

    Empty active set returns 1.0.
    """
    if not active_events:
        return 1.0
    counts = Counter(e.kind for e in active_events)
    if not counts:
        return 1.0
    max_share = max(counts.values()) / sum(counts.values())
    # Clamp defensively (Counter sums are always >= max value, so result
    # is in [0, 1], but be paranoid about float rounding).
    if max_share < 0.0:
        return 0.0
    if max_share > 1.0:
        return 1.0
    return max_share


def compute_s_t(ar_t: float, kappa_t: float, b_t: float) -> float:
    """Surrogate signal strength: arithmetic mean of (ar_t, kappa_t, b_t).
    Bounded in [0, 1] when each input is in [0, 1].
    """
    val = (float(ar_t) + float(kappa_t) + float(b_t)) / 3.0
    if val < 0.0:
        return 0.0
    if val > 1.0:
        return 1.0
    return val


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------


def signal_to_dict(signal: PotentialOmegaSignal) -> Dict[str, Any]:
    """Convert a PotentialOmegaSignal into a JSON-friendly dict.

    Tuples become lists. Booleans pass through.
    """
    if not isinstance(signal, PotentialOmegaSignal):
        raise TypeError(
            f"signal_to_dict expects PotentialOmegaSignal, got "
            f"{type(signal).__name__}"
        )
    return {
        "signal_id": signal.signal_id,
        "center_id": signal.center_id,
        "perspective": signal.perspective,
        "window_size": signal.window_size,
        "s_trend": float(signal.s_trend),
        "ar_stability": float(signal.ar_stability),
        "kappa_stability": float(signal.kappa_stability),
        "z_active_trend": float(signal.z_active_trend),
        "b_t_trend": float(signal.b_t_trend),
        "confidence": float(signal.confidence),
        "reason": signal.reason,
        "source_cycle_ids": list(signal.source_cycle_ids),
        "advisory_only": bool(signal.advisory_only),
    }


def summary_event_to_dict(se: SummaryEvent) -> Dict[str, Any]:
    """Convert a SummaryEvent into a JSON-friendly dict.

    Includes provenance + tombstone pointers so the dict is a complete
    audit record (matches the schemas L3-G7 / L3-G8 contract).
    """
    if not isinstance(se, SummaryEvent):
        raise TypeError(
            f"summary_event_to_dict expects SummaryEvent, got "
            f"{type(se).__name__}"
        )
    s = se.summary
    prov = s.provenance
    return {
        "summary_id": s.summary_id,
        "center_id": s.center_id,
        "perspective": s.perspective,
        "summary_text": s.summary_text,
        "source_event_ids": list(s.source_event_ids),
        "resolved_event_ids": list(s.resolved_event_ids),
        "archived_event_ids": list(s.archived_event_ids),
        "z_reduction": float(s.z_reduction),
        "provenance": (
            {
                "policy_version": prov.policy_version,
                "parent_summary_id": prov.parent_summary_id,
                "produced_at_ts": prov.produced_at_ts,
                "produced_at_turn": prov.produced_at_turn,
                "transcript_id": prov.transcript_id,
                "seed": prov.seed,
            }
            if prov is not None
            else None
        ),
        "tombstone_pointers": [
            {
                "archived_event_id": t.archived_event_id,
                "archived_at_ts": t.archived_at_ts,
                "recovery_path": t.recovery_path,
                "reason": t.reason,
                "summary_id": t.summary_id,
                "archived_at_turn": t.archived_at_turn,
                "source_event_ids": list(t.source_event_ids),
            }
            for t in se.tombstone_pointers
        ],
    }
