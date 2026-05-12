"""Real FCE-M observation adapter — isolated, read-only.

Bootstraps a fresh FCE-M `Agent` per bucket-and-transcript and feeds it
a deterministic sequence of (delta_X, U_a, anchor) tuples derived from
the research harness's existing cycle telemetry. `agent.step(...)`
returns the production `S_t` (computed via the unmodified `self_index`
formula); a LOCAL audit re-implementation of the temporal coagulation
rule (`S_t >= theta_s for tau_coag consecutive cycles`) decides the
per-bucket verdict.

Hard isolation rules (enforced by source + tests):

  * `agent.check_coagulation(...)` is NEVER called — it mutates
    `agent.Omega`. We use `isolated_temporal_rule(...)` instead.
  * No `OmegaRegistry` import, no `OmegaRegistry.register(...)`.
  * No `ReferenceField` identifier in executable position.
  * No `is_omega_anchor` identifier.
  * No `FceOmegaObserver` import (that class writes to the registry).
  * No mutation of FCE-M vendor source.
  * No mutation of production config; `theta_s` and `tau_coag` are
    operator-locked literals here.
  * No LLM / embedding imports (field vectors are deterministic hashes
    of `cycle_id`, not produced by a semantic encoder).

The result is a "real FCE-M math on research-derived inputs"
observation. The divergence from production semantics is explicitly
documented in every report.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
from pathlib import Path
from statistics import mean
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

# ---------------------------------------------------------------------------
# Vendor path bootstrap (read-only).
# We add the FCE-M vendored sources to sys.path so the `Agent` and pure
# functions (`self_index`, `autoreferential_measure`) resolve. The vendor
# itself is NOT modified.
# ---------------------------------------------------------------------------

_RESEARCH_ROOT = Path(__file__).resolve().parent.parent
_REPO_ROOT = _RESEARCH_ROOT.parent.parent
_FCEM_VENDOR_ROOT = _REPO_ROOT / "byon-orchestrator" / "memory-service" / "vendor" / "fce_m"

if not _FCEM_VENDOR_ROOT.is_dir():
    raise ImportError(
        f"FCE-M vendor root not found at {_FCEM_VENDOR_ROOT}; the adapter "
        "requires the vendored FCE-M tree to be present."
    )

_FCEM_VENDOR_STR = str(_FCEM_VENDOR_ROOT)
if _FCEM_VENDOR_STR not in sys.path:
    sys.path.insert(0, _FCEM_VENDOR_STR)

# Read-only imports. Side-effect audit on these modules: only sys.path
# manipulation; no globals, no registries, no agents created here.
from unified_fragmergent_memory.sources import fce_omega as _fce_omega  # noqa: E402

_Agent = _fce_omega.Agent
_self_index = _fce_omega.self_index
_autoref = _fce_omega.autoreferential_measure


# ---------------------------------------------------------------------------
# Research harness imports.
# ---------------------------------------------------------------------------

from harness import LongNaturalTranscriptHarness, METRIC_SOURCE  # noqa: E402


# ---------------------------------------------------------------------------
# Operator-locked constants
# ---------------------------------------------------------------------------

SCHEMA_VERSION = "level3-research.fce_observation_adapter.v1"

THETA_S: float = 0.28
TAU_COAG: int = 12

THETA_S_SOURCE = (
    "operator-locked literal in fce_observation_adapter.adapter.THETA_S; "
    "matches production operator-locked threshold; production config "
    "untouched by this module"
)
TAU_COAG_SOURCE = (
    "operator-locked literal in fce_observation_adapter.adapter.TAU_COAG; "
    "matches production operator-locked threshold; production config "
    "untouched by this module"
)

# Agent field dimension. Small but real. The choice is deterministic and
# documented; production memory-service uses 384 (sentence-transformer
# output) but here we feed hash-derived vectors so a small D is honest.
AGENT_FIELD_DIM: int = 16

# Agent initial-state hyperparameters. Picked deterministically and
# documented so the audit can reproduce.
AGENT_KAPPA_0: float = 0.50
AGENT_ALPHA_0: float = 0.50
AGENT_RHO_0: float = 0.10
AGENT_LAMBDA_0: float = 0.10

# Metric source label distinguishing this adapter's output from both
# production telemetry and the research surrogate.
METRIC_SOURCE_REAL_FCE = (
    "real_fce_m_on_research_derived_inputs_isolated_adapter_v1"
)


# ---------------------------------------------------------------------------
# Candidate buckets (same set as commit 11)
# ---------------------------------------------------------------------------

CANDIDATE_BUCKETS: Tuple[Tuple[str, str], ...] = (
    ("byon::trust_hierarchy::factual", "factual"),
    ("byon::security_boundary::security_boundary", "security_boundary"),
    ("byon::macp_pipeline::factual", "factual"),
)


# ---------------------------------------------------------------------------
# Transcript identities
# ---------------------------------------------------------------------------

_TRANSCRIPTS_DIR = _RESEARCH_ROOT / "transcripts"

TRANSCRIPT_A_PATH = _TRANSCRIPTS_DIR / "transcript_A_byon_arch_500.jsonl"
TRANSCRIPT_B_PATH = _TRANSCRIPTS_DIR / "transcript_B_byon_arch_500.jsonl"
TRANSCRIPT_A_ID = "transcript_A_byon_arch_v1_500"
TRANSCRIPT_B_ID = "transcript_B_byon_arch_v1_500"
SEED_A = 42
SEED_B = 1337
BRANCH_NAME = "research/level-3-natural-omega"


# ---------------------------------------------------------------------------
# Local audit re-implementation of the temporal rule.
# Identical to commit 11's `isolated_temporal_rule`. Repeated here so
# the adapter is self-contained and the AST audit can verify the rule
# in this package's source.
# ---------------------------------------------------------------------------


def isolated_temporal_rule(
    s_series: List[float],
    theta_s: float,
    tau_coag: int,
) -> bool:
    """Local audit re-implementation of `S_t >= theta_s for tau_coag
    consecutive cycles`. Pure function. No FCE-M call. No side effects.
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
    """Length of the longest run of consecutive `s >= theta_s`."""
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


