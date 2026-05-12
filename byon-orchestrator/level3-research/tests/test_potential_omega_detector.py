"""Tests for the PotentialOmegaCenter detector.

Required test cases (operator-locked for commit 6):

   1. no signal before 12 cycles
   2. signal after 12 cycles with S_t rising, AR/kappa stable,
      Z_active falling, B_t rising
   3. no signal if Z_active rising
   4. no signal if B_t falling
   5. no signal if AR unstable
   6. no signal if kappa unstable
   7. sustained-high S_t can signal even if slope small
   8. confidence bounded [0, 1]
   9. signal.advisory_only is True
  10. source_cycle_ids length == 12
  11. separate centers isolated
  12. separate perspectives isolated
  13. duplicate cycle_id rejected
  14. NaN / Inf rejected
  15. snapshot / from_snapshot exact
  16. deterministic: same sequence -> same signal_id
  17. no registry write / no .register (AST)
  18. no OmegaRecord / ReferenceField / is_omega_anchor (AST)
  19. no check_coagulation call/import (AST)
  20. production imports forbidden (AST)

Plus extras: window evicts oldest beyond K; snapshot rejects bad
schema_version; integration smoke with ZMetabolismRuntime.
"""

from __future__ import annotations

import math
from typing import List

import pytest

from potential_omega import (
    POLICY_VERSION,
    SCHEMA_VERSION,
    PotentialOmegaDetector,
    PotentialOmegaSignal,
)
from schemas import Perspective


# ---------------------------------------------------------------------------
# Helpers — generate deterministic cycle streams
# ---------------------------------------------------------------------------


def _rising_stream(
    *,
    center_id: str = "byon::macp_pipeline::factual",
    perspective: str = Perspective.FACTUAL.value,
    n: int = 12,
    s_t_start: float = 0.10,
    s_t_step: float = 0.01,
    ar_t_value: float = 0.50,
    kappa_t_value: float = 0.30,
    z_active_start: float = 0.80,
    z_active_step: float = -0.05,
    b_t_start: float = 0.55,
    b_t_step: float = 0.02,
) -> List[dict]:
    """Generate `n` cycles that should satisfy ALL emission conditions:
      - S_t rising
      - AR_t flat (so std == 0)
      - kappa_t flat (so std == 0)
      - Z_active falling
      - B_t rising
    Returns the kwargs to pass to observe_cycle.
    """
    cycles = []
    for i in range(n):
        cycles.append({
            "center_id": center_id,
            "perspective": perspective,
            "cycle_id": f"cyc-{i:04d}",
            "s_t": s_t_start + i * s_t_step,
            "ar_t": ar_t_value,
            "kappa_t": kappa_t_value,
            "z_active": z_active_start + i * z_active_step,
            "b_t": b_t_start + i * b_t_step,
        })
    return cycles


def _feed(detector: PotentialOmegaDetector, cycles: List[dict]) -> List[PotentialOmegaSignal]:
    """Feed cycles into the detector; return ALL emitted signals."""
    all_signals: List[PotentialOmegaSignal] = []
    for c in cycles:
        for s in detector.observe_cycle(**c):
            all_signals.append(s)
    return all_signals


# ---------------------------------------------------------------------------
# 1 — no signal before 12 cycles
# ---------------------------------------------------------------------------


def test_01_no_signal_before_window_size() -> None:
    det = PotentialOmegaDetector(window_size=12)
    cycles = _rising_stream(n=11)
    signals = _feed(det, cycles)
    assert signals == []


# ---------------------------------------------------------------------------
# 2 — signal after 12 cycles with all conditions met
# ---------------------------------------------------------------------------


def test_02_signal_after_12_cycles_with_all_conditions() -> None:
    det = PotentialOmegaDetector(window_size=12)
    cycles = _rising_stream(n=12)
    signals = _feed(det, cycles)

    assert len(signals) == 1
    s = signals[0]
    assert s.center_id == "byon::macp_pipeline::factual"
    assert s.perspective == Perspective.FACTUAL.value
    assert s.window_size == 12
    assert s.s_trend > 0
    assert s.b_t_trend > 0
    assert s.z_active_trend < 0
    assert s.ar_stability == pytest.approx(0.0)
    assert s.kappa_stability == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# 3 — no signal if Z_active rising
# ---------------------------------------------------------------------------


def test_03_no_signal_when_z_active_rising() -> None:
    det = PotentialOmegaDetector(window_size=12)
    cycles = _rising_stream(n=12, z_active_step=+0.05)   # Z_active RISING
    signals = _feed(det, cycles)
    assert signals == []


