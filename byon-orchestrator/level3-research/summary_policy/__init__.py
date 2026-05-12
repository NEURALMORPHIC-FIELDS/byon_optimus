"""Deterministic summary policy v1 for the Level 3 research package.

Produces `SummaryEvent` / `RollingCenterSummary` from a `CenterEventBuffer`
deterministically, so `ZMetabolismRuntime.apply_summary(...)` can reduce
`Z_active` without erasing `Z_total`.

Public surface:

    class DeterministicSummaryPolicyV1
        should_summarize(buffer) -> bool
        build_summary(buffer, *, summary_id_seed, episode_index=None)
            -> SummaryEvent
            (raises NoSummaryCandidate if no admissible pattern fits)

    class NoSummaryCandidate (ValueError)

NO LLM. NO embeddings. NO clustering. NO Omega creation. NO
check_coagulation. NO ReferenceField. NO PotentialOmega detection.
NO harness runner.

The policy admits exactly THREE patterns (operator-locked for v1):

  A. correction_chain
  B. receipt_success_chain
  C. expression_pattern_stable

See `deterministic_v1.py` for the precise detection rules.
"""

from .deterministic_v1 import (
    NoSummaryCandidate,
    DeterministicSummaryPolicyV1,
    POLICY_VERSION,
    REASON_CORRECTION,
    REASON_RECEIPT,
    REASON_STABLE_PATTERN,
)

__all__ = [
    "NoSummaryCandidate",
    "DeterministicSummaryPolicyV1",
    "POLICY_VERSION",
    "REASON_CORRECTION",
    "REASON_RECEIPT",
    "REASON_STABLE_PATTERN",
]