def _first_above_index(s_series: List[float], theta_s: float) -> Optional[int]:
    for i, s in enumerate(s_series):
        if float(s) >= float(theta_s):
            return i
    return None


def _first_temporal_candidate_index(
    s_series: List[float],
    theta_s: float,
    tau_coag: int,
) -> Optional[int]:
    consecutive = 0
    for i, s in enumerate(s_series):
        if float(s) >= float(theta_s):
            consecutive += 1
            if consecutive >= tau_coag:
                return i
        else:
            consecutive = 0
    return None


# ---------------------------------------------------------------------------
# Deterministic field-vector derivation
# ---------------------------------------------------------------------------


def _hash_unit_vector(seed_str: str, dim: int) -> np.ndarray:
    """Derive a deterministic unit vector of `dim` from a string seed.

    Uses SHA-256 → bytes → 32 evenly-distributed floats → repeated to
    fill `dim` → centered (subtract 0.5) → unit-normalized. No randomness;
    same input ⇒ identical output. No LLM, no embedding model.
    """
    digest = hashlib.sha256(seed_str.encode("utf-8")).digest()
    raw = np.frombuffer(digest, dtype=np.uint8).astype(np.float64) / 255.0
    if dim <= len(raw):
        vec = raw[:dim]
    else:
        reps = (dim + len(raw) - 1) // len(raw)
        vec = np.tile(raw, reps)[:dim]
    centered = vec - 0.5
    n = float(np.linalg.norm(centered))
    if n < 1e-12:
        # Pathological: synthesize a deterministic fallback.
        out = np.zeros(dim, dtype=np.float64)
        out[0] = 1.0
        return out
    return centered / n


def _derive_anchor(cycle: Dict[str, Any]) -> float:
    """Map a research cycle record to an anchor in [0, 1] for `agent.step`.

    Mean of (s_t, b_t) clipped to [0, 1]. Deterministic, no LLM.
    """
    s_t = float(cycle.get("s_t", 0.0))
    b_t = float(cycle.get("b_t", 0.0))
    anchor = 0.5 * s_t + 0.5 * b_t
    if anchor < 0.0:
        return 0.0
    if anchor > 1.0:
        return 1.0
    return anchor


# ---------------------------------------------------------------------------
# Single-bucket observation
# ---------------------------------------------------------------------------