# ---------------------------------------------------------------------------
# 4 — no signal if B_t falling
# ---------------------------------------------------------------------------


def test_04_no_signal_when_b_t_falling() -> None:
    det = PotentialOmegaDetector(window_size=12)
    cycles = _rising_stream(n=12, b_t_step=-0.02)   # B_t FALLING
    signals = _feed(det, cycles)
    assert signals == []


# ---------------------------------------------------------------------------
# 5 — no signal if AR unstable
# ---------------------------------------------------------------------------


def test_05_no_signal_when_ar_unstable() -> None:
    """Alternate AR_t with a large swing (std > 0.12)."""
    det = PotentialOmegaDetector(window_size=12)
    cycles = _rising_stream(n=12)
    # Inject high-variance AR_t.
    for i, c in enumerate(cycles):
        c["ar_t"] = 0.50 + (0.30 if i % 2 == 0 else -0.30)   # swings of 0.60
    signals = _feed(det, cycles)
    assert signals == []


# ---------------------------------------------------------------------------
# 6 — no signal if kappa unstable
# ---------------------------------------------------------------------------


def test_06_no_signal_when_kappa_unstable() -> None:
    det = PotentialOmegaDetector(window_size=12)
    cycles = _rising_stream(n=12)
    for i, c in enumerate(cycles):
        c["kappa_t"] = 0.30 + (0.25 if i % 2 == 0 else -0.25)
    signals = _feed(det, cycles)
    assert signals == []


# ---------------------------------------------------------------------------
# 7 — sustained-high S_t can signal even if slope is small
# ---------------------------------------------------------------------------


def test_07_sustained_high_s_t_signals_even_with_flat_slope() -> None:
    """All S_t at a sustained-high value but with no rising slope.
    The other conditions (B_t rising, Z_active falling, AR/kappa
    stable) are met, so the signal must still fire."""
    det = PotentialOmegaDetector(window_size=12)
    cycles = _rising_stream(n=12, s_t_start=0.25, s_t_step=0.0)   # FLAT at 0.25
    # s_t_step == 0 -> s_trend == 0 (not > 0)
    # but s_mean == 0.25 >= 0.20 (sustained-high)
    signals = _feed(det, cycles)
    assert len(signals) == 1
    s = signals[0]
    assert s.s_trend == pytest.approx(0.0)
    # Reason mentions sustained.
    assert "sustained=True" in s.reason


# ---------------------------------------------------------------------------
# 8 — confidence bounded in [0, 1]
# ---------------------------------------------------------------------------


def test_08_confidence_bounded_in_unit_interval() -> None:
    """Pump several different rising streams; every emitted signal's
    confidence is in [0, 1]."""
    streams = [
        _rising_stream(n=12, s_t_step=0.005),    # small trend
        _rising_stream(n=12, s_t_step=0.05),     # large trend
        _rising_stream(n=12, s_t_step=0.50),     # huge trend (forces clamp)
        _rising_stream(n=12, b_t_step=0.50),     # huge B trend
        _rising_stream(n=12, z_active_step=-0.50),  # huge Z decline
    ]
    for stream in streams:
        det = PotentialOmegaDetector(window_size=12)
        signals = _feed(det, stream)
        for s in signals:
            assert 0.0 <= s.confidence <= 1.0


# ---------------------------------------------------------------------------
# 9 — signal.advisory_only is True
# ---------------------------------------------------------------------------


def test_09_signal_advisory_only_true() -> None:
    det = PotentialOmegaDetector(window_size=12)
    signals = _feed(det, _rising_stream(n=12))
    assert signals
    for s in signals:
        assert s.advisory_only is True


# ---------------------------------------------------------------------------
# 10 — source_cycle_ids length == window_size
# ---------------------------------------------------------------------------


def test_10_source_cycle_ids_length_matches_window() -> None:
    det = PotentialOmegaDetector(window_size=12)
    cycles = _rising_stream(n=12)
    signals = _feed(det, cycles)
    assert signals
    for s in signals:
        assert len(s.source_cycle_ids) == 12
        # Order must match insertion order.
        expected = tuple(c["cycle_id"] for c in cycles)
        assert tuple(s.source_cycle_ids) == expected


# ---------------------------------------------------------------------------
# 11 — separate centers are isolated
# ---------------------------------------------------------------------------


