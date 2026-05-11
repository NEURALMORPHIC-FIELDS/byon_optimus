"""FN-12 Persistence / reload.

Observer state — morphogenesis log, omega registry, per-center agents —
must roundtrip through persist() / load(). Reloading does NOT replay
UFME events; it is a passive restore.
"""

from __future__ import annotations

import json

from tests.fce_omega_functional.conftest import symbolic_entry
from unified_fragmergent_memory import UnifiedMemoryStore, Config


def test_observer_roundtrip(tmp_path):
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.0, fce_omega_tau_coag=1)
    s = UnifiedMemoryStore(cfg)
    for i in range(4):
        s.write(symbolic_entry("dragon", "color", "red",
                                episode_id=i + 1, write_step=0,
                                zone="committed"))
        s.consolidate(episode_id=i + 1)
    obs = s.fce_omega_observer()
    assert obs is not None
    path = str(tmp_path / "observer.json")
    obs.persist(path)
    snap_before = obs.metrics_snapshot()
    log_before = list(s.fce_morphogenesis_log())
    reg_before = s.omega_registry_snapshot()

    s2 = UnifiedMemoryStore(cfg)
    obs2 = s2._ensure_fce_observer()
    obs2.load(path)
    snap_after = obs2.metrics_snapshot()
    log_after = s2.fce_morphogenesis_log()
    reg_after = s2.omega_registry_snapshot()
    assert snap_before["centers"] == snap_after["centers"]
    assert snap_before["coagulated_centers"] == snap_after["coagulated_centers"]
    assert snap_before["slot_cursor"] == snap_after["slot_cursor"]
    assert log_before == log_after
    assert reg_before == reg_after


def test_omega_irreversibility_survives_reload(tmp_path):
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.0, fce_omega_tau_coag=1)
    s = UnifiedMemoryStore(cfg)
    for i in range(3):
        s.write(symbolic_entry("dragon", "color", "red",
                                episode_id=i + 1, write_step=0,
                                zone="committed"))
        s.consolidate(episode_id=i + 1)
    rec = s.omega_registry_snapshot()["records"][0]
    s.fce_omega_observer().omega_registry.mark_contested(
        rec["semantic_center"], episode_id=99, reason="x")
    path = str(tmp_path / "obs.json")
    s.fce_omega_observer().persist(path)

    s2 = UnifiedMemoryStore(cfg)
    s2._ensure_fce_observer().load(path)
    rec2 = next(r for r in s2.omega_registry_snapshot()["records"]
                if r["semantic_center"] == rec["semantic_center"])
    # Coagulation episode and id are preserved across reload.
    assert rec2["omega_id"] == rec["omega_id"]
    assert rec2["coagulated_at_episode"] == rec["coagulated_at_episode"]
    assert rec2["expression_state"] == "contested"


def test_persisted_payload_is_json_inspectable(tmp_path):
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.0, fce_omega_tau_coag=1)
    s = UnifiedMemoryStore(cfg)
    s.write(symbolic_entry("dragon", "color", "red", 1, 0))
    s.consolidate(episode_id=1)
    path = str(tmp_path / "obs.json")
    s.fce_omega_observer().persist(path)
    with open(path, "r", encoding="utf-8") as f:
        payload = json.load(f)
    # Payload version advances with each release that adds new
    # persisted fields. Loaders treat newer fields as optional so a
    # v0.4.0 / v0.4.1 / v0.5.0 / v0.5.1 payload all resume cleanly.
    assert payload["version"] in ("v0.4.0", "v0.4.1", "v0.5.0", "v0.5.1", "v0.6.0")
    assert "morphogenesis_log" in payload
    assert "omega_registry" in payload
    assert "agents" in payload
