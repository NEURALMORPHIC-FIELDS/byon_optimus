"""Deterministic projection policy — v1.

Takes a transcript row (a dict from the JSONL transcript) and produces
a list of MemoryEvent objects, one per `(center_id, perspective)` pair
that the row projects into.

The v1 policy is DETERMINISTIC: same input + same seed yields the
same events (same event_ids, same centers, same kinds, same z values).
Same input + different seed yields different event_ids but identical
center/perspective/kind/z_contribution.

NO Omega creation. NO Z runtime metabolism. NO summaries. NO harness.
NO LLM. NO embeddings (yet). NO production imports.
"""

from .deterministic_projection import (
    PROJECTION_POLICY_VERSION,
    project_turn_to_events,
    detect_perspectives,
    derive_center_id,
    classify_event_kind,
    estimate_z_contribution,
    build_provenance,
    is_adversarial_text,
    source_text_hash,
)

__all__ = [
    "PROJECTION_POLICY_VERSION",
    "project_turn_to_events",
    "detect_perspectives",
    "derive_center_id",
    "classify_event_kind",
    "estimate_z_contribution",
    "build_provenance",
    "is_adversarial_text",
    "source_text_hash",
]