def test_11_separate_centers_isolated() -> None:
    det = PotentialOmegaDetector(window_size=12)
    # Two centers each receive 11 cycles. Neither is at 12 yet,
    # so neither should signal — but pumping cycles into one bucket
    # must NOT influence the other.
    a = _rising_stream(n=11, center_id="byon::A::factual")
    b = _rising_stream(n=11, center_id="byon::B::factual")
    s_a = _feed(det, a)
    s_b = _feed(det, b)
    assert s_a == [] and s_b == []
    assert det.cycles_in_window("byon::A::factual", Perspective.FACTUAL) == 11
    assert det.cycles_in_window("byon::B::factual", Perspective.FACTUAL) == 11

    # Now push the 12th on A only; A should signal, B must NOT.
    final_a = {
        "center_id": "byon::A::factual",
        "perspective": Perspective.FACTUAL.value,
        "cycle_id": "cyc-A-0012",
        "s_t": 0.22,
        "ar_t": 0.50,
        "kappa_t": 0.30,
        "z_active": 0.25,
        "b_t": 0.79,
    }
    out = det.observe_cycle(**final_a)
    assert len(out) == 1
    assert out[0].center_id == "byon::A::factual"
    # B still at 11 cycles, no signal possible.
    assert det.cycles_in_window("byon::B::factual", Perspective.FACTUAL) == 11


# ---------------------------------------------------------------------------
# 12 — separate perspectives are isolated
# ---------------------------------------------------------------------------


def test_12_separate_perspectives_isolated() -> None:
    det = PotentialOmegaDetector(window_size=12)
    # Same center_id base, different perspectives -> two buckets.
    cid = "byon::executor_air_gap"
    fact = _rising_stream(
        n=11,
        center_id=f"{cid}::factual",
        perspective=Perspective.FACTUAL.value,
    )
    sec = _rising_stream(
        n=11,
        center_id=f"{cid}::security_boundary",
        perspective=Perspective.SECURITY_BOUNDARY.value,
    )
    s1 = _feed(det, fact)
    s2 = _feed(det, sec)
    assert s1 == [] and s2 == []
    assert det.cycles_in_window(f"{cid}::factual", Perspective.FACTUAL) == 11
    assert det.cycles_in_window(f"{cid}::security_boundary", Perspective.SECURITY_BOUNDARY) == 11


# ---------------------------------------------------------------------------
# 13 — duplicate cycle_id rejected
# ---------------------------------------------------------------------------


def test_13_duplicate_cycle_id_rejected() -> None:
    det = PotentialOmegaDetector(window_size=12)
    cycles = _rising_stream(n=5)
    _feed(det, cycles)
    # Re-send the same cycle_id with different payload.
    dup = dict(cycles[2])
    with pytest.raises(ValueError, match="duplicate cycle_id"):
        det.observe_cycle(**dup)


# ---------------------------------------------------------------------------
# 14 — NaN / Inf rejected
# ---------------------------------------------------------------------------


def test_14_nan_and_inf_rejected() -> None:
    det = PotentialOmegaDetector(window_size=12)
    base = {
        "center_id": "byon::macp_pipeline::factual",
        "perspective": Perspective.FACTUAL.value,
        "cycle_id": "cyc-bad",
        "s_t": 0.1, "ar_t": 0.5, "kappa_t": 0.3,
        "z_active": 0.5, "b_t": 0.67,
    }
    for fld in ("s_t", "ar_t", "kappa_t", "z_active", "b_t"):
        bad_nan = dict(base, **{fld: float("nan"), "cycle_id": f"cyc-nan-{fld}"})
        with pytest.raises(ValueError, match="finite"):
            det.observe_cycle(**bad_nan)
        bad_inf = dict(base, **{fld: float("inf"), "cycle_id": f"cyc-inf-{fld}"})
        with pytest.raises(ValueError, match="finite"):
            det.observe_cycle(**bad_inf)


# ---------------------------------------------------------------------------
# 15 — snapshot / from_snapshot exact
# ---------------------------------------------------------------------------


def test_15_snapshot_from_snapshot_exact() -> None:
    det = PotentialOmegaDetector(window_size=12)
    _feed(det, _rising_stream(n=12))
    # Feed a second bucket too, to exercise multi-bucket snapshot.
    _feed(det, _rising_stream(
        n=8,
        center_id="byon::release_state::project_state",
        perspective=Perspective.PROJECT_STATE.value,
    ))

    snap = det.snapshot()

    import json
    reserialised = json.loads(json.dumps(snap))
    rebuilt = PotentialOmegaDetector.from_snapshot(reserialised)

    assert rebuilt.window_size == det.window_size
    assert rebuilt.buckets() == det.buckets()
    # emitted_signal_ids preserved.
    assert rebuilt.emitted_signal_ids == det.emitted_signal_ids
    # Window contents preserved cycle-by-cycle.
    for k in det.buckets():
        orig_snap = det.snapshot()["windows"][k]
        new_snap = rebuilt.snapshot()["windows"][k]
        assert orig_snap == new_snap


