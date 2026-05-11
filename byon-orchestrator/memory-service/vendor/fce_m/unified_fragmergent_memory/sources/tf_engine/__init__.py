"""Passthrough wrapper for the fragmergent-tf-engine source project.

PATCHED FOR BYON INTEGRATION (2026-05-11):
- Paths now read from env (FCEM_TF_ENGINE_ROOT, FCEM_TF_EXTRACTED_ROOT).
- Missing source no longer raises ImportError; module imports with stub state.
- Numerical write/read calls (build_husimi_flat, etc.) raise RuntimeError at call time.
"""

from __future__ import annotations

import logging
import os
import sys
import tarfile
from pathlib import Path
from typing import Any, Optional

_log = logging.getLogger("unified_fragmergent_memory.sources.tf_engine")

_DEFAULT_ORIGINAL = Path("c:/Users/Lucian/Desktop/fragmergent-tf-engine")
_DEFAULT_EXTRACTED = Path(
    "c:/Users/Lucian/Desktop/unified-fragmergent-memory-engine/.claude/extracted_sources"
)
_ORIGINAL_SOURCE_FOLDER = Path(
    os.environ.get("FCEM_TF_ENGINE_ROOT", str(_DEFAULT_ORIGINAL))
)
_EXTRACTED_ROOT = Path(
    os.environ.get("FCEM_TF_EXTRACTED_ROOT", str(_DEFAULT_EXTRACTED))
)
_TF_ENGINE_DIR = _EXTRACTED_ROOT / "fragmergent-tf-engine"

AVAILABLE: bool = False

# Stub exports
generate_chirped_gaussian = None
generate_vectorial_packet = None
wigner_distribution = None
husimi_q = None
mutual_information_analytical_chirp = None
mutual_information_legacy_convention = None
mutual_information_numerical = None
quantum_fisher_information_chirp = None
hom_probability = None
hom_scan = None
propagate_semantic = None
propagate_mode_matching = None
packet_centroid = None
measure_group_delay = None
build_memory_bank = None
build_husimi_flat = None
sample_beta_sigma_for_mi = None
softmax_attention = None
mi_attention = None
propagate_step = None
run_propagation = None
predict_label = None
recall_at_k = None
core: Optional[Any] = None
memory: Optional[Any] = None


