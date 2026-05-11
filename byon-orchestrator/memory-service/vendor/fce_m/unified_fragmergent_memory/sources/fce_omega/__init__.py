"""Passthrough wrapper for the fragmergent-causal-exponentiation (FCE-Ω) project.

Mirrors the convention used by sources/memory_engine_runtime: adds the FCE
project root to sys.path so its internal `from src.core...` imports resolve,
then re-exports the public surface under a stable namespace inside UFME.

The FCE-Ω repo is treated read-only (R1 of the UFME contract). Nothing in
this wrapper modifies, monkey-patches or shadows FCE source modules. The
wrapper is the only thing FCE-Ω-aware UFME code is allowed to import from.

Public surface (re-exported from src.core.*):
    Agent, build_Phi_a, build_Pi_s, compute_transport_q, update_residue,
    compute_back_action, initialize_field, dissipate_field,
    normalize_direction, self_index, autoreferential_measure,
    classify_sine_level, classify_attractor, check_coagulation,
    expressed_self, SINE_LEVEL_LABELS, ATTRACTOR_LABELS,
    S_PROTO, S_OPERATIONAL, S_PROPER.

Mission integration: per misiunea.txt §3, FCE-Ω lives here as a separate
source namespace and never as a routing target for read/write/consolidate.
The morphogenesis observer is built on top of this wrapper in
runtime.fce_omega_observer; the OmegaRegistry lives next to it.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import ModuleType

# Vendored layout: the FCE-Ω source lives at
# <repo_root>/vendor/fce_omega_source/, two parents above this wrapper
# inside the package tree. Path-resolution is done relative to this file
# so the integrated project is movable without code edits.
_SOURCE_ROOT = (
    Path(__file__).resolve().parents[3] / "vendor" / "fce_omega_source"
)

if not (_SOURCE_ROOT / "src" / "core" / "agent.py").exists():
    raise ImportError(
        "fce_omega source not found. Looked at "
        f"{_SOURCE_ROOT / 'src' / 'core' / 'agent.py'}."
    )

_root_str = str(_SOURCE_ROOT)
if _root_str not in sys.path:
    sys.path.insert(0, _root_str)

# Resolve the FCE-Ω primitives via the source's own top-level package name.
# Note: FCE-Ω uses `src` as its package name internally. Inserting the repo
# root into sys.path makes those internal imports work; users of this
# wrapper should import FCE-Ω symbols from this namespace, not from `src`.
import src.core.agent as _fce_agent  # noqa: E402
import src.core.field_operators as _fce_field_operators  # noqa: E402
import src.core.metrics as _fce_metrics  # noqa: E402
import src.core.interactions as _fce_interactions  # noqa: E402

agent: ModuleType = _fce_agent
field_operators: ModuleType = _fce_field_operators
metrics: ModuleType = _fce_metrics
interactions: ModuleType = _fce_interactions

# Public types and functions (one-to-one with FCE-Ω public API).
Agent = _fce_agent.Agent

build_Phi_a = _fce_field_operators.build_Phi_a
build_Pi_s = _fce_field_operators.build_Pi_s
compute_transport_q = _fce_field_operators.compute_transport_q
update_residue = _fce_field_operators.update_residue
compute_back_action = _fce_field_operators.compute_back_action
initialize_field = _fce_field_operators.initialize_field
dissipate_field = _fce_field_operators.dissipate_field
normalize_direction = _fce_field_operators.normalize_direction

self_index = _fce_metrics.self_index
autoreferential_measure = _fce_metrics.autoreferential_measure
classify_sine_level = _fce_metrics.classify_sine_level
classify_attractor = _fce_metrics.classify_attractor
check_coagulation = _fce_metrics.check_coagulation
expressed_self = _fce_metrics.expressed_self

SINE_LEVEL_LABELS = _fce_metrics.SINE_LEVEL_LABELS
ATTRACTOR_LABELS = _fce_metrics.ATTRACTOR_LABELS
S_PROTO = _fce_metrics.S_PROTO
S_OPERATIONAL = _fce_metrics.S_OPERATIONAL
S_PROPER = _fce_metrics.S_PROPER

SOURCE_ROOT = _SOURCE_ROOT

__all__ = [
    "agent",
    "field_operators",
    "metrics",
    "interactions",
    "Agent",
    "build_Phi_a",
    "build_Pi_s",
    "compute_transport_q",
    "update_residue",
    "compute_back_action",
    "initialize_field",
    "dissipate_field",
    "normalize_direction",
    "self_index",
    "autoreferential_measure",
    "classify_sine_level",
    "classify_attractor",
    "check_coagulation",
    "expressed_self",
    "SINE_LEVEL_LABELS",
    "ATTRACTOR_LABELS",
    "S_PROTO",
    "S_OPERATIONAL",
    "S_PROPER",
    "SOURCE_ROOT",
]