def observe_bucket_real_fce(
    *,
    cycle_records: List[Dict[str, Any]],
    summary_events: List[Dict[str, Any]],
    center_id: str,
    perspective: str,
    seed: int,
    field_dim: int = AGENT_FIELD_DIM,
    theta_s: float = THETA_S,
    tau_coag: int = TAU_COAG,
) -> Dict[str, Any]:
    """Observe one (bucket × transcript) pair under REAL FCE-M math.

    Reads only. Constructs a fresh `Agent`. Steps it. Returns S_t per
    cycle and applies the LOCAL temporal rule. Does NOT call
    `agent.check_coagulation` (the FCE-M routine that flips
    `agent.Omega`).
    """
    filtered = [
        c
        for c in cycle_records
        if c["center_id"] == center_id and c["perspective"] == perspective
    ]
    n_cycles = len(filtered)

    # Aggregate provenance.
    bucket_summaries = [
        s
        for s in summary_events
        if s["center_id"] == center_id and s["perspective"] == perspective
    ]
    source_summary_ids = [s["summary_id"] for s in bucket_summaries]
    source_event_ids: List[str] = []
    seen = set()
    for s in bucket_summaries:
        for eid in s["source_event_ids"]:
            if eid not in seen:
                source_event_ids.append(eid)
                seen.add(eid)
    all_bucket_cycle_ids = [c["cycle_id"] for c in filtered]

    if n_cycles < tau_coag:
        return {
            "center_id": center_id,
            "perspective": perspective,
            "seed": seed,
            "n_cycles": n_cycles,
            "insufficient_cycles": True,
            "theta_s": float(theta_s),
            "tau_coag": int(tau_coag),
            "verdict": "ADAPTER_INCONCLUSIVE",
            "would_pass_temporal_rule_real_fce": False,
            "max_S_t_real": None,
            "mean_S_t_real": None,
            "longest_run_above_theta": 0,
            "first_cycle_above_theta": None,
            "coagulation_candidate_cycle_index": None,
            "coagulation_candidate_cycle_id": None,
            "agent_omega_state": 0,
            "metric_source_real": METRIC_SOURCE_REAL_FCE,
            "field_dim": int(field_dim),
            "source_cycle_ids": [],
            "all_bucket_cycle_ids": all_bucket_cycle_ids,
            "source_event_ids": source_event_ids,
            "source_summary_ids": source_summary_ids,
        }

    # Build a fresh Agent. Deterministic seed: transcript seed XOR a
    # hash of (center_id, perspective, "fce_adapter_v1") so each bucket
    # has its own deterministic RNG state.
    seed_bytes = hashlib.sha256(
        f"{seed}::{center_id}::{perspective}::fce_adapter_v1".encode("utf-8")
    ).digest()
    rng_seed = int.from_bytes(seed_bytes[:8], "big", signed=False) % (2**32)
    rng = np.random.default_rng(rng_seed)

    agent = _Agent(
        idx=0,
        D=int(field_dim),
        kappa_0=AGENT_KAPPA_0,
        alpha_0=AGENT_ALPHA_0,
        rho_0=AGENT_RHO_0,
        lambda_0=AGENT_LAMBDA_0,
        rng=rng,
    )

    s_series: List[float] = []
    ar_series: List[float] = []
    bt_series: List[float] = []
    kappa_series: List[float] = []
    alpha_series: List[float] = []
    rho_series: List[float] = []
    lambda_series: List[float] = []
    z_norm_series: List[float] = []

    for c in filtered:
        seed_str = f"{c['cycle_id']}::field"
        delta_X = _hash_unit_vector(seed_str, field_dim)
        # Scale delta_X by anchor magnitude so weaker cycles produce
        # smaller field excitation. The unit-normalization above keeps
        # direction deterministic; the scale is set from research
        # cycle z_active.
        z_active = float(c.get("z_active", 0.0))
        # Map z_active >= 0 to a positive magnitude in [0.5, 1.5].
        scale = 0.5 + min(1.0, max(0.0, z_active))
        delta_X = delta_X * scale

        u_seed = f"{c['cycle_id']}::noise"
        U_a = _hash_unit_vector(u_seed, field_dim) * 0.05
        anchor = _derive_anchor(c)

        S_t = float(agent.step(delta_X, U_a, anchor=anchor))
        s_series.append(S_t)
        # Read other state.
        ar_series.append(float(_autoref(agent.Pi_s, agent.Phi_s)))
        z_norm = float(np.linalg.norm(agent.Z))
        z_norm_series.append(z_norm)
        bt_series.append(1.0 / (1.0 + z_norm))
        kappa_series.append(float(agent.kappa))
        alpha_series.append(float(agent.alpha))
        rho_series.append(float(agent.rho))
        lambda_series.append(float(agent.lambda_ar))

    longest_run = longest_run_above_threshold(s_series, theta_s)
    first_above = _first_above_index(s_series, theta_s)
    candidate_idx = _first_temporal_candidate_index(s_series, theta_s, tau_coag)
    would_pass = isolated_temporal_rule(s_series, theta_s, tau_coag)

    if candidate_idx is not None:
        start = candidate_idx - tau_coag + 1
        if start < 0:
            start = 0
        window_cycle_ids = all_bucket_cycle_ids[start : candidate_idx + 1]
        candidate_cycle_id = all_bucket_cycle_ids[candidate_idx]
    else:
        window_cycle_ids = []
        candidate_cycle_id = None

    # Verdict assignment per operator-locked vocabulary.
    if would_pass:
        verdict = "REAL_FCE_TEMPORAL_RULE_OBSERVED_NO_OMEGA_CREATED"
    elif longest_run > 0 and (max(s_series) >= 0.9 * theta_s):
        verdict = "REAL_FCE_NEAR_THRESHOLD"
    elif longest_run > 0:
        verdict = "REAL_FCE_NO_COAGULATION"
    else:
        verdict = "REAL_FCE_NO_COAGULATION"

    # Sanity: the adapter must NEVER set agent.Omega via this path.
    if int(agent.Omega) != 0:
        # This would only happen if `agent.check_coagulation` was called,
        # which this module does NOT do. If somehow the agent's internal
        # bookkeeping flipped Omega, that's a hard contract break.
        raise AssertionError(
            f"agent.Omega unexpectedly nonzero ({agent.Omega}); the adapter "
            "must not call agent.check_coagulation and must not flip Omega"
        )

    return {
        "center_id": center_id,
        "perspective": perspective,
        "seed": seed,
        "n_cycles": n_cycles,
        "insufficient_cycles": False,
        "theta_s": float(theta_s),
        "tau_coag": int(tau_coag),
        "max_S_t_real": max(s_series),
        "mean_S_t_real": mean(s_series),
        "longest_run_above_theta": longest_run,
        "first_cycle_above_theta": first_above,
        "coagulation_candidate_cycle_index": candidate_idx,
        "coagulation_candidate_cycle_id": candidate_cycle_id,
        "would_pass_temporal_rule_real_fce": would_pass,
        "verdict": verdict,
        "agent_omega_state": int(agent.Omega),
        "agent_final_kappa": float(agent.kappa),
        "agent_final_alpha": float(agent.alpha),
        "agent_final_rho": float(agent.rho),
        "agent_final_lambda_ar": float(agent.lambda_ar),
        "metric_source_real": METRIC_SOURCE_REAL_FCE,
        "field_dim": int(field_dim),
        "agent_init": {
            "kappa_0": AGENT_KAPPA_0,
            "alpha_0": AGENT_ALPHA_0,
            "rho_0": AGENT_RHO_0,
            "lambda_0": AGENT_LAMBDA_0,
        },
        "source_cycle_ids": window_cycle_ids,
        "all_bucket_cycle_ids": all_bucket_cycle_ids,
        "source_event_ids": source_event_ids,
        "source_summary_ids": source_summary_ids,
        "s_series_summary": {
            "min": min(s_series),
            "max": max(s_series),
            "mean": mean(s_series),
        },
        "ar_t_summary": {
            "min": min(ar_series),
            "max": max(ar_series),
            "mean": mean(ar_series),
        },
        "b_t_summary": {
            "min": min(bt_series),
            "max": max(bt_series),
            "mean": mean(bt_series),
        },
        "z_norm_summary": {
            "min": min(z_norm_series),
            "max": max(z_norm_series),
            "mean": mean(z_norm_series),
        },
        "kappa_summary": {
            "min": min(kappa_series),
            "max": max(kappa_series),
            "final": kappa_series[-1],
        },
    }