def _try_load() -> bool:
    """Try to load fragmergent_tf. Return True on success, False on graceful miss."""
    global AVAILABLE
    global generate_chirped_gaussian, generate_vectorial_packet, wigner_distribution
    global husimi_q, mutual_information_analytical_chirp
    global mutual_information_legacy_convention, mutual_information_numerical
    global quantum_fisher_information_chirp, hom_probability, hom_scan
    global propagate_semantic, propagate_mode_matching, packet_centroid
    global measure_group_delay, build_memory_bank, build_husimi_flat
    global sample_beta_sigma_for_mi, softmax_attention, mi_attention
    global propagate_step, run_propagation, predict_label, recall_at_k
    global core, memory

    if not (_TF_ENGINE_DIR / "fragmergent_tf" / "__init__.py").exists():
        tarball = _ORIGINAL_SOURCE_FOLDER / "fragmergent-tf-engine.tar.gz"
        if not tarball.exists():
            _log.warning(
                "tf_engine source not found. Looked at %s and %s. "
                "Set FCEM_TF_ENGINE_ROOT / FCEM_TF_EXTRACTED_ROOT. "
                "Stub mode: numerical write/read will fail at runtime.",
                _TF_ENGINE_DIR / "fragmergent_tf",
                tarball,
            )
            return False
        try:
            _EXTRACTED_ROOT.mkdir(parents=True, exist_ok=True)
            with tarfile.open(tarball, "r:gz") as _tf:
                _tf.extractall(_EXTRACTED_ROOT)
        except OSError as _e:
            _log.warning("tf_engine tarball extraction failed: %s. Stub mode.", _e)
            return False

    root_str = str(_TF_ENGINE_DIR)
    if root_str not in sys.path:
        sys.path.insert(0, root_str)

    try:
        import fragmergent_tf as _fragmergent_tf  # noqa: E402

        from fragmergent_tf import (  # noqa: E402,F401
            build_husimi_flat as _build_husimi_flat,
            build_memory_bank as _build_memory_bank,
            generate_chirped_gaussian as _generate_chirped_gaussian,
            generate_vectorial_packet as _generate_vectorial_packet,
            hom_probability as _hom_probability,
            hom_scan as _hom_scan,
            husimi_q as _husimi_q,
            measure_group_delay as _measure_group_delay,
            mi_attention as _mi_attention,
            mutual_information_analytical_chirp as _mutual_information_analytical_chirp,
            mutual_information_legacy_convention as _mutual_information_legacy_convention,
            mutual_information_numerical as _mutual_information_numerical,
            packet_centroid as _packet_centroid,
            predict_label as _predict_label,
            propagate_mode_matching as _propagate_mode_matching,
            propagate_semantic as _propagate_semantic,
            propagate_step as _propagate_step,
            quantum_fisher_information_chirp as _quantum_fisher_information_chirp,
            recall_at_k as _recall_at_k,
            run_propagation as _run_propagation,
            sample_beta_sigma_for_mi as _sample_beta_sigma_for_mi,
            softmax_attention as _softmax_attention,
            wigner_distribution as _wigner_distribution,
        )

        generate_chirped_gaussian = _generate_chirped_gaussian
        generate_vectorial_packet = _generate_vectorial_packet
        wigner_distribution = _wigner_distribution
        husimi_q = _husimi_q
        mutual_information_analytical_chirp = _mutual_information_analytical_chirp
        mutual_information_legacy_convention = _mutual_information_legacy_convention
        mutual_information_numerical = _mutual_information_numerical
        quantum_fisher_information_chirp = _quantum_fisher_information_chirp
        hom_probability = _hom_probability
        hom_scan = _hom_scan
        propagate_semantic = _propagate_semantic
        propagate_mode_matching = _propagate_mode_matching
        packet_centroid = _packet_centroid
        measure_group_delay = _measure_group_delay
        build_memory_bank = _build_memory_bank
        build_husimi_flat = _build_husimi_flat
        sample_beta_sigma_for_mi = _sample_beta_sigma_for_mi
        softmax_attention = _softmax_attention
        mi_attention = _mi_attention
        propagate_step = _propagate_step
        run_propagation = _run_propagation
        predict_label = _predict_label
        recall_at_k = _recall_at_k

        core = _fragmergent_tf.core
        memory = _fragmergent_tf.memory

        AVAILABLE = True
        return True
    except ImportError as _e:
        _log.warning("tf_engine import failed: %s. Stub mode.", _e)
        return False


_try_load()

SOURCE_ROOT = _TF_ENGINE_DIR if AVAILABLE else None
ORIGINAL_SOURCE_FOLDER = _ORIGINAL_SOURCE_FOLDER

__all__ = [
    "AVAILABLE",
    "generate_chirped_gaussian",
    "generate_vectorial_packet",
    "wigner_distribution",
    "husimi_q",
    "mutual_information_analytical_chirp",
    "mutual_information_legacy_convention",
    "mutual_information_numerical",
    "quantum_fisher_information_chirp",
    "hom_probability",
    "hom_scan",
    "propagate_semantic",
    "propagate_mode_matching",
    "packet_centroid",
    "measure_group_delay",
    "build_memory_bank",
    "build_husimi_flat",
    "sample_beta_sigma_for_mi",
    "softmax_attention",
    "mi_attention",
    "propagate_step",
    "run_propagation",
    "predict_label",
    "recall_at_k",
    "core",
    "memory",
    "SOURCE_ROOT",
    "ORIGINAL_SOURCE_FOLDER",
]
