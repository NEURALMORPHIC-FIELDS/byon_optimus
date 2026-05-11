"""Verify the FCE-Omega source wrapper exposes the FCE-Omega public surface.

Mirrors tests/passthrough/test_memory_engine_runtime_passthrough.py.
"""

from __future__ import annotations


def test_fce_omega_symbols_reachable():
    from unified_fragmergent_memory.sources import fce_omega
    expected = [
        "Agent",
        "build_Phi_a", "build_Pi_s", "compute_transport_q",
        "update_residue", "compute_back_action",
        "initialize_field", "dissipate_field", "normalize_direction",
        "self_index", "autoreferential_measure",
        "classify_sine_level", "classify_attractor",
        "check_coagulation", "expressed_self",
        "SINE_LEVEL_LABELS", "ATTRACTOR_LABELS",
        "S_PROTO", "S_OPERATIONAL", "S_PROPER",
    ]
    for name in expected:
        assert hasattr(fce_omega, name), \
            f"missing {name!r} on unified fce_omega namespace"


def test_fce_omega_constants_match_source():
    from unified_fragmergent_memory.sources import fce_omega
    assert fce_omega.S_PROTO == 0.05
    assert fce_omega.S_OPERATIONAL == 0.15
    assert fce_omega.S_PROPER == 0.35


def test_fce_omega_agent_construction_runs():
    from unified_fragmergent_memory.sources import fce_omega
    import numpy as np
    rng = np.random.default_rng(0)
    agent = fce_omega.Agent(idx=0, D=8, rng=rng)
    assert agent.Omega == 0
    assert agent.sine_type == "not_coagulated"
    assert agent.kappa > 0
    assert agent.Phi_s.shape == (8,)


def test_fce_omega_self_index_signature():
    from unified_fragmergent_memory.sources import fce_omega
    import numpy as np
    rng = np.random.default_rng(0)
    agent = fce_omega.Agent(idx=0, D=4, rng=rng)
    delta = np.array([1.0, 0.5, -0.25, 0.1])
    E = agent.Pi_s @ delta
    S_t, AR, I_t, B_t = fce_omega.self_index(
        agent.Pi_s, agent.Phi_s, E, delta, agent.Z, agent.kappa
    )
    assert 0 <= S_t
    assert 0 <= AR <= 1
    assert 0 <= I_t
    assert 0 < B_t <= 1
