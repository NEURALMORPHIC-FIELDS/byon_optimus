"""FN-01 Baseline invariance.

Same UFME operations with FCE observer enabled vs disabled must yield
identical results at the operational-memory level (read/write/consolidate).
The observer is allowed to add audit/morphogenesis trace but is forbidden
from altering UFME's response.
"""

from __future__ import annotations

import numpy as np

from tests.fce_omega_functional.conftest import (
    symbolic_entry, numerical_entry, runtime_view,
)
from unified_fragmergent_memory import UnifiedMemoryStore, Config


def test_consolidate_signals_and_ops_identical(store_off, store_on):
    seq = [
        symbolic_entry("dragon", "color", "red", 1, 0),
        symbolic_entry("dragon", "size", "large", 1, 1),
        symbolic_entry("phoenix", "color", "gold", 2, 0),
    ]
    for e in seq:
        store_off.write(e)
        store_on.write(e)

    o1 = store_off.consolidate(episode_id=1)
    o2 = store_on.consolidate(episode_id=1)
    assert o1["episode_id"] == o2["episode_id"]
    assert o1["ops"] == o2["ops"]
    assert o1["signals_summary"] == o2["signals_summary"]
    # The only allowed delta is the extra fce_omega_report key.
    extra_keys = set(o2) - set(o1) - {"fce_omega_report"}
    assert not extra_keys, f"unexpected extra keys with observer on: {extra_keys}"


def test_runtime_view_identical(store_off, store_on):
    for e in [
        symbolic_entry("dragon", "color", "red", 1, 0),
        symbolic_entry("dragon", "color", "blue", 1, 1, zone="disputed"),
        symbolic_entry("phoenix", "size", "tiny", 2, 0, zone="provisional"),
    ]:
        store_off.write(e)
        store_on.write(e)
    store_off.consolidate(episode_id=1)
    store_on.consolidate(episode_id=1)
    store_off.consolidate(episode_id=2)
    store_on.consolidate(episode_id=2)
    rv_off = runtime_view(store_off)
    rv_on = runtime_view(store_on)
    assert rv_off == rv_on, (
        f"runtime view diverged: off={rv_off!r} on={rv_on!r}"
    )


def test_tf_engine_read_results_identical(store_off, store_on):
    """The numerical side of UFME must respond identically too."""
    entries = [numerical_entry(label=i, mi=0.5 * i, dim=16, seed=i)
               for i in range(4)]
    for e in entries:
        store_off.write(e, source="tf_engine")
        store_on.write(e, source="tf_engine")
    q = numerical_entry(label=0, mi=1.0, dim=16, seed=99)
    r_off = store_off.read(q, source="tf_engine", scoring="softmax")
    r_on = store_on.read(q, source="tf_engine", scoring="softmax")
    np.testing.assert_array_equal(r_off, r_on)


def test_audit_log_unchanged_by_observer(store_off, store_on):
    for e in [
        symbolic_entry("dragon", "color", "red", 1, 0),
        symbolic_entry("dragon", "size", "large", 1, 1),
    ]:
        store_off.write(e)
        store_on.write(e)
    store_off.consolidate(episode_id=1)
    store_on.consolidate(episode_id=1)
    a_off = store_off.audit_log()
    a_on = store_on.audit_log()
    assert len(a_off) == len(a_on)
    # FCE never appears in audit_log; it has its own morphogenesis log.
    mlog = store_on.fce_morphogenesis_log()
    assert mlog, "observer should record morphogenesis entries"
