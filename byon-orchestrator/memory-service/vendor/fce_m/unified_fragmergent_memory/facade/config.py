"""Single configuration object for the unified facade."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Config:
    """Unified-engine configuration.

    All fields have defaults that match the source projects' sealed values.
    Override per-call when needed.
    """

    default_routing: str = "auto"

    tf_engine_temperature_softmax: float = 0.05
    tf_engine_temperature_mi: float = 0.5
    tf_engine_alpha: float = 0.3
    tf_engine_k_top: int = 5

    runtime_latent_mode: str = "advisory"
    runtime_n_promote: int = 2
    runtime_m_retrograde: int = 2
    runtime_k_promote_age: int = 2
    runtime_k_prune_stale: int = 3

    bridges_mi_scale: float = 1.0
    audit_strict: bool = False

    # Cross-substrate coupling (v0.2.0, Pas 5).
    # Per A2 user resolution 2026-05-06: configurable factors with deterministic
    # op order PRUNE -> RETROGRADE -> RECONCILE (no-op) -> PROMOTE; multiplicative
    # composition on the same label.
    cross_substrate_n_steps: int = 3
    cross_substrate_promote_amplification: float = 1.5
    cross_substrate_retrograde_attenuation: float = 0.5
    cross_substrate_prune_mask_value: float = 0.0
    cross_substrate_pressure_seed_strength: float = 1.0
    cross_substrate_propagation_method: str = "softmax"

    # FCE-Omega morphogenetic layer (v0.4.0 — Etapa 1 / Passive Integration).
    # Per misiunea.txt: the observer is OFF by default. When enabled it runs
    # in PASSIVE mode — it never alters UFME routing, writes, or audit_log.
    # It only records its own morphogenesis log and Omega registry.
    fce_omega_enabled: bool = False
    fce_omega_D: int = 16
    fce_omega_theta_s: float = 0.28
    fce_omega_tau_coag: int = 12
    fce_omega_seed: int = 42

    # v0.5.0 multiperspectival observer. When enabled, the observer
    # composes directional inter-center interactions (absorption,
    # repulsion, interference, directional coagulation) and records
    # them in an interaction_log. Coagulated centers project a
    # reference-field anchor onto co-active neighbors. Default OFF so
    # v0.4.x tests keep their bitwise behavior.
    fce_multiperspectival_enabled: bool = False
    # eta controls how much the reference-field anchor from
    # Omega-coagulated neighbors augments a center's per-zone anchor.
    # Anchor is clamped to [0, 1] after composition. The default is
    # conservative; cross-center coupling is morphogenetic, not
    # epistemic, and must not be allowed to coagulate B from A alone.
    fce_multiperspectival_anchor_eta: float = 0.30
    # Pair threshold for shared-coagulation candidates (vendor THETA_PAIR).
    fce_multiperspectival_theta_pair: float = 0.20

    # v0.5.1 semi-active advisory feedback. Default "read_only" matches
    # v0.4.x / v0.5.0 behavior exactly — `advisory_hints()` snapshots are
    # available but no priority-mode feedback is generated or persisted.
    # "priority_only" enables the semi-active channel: after each
    # consolidate the observer derives an `FCEAdvisoryFeedback` log of
    # PRIORITY-METADATA recommendations with bounded priority_delta and
    # full provenance. Even in priority_only mode the observer never
    # writes to slot_event_log / audit_log / runtime adapter / D_Cortex /
    # tf_engine — the mode only adds inspectable advisory metadata.
    fce_advisory_mode: str = "read_only"

    # v0.6.0 native memory prototype. When enabled, the observer derives
    # a ReferenceField from every OmegaRecord (snapshot of Phi_s at
    # coagulation) and classifies subsequent observations on the same
    # center morphogenetically (aligned, tensioned, contested,
    # orthogonal, expression_reinforcing, residue_amplifying). Pairs
    # of coagulated centers can produce OmegaFieldInteraction traces.
    # Default OFF preserves v0.5.1 behavior bit-identical. Even when
    # ON, ReferenceField is never truth authority — it only shapes how
    # future events are READ, not what they MEAN epistemically.
    fce_reference_fields_enabled: bool = False

    def validate(self) -> None:
        if self.default_routing not in {"auto", "explicit"}:
            raise ValueError(
                f"default_routing must be 'auto' or 'explicit', got {self.default_routing!r}"
            )
        if self.runtime_latent_mode not in {"off", "write_only", "advisory"}:
            raise ValueError(
                f"runtime_latent_mode must be 'off', 'write_only', or 'advisory', "
                f"got {self.runtime_latent_mode!r}"
            )
        if self.tf_engine_alpha < 0.0 or self.tf_engine_alpha > 1.0:
            raise ValueError(f"tf_engine_alpha must be in [0,1], got {self.tf_engine_alpha}")
        if self.tf_engine_k_top < 1:
            raise ValueError(f"tf_engine_k_top must be >= 1, got {self.tf_engine_k_top}")
        if self.cross_substrate_n_steps < 1:
            raise ValueError(
                f"cross_substrate_n_steps must be >= 1, got {self.cross_substrate_n_steps}"
            )
        if self.cross_substrate_promote_amplification <= 0:
            raise ValueError("cross_substrate_promote_amplification must be > 0")
        if self.cross_substrate_retrograde_attenuation <= 0:
            raise ValueError("cross_substrate_retrograde_attenuation must be > 0")
        if self.cross_substrate_propagation_method not in {"softmax", "mi"}:
            raise ValueError(
                "cross_substrate_propagation_method must be 'softmax' or 'mi', got "
                f"{self.cross_substrate_propagation_method!r}"
            )
        if self.fce_omega_D < 2:
            raise ValueError(
                f"fce_omega_D must be >= 2, got {self.fce_omega_D}"
            )
        if self.fce_omega_tau_coag < 1:
            raise ValueError(
                f"fce_omega_tau_coag must be >= 1, got {self.fce_omega_tau_coag}"
            )
        if not (0.0 <= self.fce_omega_theta_s <= 1.0):
            raise ValueError(
                f"fce_omega_theta_s must be in [0, 1], got {self.fce_omega_theta_s}"
            )
        if not (0.0 <= self.fce_multiperspectival_anchor_eta <= 1.0):
            raise ValueError(
                "fce_multiperspectival_anchor_eta must be in [0, 1], got "
                f"{self.fce_multiperspectival_anchor_eta}"
            )
        if not (0.0 <= self.fce_multiperspectival_theta_pair <= 1.0):
            raise ValueError(
                "fce_multiperspectival_theta_pair must be in [0, 1], got "
                f"{self.fce_multiperspectival_theta_pair}"
            )
        if self.fce_advisory_mode not in {"read_only", "priority_only"}:
            raise ValueError(
                "fce_advisory_mode must be 'read_only' or "
                f"'priority_only', got {self.fce_advisory_mode!r}"
            )