# ---------------------------------------------------------------------------
# Helpers
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


def _surrogate_bucket_pass(
    tel: Dict[str, Any],
    center_id: str,
    perspective: str,
    theta_s: float,
    tau_coag: int,
) -> Tuple[bool, int, int]:
    """Compute the SURROGATE temporal-rule result for the same bucket,
    so the report can compare real vs surrogate per bucket.

    Returns (would_pass_surrogate, longest_run, n_cycles).
    """
    filtered = [
        c
        for c in tel["cycle_records"]
        if c["center_id"] == center_id and c["perspective"] == perspective
    ]
    s_series = [float(c["s_t"]) for c in filtered]
    longest = longest_run_above_threshold(s_series, theta_s)
    return (isolated_temporal_rule(s_series, theta_s, tau_coag), longest, len(filtered))


def _observe_transcript(
    *,
    label: str,
    path: Path,
    seed: int,
    transcript_id: str,
    theta_s: float,
    tau_coag: int,
    field_dim: int,
) -> Dict[str, Any]:
    tel = _run_harness(path, seed, transcript_id)
    per_bucket: List[Dict[str, Any]] = []
    for center_id, perspective in CANDIDATE_BUCKETS:
        obs = observe_bucket_real_fce(
            cycle_records=tel["cycle_records"],
            summary_events=tel["summary_events"],
            center_id=center_id,
            perspective=perspective,
            seed=seed,
            field_dim=field_dim,
            theta_s=theta_s,
            tau_coag=tau_coag,
        )
        # Add surrogate comparison.
        surrogate_pass, surrogate_longest, _ = _surrogate_bucket_pass(
            tel, center_id, perspective, theta_s, tau_coag
        )
        obs["surrogate_would_pass"] = surrogate_pass
        obs["surrogate_longest_run_above_theta"] = surrogate_longest
        obs["surrogate_vs_real_diverge"] = (
            surrogate_pass != obs["would_pass_temporal_rule_real_fce"]
        )
        if obs["surrogate_vs_real_diverge"]:
            obs["divergence_note"] = (
                "surrogate temporal rule and real-FCE temporal rule "
                "disagree for this bucket; the surrogate metric reflects "
                "alignment/kappa/b_t means while real FCE-M S_t includes "
                "I_t (assimilation fidelity) and is driven by the agent's "
                "hash-derived field updates"
            )
        else:
            obs["divergence_note"] = None
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
        "metric_source_surrogate": tel["metric_source"],
        "metric_source_real": METRIC_SOURCE_REAL_FCE,
        "invariant_ok": tel["invariant_ok"],
        "audit_flags": tel["audit_flags"],
        "buckets": per_bucket,
    }


