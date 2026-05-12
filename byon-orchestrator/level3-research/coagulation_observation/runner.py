"""Controlled coagulation observation runner.

Loads research harness telemetry for Transcript A (seed 42) and
Transcript B (seed 1337), filters cycles per candidate bucket, and
reports — without creating Omega — whether the temporal coagulation
shape (`S_t >= theta_s` for `tau_coag` consecutive cycles) holds.

Operator-locked thresholds — read at module load, written below as
explicit literals so the values appear in the audited source:

    THETA_S  = 0.28
    TAU_COAG = 12

These match the production operator-locked thresholds. The module
does NOT modify production config and does NOT call the production
`check_coagulation` function. `isolated_temporal_rule(...)` is a
local minimal re-implementation of the same rule, defined here so it
is fully auditable in the research package.

Hard isolation rules (enforced by this module's source + tests):

  * NO import of `byon_orchestrator.src`, `byon_orchestrator.scripts`,
    `byon_orchestrator.memory_service`
  * NO import of `unified_fragmergent_memory` (FCE-M production)
  * NO import of `check_coagulation`
  * NO call to OmegaRegistry.register
  * NO creation of OmegaRecord
  * NO creation of ReferenceField
  * NO `is_omega_anchor` identifier
  * NO mutation of production config

Verdict strings (per bucket × transcript):
  WOULD_COAGULATE
  NO_COAGULATION
  INSUFFICIENT_CYCLES

Final report verdict (across all observations):
  NO_COAGULATION_OBSERVED
  SURROGATE_FEASIBILITY_ONLY            (reserved; surrogate-only path)
  ISOLATED_RULE_OBSERVED_NO_OMEGA_CREATED

The literal string `LEVEL_3_REACHED` is intentionally NEVER emitted.
"""

from __future__ import annotations

import subprocess
from collections import Counter
from pathlib import Path
from statistics import mean
from typing import Any, Dict, List, Optional, Tuple

from harness import LongNaturalTranscriptHarness, METRIC_SOURCE


SCHEMA_VERSION = "level3-research.coagulation_observation.v1"

# ---------------------------------------------------------------------------
# Operator-locked thresholds — literal values, NOT read from production
# config. The values match production's operator-locked thresholds; this
# module documents them explicitly so the audit reads the value used.
# ---------------------------------------------------------------------------

THETA_S: float = 0.28
TAU_COAG: int = 12

THETA_S_SOURCE = (
    "operator-locked literal in coagulation_observation.runner.THETA_S; "
    "matches production operator-locked threshold; production config "
    "untouched by this module"
)
TAU_COAG_SOURCE = (
    "operator-locked literal in coagulation_observation.runner.TAU_COAG; "
    "matches production operator-locked threshold; production config "
    "untouched by this module"
)

# ---------------------------------------------------------------------------
# Candidate buckets (operator-locked for commit 11)
# ---------------------------------------------------------------------------

# (center_id, perspective)
CANDIDATE_BUCKETS: Tuple[Tuple[str, str], ...] = (
    ("byon::trust_hierarchy::factual", "factual"),
    ("byon::security_boundary::security_boundary", "security_boundary"),
    ("byon::macp_pipeline::factual", "factual"),
)

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
# Isolated rule — local, minimal, auditable
# ---------------------------------------------------------------------------


def isolated_temporal_rule(
    s_series: List[float],
    theta_s: float,
    tau_coag: int,
) -> bool:
    """Local audit re-implementation of the temporal coagulation rule.

    Returns True iff there exist `tau_coag` consecutive values in
    `s_series` each `>= theta_s`. Pure function. No side effects.
    No production import. No Omega creation. No registry write.

    Identical semantics to "S_t >= theta_s for tau_coag consecutive
    cycles" — the temporal portion of the production rule.

    Parameters
    ----------
    s_series : sequence of floats
        The S_t values, in cycle order.
    theta_s : float
        Threshold (operator-locked at 0.28 elsewhere in this module).
    tau_coag : int
        Required consecutive-run length (operator-locked at 12).
    """
    if tau_coag <= 0:
        raise ValueError(f"tau_coag must be positive, got {tau_coag}")
    if not s_series:
        return False
    consecutive = 0
    for s in s_series:
        if float(s) >= float(theta_s):
            consecutive += 1
            if consecutive >= tau_coag:
                return True
        else:
            consecutive = 0
    return False


