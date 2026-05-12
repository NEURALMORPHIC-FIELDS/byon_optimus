"""Renderers + CLI for the coagulation observation runner.

ADVISORY ONLY. The renderers convert a `run_observation()` dict into
markdown + JSON. Neither renderer mutates state, calls production code,
nor creates Omega.

CLI:

    cd byon-orchestrator/level3-research
    python -m coagulation_observation
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .runner import (
    CANDIDATE_BUCKETS,
    SCHEMA_VERSION,
    TAU_COAG,
    THETA_S,
    run_observation,
)


# ---------------------------------------------------------------------------
# Renderers
# ---------------------------------------------------------------------------


def render_json(observation: Dict[str, Any]) -> str:
    """Render the observation dict to a stable, indented JSON string."""
    return json.dumps(observation, indent=2, ensure_ascii=False, sort_keys=False)


def _fmt_float(v: Any, fmt: str = "{:.4f}") -> str:
    if v is None:
        return "—"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return fmt.format(float(v))
    return str(v)


def _bucket_table(transcript: Dict[str, Any]) -> List[str]:
    out: List[str] = []
    out.append(
        "| center_id | perspective | n_cycles | max_s_t | mean_s_t | "
        "longest_run | first_above | candidate_cycle_idx | "
        "would_coagulate_surrogate | would_coagulate_isolated | verdict |"
    )
    out.append(
        "|---|---|---:|---:|---:|---:|---:|---:|:---:|:---:|---|"
    )
    for b in transcript["buckets"]:
        out.append(
            "| `{cid}` | `{p}` | {n} | {ms} | {mn} | {lr} | {fa} | "
            "{ci} | {sg} | {iso} | **{v}** |".format(
                cid=b["center_id"],
                p=b["perspective"],
                n=b["n_cycles"],
                ms=_fmt_float(b.get("max_s_t")),
                mn=_fmt_float(b.get("mean_s_t")),
                lr=b.get("longest_run_above_threshold", 0),
                fa=(
                    b.get("first_cycle_above_threshold")
                    if b.get("first_cycle_above_threshold") is not None
                    else "—"
                ),
                ci=(
                    b.get("coagulation_candidate_cycle_index")
                    if b.get("coagulation_candidate_cycle_index") is not None
                    else "—"
                ),
                sg=("true" if b["would_coagulate_surrogate"] else "false"),
                iso=("true" if b["would_coagulate_isolated_rule"] else "false"),
                v=b["verdict"],
            )
        )
    return out


def render_markdown(observation: Dict[str, Any]) -> str:
    """Render the observation dict to a human-readable markdown report."""
    out: List[str] = []
    out.append("# Controlled Coagulation Observation Report")
    out.append("")
    out.append(
        "> ADVISORY ONLY. Research artifact. Does NOT declare Level 3, "
        "does NOT create OmegaRecord, does NOT write to OmegaRegistry, "
        "does NOT modify production config, does NOT call the production "
        "`check_coagulation`. Inputs are surrogate S_t labeled "
        f"`{observation['metric_source']}`."
    )
    out.append("")
    out.append(f"- Schema version: `{observation['schema_version']}`")
    out.append(f"- Branch: `{observation['branch']}`")
    out.append(
        f"- Generated at commit SHA: `{observation['generated_at_commit_sha']}`"
    )
    out.append(f"- Metric source: `{observation['metric_source']}`")
    out.append(f"- `theta_s` used: **{observation['theta_s_used']}**")
    out.append(f"- `tau_coag` used: **{observation['tau_coag_used']}**")
    out.append(f"- `theta_s` source: {observation['theta_s_source']}")
    out.append(f"- `tau_coag` source: {observation['tau_coag_source']}")
    out.append(
        f"- Production config untouched: **{observation['production_config_untouched']}**"
    )
    out.append("")

    out.append("## Hard isolation guarantees")
    out.append("")
    out.append(
        f"- Level 3 declared: **{observation['level_3_declared']}** "
        "(must be false)"
    )
    out.append(
        f"- Natural Omega created: **{observation['natural_omega_created']}** "
        "(must be false)"
    )
    out.append(f"- No OmegaRecord created: **{observation['no_omega_record_created']}**")
    out.append(f"- No OmegaRegistry write: **{observation['no_omega_registry_write']}**")
    out.append(
        f"- No ReferenceField created: **{observation['no_reference_field_created']}**"
    )
    out.append("")

    out.append("## Candidate buckets")
    out.append("")
    for cb in observation["candidate_buckets"]:
        out.append(f"- `{cb['center_id']}` / `{cb['perspective']}`")
    out.append("")

    for transcript in observation["transcripts"]:
        out.append(f"## Transcript {transcript['label']} (seed {transcript['seed']})")
        out.append("")
        out.append(f"- `transcript_id`: `{transcript['transcript_id']}`")
        out.append(f"- `n_rows`: {transcript['n_rows']}")
        out.append(f"- `n_events`: {transcript['n_events']}")
        out.append(f"- `n_centers`: {transcript['n_centers']}")
        out.append(f"- `n_summaries`: {transcript['n_summaries']}")
        out.append(
            f"- `n_potential_omega_signals`: {transcript['n_potential_omega_signals']}"
        )
        out.append(f"- `invariant_ok`: **{transcript['invariant_ok']}**")
        out.append(f"- `audit_flags`: `{transcript['audit_flags']}`")
        out.append(f"- `metric_source`: `{transcript['metric_source']}`")
        out.append("")
        out.append("### Per-bucket observation")
        out.append("")
        out.extend(_bucket_table(transcript))
        out.append("")

    # Family A-vs-B cross-status.
    out.append("## A/B family cross-status")
    out.append("")
    out.append(
        "| family | A verdict | B verdict | A surrogate | A isolated | "
        "B surrogate | B isolated | comparable |"
    )
    out.append("|---|---|---|:---:|:---:|:---:|:---:|:---:|")
    for key, fs in observation["family_status"].items():
        out.append(
            "| `{k}` | **{a}** | **{b}** | {sa} | {ia} | {sb} | {ib} | {comp} |".format(
                k=key,
                a=fs["a_verdict"],
                b=fs["b_verdict"],
                sa=("true" if fs["would_coagulate_surrogate_a"] else "false"),
                ia=("true" if fs["would_coagulate_isolated_a"] else "false"),
                sb=("true" if fs["would_coagulate_surrogate_b"] else "false"),
                ib=("true" if fs["would_coagulate_isolated_b"] else "false"),
                comp=("true" if fs["comparable_behavior"] else "false"),
            )
        )
    out.append("")

    out.append("## Final verdict")
    out.append("")
    out.append(f"**`{observation['final_verdict']}`**")
    out.append("")
    out.append(observation["verdict_legend"][observation["final_verdict"]])
    out.append("")

    out.append("## Confirmations")
    out.append("")
    out.append("- Level 3 is **NOT declared**.")
    out.append("- No OmegaRecord created.")
    out.append("- No OmegaRegistry write.")
    out.append("- No ReferenceField created.")
    out.append("- `theta_s = 0.28` unchanged from operator-locked value.")
    out.append("- `tau_coag = 12` unchanged from operator-locked value.")
    out.append("- Production config untouched.")
    out.append(
        "- Inputs are surrogate S_t (`research_surrogate_v1_not_fce_production`); "
        "this is a research observation, not a production coagulation event."
    )
    out.append("")
    return "\n".join(out) + "\n"


# ---------------------------------------------------------------------------
# Write reports
# ---------------------------------------------------------------------------


_RESEARCH_ROOT = Path(__file__).resolve().parent.parent


def write_reports(
    out_dir: Path,
    *,
    commit_sha: Optional[str] = None,
) -> Tuple[Path, Path]:
    """Run the observation and write both reports to `out_dir`."""
    out_dir.mkdir(parents=True, exist_ok=True)
    observation = run_observation(commit_sha=commit_sha)
    json_path = out_dir / "coagulation_observation_report.json"
    md_path = out_dir / "coagulation_observation_report.md"
    json_path.write_text(render_json(observation) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(observation), encoding="utf-8")
    return json_path, md_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv: Optional[List[str]] = None) -> int:
    out_dir = _RESEARCH_ROOT / "reports"
    json_path, md_path = write_reports(out_dir)
    sys.stdout.write(f"wrote {json_path}\n")
    sys.stdout.write(f"wrote {md_path}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
