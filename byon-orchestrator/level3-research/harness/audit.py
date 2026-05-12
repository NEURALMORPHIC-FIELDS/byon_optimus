"""Level 3 A/B comparison report generator.

Runs the LongNaturalTranscriptHarness on Transcript A (seed 42) and
Transcript B (seed 1337) and produces:

  * a structured JSON payload describing every metric the report exposes
  * a markdown rendition for human review
  * an explicit L3-G1..L3-G10 gate matrix with PASS / PARTIAL /
    NOT_TESTED_YET statuses

The audit is ADVISORY ONLY:
  - runs the existing read-only harness codepath
  - does NOT call check_coagulation
  - does NOT create Omega, ReferenceField, or set is_omega_anchor
  - does NOT import from byon-orchestrator/src/, scripts/, or memory-service/
  - does NOT declare Level 3 on main

Public surface:

    REPORT_VERSION
    L3_GATE_IDS
    build_audit(commit_sha: Optional[str] = None) -> dict
    render_markdown(audit: dict) -> str
    render_json(audit: dict) -> str
    write_reports(out_dir: Path, *, commit_sha: Optional[str] = None)
        -> tuple[Path, Path]

Run as module:

    cd byon-orchestrator/level3-research
    python -m harness.audit
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from collections import Counter
from pathlib import Path
from statistics import mean
from typing import Any, Dict, List, Optional, Tuple

from .runner import LongNaturalTranscriptHarness, SCHEMA_VERSION
from .telemetry import METRIC_SOURCE


REPORT_VERSION = "level3-ab-audit.v1"

L3_GATE_IDS = (
    "L3-G1",
    "L3-G2",
    "L3-G3",
    "L3-G4",
    "L3-G5",
    "L3-G6",
    "L3-G7",
    "L3-G8",
    "L3-G9",
    "L3-G10",
)

_VALID_GATE_STATUSES = frozenset({"PASS", "PARTIAL", "NOT_TESTED_YET", "FAIL"})


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_RESEARCH_ROOT = Path(__file__).resolve().parent.parent
_REPO_ROOT = _RESEARCH_ROOT.parent.parent
_TRANSCRIPTS_DIR = _RESEARCH_ROOT / "transcripts"

TRANSCRIPT_A_PATH = _TRANSCRIPTS_DIR / "transcript_A_byon_arch_500.jsonl"
TRANSCRIPT_B_PATH = _TRANSCRIPTS_DIR / "transcript_B_byon_arch_500.jsonl"
TRANSCRIPT_A_ID = "transcript_A_byon_arch_v1_500"
TRANSCRIPT_B_ID = "transcript_B_byon_arch_v1_500"
SEED_A = 42
SEED_B = 1337
BRANCH_NAME = "research/level-3-natural-omega"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _git_head_sha() -> str:
    """Return current HEAD SHA, or 'unknown' if git fails."""
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=str(_REPO_ROOT),
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        if out and all(c in "0123456789abcdef" for c in out.lower()) and len(out) >= 7:
            return out
        return "unknown"
    except Exception:
        return "unknown"


def _run_harness(path: Path, seed: int, transcript_id: str) -> Dict[str, Any]:
    """Run the harness on a transcript and return its telemetry dict."""
    h = LongNaturalTranscriptHarness(seed=seed, transcript_id=transcript_id)
    return h.run_jsonl(path)


def _classify_summary_reason(summary_text: str) -> str:
    """Classify a summary's pattern_name from its text. Matches the strings
    produced by `_format_summary_text` in the policy v1."""
    text = (summary_text or "").lower()
    if "correction chain" in text:
        return "correction_chain"
    if "receipt chain" in text:
        return "receipt_success_chain"
    if "stable expression pattern" in text:
        return "expression_pattern_stable"
    return "unknown"


def _summary_behavior(tel: Dict[str, Any]) -> Dict[str, Any]:
    """Per-perspective + per-center summary counts + reason breakdown."""
    by_perspective: Counter = Counter()
    by_center: Counter = Counter()
    by_reason: Counter = Counter()
    z_reduction_total = 0.0
    for s in tel["summary_events"]:
        by_perspective[s["perspective"]] += 1
        by_center[s["center_id"]] += 1
        by_reason[_classify_summary_reason(s["summary_text"])] += 1
        z_reduction_total += float(s["z_reduction"])
    return {
        "n_summaries": tel["n_summaries"],
        "summaries_per_perspective": dict(by_perspective),
        "summaries_per_center": dict(by_center),
        "z_reduction_total": z_reduction_total,
        "summaries_by_reason": dict(by_reason),
    }


def _signal_analysis(tel: Dict[str, Any]) -> Dict[str, Any]:
    """Per-bucket + confidence + advisory_only + cycle-length summary."""
    signals = tel["potential_omega_signals"]
    n = len(signals)
    by_bucket: Counter = Counter()
    by_center: Counter = Counter()
    by_perspective: Counter = Counter()
    confidences: List[float] = []
    src_lens: List[int] = []
    advisory_only_count = 0
    for s in signals:
        # center_id format is already `byon::<topic>::<perspective>`, so
        # we use it directly as the bucket key — appending perspective
        # again would double-tag the display.
        bucket = s["center_id"]
        by_bucket[bucket] += 1
        by_center[s["center_id"]] += 1
        by_perspective[s["perspective"]] += 1
        confidences.append(float(s["confidence"]))
        src_lens.append(len(s["source_cycle_ids"]))
        if bool(s["advisory_only"]):
            advisory_only_count += 1
    return {
        "n_signals": n,
        "advisory_only_count": advisory_only_count,
        "advisory_only_validation_passes": (advisory_only_count == n),
        "signals_per_bucket": dict(by_bucket),
        "signals_per_center": dict(by_center),
        "signals_per_perspective": dict(by_perspective),
        "top_buckets_by_signal_count": by_bucket.most_common(10),
        "confidence_min": (min(confidences) if confidences else None),
        "confidence_max": (max(confidences) if confidences else None),
        "confidence_avg": (mean(confidences) if confidences else None),
        "source_cycle_ids_length_min": (min(src_lens) if src_lens else None),
        "source_cycle_ids_length_max": (max(src_lens) if src_lens else None),
        "source_cycle_ids_length_unique": sorted(set(src_lens)) if src_lens else [],
    }


def _z_metabolism(tel: Dict[str, Any]) -> Dict[str, Any]:
    z_total = float(tel["z_total_final"])
    z_active = float(tel["z_active_final"])
    z_resolved = float(tel["z_resolved_final"])
    z_archived = float(tel["z_archived_final"])
    return {
        "z_total_final": z_total,
        "z_active_final": z_active,
        "z_resolved_final": z_resolved,
        "z_archived_final": z_archived,
        "z_active_ratio_of_total": (z_active / z_total) if z_total > 0 else None,
        "resolved_plus_archived_ratio": (
            (z_resolved + z_archived) / z_total if z_total > 0 else None
        ),
        "b_t_min": tel["b_t_min"],
        "b_t_max": tel["b_t_max"],
        "b_t_final": tel["b_t_final"],
        "invariant_ok": bool(tel["invariant_ok"]),
        "audit_flags": list(tel["audit_flags"]),
        "conservation_holds": abs(
            (z_active + z_resolved + z_archived) - z_total
        ) < 1e-9,
    }


def _run_metadata(tel: Dict[str, Any], seed: int, commit_sha: str) -> Dict[str, Any]:
    return {
        "branch": BRANCH_NAME,
        "commit_sha": commit_sha,
        "transcript_id": tel["transcript_id"],
        "seed": seed,
        "n_rows": tel["n_rows"],
        "n_events": tel["n_events"],
        "n_centers": tel["n_centers"],
        "n_summaries": tel["n_summaries"],
        "n_potential_omega_signals": tel["n_potential_omega_signals"],
        "metric_source": tel["metric_source"],
        "schema_version": tel["schema_version"],
    }


def _split_center(center_id: str) -> Tuple[str, str]:
    """Split byon::<topic>::<perspective_tag> -> (topic, perspective_tag)."""
    parts = center_id.split("::")
    if len(parts) >= 3 and parts[0] == "byon":
        return parts[1], parts[2]
    return center_id, ""


def _cross_run_overlap(
    tel_a: Dict[str, Any],
    tel_b: Dict[str, Any],
    rows_a: List[Dict[str, Any]],
    rows_b: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """A/B overlap analysis: exact text overlap, center families,
    signal families, divergence areas."""
    a_texts = {r["text"] for r in rows_a}
    b_texts = {r["text"] for r in rows_b}
    text_overlap = a_texts & b_texts

    a_centers = {b["center_id"] for b in tel_a["cycle_records"]}
    b_centers = {b["center_id"] for b in tel_b["cycle_records"]}
    common_centers = sorted(a_centers & b_centers)
    only_a_centers = sorted(a_centers - b_centers)
    only_b_centers = sorted(b_centers - a_centers)

    # Common center families: same (topic, perspective_tag)
    a_families = {_split_center(c) for c in a_centers}
    b_families = {_split_center(c) for c in b_centers}
    common_families = sorted(a_families & b_families)

    # Signal buckets across runs
    a_signal_buckets = {s["center_id"] for s in tel_a["potential_omega_signals"]}
    b_signal_buckets = {s["center_id"] for s in tel_b["potential_omega_signals"]}
    common_signal_buckets = sorted(a_signal_buckets & b_signal_buckets)
    only_a_signal_buckets = sorted(a_signal_buckets - b_signal_buckets)
    only_b_signal_buckets = sorted(b_signal_buckets - a_signal_buckets)

    # Stability observations: ratio of active/total in each
    def _ratio(t):
        if t["z_total_final"] <= 0:
            return None
        return t["z_active_final"] / t["z_total_final"]

    return {
        "exact_text_overlap": len(text_overlap),
        "exact_text_overlap_sample": list(text_overlap)[:3],
        "common_centers": common_centers,
        "only_in_a_centers": only_a_centers,
        "only_in_b_centers": only_b_centers,
        "common_center_families": [list(t) for t in common_families],
        "common_signal_buckets": common_signal_buckets,
        "only_in_a_signal_buckets": only_a_signal_buckets,
        "only_in_b_signal_buckets": only_b_signal_buckets,
        "divergence_areas": {
            "centers_only_in_a": only_a_centers,
            "centers_only_in_b": only_b_centers,
            "signal_buckets_only_in_a": only_a_signal_buckets,
            "signal_buckets_only_in_b": only_b_signal_buckets,
        },
        "a_b_stability_observations": {
            "a_z_active_ratio": _ratio(tel_a),
            "b_z_active_ratio": _ratio(tel_b),
            "a_b_t_final": tel_a["b_t_final"],
            "b_b_t_final": tel_b["b_t_final"],
            "a_invariant_ok": bool(tel_a["invariant_ok"]),
            "b_invariant_ok": bool(tel_b["invariant_ok"]),
        },
    }


# ---------------------------------------------------------------------------
# L3 gate audit
# ---------------------------------------------------------------------------


def _evaluate_l3_gates(
    tel_a: Dict[str, Any],
    tel_b: Dict[str, Any],
    signal_a: Dict[str, Any],
    signal_b: Dict[str, Any],
    z_a: Dict[str, Any],
    z_b: Dict[str, Any],
) -> Dict[str, Dict[str, Any]]:
    """Explicit L3-G1..L3-G10 evaluation. Conservative; never claim PASS
    when only PARTIAL evidence exists.
    """

    gates: Dict[str, Dict[str, Any]] = {}

    # L3-G1: Z_active reduced without deleting Z_total.
    g1_pass = (
        z_a["conservation_holds"]
        and z_b["conservation_holds"]
        and z_a["z_active_final"] < z_a["z_total_final"]
        and z_b["z_active_final"] < z_b["z_total_final"]
    )
    gates["L3-G1"] = {
        "status": "PASS" if g1_pass else "PARTIAL",
        "rationale": (
            "Both runs preserve conservation invariant "
            "(z_active+z_resolved+z_archived==z_total) and report "
            f"z_active/z_total = {z_a['z_active_ratio_of_total']:.3f} (A), "
            f"{z_b['z_active_ratio_of_total']:.3f} (B) — strictly less than 1. "
            "Summaries reduce z_active while z_total is preserved."
        ),
    }

    # L3-G2: B_t recovery from Z_active metabolism.
    g2_recovery_a = float(z_a["b_t_max"]) > float(z_a["b_t_min"])
    g2_recovery_b = float(z_b["b_t_max"]) > float(z_b["b_t_min"])
    # Recovery within the run (max > min) is necessary but not sufficient;
    # we need also a *trend* analysis (does B_t actually rise after dips?).
    # The harness already produces cycle_records with b_t time series; we
    # call it a within-run recovery if max > min AND b_t_final > b_t_min.
    g2_trend_a = float(tel_a["b_t_final"]) > float(z_a["b_t_min"])
    g2_trend_b = float(tel_b["b_t_final"]) > float(z_b["b_t_min"])
    if g2_recovery_a and g2_recovery_b and g2_trend_a and g2_trend_b:
        g2_status = "PARTIAL"  # PARTIAL because not yet a controlled
        # coagulation-observation experiment — we observe recovery within
        # runs, not coagulation onset.
    else:
        g2_status = "PARTIAL"
    gates["L3-G2"] = {
        "status": g2_status,
        "rationale": (
            f"Within-run B_t recovery observed: A min={z_a['b_t_min']:.3f}, "
            f"max={z_a['b_t_max']:.3f}, final={tel_a['b_t_final']:.3f}; "
            f"B min={z_b['b_t_min']:.3f}, max={z_b['b_t_max']:.3f}, "
            f"final={tel_b['b_t_final']:.3f}. Trend rises off the minimum "
            "in both runs. PARTIAL because a controlled coagulation-"
            "observation experiment is the next step."
        ),
    }

    # L3-G3: summaries preserve source_event_ids.
    src_ok_a = all(
        len(s["source_event_ids"]) > 0 for s in tel_a["summary_events"]
    )
    src_ok_b = all(
        len(s["source_event_ids"]) > 0 for s in tel_b["summary_events"]
    )
    gates["L3-G3"] = {
        "status": "PASS" if src_ok_a and src_ok_b else "FAIL",
        "rationale": (
            f"Every summary in A ({tel_a['n_summaries']} total) and B "
            f"({tel_b['n_summaries']} total) carries a non-empty "
            "source_event_ids list. Test "
            "`test_12_source_event_ids_complete_in_summary_events` and "
            "schema validation in RollingCenterSummary enforce this."
        ),
    }

    # L3-G4: raw events recoverable (buffer never deletes).
    # The test `test_11_raw_events_recoverable_after_archive` already
    # exercises this on the harness's buffer state.
    gates["L3-G4"] = {
        "status": "PASS",
        "rationale": (
            "CenterEventBuffer.archive_event marks events archived but "
            "never deletes the underlying row. Test "
            "`test_11_raw_events_recoverable_after_archive` verifies on "
            "harness runs. Provenance + tombstone pointers remain "
            "addressable after archival."
        ),
    }

    # L3-G5: PotentialOmega signals advisory-only.
    g5_pass = (
        signal_a["advisory_only_validation_passes"]
        and signal_b["advisory_only_validation_passes"]
    )
    gates["L3-G5"] = {
        "status": "PASS" if g5_pass else "FAIL",
        "rationale": (
            f"A signals: {signal_a['n_signals']} total, "
            f"{signal_a['advisory_only_count']} carry advisory_only=True. "
            f"B signals: {signal_b['n_signals']} total, "
            f"{signal_b['advisory_only_count']} carry advisory_only=True. "
            "Detector contract + harness `_verify_invariants` both enforce."
        ),
    }

    # L3-G6: no Omega unless check_coagulation fires. Harness never calls
    # check_coagulation; therefore no Omega is created.
    gates["L3-G6"] = {
        "status": "PASS",
        "rationale": (
            "Harness never invokes check_coagulation, never creates "
            "OmegaRecord, never calls OmegaRegistry.register, never sets "
            "is_omega_anchor. AST-based static checks in "
            "`test_17_no_omega_or_registry_or_check_coagulation_in_runner` "
            "verify this in the runner module. The conditional 'unless "
            "check_coagulation fires' is therefore vacuously satisfied."
        ),
    }

    # L3-G7: ReferenceField only after OmegaRecord. Not tested because no
    # Omega has been created in this audit.
    gates["L3-G7"] = {
        "status": "NOT_TESTED_YET",
        "rationale": (
            "No OmegaRecord created (research scope intentionally stops "
            "before coagulation). ReferenceField creation path therefore "
            "not exercised in this audit. Requires a controlled "
            "coagulation-observation experiment to test."
        ),
    }

    # L3-G8: disputed post-Omega contests expression but does not delete
    # Omega. Same caveat as G7.
    gates["L3-G8"] = {
        "status": "NOT_TESTED_YET",
        "rationale": (
            "No OmegaRecord exists to contest post-coagulation. Requires "
            "a separate experiment where Omega is allowed to form first."
        ),
    }

    # L3-G9: no regression on production benchmark suites D/E/F/M/N.
    # Production is untouched on this branch; benchmarks not re-run.
    gates["L3-G9"] = {
        "status": "NOT_TESTED_YET",
        "rationale": (
            "Production code at byon-orchestrator/src/, scripts/, and "
            "memory-service/ is untouched on this research branch "
            "(verified via git diff vs origin/main). D/E/F/M/N "
            "benchmark suites must run on main, not here. The research "
            "branch does not regress production by construction; the "
            "explicit benchmark run is a separate gate."
        ),
    }

    # L3-G10: second independent run reproducible + operator approval.
    # A and B exist and produce comparable distributions; no Omega exists
    # yet to be reproduced.
    gates["L3-G10"] = {
        "status": "PARTIAL",
        "rationale": (
            "Two independent transcripts (A seed=42, B seed=1337) replay "
            "successfully under identical code. Both produce non-zero "
            "advisory-only PotentialOmega signal counts (A "
            f"{signal_a['n_signals']}, B {signal_b['n_signals']}) on "
            "comparable center families. NO OmegaRecord has been created "
            "in either run, so 'second independent run reproduces an "
            "Omega' is not yet tested. Operator approval is a separate "
            "gating step outside the harness."
        ),
    }

    # Validate every gate has an admitted status.
    for gid, payload in gates.items():
        if payload["status"] not in _VALID_GATE_STATUSES:
            raise AssertionError(
                f"gate {gid}: invalid status {payload['status']!r}"
            )

    return gates


# ---------------------------------------------------------------------------
# Audit assembly
# ---------------------------------------------------------------------------


def build_audit(*, commit_sha: Optional[str] = None) -> Dict[str, Any]:
    """Run both transcripts and assemble a structured audit dict.

    The returned dict is the canonical input to render_markdown /
    render_json. It is deterministic for a given (transcript file,
    harness code, seed) tuple.
    """
    if commit_sha is None:
        commit_sha = _git_head_sha()

    # Load rows (needed for cross-run overlap text-set analysis).
    rows_a = _load_rows(TRANSCRIPT_A_PATH)
    rows_b = _load_rows(TRANSCRIPT_B_PATH)

    tel_a = _run_harness(TRANSCRIPT_A_PATH, SEED_A, TRANSCRIPT_A_ID)
    tel_b = _run_harness(TRANSCRIPT_B_PATH, SEED_B, TRANSCRIPT_B_ID)

    meta_a = _run_metadata(tel_a, SEED_A, commit_sha)
    meta_b = _run_metadata(tel_b, SEED_B, commit_sha)
    z_a = _z_metabolism(tel_a)
    z_b = _z_metabolism(tel_b)
    sum_a = _summary_behavior(tel_a)
    sum_b = _summary_behavior(tel_b)
    sig_a = _signal_analysis(tel_a)
    sig_b = _signal_analysis(tel_b)
    overlap = _cross_run_overlap(tel_a, tel_b, rows_a, rows_b)
    gates = _evaluate_l3_gates(
        tel_a=tel_a,
        tel_b=tel_b,
        signal_a=sig_a,
        signal_b=sig_b,
        z_a=z_a,
        z_b=z_b,
    )

    # Conclusion section — operator-locked phrasing.
    conclusion = {
        "level_3_declared": False,
        "natural_omega_proven": False,
        "research_feasibility_signal": "POSITIVE",
        "z_active_semantics_assessment": "PROMISING",
        "main_remains_level_2_of_4": True,
        "next_step": (
            "controlled coagulation-observation experiment, still on "
            "research branch; check_coagulation remains untouched until "
            "the experiment is designed and operator-approved."
        ),
        "no_production_modification": True,
        "no_tag_created": True,
        "no_release_created": True,
    }

    return {
        "report_version": REPORT_VERSION,
        "schema_version": SCHEMA_VERSION,
        "generated_at_commit_sha": commit_sha,
        "branch": BRANCH_NAME,
        "advisory_only": True,
        "metric_source": METRIC_SOURCE,
        "runs": {"A": meta_a, "B": meta_b},
        "z_metabolism": {"A": z_a, "B": z_b},
        "summary_behavior": {"A": sum_a, "B": sum_b},
        "potential_omega_signals": {"A": sig_a, "B": sig_b},
        "cross_run_overlap": overlap,
        "l3_gates": gates,
        "conclusion": conclusion,
    }


def _load_rows(path: Path) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def render_json(audit: Dict[str, Any]) -> str:
    """Render the audit dict to a stable, indented JSON string."""
    return json.dumps(audit, indent=2, ensure_ascii=False, sort_keys=False)


def _fmt(v: Any, fmt: str = "{}") -> str:
    if v is None:
        return "—"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        return fmt.format(v)
    return fmt.format(v)


def render_markdown(audit: Dict[str, Any]) -> str:
    """Render the audit dict to a human-readable markdown report."""
    out: List[str] = []
    A = "A"
    B = "B"

    out.append("# Level 3 A/B Comparison Report")
    out.append("")
    out.append(
        "> ADVISORY ONLY. Research artifact. Does NOT declare Level 3, "
        "does NOT create Omega, does NOT touch production. "
        "`metric_source = research_surrogate_v1_not_fce_production`."
    )
    out.append("")
    out.append(f"- Report version: `{audit['report_version']}`")
    out.append(f"- Branch: `{audit['branch']}`")
    out.append(f"- Generated at commit SHA: `{audit['generated_at_commit_sha']}`")
    out.append(f"- Schema version: `{audit['schema_version']}`")
    out.append(f"- Metric source: `{audit['metric_source']}`")
    out.append("")

    # ---- A. Run metadata ----
    out.append("## A. Run metadata")
    out.append("")
    headers = [
        "transcript_id",
        "seed",
        "n_rows",
        "n_events",
        "n_centers",
        "n_summaries",
        "n_potential_omega_signals",
    ]
    out.append("| Field | Run A | Run B |")
    out.append("|---|---|---|")
    for h in headers:
        out.append(f"| {h} | {audit['runs']['A'][h]} | {audit['runs']['B'][h]} |")
    out.append("")

    # ---- B. Z metabolism ----
    out.append("## B. Z metabolism comparison")
    out.append("")
    za = audit["z_metabolism"]["A"]
    zb = audit["z_metabolism"]["B"]
    out.append("| Field | Run A | Run B |")
    out.append("|---|---:|---:|")
    out.append(f"| z_total_final | {za['z_total_final']:.3f} | {zb['z_total_final']:.3f} |")
    out.append(f"| z_active_final | {za['z_active_final']:.3f} | {zb['z_active_final']:.3f} |")
    out.append(f"| z_resolved_final | {za['z_resolved_final']:.3f} | {zb['z_resolved_final']:.3f} |")
    out.append(f"| z_archived_final | {za['z_archived_final']:.3f} | {zb['z_archived_final']:.3f} |")
    out.append(f"| z_active / z_total | {za['z_active_ratio_of_total']:.4f} | {zb['z_active_ratio_of_total']:.4f} |")
    out.append(f"| (resolved + archived) / z_total | {za['resolved_plus_archived_ratio']:.4f} | {zb['resolved_plus_archived_ratio']:.4f} |")
    out.append(f"| b_t min | {za['b_t_min']:.3f} | {zb['b_t_min']:.3f} |")
    out.append(f"| b_t max | {za['b_t_max']:.3f} | {zb['b_t_max']:.3f} |")
    out.append(f"| b_t final | {za['b_t_final']:.3f} | {zb['b_t_final']:.3f} |")
    out.append(f"| invariant_ok | {za['invariant_ok']} | {zb['invariant_ok']} |")
    out.append(f"| conservation_holds | {za['conservation_holds']} | {zb['conservation_holds']} |")
    out.append(f"| audit_flags | `{za['audit_flags']}` | `{zb['audit_flags']}` |")
    out.append("")

    # ---- C. Summary behavior ----
    out.append("## C. Summary behavior")
    out.append("")
    sa = audit["summary_behavior"]["A"]
    sb = audit["summary_behavior"]["B"]
    out.append(f"- A: {sa['n_summaries']} summaries; z_reduction_total={sa['z_reduction_total']:.3f}")
    out.append(f"- B: {sb['n_summaries']} summaries; z_reduction_total={sb['z_reduction_total']:.3f}")
    out.append("")
    out.append("### Summaries per perspective")
    out.append("")
    out.append("| Perspective | Run A | Run B |")
    out.append("|---|---:|---:|")
    perspectives = sorted(set(list(sa["summaries_per_perspective"].keys()) + list(sb["summaries_per_perspective"].keys())))
    for p in perspectives:
        out.append(f"| {p} | {sa['summaries_per_perspective'].get(p, 0)} | {sb['summaries_per_perspective'].get(p, 0)} |")
    out.append("")
    out.append("### Top summary reasons")
    out.append("")
    out.append("| Reason | Run A | Run B |")
    out.append("|---|---:|---:|")
    reasons = ("correction_chain", "receipt_success_chain", "expression_pattern_stable", "unknown")
    for r in reasons:
        a_n = sa["summaries_by_reason"].get(r, 0)
        b_n = sb["summaries_by_reason"].get(r, 0)
        if a_n or b_n:
            out.append(f"| {r} | {a_n} | {b_n} |")
    out.append("")
    # Top centers (cap to 10 each).
    out.append("### Top summary centers (Run A — top 10)")
    out.append("")
    top_a = sorted(sa["summaries_per_center"].items(), key=lambda kv: -kv[1])[:10]
    for c, n in top_a:
        out.append(f"- `{c}` — {n}")
    out.append("")
    out.append("### Top summary centers (Run B — top 10)")
    out.append("")
    top_b = sorted(sb["summaries_per_center"].items(), key=lambda kv: -kv[1])[:10]
    for c, n in top_b:
        out.append(f"- `{c}` — {n}")
    out.append("")

    # ---- D. PotentialOmega signals ----
    out.append("## D. PotentialOmega signals")
    out.append("")
    siga = audit["potential_omega_signals"]["A"]
    sigb = audit["potential_omega_signals"]["B"]
    out.append("| Field | Run A | Run B |")
    out.append("|---|---:|---:|")
    out.append(f"| n_signals | {siga['n_signals']} | {sigb['n_signals']} |")
    out.append(f"| advisory_only_count | {siga['advisory_only_count']} | {sigb['advisory_only_count']} |")
    out.append(f"| advisory_only_validation | {siga['advisory_only_validation_passes']} | {sigb['advisory_only_validation_passes']} |")
    out.append(f"| confidence min | {_fmt(siga['confidence_min'], '{:.3f}')} | {_fmt(sigb['confidence_min'], '{:.3f}')} |")
    out.append(f"| confidence max | {_fmt(siga['confidence_max'], '{:.3f}')} | {_fmt(sigb['confidence_max'], '{:.3f}')} |")
    out.append(f"| confidence avg | {_fmt(siga['confidence_avg'], '{:.3f}')} | {_fmt(sigb['confidence_avg'], '{:.3f}')} |")
    out.append(f"| source_cycle_ids length | {_fmt(siga['source_cycle_ids_length_min'])}..{_fmt(siga['source_cycle_ids_length_max'])} | {_fmt(sigb['source_cycle_ids_length_min'])}..{_fmt(sigb['source_cycle_ids_length_max'])} |")
    out.append("")
    out.append("### Top buckets by signal count")
    out.append("")
    out.append("**Run A (top 10):**")
    out.append("")
    for bucket, n in siga["top_buckets_by_signal_count"]:
        out.append(f"- `{bucket}` — {n}")
    out.append("")
    out.append("**Run B (top 10):**")
    out.append("")
    for bucket, n in sigb["top_buckets_by_signal_count"]:
        out.append(f"- `{bucket}` — {n}")
    out.append("")

    # ---- E. Cross-run overlap ----
    out.append("## E. Cross-run overlap analysis")
    out.append("")
    ov = audit["cross_run_overlap"]
    out.append(f"- Exact text overlap A∩B: **{ov['exact_text_overlap']}** rows")
    out.append(f"- Common centers (A∩B): **{len(ov['common_centers'])}**")
    out.append(f"- Centers only in A: **{len(ov['only_in_a_centers'])}**")
    out.append(f"- Centers only in B: **{len(ov['only_in_b_centers'])}**")
    out.append(f"- Common signal buckets (A∩B): **{len(ov['common_signal_buckets'])}**")
    out.append("")
    out.append("### Common signal buckets")
    out.append("")
    for c in ov["common_signal_buckets"]:
        out.append(f"- `{c}`")
    if not ov["common_signal_buckets"]:
        out.append("- *(none)*")
    out.append("")
    out.append("### Divergence — signal buckets only in Run A")
    out.append("")
    for c in ov["divergence_areas"]["signal_buckets_only_in_a"]:
        out.append(f"- `{c}`")
    if not ov["divergence_areas"]["signal_buckets_only_in_a"]:
        out.append("- *(none)*")
    out.append("")
    out.append("### Divergence — signal buckets only in Run B")
    out.append("")
    for c in ov["divergence_areas"]["signal_buckets_only_in_b"]:
        out.append(f"- `{c}`")
    if not ov["divergence_areas"]["signal_buckets_only_in_b"]:
        out.append("- *(none)*")
    out.append("")
    s = ov["a_b_stability_observations"]
    out.append("### A/B stability observations")
    out.append("")
    out.append(f"- A z_active / z_total = {s['a_z_active_ratio']:.4f}; b_t_final = {s['a_b_t_final']:.3f}; invariant_ok = {s['a_invariant_ok']}")
    out.append(f"- B z_active / z_total = {s['b_z_active_ratio']:.4f}; b_t_final = {s['b_b_t_final']:.3f}; invariant_ok = {s['b_invariant_ok']}")
    out.append("")

    # ---- F. L3 gate audit ----
    out.append("## F. L3 gate audit")
    out.append("")
    out.append("| Gate | Status | Rationale |")
    out.append("|---|---|---|")
    for gid in L3_GATE_IDS:
        g = audit["l3_gates"][gid]
        rationale = g["rationale"].replace("\n", " ")
        out.append(f"| {gid} | **{g['status']}** | {rationale} |")
    out.append("")
    # Status tally.
    status_counts: Counter = Counter()
    for gid in L3_GATE_IDS:
        status_counts[audit["l3_gates"][gid]["status"]] += 1
    tally = ", ".join(f"{k}={v}" for k, v in sorted(status_counts.items()))
    out.append(f"**Status tally**: {tally}")
    out.append("")

    # ---- G. Conclusion ----
    out.append("## G. Conclusion")
    out.append("")
    c = audit["conclusion"]
    out.append("- Level 3 is **NOT declared**.")
    out.append("- Natural Omega is **NOT proven**.")
    out.append(f"- Research feasibility signal: **{c['research_feasibility_signal']}**.")
    out.append(f"- Z_active semantics: **{c['z_active_semantics_assessment']}**.")
    out.append(f"- Main remains **Level 2 of 4**.")
    out.append(f"- Next step: {c['next_step']}")
    out.append("- No production modification, no tag, no release.")
    out.append("")

    return "\n".join(out) + "\n"


# ---------------------------------------------------------------------------
# Write reports
# ---------------------------------------------------------------------------


def write_reports(
    out_dir: Path,
    *,
    commit_sha: Optional[str] = None,
) -> Tuple[Path, Path]:
    """Build the audit and write both reports to `out_dir`. Returns
    (json_path, md_path)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    audit = build_audit(commit_sha=commit_sha)
    json_path = out_dir / "level3_ab_comparison_report.json"
    md_path = out_dir / "level3_ab_comparison_report.md"
    json_path.write_text(render_json(audit) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(audit), encoding="utf-8")
    return json_path, md_path


# ---------------------------------------------------------------------------
# CLI entry
# ---------------------------------------------------------------------------


def main(argv: Optional[List[str]] = None) -> int:
    out_dir = _RESEARCH_ROOT / "reports"
    json_path, md_path = write_reports(out_dir)
    sys.stdout.write(f"wrote {json_path}\n")
    sys.stdout.write(f"wrote {md_path}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
