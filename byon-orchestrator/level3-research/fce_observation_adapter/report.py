"""Renderers + CLI for the real-FCE-M observation adapter.

ADVISORY ONLY. Same isolation guarantees as the runner: no OmegaRecord,
no OmegaRegistry write, no ReferenceField, no production mutation.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .adapter import (
    AGENT_FIELD_DIM,
    CANDIDATE_BUCKETS,
    SCHEMA_VERSION,
    TAU_COAG,
    THETA_S,
    run_real_fce_observation,
)


def render_json(observation: Dict[str, Any]) -> str:
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
        "| center_id | perspective | n_cycles | max_S_t_real | mean_S_t_real | "
        "longest_run | candidate_cycle_idx | real_FCE_pass | "
        "surrogate_pass | diverge | verdict |"
    )
    out.append("|---|---|---:|---:|---:|---:|---:|:---:|:---:|:---:|---|")
    for b in transcript["buckets"]:
        out.append(
            "| `{cid}` | `{p}` | {n} | {ms} | {mn} | {lr} | {ci} | "
            "{r} | {s} | {d} | **{v}** |".format(
                cid=b["center_id"],
                p=b["perspective"],
                n=b["n_cycles"],
                ms=_fmt_float(b.get("max_S_t_real")),
                mn=_fmt_float(b.get("mean_S_t_real")),
                lr=b.get("longest_run_above_theta", 0),
                ci=(
                    b.get("coagulation_candidate_cycle_index")
                    if b.get("coagulation_candidate_cycle_index") is not None
                    else "—"
                ),
                r=("true" if b.get("would_pass_temporal_rule_real_fce") else "false"),
                s=("true" if b.get("surrogate_would_pass") else "false"),
                d=("true" if b.get("surrogate_vs_real_diverge") else "false"),
                v=b["verdict"],
            )
        )
    return out


def render_markdown(observation: Dict[str, Any]) -> str:
    out: List[str] = []
    out.append("# Isolated Real FCE-M Observation Adapter — Report")
    out.append("")
    out.append(
        "> ADVISORY ONLY. Research artifact. Does NOT declare Level 3, "
        "does NOT create OmegaRecord, does NOT write to OmegaRegistry, "
        "does NOT create ReferenceField, does NOT call "
        "`agent.check_coagulation`, does NOT modify FCE-M vendor."
    )
    out.append("")
    out.append(f"- Schema version: `{observation['schema_version']}`")
    out.append(f"- Branch: `{observation['branch']}`")
    out.append(
        f"- Generated at commit SHA: `{observation['generated_at_commit_sha']}`"
    )
    out.append(f"- `metric_source_real`: `{observation['metric_source_real']}`")
    out.append(
        f"- `metric_source_surrogate`: `{observation['metric_source_surrogate']}`"
    )
    out.append(f"- `theta_s` used: **{observation['theta_s_used']}**")
    out.append(f"- `tau_coag` used: **{observation['tau_coag_used']}**")
    out.append(f"- Agent field dim: **{observation['field_dim_used']}**")
    ai = observation["agent_init"]
    out.append(
        "- Agent init: kappa_0={k}, alpha_0={a}, rho_0={r}, lambda_0={l}".format(
            k=ai["kappa_0"],
            a=ai["alpha_0"],
            r=ai["rho_0"],
            l=ai["lambda_0"],
        )
    )
    out.append(
        f"- Production config untouched: **{observation['production_config_untouched']}**"
    )
    out.append(
        f"- FCE-M vendor unmodified: **{observation['fce_m_vendor_unmodified']}**"
    )
    out.append("")

    out.append("## Hard isolation guarantees")
    out.append("")
    out.append(
        f"- Level 3 declared: **{observation['level_3_declared']}** (must be false)"
    )
    out.append(
        f"- Natural Omega created: **{observation['natural_omega_created']}** (must be false)"
    )
    out.append(f"- No OmegaRecord created: **{observation['no_omega_record_created']}**")
    out.append(f"- No OmegaRegistry write: **{observation['no_omega_registry_write']}**")
    out.append(
        f"- No ReferenceField created: **{observation['no_reference_field_created']}**"
    )
    out.append(
        f"- `agent.check_coagulation` called: **{observation['agent_check_coagulation_called']}** (must be false)"
    )
    out.append("")
    out.append("### Isolation notes")
    out.append("")
    for note in observation["isolation_notes"]:
        out.append(f"- {note}")
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
        out.append("")
        out.append("### Per-bucket real-FCE-M observation")
        out.append("")
        out.extend(_bucket_table(transcript))
        out.append("")

        # Real vs surrogate divergence highlights, if any.
        diverge = [
            b
            for b in transcript["buckets"]
            if b.get("surrogate_vs_real_diverge")
        ]
        if diverge:
            out.append("### Divergence notes (real vs surrogate)")
            out.append("")
            for b in diverge:
                out.append(
                    f"- `{b['center_id']}`: surrogate={b['surrogate_would_pass']}, "
                    f"real-FCE={b['would_pass_temporal_rule_real_fce']} — "
                    f"{b['divergence_note']}"
                )
            out.append("")

    out.append("## A/B family cross-status (real FCE-M)")
    out.append("")
    out.append(
        "| family | A real verdict | B real verdict | A real pass | "
        "B real pass | A surr pass | B surr pass | A diverge | B diverge | comparable |"
    )
    out.append("|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|")
    for key, fs in observation["family_status"].items():
        out.append(
            "| `{k}` | **{a}** | **{b}** | {ar} | {br} | {as_} | {bs} | "
            "{ad} | {bd} | {comp} |".format(
                k=key,
                a=fs["a_verdict_real_fce"],
                b=fs["b_verdict_real_fce"],
                ar=("true" if fs["a_would_pass_real_fce"] else "false"),
                br=("true" if fs["b_would_pass_real_fce"] else "false"),
                as_=("true" if fs["a_surrogate_would_pass"] else "false"),
                bs=("true" if fs["b_surrogate_would_pass"] else "false"),
                ad=("true" if fs["a_surrogate_vs_real_diverge"] else "false"),
                bd=("true" if fs["b_surrogate_vs_real_diverge"] else "false"),
                comp=("true" if fs["comparable_behavior_real_fce"] else "false"),
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
    out.append("- No `agent.check_coagulation` call.")
    out.append("- `theta_s = 0.28` unchanged from operator-locked value.")
    out.append("- `tau_coag = 12` unchanged from operator-locked value.")
    out.append("- Production config untouched.")
    out.append("- FCE-M vendor unmodified.")
    out.append(
        "- Real FCE-M math is applied to research-derived inputs "
        "(hash-based field vectors + surrogate-derived anchor); the divergence "
        "from a production replay is documented here, not hidden."
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
    out_dir.mkdir(parents=True, exist_ok=True)
    observation = run_real_fce_observation(commit_sha=commit_sha)
    json_path = out_dir / "fce_observation_adapter_report.json"
    md_path = out_dir / "fce_observation_adapter_report.md"
    json_path.write_text(render_json(observation) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(observation), encoding="utf-8")
    return json_path, md_path


def main(argv: Optional[List[str]] = None) -> int:
    out_dir = _RESEARCH_ROOT / "reports"
    json_path, md_path = write_reports(out_dir)
    sys.stdout.write(f"wrote {json_path}\n")
    sys.stdout.write(f"wrote {md_path}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