def longest_run_above_threshold(s_series: List[float], theta_s: float) -> int:
    """Length of the longest run of consecutive `s >= theta_s` in the
    series. Pure function. No side effects."""
    longest = 0
    consecutive = 0
    for s in s_series:
        if float(s) >= float(theta_s):
            consecutive += 1
            if consecutive > longest:
                longest = consecutive
        else:
            consecutive = 0
    return longest


def _first_coagulation_candidate_index(
    s_series: List[float],
    theta_s: float,
    tau_coag: int,
) -> Optional[int]:
    """Index of the cycle at which a `tau_coag`-long run first completes,
    or None if no such cycle exists."""
    consecutive = 0
    for i, s in enumerate(s_series):
        if float(s) >= float(theta_s):
            consecutive += 1
            if consecutive >= tau_coag:
                return i
        else:
            consecutive = 0
    return None


def _first_cycle_above_threshold(
    s_series: List[float],
    theta_s: float,
) -> Optional[int]:
    for i, s in enumerate(s_series):
        if float(s) >= float(theta_s):
            return i
    return None


# ---------------------------------------------------------------------------
# Bucket observation
# ---------------------------------------------------------------------------


def observe_bucket(
    *,
    cycle_records: List[Dict[str, Any]],
    summary_events: List[Dict[str, Any]],
    center_id: str,
    perspective: str,
    theta_s: float = THETA_S,
    tau_coag: int = TAU_COAG,
) -> Dict[str, Any]:
    """Observe a single bucket on a single transcript. Returns a dict
    describing both modes' outcomes plus full provenance.

    Reads only — does NOT mutate cycle_records or summary_events.
    """
    filtered = [
        c
        for c in cycle_records
        if c["center_id"] == center_id and c["perspective"] == perspective
    ]
    n_cycles = len(filtered)
    if n_cycles < tau_coag:
        return {
            "center_id": center_id,
            "perspective": perspective,
            "n_cycles": n_cycles,
            "insufficient_cycles": True,
            "theta_s": float(theta_s),
            "tau_coag": int(tau_coag),
            "verdict": "INSUFFICIENT_CYCLES",
            "would_coagulate_surrogate": False,
            "would_coagulate_isolated_rule": False,
            "max_s_t": (max(c["s_t"] for c in filtered) if filtered else None),
            "mean_s_t": (mean(c["s_t"] for c in filtered) if filtered else None),
            "longest_run_above_threshold": (
                longest_run_above_threshold([c["s_t"] for c in filtered], theta_s)
                if filtered
                else 0
            ),
            "first_cycle_above_threshold": None,
            "coagulation_candidate_cycle_index": None,
            "coagulation_candidate_cycle_id": None,
            "source_cycle_ids": [c["cycle_id"] for c in filtered],
            "source_event_ids": [],
            "source_summary_ids": [],
        }

    s_series = [float(c["s_t"]) for c in filtered]
    cycle_ids = [c["cycle_id"] for c in filtered]

    longest_run = longest_run_above_threshold(s_series, theta_s)
    first_above = _first_cycle_above_threshold(s_series, theta_s)
    candidate_idx = _first_coagulation_candidate_index(
        s_series, theta_s, tau_coag
    )

    # Mode A — surrogate feasibility (using surrogate S_t).
    would_coagulate_surrogate = longest_run >= tau_coag
    # Mode B — isolated rule (local audit re-implementation, same logic).
    would_coagulate_isolated = isolated_temporal_rule(
        s_series, theta_s, tau_coag
    )
    # Sanity invariant: both modes apply the same temporal rule to the
    # same surrogate input — they MUST agree.
    if would_coagulate_surrogate != would_coagulate_isolated:
        raise AssertionError(
            f"mode mismatch on bucket {center_id!r}: surrogate "
            f"{would_coagulate_surrogate} vs isolated {would_coagulate_isolated}; "
            "this indicates a logic divergence and is a bug"
        )

    # Provenance: cycle_ids in the qualifying window.
    if candidate_idx is not None:
        start = candidate_idx - tau_coag + 1
        if start < 0:
            start = 0
        window_cycle_ids = cycle_ids[start : candidate_idx + 1]
        candidate_cycle_id = cycle_ids[candidate_idx]
    else:
        window_cycle_ids = []
        candidate_cycle_id = None

    # Aggregate provenance: events + summaries seen on this bucket.
    bucket_summaries = [
        s
        for s in summary_events
        if s["center_id"] == center_id and s["perspective"] == perspective
    ]
    source_summary_ids = [s["summary_id"] for s in bucket_summaries]
    source_event_id_set: List[str] = []
    seen = set()
    for s in bucket_summaries:
        for eid in s["source_event_ids"]:
            if eid not in seen:
                source_event_id_set.append(eid)
                seen.add(eid)

    verdict = "WOULD_COAGULATE" if would_coagulate_isolated else "NO_COAGULATION"

    return {
        "center_id": center_id,
        "perspective": perspective,
        "n_cycles": n_cycles,
        "insufficient_cycles": False,
        "theta_s": float(theta_s),
        "tau_coag": int(tau_coag),
        "max_s_t": max(s_series),
        "mean_s_t": mean(s_series),
        "longest_run_above_threshold": longest_run,
        "first_cycle_above_threshold": first_above,
        "coagulation_candidate_cycle_index": candidate_idx,
        "coagulation_candidate_cycle_id": candidate_cycle_id,
        "would_coagulate_surrogate": would_coagulate_surrogate,
        "would_coagulate_isolated_rule": would_coagulate_isolated,
        "source_cycle_ids": window_cycle_ids,
        "all_bucket_cycle_ids": cycle_ids,
        "source_event_ids": source_event_id_set,
        "source_summary_ids": source_summary_ids,
        "n_source_events": len(source_event_id_set),
        "n_source_summaries": len(source_summary_ids),
        "verdict": verdict,
    }


