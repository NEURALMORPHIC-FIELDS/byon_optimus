"""End-to-end orchestrator test exercising all three sources."""

from __future__ import annotations

import pytest

from unified_fragmergent_memory.runtime import Orchestrator, run_end_to_end_demo


def test_orchestrator_run_completes():
    """Smoke test: the orchestrator runs end-to-end without errors."""
    orch = Orchestrator()
    report = orch.run(
        n_tf_entries_per_label=2,
        n_propagation_steps=2,
        mi_targets=(0.5, 1.5),
        seed=42,
    )
    assert report.tf_bank_size == 4
    assert report.runtime_writes == 3
    assert report.propagation_steps == 2
    assert "tf_engine bank populated" in report.invariants_passed
    assert "runtime symbolic writes ingested" in report.invariants_passed


def test_run_end_to_end_demo_default():
    """Default demo run used by reproduce.sh."""
    report = run_end_to_end_demo()
    assert report.tf_bank_size > 0
    assert report.runtime_writes >= 1