# ---------------------------------------------------------------------------
# Final verdict aggregation
# ---------------------------------------------------------------------------


_FORBIDDEN_FINAL_VERDICTS = (
    "LEVEL_3_REACHED",
    "OMEGA_CREATED",
    "NATURAL_OMEGA_PROVEN",
)


def _final_verdict(transcripts: List[Dict[str, Any]]) -> str:
    """Aggregate per-bucket verdicts into a final report verdict.

    Operator-locked vocabulary:
      REAL_FCE_NO_COAGULATION
      REAL_FCE_NEAR_THRESHOLD
      REAL_FCE_TEMPORAL_RULE_OBSERVED_NO_OMEGA_CREATED
      ADAPTER_INCONCLUSIVE

    NEVER emits any of: LEVEL_3_REACHED, OMEGA_CREATED, NATURAL_OMEGA_PROVEN.
    """
    any_pass = False
    any_near = False
    any_no_coag = False
    any_inconclusive_only = True
    any_real = False
    for t in transcripts:
        for b in t["buckets"]:
            if b.get("insufficient_cycles"):
                continue
            any_real = True
            any_inconclusive_only = False
            v = b["verdict"]
            if v == "REAL_FCE_TEMPORAL_RULE_OBSERVED_NO_OMEGA_CREATED":
                any_pass = True
            elif v == "REAL_FCE_NEAR_THRESHOLD":
                any_near = True
            elif v == "REAL_FCE_NO_COAGULATION":
                any_no_coag = True
    if not any_real and any_inconclusive_only:
        return "ADAPTER_INCONCLUSIVE"
    if any_pass:
        verdict = "REAL_FCE_TEMPORAL_RULE_OBSERVED_NO_OMEGA_CREATED"
    elif any_near:
        verdict = "REAL_FCE_NEAR_THRESHOLD"
    else:
        verdict = "REAL_FCE_NO_COAGULATION"
    assert verdict not in _FORBIDDEN_FINAL_VERDICTS
    return verdict


# ---------------------------------------------------------------------------
# Public entry
# ---------------------------------------------------------------------------