# ---------------------------------------------------------------------------
# Transcript-level + run-level assembly
# ---------------------------------------------------------------------------


def _git_head_sha() -> str:
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
    h = LongNaturalTranscriptHarness(seed=seed, transcript_id=transcript_id)
    return h.run_jsonl(path)


def _observe_transcript(
    *,
    label: str,
    path: Path,
    seed: int,
    transcript_id: str,
    theta_s: float,
    tau_coag: int,
) -> Dict[str, Any]:
    tel = _run_harness(path, seed, transcript_id)
    per_bucket: List[Dict[str, Any]] = []
    for center_id, perspective in CANDIDATE_BUCKETS:
        obs = observe_bucket(
            cycle_records=tel["cycle_records"],
            summary_events=tel["summary_events"],
            center_id=center_id,
            perspective=perspective,
            theta_s=theta_s,
            tau_coag=tau_coag,
        )
        per_bucket.append(obs)
    return {
        "label": label,
        "transcript_id": transcript_id,
        "seed": seed,
        "n_rows": tel["n_rows"],
        "n_events": tel["n_events"],
        "n_centers": tel["n_centers"],
        "n_summaries": tel["n_summaries"],
        "n_potential_omega_signals": tel["n_potential_omega_signals"],
        "metric_source": tel["metric_source"],
        "invariant_ok": tel["invariant_ok"],
        "audit_flags": tel["audit_flags"],
        "buckets": per_bucket,
    }


def _final_verdict(transcripts: List[Dict[str, Any]]) -> str:
    """Aggregate verdict across transcripts × buckets.

    Possible outputs (operator-locked):
      NO_COAGULATION_OBSERVED
      SURROGATE_FEASIBILITY_ONLY            (reserved; not reachable since
                                             both modes share the same input)
      ISOLATED_RULE_OBSERVED_NO_OMEGA_CREATED
    """
    any_isolated = False
    any_surrogate = False
    for t in transcripts:
        for b in t["buckets"]:
            if b.get("would_coagulate_isolated_rule"):
                any_isolated = True
            if b.get("would_coagulate_surrogate"):
                any_surrogate = True
    if any_isolated:
        return "ISOLATED_RULE_OBSERVED_NO_OMEGA_CREATED"
    if any_surrogate:
        # Should not happen given identical-rule semantics, but kept for
        # completeness of the enumerated verdict set.
        return "SURROGATE_FEASIBILITY_ONLY"
    return "NO_COAGULATION_OBSERVED"


