"""FN-13 Vendor source integrity.

vendor/fce_omega_source/ is used through a path computed relative to the
wrapper. No copies, no nested redundancy, no stale egg-info.
"""

from __future__ import annotations

from pathlib import Path


def test_vendor_source_resolved_via_relative_path():
    from unified_fragmergent_memory.sources import fce_omega
    repo_root = Path(__file__).resolve().parents[2]
    expected = repo_root / "vendor" / "fce_omega_source"
    assert fce_omega.SOURCE_ROOT.resolve() == expected.resolve(), (
        f"FCE-Omega wrapper SOURCE_ROOT diverged from "
        f"vendor/fce_omega_source/: {fce_omega.SOURCE_ROOT} vs {expected}"
    )


def test_vendor_layout_has_expected_top_files():
    from unified_fragmergent_memory.sources import fce_omega
    root = fce_omega.SOURCE_ROOT
    assert (root / "src" / "core" / "agent.py").exists()
    assert (root / "src" / "core" / "field_operators.py").exists()
    assert (root / "src" / "core" / "metrics.py").exists()
    assert (root / "src" / "core" / "interactions.py").exists()


def test_no_stale_egg_info_at_repo_root():
    repo_root = Path(__file__).resolve().parents[2]
    egg = repo_root / "unified_fragmergent_memory_engine.egg-info"
    assert not egg.exists(), (
        "stale egg-info must not reappear at repo root; clean build artifacts"
    )


def test_no_legacy_top_level_project_folders():
    """The integrated workspace IS the project. Old subfolders like
    'unified-fragmergent-memory-engine/' or 'fragmergent-causal-exponentiation/'
    must not reappear at the working-dir root."""
    repo_root = Path(__file__).resolve().parents[2]
    for stale in (
        "unified-fragmergent-memory-engine",
        "fragmergent-causal-exponentiation",
    ):
        assert not (repo_root / stale).exists(), (
            f"stale subfolder {stale!r} should not exist at repo root"
        )


def test_vendor_dir_only_contains_fce_omega_source():
    repo_root = Path(__file__).resolve().parents[2]
    vendor = repo_root / "vendor"
    assert vendor.is_dir()
    entries = {p.name for p in vendor.iterdir()
               if not p.name.startswith(".")}
    assert entries == {"fce_omega_source"}, (
        f"vendor/ should contain exactly fce_omega_source/, got {entries}"
    )