def run_real_fce_observation(
    *,
    commit_sha: Optional[str] = None,
    theta_s: float = THETA_S,
    tau_coag: int = TAU_COAG,
    field_dim: int = AGENT_FIELD_DIM,
) -> Dict[str, Any]:
    """Run the real-FCE-M observation on both transcripts × all candidate
    buckets. Returns a structured dict consumable by the renderers.
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
            field_dim=field_dim,
        ),
        _observe_transcript(
            label="B",
            path=TRANSCRIPT_B_PATH,
            seed=SEED_B,
            transcript_id=TRANSCRIPT_B_ID,
            theta_s=theta_s,
            tau_coag=tau_coag,
            field_dim=field_dim,
        ),
    ]

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
            "a_verdict_real_fce": a_obs["verdict"],
            "b_verdict_real_fce": b_obs["verdict"],
            "a_would_pass_real_fce": a_obs.get("would_pass_temporal_rule_real_fce"),
            "b_would_pass_real_fce": b_obs.get("would_pass_temporal_rule_real_fce"),
            "a_surrogate_would_pass": a_obs.get("surrogate_would_pass"),
            "b_surrogate_would_pass": b_obs.get("surrogate_would_pass"),
            "a_surrogate_vs_real_diverge": a_obs.get("surrogate_vs_real_diverge"),
            "b_surrogate_vs_real_diverge": b_obs.get("surrogate_vs_real_diverge"),
            "comparable_behavior_real_fce": (
                a_obs["verdict"] == b_obs["verdict"]
            ),
        }

    final_verdict = _final_verdict(transcripts)

    return {
        "schema_version": SCHEMA_VERSION,
        "branch": BRANCH_NAME,
        "generated_at_commit_sha": commit_sha,
        "metric_source_real": METRIC_SOURCE_REAL_FCE,
        "metric_source_surrogate": METRIC_SOURCE,
        "theta_s_used": float(theta_s),
        "tau_coag_used": int(tau_coag),
        "theta_s_source": THETA_S_SOURCE,
        "tau_coag_source": TAU_COAG_SOURCE,
        "field_dim_used": int(field_dim),
        "agent_init": {
            "kappa_0": AGENT_KAPPA_0,
            "alpha_0": AGENT_ALPHA_0,
            "rho_0": AGENT_RHO_0,
            "lambda_0": AGENT_LAMBDA_0,
        },
        "production_config_untouched": True,
        "fce_m_vendor_unmodified": True,
        "level_3_declared": False,
        "natural_omega_created": False,
        "no_omega_record_created": True,
        "no_omega_registry_write": True,
        "no_reference_field_created": True,
        "agent_check_coagulation_called": False,
        "isolation_notes": [
            "Imports FCE-M `Agent`, `self_index`, and `autoreferential_measure` "
            "read-only. Module imports verified to have no side effects.",
            "Does NOT call `agent.check_coagulation` (which would mutate "
            "`agent.Omega`).",
            "Does NOT import or call `FceOmegaObserver` (production "
            "registry-writing path).",
            "Field vectors are deterministic hashes of `cycle_id` "
            "(SHA-256 → unit vector). NO LLM, NO embedding encoder.",
            "Anchor is a deterministic mapping of research surrogate "
            "telemetry (`0.5*s_t + 0.5*b_t`). NO production semantic encoder.",
            "Agent.Omega state is verified to remain 0 after every bucket "
            "observation; an exception is raised on any unexpected flip.",
        ],
        "candidate_buckets": [
            {"center_id": c, "perspective": p} for c, p in CANDIDATE_BUCKETS
        ],
        "transcripts": transcripts,
        "family_status": family_status,
        "final_verdict": final_verdict,
        "verdict_legend": {
            "REAL_FCE_NO_COAGULATION": (
                "Real FCE-M S_t never reached `tau_coag` consecutive cycles "
                "above `theta_s` in any bucket × transcript pair."
            ),
            "REAL_FCE_NEAR_THRESHOLD": (
                "Real FCE-M S_t showed runs of cycles above `theta_s` but "
                "never reached `tau_coag` consecutive cycles in any bucket."
            ),
            "REAL_FCE_TEMPORAL_RULE_OBSERVED_NO_OMEGA_CREATED": (
                "Real FCE-M S_t, computed via the production `self_index` "
                "formula on hash-derived field vectors, reached `tau_coag` "
                "consecutive cycles above `theta_s` on at least one bucket "
                "× transcript pair. NO OmegaRecord was created. NO registry "
                "write. NO ReferenceField. The production "
                "`agent.check_coagulation` was NOT called. Inputs are "
                "research-derived (hash-based field vectors + surrogate "
                "anchor), NOT production semantic encoder output, so this "
                "is an isolated research observation. Level 3 is NOT "
                "declared."
            ),
            "ADAPTER_INCONCLUSIVE": (
                "Every candidate bucket had fewer than `tau_coag` cycles in "
                "both transcripts; the adapter cannot evaluate the rule."
            ),
        },
    }
