"""R10b reproduction inside the integrated UFME + FCE-Omega runtime.

The FCE-Omega paper's R10b finding (regimes/multiperspectival.py: integrative
coagulation Omega_0 = 1 at t=11, kappa=0.612 under germinal incubation)
demonstrates the central theoretical event of FCE-Omega: irreversible
coagulation produced by a coherent trajectory, not by a manual switch.

This script reproduces the *principle* of R10b inside the integrated
runtime — not the exact numbers, which depend on the synthetic
Lie-algebra dynamics used in the standalone regime. Instead we drive a
single semantic center (`phoenix::identity`) through:

    1. germinal incubation: a coherent sequence of COMMITTED writes
       that pushes S_t above theta_s for tau_coag consecutive cycles,
       triggering Omega = 1 through `agent.check_coagulation`;

    2. post-coagulation perturbation: a sequence of DISPUTED writes
       that drives S_t back below theta_s and grows residue Z;

    3. invariant check: Omega stays at 1, the runtime's slot_event
       still reports DISPUTED zone, the OmegaRecord's coagulation
       episode and id are immutable.

Output is a JSON trajectory under results/etapa_02_v0_4_2_r10b_integrated/.

Run:

    python experiments/r10b_integrated_phoenix.py
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


# Realistic thresholds picked by the smoke loop in v0.4.2:
#   - theta_s=0.10 is well above the noise floor (S_t hovers ~0.001
#     for an unincubated center under random delta_X) so coagulation
#     cannot fire spuriously.
#   - tau_coag=3 represents a genuine germinal incubation window;
#     S_t must stay above theta for three consecutive cycles before
#     Omega flips, which the integrated dynamics naturally produces
#     during the early "coherent ramp" of the trajectory.
THETA_S_DEFAULT: float = 0.10
TAU_COAG_DEFAULT: int = 3
D_DEFAULT: int = 16
SEED_DEFAULT: int = 42

GERMINAL_EPISODES_DEFAULT: int = 8
PERTURBATION_EPISODES_DEFAULT: int = 8


@dataclass
class CycleRow:
    phase: str
    episode_id: int
    cycle: int
    S_t: float
    AR: float
    kappa: float
    alpha: float
    rho: float
    Z_norm: float
    delta_X_norm: float
    omega: int
    newly_coagulated: bool
    omega_id: Optional[str]
    zone_seen: str


@dataclass
class R10bExperimentReport:
    """Self-contained R10b trajectory artifact."""

    semantic_center: str
    theta_s: float
    tau_coag: int
    D: int
    seed: int
    germinal_episodes: int
    perturbation_episodes: int

    coagulation_observed: bool = False
    coagulation_was_synthetic: bool = False  # True if we manually forced it; FALSE here
    coagulation_at_episode: Optional[int] = None
    coagulation_at_cycle: Optional[int] = None
    S_t_at_coagulation: Optional[float] = None
    kappa_at_coagulation: Optional[float] = None
    AR_at_coagulation: Optional[float] = None
    sine_type: Optional[str] = None
    omega_id: Optional[str] = None
    duration_above_threshold: int = 0

    # Post-perturbation invariants
    omega_remained_1: bool = False
    omega_id_immutable: bool = False
    coagulation_episode_immutable: bool = False
    S_t_at_coagulation_immutable: bool = False
    runtime_log_last_disputed_zone_intact: bool = False
    source_episodes_complete: bool = False
    source_events_complete: bool = False

    # Persistence
    persist_load_roundtrip_ok: bool = False

    trajectory: List[CycleRow] = field(default_factory=list)

    def to_json_safe(self) -> Dict[str, Any]:
        payload = asdict(self)
        payload["trajectory"] = [asdict(c) for c in self.trajectory]
        return payload


def _slot_event(entity: str, attr: str, value: str, value_idx: int,
                episode_id: int, write_step: int,
                zone: str) -> Dict[str, Any]:
    return {
        "entity_id": entity, "attr_type": attr,
        "value_str": value, "value_idx": int(value_idx),
        "episode_id": episode_id, "write_step": write_step,
        "zone_after": zone,
    }


def run(
    theta_s: float = THETA_S_DEFAULT,
    tau_coag: int = TAU_COAG_DEFAULT,
    D: int = D_DEFAULT,
    seed: int = SEED_DEFAULT,
    germinal_episodes: int = GERMINAL_EPISODES_DEFAULT,
    perturbation_episodes: int = PERTURBATION_EPISODES_DEFAULT,
    out_dir: Optional[Path] = None,
) -> R10bExperimentReport:
    """Drive the trajectory and return a structured report."""
    from unified_fragmergent_memory import UnifiedMemoryStore, Config

    cfg = Config(
        fce_omega_enabled=True,
        fce_omega_D=D,
        fce_omega_theta_s=theta_s,
        fce_omega_tau_coag=tau_coag,
        fce_omega_seed=seed,
    )
    s = UnifiedMemoryStore(cfg)
    center = "phoenix::identity"
    rep = R10bExperimentReport(
        semantic_center=center,
        theta_s=theta_s, tau_coag=tau_coag, D=D, seed=seed,
        germinal_episodes=germinal_episodes,
        perturbation_episodes=perturbation_episodes,
    )

    # --- Phase 1: germinal incubation (coherent committed writes) ---
    for ep in range(1, germinal_episodes + 1):
        s.write(_slot_event(
            "phoenix", "identity", "fire-bird", value_idx=1,
            episode_id=ep, write_step=0, zone="committed",
        ))
        s.consolidate(episode_id=ep)

    log = s.fce_morphogenesis_log()
    for r in log:
        if r["semantic_center"] != center:
            continue
        rep.trajectory.append(CycleRow(
            phase="germinal",
            episode_id=int(r["episode_id"]),
            cycle=int(r["cycle"]),
            S_t=float(r["S_t"]),
            AR=float(r["AR"]),
            kappa=float(r["kappa"]),
            alpha=float(r["alpha"]),
            rho=float(r["rho"]),
            Z_norm=float(r["Z_norm"]),
            delta_X_norm=float(r["delta_X_norm"]),
            omega=int(r["omega"]),
            newly_coagulated=bool(r["newly_coagulated"]),
            omega_id=r["omega_id"],
            zone_seen=str(r["zone_seen"]),
        ))

    reg = s.omega_registry_snapshot()
    if reg["count"] >= 1:
        rec_at_coag = next(
            r for r in reg["records"] if r["semantic_center"] == center
        )
        # Find the AR at the exact coagulation cycle from the trajectory.
        coag_row = next(
            (c for c in rep.trajectory if c.newly_coagulated), None
        )
        rep.coagulation_observed = True
        rep.coagulation_was_synthetic = False  # produced by check_coagulation rule
        rep.coagulation_at_episode = int(rec_at_coag["coagulated_at_episode"])
        rep.coagulation_at_cycle = int(rec_at_coag["coagulated_at_cycle"])
        rep.S_t_at_coagulation = float(rec_at_coag["S_t_at_coagulation"])
        rep.kappa_at_coagulation = float(rec_at_coag["kappa_at_coagulation"])
        rep.AR_at_coagulation = float(coag_row.AR) if coag_row else None
        rep.sine_type = str(rec_at_coag["sine_type"])
        rep.omega_id = str(rec_at_coag["omega_id"])
        rep.duration_above_threshold = int(rec_at_coag["duration_above_threshold"])
        rep.source_episodes_complete = bool(rec_at_coag["source_episodes"])
        rep.source_events_complete = bool(rec_at_coag["source_events"])

    # If we did not coagulate in the germinal phase, return early — the
    # rest of the assertions are vacuous and the experiment failed.
    if not rep.coagulation_observed:
        if out_dir is not None:
            _save_report(rep, out_dir)
        return rep

    # --- Phase 2: post-coagulation perturbation (disputed writes) ---
    log_size_before = len(s.fce_morphogenesis_log())
    perturb_values = [
        "blue", "green", "yellow", "violet", "cyan",
        "ochre", "indigo", "rust", "amber", "slate", "moss",
        "claret", "olive", "saffron", "emerald", "lapis",
    ][:perturbation_episodes]
    for k, v in enumerate(perturb_values):
        s.write(_slot_event(
            "phoenix", "identity", v, value_idx=100 + k,
            episode_id=100 + k, write_step=0, zone="disputed",
        ))
        s.consolidate(episode_id=100 + k)
    perturb_rows = [r for r in s.fce_morphogenesis_log()[log_size_before:]
                    if r["semantic_center"] == center]
    for r in perturb_rows:
        rep.trajectory.append(CycleRow(
            phase="perturbation",
            episode_id=int(r["episode_id"]),
            cycle=int(r["cycle"]),
            S_t=float(r["S_t"]),
            AR=float(r["AR"]),
            kappa=float(r["kappa"]),
            alpha=float(r["alpha"]),
            rho=float(r["rho"]),
            Z_norm=float(r["Z_norm"]),
            delta_X_norm=float(r["delta_X_norm"]),
            omega=int(r["omega"]),
            newly_coagulated=bool(r["newly_coagulated"]),
            omega_id=r["omega_id"],
            zone_seen=str(r["zone_seen"]),
        ))

    rec_after = next(
        r for r in s.omega_registry_snapshot()["records"]
        if r["semantic_center"] == center
    )
    last_runtime_event = s._runtime_adapter.slot_event_log[-1]
    rep.omega_remained_1 = all(c.omega == 1 for c in perturb_rows_to_cycles(rep))
    rep.omega_id_immutable = rec_after["omega_id"] == rep.omega_id
    rep.coagulation_episode_immutable = (
        rec_after["coagulated_at_episode"] == rep.coagulation_at_episode
    )
    rep.S_t_at_coagulation_immutable = (
        rec_after["S_t_at_coagulation"] == rep.S_t_at_coagulation
    )
    rep.runtime_log_last_disputed_zone_intact = (
        last_runtime_event["zone_after"] == "DISPUTED"
    )

    # --- Phase 3: persist / load roundtrip ---
    import tempfile
    import os
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False
    ) as f:
        path = f.name
    try:
        s.fce_omega_observer().persist(path)
        from unified_fragmergent_memory import UnifiedMemoryStore as _UMS
        s2 = _UMS(cfg)
        s2._ensure_fce_observer().load(path)
        rec_reloaded = next(
            r for r in s2.omega_registry_snapshot()["records"]
            if r["semantic_center"] == center
        )
        rep.persist_load_roundtrip_ok = (
            rec_reloaded["omega_id"] == rep.omega_id
            and rec_reloaded["coagulated_at_episode"] == rep.coagulation_at_episode
            and rec_reloaded["S_t_at_coagulation"] == rep.S_t_at_coagulation
        )
    finally:
        os.unlink(path)

    if out_dir is not None:
        _save_report(rep, out_dir)
    return rep


def perturb_rows_to_cycles(rep: R10bExperimentReport) -> List[CycleRow]:
    """Helper: subset of trajectory that belongs to the perturbation phase."""
    return [c for c in rep.trajectory if c.phase == "perturbation"]


def _save_report(rep: R10bExperimentReport, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "r10b_trajectory.json").write_text(
        json.dumps(rep.to_json_safe(), indent=2), encoding="utf-8")
    # Human-readable trajectory dump.
    lines: List[str] = [
        "R10b integrated reproduction (phoenix::identity)",
        "================================================",
        f"  theta_s={rep.theta_s}  tau_coag={rep.tau_coag}  D={rep.D}  seed={rep.seed}",
        f"  germinal_episodes={rep.germinal_episodes}  "
        f"perturbation_episodes={rep.perturbation_episodes}",
        "",
        f"  Omega produced by RULE (check_coagulation): {rep.coagulation_observed}",
        f"  Was Omega set synthetically? {rep.coagulation_was_synthetic}",
        f"  Coagulated at episode={rep.coagulation_at_episode} "
        f"cycle={rep.coagulation_at_cycle}",
        f"  S_t_at_coagulation={rep.S_t_at_coagulation}",
        f"  kappa_at_coagulation={rep.kappa_at_coagulation}",
        f"  AR_at_coagulation={rep.AR_at_coagulation}",
        f"  sine_type={rep.sine_type}",
        f"  omega_id={rep.omega_id}",
        f"  duration_above_threshold={rep.duration_above_threshold}",
        "",
        "  Post-perturbation invariants:",
        f"    omega_remained_1                       : {rep.omega_remained_1}",
        f"    omega_id_immutable                     : {rep.omega_id_immutable}",
        f"    coagulation_episode_immutable          : {rep.coagulation_episode_immutable}",
        f"    S_t_at_coagulation_immutable           : {rep.S_t_at_coagulation_immutable}",
        f"    runtime_log_last_disputed_zone_intact  : {rep.runtime_log_last_disputed_zone_intact}",
        f"    source_episodes_complete               : {rep.source_episodes_complete}",
        f"    source_events_complete                 : {rep.source_events_complete}",
        f"    persist_load_roundtrip_ok              : {rep.persist_load_roundtrip_ok}",
        "",
        "Trajectory:",
        f"  {'phase':<13} {'ep':>4} {'cyc':>4} {'S_t':>8} {'AR':>6} "
        f"{'kappa':>6} {'rho':>6} {'Z':>6} {'omega':>5} new",
    ]
    for c in rep.trajectory:
        lines.append(
            f"  {c.phase:<13} {c.episode_id:>4} {c.cycle:>4} "
            f"{c.S_t:>8.4f} {c.AR:>6.3f} {c.kappa:>6.3f} "
            f"{c.rho:>6.3f} {c.Z_norm:>6.3f} {c.omega:>5} "
            f"{'+' if c.newly_coagulated else ' '}"
        )
    (out_dir / "r10b_trajectory.txt").write_text(
        "\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--out",
                   default="results/etapa_02_v0_4_2_r10b_integrated/r10b_trajectory")
    p.add_argument("--theta-s", type=float, default=THETA_S_DEFAULT)
    p.add_argument("--tau-coag", type=int, default=TAU_COAG_DEFAULT)
    p.add_argument("--D", type=int, default=D_DEFAULT)
    p.add_argument("--seed", type=int, default=SEED_DEFAULT)
    p.add_argument("--germinal", type=int, default=GERMINAL_EPISODES_DEFAULT)
    p.add_argument("--perturbation", type=int, default=PERTURBATION_EPISODES_DEFAULT)
    args = p.parse_args()
    out_dir = Path(args.out).resolve().parent
    rep = run(
        theta_s=args.theta_s, tau_coag=args.tau_coag,
        D=args.D, seed=args.seed,
        germinal_episodes=args.germinal,
        perturbation_episodes=args.perturbation,
        out_dir=out_dir,
    )
    print((out_dir / "r10b_trajectory.txt").read_text(encoding="utf-8"))
    return 0 if rep.coagulation_observed else 1


if __name__ == "__main__":
    raise SystemExit(main())