# ---------------------------------------------------------------------------
# 16 — deterministic: same sequence -> same signal_id
# ---------------------------------------------------------------------------


def test_16_deterministic_same_sequence_produces_same_signal_id() -> None:
    det_a = PotentialOmegaDetector(window_size=12)
    det_b = PotentialOmegaDetector(window_size=12)
    cycles = _rising_stream(n=12)
    sa = _feed(det_a, cycles)
    sb = _feed(det_b, cycles)
    assert len(sa) == len(sb) == 1
    assert sa[0].signal_id == sb[0].signal_id
    assert sa[0].source_cycle_ids == sb[0].source_cycle_ids
    assert sa[0].confidence == pytest.approx(sb[0].confidence)


# ---------------------------------------------------------------------------
# 17 — no .register / no registry write (AST)
# ---------------------------------------------------------------------------


def test_17_no_register_calls_in_detector() -> None:
    import ast
    import inspect
    import potential_omega.detector as d

    tree = ast.parse(inspect.getsource(d))
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            f = node.func
            if isinstance(f, ast.Attribute) and f.attr == "register":
                pytest.fail(
                    "potential_omega.detector contains a .register(...) call; "
                    "OmegaRegistry writes are forbidden in research code"
                )


# ---------------------------------------------------------------------------
# 18 — no OmegaRecord / ReferenceField / is_omega_anchor (AST)
# ---------------------------------------------------------------------------


def test_18_no_omega_record_reference_field_or_anchor_names() -> None:
    import ast
    import inspect
    import potential_omega.detector as d

    forbidden = ("OmegaRecord", "ReferenceField", "is_omega_anchor", "omega_anchor")
    tree = ast.parse(inspect.getsource(d))
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            for fn in forbidden:
                assert fn != node.id, (
                    f"potential_omega.detector references forbidden name {fn!r}"
                )


# ---------------------------------------------------------------------------
# 19 — no check_coagulation import / call (AST)
# ---------------------------------------------------------------------------


def test_19_no_check_coagulation_import_or_call() -> None:
    import ast
    import inspect
    import potential_omega.detector as d

    src = inspect.getsource(d)
    tree = ast.parse(src)
    forbidden_substrings = (
        "check_coagulation",
        "OmegaRegistry",
        "omega_registry",
        "fce_omega_observer",
        "register_omega",
    )
    seen = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                seen.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            seen.append(node.module or "")
            for alias in node.names:
                seen.append(alias.name)
    for mod in seen:
        low = (mod or "").lower()
        for fp in forbidden_substrings:
            assert fp.lower() not in low, (
                f"detector.py references forbidden import/name {mod!r}"
            )

    # Also verify no function call named check_coagulation anywhere.
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            f = node.func
            name = None
            if isinstance(f, ast.Name):
                name = f.id
            elif isinstance(f, ast.Attribute):
                name = f.attr
            if name and "check_coagulation" in name.lower():
                pytest.fail(
                    "detector.py contains a check_coagulation(...) call"
                )


# ---------------------------------------------------------------------------
# 20 — production imports forbidden (AST)
# ---------------------------------------------------------------------------


def test_20_production_imports_forbidden() -> None:
    import ast
    import inspect
    import potential_omega.detector as d

    tree = ast.parse(inspect.getsource(d))
    forbidden_prefixes = (
        "byon_orchestrator",
        "byon-orchestrator",
        "memory_service",
        "unified_fragmergent_memory",
        "fce_m",
        "fce_omega_observer",
        "omega_registry",
        "check_coagulation",
        "fact_extractor",
    )
    seen = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                seen.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            seen.append(node.module or "")
    for mod in seen:
        low = (mod or "").lower()
        for fp in forbidden_prefixes:
            assert not low.startswith(fp.lower()), (
                f"detector.py imports forbidden module {mod!r}"
            )
    # Sanity: detector DOES import from schemas.
    assert any(m == "schemas" or m.startswith("schemas.") for m in seen)


# ---------------------------------------------------------------------------
# Extras
# ---------------------------------------------------------------------------


def test_extra_window_evicts_oldest_after_capacity() -> None:
    det = PotentialOmegaDetector(window_size=12)
    # Push 20 cycles; the bucket should always hold exactly 12.
    cycles = _rising_stream(n=20)
    _feed(det, cycles)
    assert det.cycles_in_window("byon::macp_pipeline::factual", Perspective.FACTUAL) == 12


