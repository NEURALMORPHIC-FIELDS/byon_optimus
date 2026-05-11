"""FN-15 Functional report generation.

tools/fce_functional_report.py runs the integrated workload and writes
results/fce_functional_report.{txt,json}. The test exercises it on a
tmp out path so it is reproducible from a clean checkout without
polluting the working tree.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_report_script_runs_and_emits_files(tmp_path):
    out_text = tmp_path / "rep.txt"
    out_json = tmp_path / "rep.json"
    proc = subprocess.run(
        [sys.executable, "tools/fce_functional_report.py",
         "--out", str(out_text), "--json", str(out_json)],
        capture_output=True, text=True, cwd=str(REPO_ROOT),
    )
    assert proc.returncode == 0, (
        f"report script failed: stderr={proc.stderr!r}"
    )
    assert out_text.exists()
    assert out_json.exists()
    payload = json.loads(out_json.read_text(encoding="utf-8"))
    for key in [
        "n_ufme_tests", "n_fce_omega_unit_tests",
        "n_fce_omega_functional_tests", "n_tests_total",
        "observer_active_passive_invariance",
        "residue_detected", "omega_irreversibility",
        "advisory_no_truth_override",
        "multiperspectival_normalization",
        "provenance_complete",
        "persistence_roundtrip",
        "vendor_layout_clean",
    ]:
        assert key in payload, f"missing key {key!r} in report"
    # The report counts should be positive on a healthy checkout.
    assert payload["n_tests_total"] > 100
    assert payload["n_fce_omega_functional_tests"] >= 10


def test_report_capability_flags_truthy_after_workload(tmp_path):
    out_text = tmp_path / "rep.txt"
    out_json = tmp_path / "rep.json"
    subprocess.run(
        [sys.executable, "tools/fce_functional_report.py",
         "--out", str(out_text), "--json", str(out_json)],
        check=True, cwd=str(REPO_ROOT),
    )
    payload = json.loads(out_json.read_text(encoding="utf-8"))
    # Workload-driven flags that MUST be True under the v0.4.0 contract.
    must_be_true = [
        "observer_active_passive_invariance",
        "residue_detected",
        "omega_irreversibility",
        "advisory_no_truth_override",
        "provenance_complete",
        "persistence_roundtrip",
        "vendor_layout_clean",
    ]
    for k in must_be_true:
        assert payload[k] is True, (
            f"capability flag {k!r} unexpectedly False in report"
        )
