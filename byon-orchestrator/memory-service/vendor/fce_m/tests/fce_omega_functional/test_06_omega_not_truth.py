"""FN-06 Omega is not truth.

A coagulated Omega must not flip a disputed/rejected runtime decision
into a committed one. Omega marks structural reference, not epistemic
verdict. The runtime/D_Cortex authority is preserved.
"""

from __future__ import annotations

import pytest

from tests.fce_omega_functional.conftest import symbolic_entry
from unified_fragmergent_memory import UnifiedMemoryStore, Config


def _coagulate(store, center=("dragon", "color"), n=3):
    for i in range(n):
        store.write(symbolic_entry(center[0], center[1], "red",
                                    episode_id=i + 1, write_step=0,
                                    zone="committed"))
        store.consolidate(episode_id=i + 1)


def test_disputed_write_after_coagulation_lands_in_runtime_log():
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.0, fce_omega_tau_coag=1)
    s = UnifiedMemoryStore(cfg)
    _coagulate(s)
    assert s.omega_registry_snapshot()["count"] >= 1

    s.write(symbolic_entry("dragon", "color", "blue",
                            episode_id=99, write_step=0, zone="disputed"))
    s.consolidate(episode_id=99)
    adapter = s._runtime_adapter
    assert adapter is not None
    last = adapter.slot_event_log[-1]
    assert last["zone_after"] == "DISPUTED", (
        "FCE must not rewrite a disputed runtime event to committed"
    )
    # And the Omega record's coagulation episode predates the disputed
    # contestation episode (i.e., contestation cannot rewrite history).
    rec = s.omega_registry_snapshot()["records"][0]
    assert rec["coagulated_at_episode"] < 99


def test_registry_refuses_to_invent_records_via_expression_calls():
    from unified_fragmergent_memory.runtime.omega_registry import OmegaRegistry
    reg = OmegaRegistry()
    with pytest.raises(KeyError):
        reg.mark_contested("phantom", episode_id=1, reason="x")
    with pytest.raises(KeyError):
        reg.mark_active("phantom", episode_id=1, reason="x")
    with pytest.raises(KeyError):
        reg.mark_inexpressed("phantom", episode_id=1, reason="x")
    assert len(reg) == 0


def test_advisory_hint_explicitly_disclaims_truth_override():
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.0, fce_omega_tau_coag=1)
    s = UnifiedMemoryStore(cfg)
    _coagulate(s)
    # Now contest the Omega via the registry to drive a contested hint.
    rec = s.omega_registry_snapshot()["records"][0]
    s.fce_omega_observer().omega_registry.mark_contested(
        rec["semantic_center"], episode_id=42, reason="conflict")
    hints = s.fce_advisory_hints()
    contested = [h for h in hints if h.get("kind") == "contested_expression"]
    assert contested, "contested expression should emit a contested hint"
    # The hint text must signal that the runtime stays authoritative.
    assert "runtime" in contested[0]["suggestion"].lower() or \
           "epistemic" in contested[0]["suggestion"].lower()