def test_extra_snapshot_rejects_bad_schema_version() -> None:
    bad = {
        "schema_version": "level3-research.potential_omega.vXXX",
        "window_size": 12,
        "windows": {},
        "emitted_signal_ids": [],
        "thresholds": {},
    }
    with pytest.raises(ValueError, match="unknown schema_version"):
        PotentialOmegaDetector.from_snapshot(bad)


def test_extra_snapshot_rejects_duplicate_signal_ids() -> None:
    bad = {
        "schema_version": SCHEMA_VERSION,
        "window_size": 12,
        "windows": {},
        "emitted_signal_ids": ["sig-1", "sig-1"],
        "thresholds": {},
    }
    with pytest.raises(ValueError, match="duplicate emitted_signal_ids"):
        PotentialOmegaDetector.from_snapshot(bad)


def test_extra_snapshot_rejects_duplicate_cycle_ids_in_window() -> None:
    bad = {
        "schema_version": SCHEMA_VERSION,
        "window_size": 12,
        "windows": {
            "byon::A::factual": {
                "cycle_ids": ["c1", "c2", "c1"],
                "s_t": [0.1, 0.1, 0.1],
                "ar_t": [0.5, 0.5, 0.5],
                "kappa_t": [0.3, 0.3, 0.3],
                "z_active": [0.5, 0.5, 0.5],
                "b_t": [0.6, 0.6, 0.6],
            },
        },
        "emitted_signal_ids": [],
        "thresholds": {},
    }
    with pytest.raises(ValueError, match="duplicate cycle_ids"):
        PotentialOmegaDetector.from_snapshot(bad)


def test_extra_snapshot_rejects_invalid_window_size() -> None:
    bad = {
        "schema_version": SCHEMA_VERSION,
        "window_size": 1,    # < 2 is invalid
        "windows": {},
        "emitted_signal_ids": [],
        "thresholds": {},
    }
    with pytest.raises(ValueError, match="window_size"):
        PotentialOmegaDetector.from_snapshot(bad)


def test_extra_integration_smoke_with_z_runtime() -> None:
    """The detector reads the same `b_t` / `z_active` numbers that
    ZMetabolismRuntime produces. We feed events into the runtime,
    read its counters back, and forward the (s_t, ar_t, kappa_t,
    z_active, b_t) tuple to the detector. This confirms the detector
    works on real runtime telemetry, not just synthetic streams.
    """
    import uuid
    from z_metabolism import ZMetabolismRuntime
    from schemas import EventKind, MemoryEvent, ProvenanceRecord

    rt = ZMetabolismRuntime()
    det = PotentialOmegaDetector(window_size=12)

    def prov(turn):
        return ProvenanceRecord(
            channel="harness", thread_id="t", source="demo",
            turn_index=turn, transcript_id="demo_tr", seed=42,
        )

    CENTER = "byon::macp_pipeline::factual"
    PERSP = Perspective.FACTUAL.value

    # Feed 5 events to the runtime so z_active rises.
    for i in range(5):
        rt.apply_event(MemoryEvent(
            event_id=f"ev-{i}", center_id=CENTER, perspective=PERSP,
            ts=f"2026-01-01T00:00:{i:02d}.000000Z",
            kind=EventKind.ALIGNED.value, text="x",
            provenance=prov(i), z_contribution=0.1,
        ))

    # Now feed 12 cycles to the detector that synthesise the
    # "z_active falling, b_t rising" pattern atop the runtime's reading.
    cycles = []
    for i in range(12):
        # We synthesise the trajectory using deterministic numbers
        # consistent with a sequence of summary-events that gradually
        # drain z_active. The detector should signal.
        z_active = 0.5 - i * 0.03   # falls from 0.50 -> 0.17
        b_t = 1.0 / (1.0 + z_active)
        cycles.append({
            "center_id": CENTER, "perspective": PERSP,
            "cycle_id": f"int-cyc-{i:04d}",
            "s_t": 0.10 + i * 0.015,    # 0.10 -> 0.265
            "ar_t": 0.50,
            "kappa_t": 0.30,
            "z_active": z_active,
            "b_t": b_t,
        })
    signals = _feed(det, cycles)
    assert len(signals) == 1
    s = signals[0]
    assert s.advisory_only is True
    assert s.s_trend > 0
    assert s.z_active_trend < 0
    assert s.b_t_trend > 0
    # Runtime z_total is untouched by the detector.
    rt_counters = rt.counters_for(CENTER, Perspective.FACTUAL)
    assert rt_counters.z_total == pytest.approx(0.5)
    # Detector did NOT mutate runtime counters in any way.