def run_observation(
    *,
    commit_sha: Optional[str] = None,
    theta_s: float = THETA_S,
    tau_coag: int = TAU_COAG,
) -> Dict[str, Any]:
    """Run the full observation pipeline. Returns a structured dict
    consumable by the renderers.

    Operator-locked: this function does NOT create Omega, does NOT write
    to any registry, does NOT modify production config. Repeated calls
    are pure / deterministic for fixed inputs.
    """
    if theta_s != THETA_S:
        raise ValueError(
            f"theta_s must remain operator-locked at {THETA_S}; got {theta_s}"
        )
    if tau_coag != TAU_COAG:
        raise ValueError(
            f"tau_coag must remain operator-locked at {TAU_COAG}; got {tau_coag}"
        )
    if commit_sha is None:
        commit_sha = _git_head_sha()

    transcripts = [
        _observe_transcript(
            label="A",
            path=TRANSCRIPT_A_PATH,
            seed=SEED_A,
            transcript_id=TRANSCRIPT_A_ID,
            theta_s=theta_s,
            tau_coag=tau_coag,
        ),
        _observe_transcript(
            label="B",
            path=TRANSCRIPT_B_PATH,
            seed=SEED_B,
            transcript_id=TRANSCRIPT_B_ID,
            theta_s=theta_s,
            tau_coag=tau_coag,
        ),
    ]

    final_verdict = _final_verdict(transcripts)

    # Bucket family verdict: does the same family show up in BOTH A and B?
    family_status: Dict[str, Dict[str, Any]] = {}
    for center_id, perspective in CANDIDATE_BUCKETS:
        key = f"{center_id}::{perspective}"
        a_obs = next(
            b
            for b in transcripts[0]["buckets"]
            if b["center_id"] == center_id and b["perspective"] == perspective
        )
        b_obs = next(
            b
            for b in transcripts[1]["buckets"]
            if b["center_id"] == center_id and b["perspective"] == perspective
        )
        family_status[key] = {
            "center_id": center_id,
            "perspective": perspective,
            "a_verdict": a_obs["verdict"],
            "b_verdict": b_obs["verdict"],
            "comparable_behavior": a_obs["verdict"] == b_obs["verdict"],
            "would_coagulate_isolated_a": a_obs.get("would_coagulate_isolated_rule"),
            "would_coagulate_isolated_b": b_obs.get("would_coagulate_isolated_rule"),
            "would_coagulate_surrogate_a": a_obs.get("would_coagulate_surrogate"),
            "would_coagulate_surrogate_b": b_obs.get("would_coagulate_surrogate"),
        }

    return {
        "schema_version": SCHEMA_VERSION,
        "branch": BRANCH_NAME,
        "generated_at_commit_sha": commit_sha,
        "metric_source": METRIC_SOURCE,
        "theta_s_used": float(theta_s),
        "tau_coag_used": int(tau_coag),
        "theta_s_source": THETA_S_SOURCE,
        "tau_coag_source": TAU_COAG_SOURCE,
        "production_config_untouched": True,
        "level_3_declared": False,
        "natural_omega_created": False,
        "no_omega_record_created": True,
        "no_omega_registry_write": True,
        "no_reference_field_created": True,
        "candidate_buckets": [
            {"center_id": c, "perspective": p} for c, p in CANDIDATE_BUCKETS
        ],
        "transcripts": transcripts,
        "family_status": family_status,
        "final_verdict": final_verdict,
        "verdict_legend": {
            "NO_COAGULATION_OBSERVED": (
                "No bucket × transcript pair had 12 consecutive S_t >= 0.28."
            ),
            "SURROGATE_FEASIBILITY_ONLY": (
                "Reserved for the hypothetical case where the surrogate "
                "metric satisfies the rule but the isolated audit rule does "
                "not (currently unreachable; both share input + logic)."
            ),
            "ISOLATED_RULE_OBSERVED_NO_OMEGA_CREATED": (
                "The local audit re-implementation of `S_t >= theta_s for "
                "tau_coag consecutive cycles` would emit on at least one "
                "bucket × transcript. NO OmegaRecord is created. NO "
                "registry write. Production config untouched. Level 3 NOT "
                "declared. Inputs are surrogate S_t, not production FCE "
                "metrics; this is a research observation only."
            ),
        },
    }
