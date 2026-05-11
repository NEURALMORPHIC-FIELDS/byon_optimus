"""Verify tf_engine source primitives are reachable through the unified namespace.

Invariant I1: every public source-project symbol is reachable through
unified_fragmergent_memory.sources.tf_engine.*

Invariant I3: tf_engine's own smoke tests pass when invoked through the
wrapped source. We instantiate the same fixtures and assertions.
"""

from __future__ import annotations

import numpy as np
import pytest


def test_tf_engine_top_level_symbols_reachable():
    from unified_fragmergent_memory.sources import tf_engine
    expected = [
        "generate_chirped_gaussian", "generate_vectorial_packet",
        "wigner_distribution", "husimi_q",
        "mutual_information_analytical_chirp",
        "mutual_information_legacy_convention",
        "mutual_information_numerical",
        "quantum_fisher_information_chirp",
        "hom_probability", "hom_scan",
        "propagate_semantic", "propagate_mode_matching",
        "packet_centroid", "measure_group_delay",
        "build_memory_bank", "build_husimi_flat",
        "sample_beta_sigma_for_mi",
        "softmax_attention", "mi_attention",
        "propagate_step", "run_propagation",
        "predict_label", "recall_at_k",
    ]
    for name in expected:
        assert hasattr(tf_engine, name), f"missing {name} on unified tf_engine namespace"
        assert callable(getattr(tf_engine, name)), f"{name} not callable"


def test_chirped_gaussian_normalisation_through_facade():
    from unified_fragmergent_memory.sources import tf_engine
    t = np.linspace(-12.0, 12.0, 2048)
    psi = tf_engine.generate_chirped_gaussian(t, omega0=5.0, sigma_t=1.0, beta=0.5)
    dt = float(t[1] - t[0])
    norm_sq = np.sum(np.abs(psi) ** 2) * dt
    assert np.isclose(norm_sq, 1.0, atol=1e-10), f"|psi|^2 dt = {norm_sq}, expected 1.0"


def test_mi_analytical_corrected_formula_through_facade():
    from unified_fragmergent_memory.sources import tf_engine
    assert tf_engine.mutual_information_analytical_chirp(beta=0.0, sigma_t=1.0) == 0.0
    expected = 0.5 * np.log2(1 + 16 * 4.0)
    actual = tf_engine.mutual_information_analytical_chirp(beta=2.0, sigma_t=1.0)
    assert np.isclose(actual, expected, rtol=1e-12), f"got {actual}, expected {expected}"


def test_qfi_closed_form_through_facade():
    from unified_fragmergent_memory.sources import tf_engine
    for sigma_t in [0.5, 1.0, 1.5, 2.0]:
        actual = tf_engine.quantum_fisher_information_chirp(beta=1.0, sigma_t=sigma_t)
        expected = 8.0 * sigma_t ** 4
        assert np.isclose(actual, expected, rtol=1e-10), \
            f"QFI mismatch at sigma_t={sigma_t}: got {actual}, expected {expected}"


def test_memory_bank_shape_through_facade():
    from unified_fragmergent_memory.sources import tf_engine
    bank = tf_engine.build_memory_bank(
        mi_targets=(0.5, 1.5, 2.5, 3.5),
        entries_per_label=4,
        seed=42,
    )
    assert "vectors" in bank and "mis" in bank and "labels" in bank
    assert bank["vectors"].shape[0] == 16
    assert bank["mis"].shape[0] == 16
    assert bank["labels"].shape[0] == 16


def test_softmax_attention_normalisation_through_facade():
    from unified_fragmergent_memory.sources import tf_engine
    rng = np.random.default_rng(0)
    bank_vecs = rng.normal(size=(8, 32))
    q_vec = rng.normal(size=32)
    weights = tf_engine.softmax_attention(q_vec, bank_vecs, temperature=0.05)
    assert weights.shape == (8,)
    assert np.all(weights >= 0)
    assert np.isclose(weights.sum(), 1.0)
