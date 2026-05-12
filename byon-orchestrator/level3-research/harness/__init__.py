"""LongNaturalTranscriptHarness for the Level 3 research package.

Replay-loop runner that integrates the previous research commits:

    transcript row
      -> deterministic projection (commit 3)
      -> CenterEventBuffer append (commit 2)
      -> ZMetabolismRuntime.apply_event (commit 4)
      -> DeterministicSummaryPolicyV1.build_summary (commit 5)
      -> ZMetabolismRuntime.apply_summary (commit 4)
      -> CenterEventBuffer.archive_event (option B: compress)
      -> PotentialOmegaDetector.observe_cycle (commit 6)
      -> per-cycle telemetry record

Public surface:

    class LongNaturalTranscriptHarness
        run_jsonl(path) -> dict
        run_rows(rows)  -> dict
        telemetry()     -> dict

    SCHEMA_VERSION
    METRIC_SOURCE  ("research_surrogate_v1_not_fce_production")

The harness does NOT call check_coagulation, does NOT create
OmegaRecord, does NOT mutate OmegaRegistry, does NOT import from
production paths, does NOT use LLM / embeddings. Every emitted
telemetry record is explicitly labelled as a research surrogate so
no outside reader can mistake it for a coagulation test result.
"""

from .runner import LongNaturalTranscriptHarness, SCHEMA_VERSION
from .telemetry import (
    METRIC_SOURCE,
    compute_ar_t,
    compute_kappa_t,
    compute_s_t,
    signal_to_dict,
    summary_event_to_dict,
)
from .audit import (
    L3_GATE_IDS,
    REPORT_VERSION,
    build_audit,
    render_json,
    render_markdown,
    write_reports,
)

__all__ = [
    "LongNaturalTranscriptHarness",
    "SCHEMA_VERSION",
    "METRIC_SOURCE",
    "compute_ar_t",
    "compute_kappa_t",
    "compute_s_t",
    "signal_to_dict",
    "summary_event_to_dict",
    # audit module
    "L3_GATE_IDS",
    "REPORT_VERSION",
    "build_audit",
    "render_json",
    "render_markdown",
    "write_reports",
]
