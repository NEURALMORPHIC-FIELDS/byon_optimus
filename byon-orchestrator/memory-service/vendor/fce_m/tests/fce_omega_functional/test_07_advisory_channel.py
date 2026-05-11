"""FN-07 Advisory channel.

The advisory_hints() API returns inspectable suggestions. Calling it
produces no side effects: no UFME writes, no audit-log mutation, no
change to the underlying runtime adapter state.
"""

from __future__ import annotations

from tests.fce_omega_functional.conftest import (
    symbolic_entry, runtime_view,
)
from unified_fragmergent_memory import UnifiedMemoryStore, Config


def test_advisory_hints_have_no_side_effects():
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.0, fce_omega_tau_coag=1)
    s = UnifiedMemoryStore(cfg)
    for i in range(4):
        s.write(symbolic_entry("dragon", "color", f"v{i}",
                                episode_id=i + 1, write_step=0,
                                zone="disputed"))
        s.consolidate(episode_id=i + 1)

    before_runtime = runtime_view(s)
    before_mlog = list(s.fce_morphogenesis_log())
    before_reg = s.omega_registry_snapshot()

    _ = s.fce_advisory_hints()
    _ = s.fce_advisory_hints()
    _ = s.fce_advisory_hints()

    after_runtime = runtime_view(s)
    after_mlog = list(s.fce_morphogenesis_log())
    after_reg = s.omega_registry_snapshot()
    assert before_runtime == after_runtime
    assert before_mlog == after_mlog
    assert before_reg == after_reg


def test_high_residue_hint_appears_after_repeated_dispute():
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.0, fce_omega_tau_coag=99)
    s = UnifiedMemoryStore(cfg)
    for i, v in enumerate(["a", "b", "c", "d", "e", "f", "g", "h"]):
        s.write(symbolic_entry("dragon", "color", v,
                                episode_id=1, write_step=i, zone="disputed"))
    s.consolidate(episode_id=1)
    hints = s.fce_advisory_hints()
    kinds = {h["kind"] for h in hints}
    assert "high_residue" in kinds, (
        f"expected a high_residue hint, got kinds={kinds}"
    )


def test_advisory_hints_empty_when_observer_off():
    s = UnifiedMemoryStore(Config(fce_omega_enabled=False))
    s.write(symbolic_entry("dragon", "color", "red", 1, 0))
    s.consolidate(episode_id=1)
    assert s.fce_advisory_hints() == []


def test_advisory_hint_schema_is_inspectable():
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.0, fce_omega_tau_coag=1)
    s = UnifiedMemoryStore(cfg)
    for i in range(3):
        s.write(symbolic_entry("dragon", "color", "red",
                                episode_id=i + 1, write_step=0,
                                zone="committed"))
        s.consolidate(episode_id=i + 1)
    hints = s.fce_advisory_hints()
    assert hints, "expected at least one hint after coagulation"
    for h in hints:
        assert "kind" in h
        assert "suggestion" in h
        assert isinstance(h["suggestion"], str)
        # Every hint references a semantic center (or omega_id) so a
        # consumer can act on it.
        assert ("semantic_center" in h) or ("omega_id" in h)
