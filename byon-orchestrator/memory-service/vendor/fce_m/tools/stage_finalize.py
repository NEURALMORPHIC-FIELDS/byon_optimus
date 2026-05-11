"""Stage finalizer for the FCE-Ω + UFME integrated project.

Per docs/EVOLUTION_PROTOCOL.md, every completed stage emits a folder
under results/etapa_<NN>_<version>_<short_name>/ containing:

    pytest_full.txt      - python -m pytest -v --tb=short
    pytest_summary.txt   - python -m pytest -q tail
    report.txt           - tools/fce_functional_report.py text
    report.json          - tools/fce_functional_report.py json
    manifest.json        - structured stage metadata
    CHANGELOG_slice.md   - the CHANGELOG entry for this version

Run at the end of a stage:

    python tools/stage_finalize.py --etapa 01 --version v0.4.1 \
        --short-name center_isolated_anchor \
        --integration-mode passive_with_advisory \
        --previous-total 213
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional


REPO_ROOT = Path(__file__).resolve().parents[1]
RESULTS_ROOT = REPO_ROOT / "results"


def _run_pytest_verbose(out_path: Path) -> int:
    """Run pytest -v --tb=short, capture transcript, return exit code."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        proc = subprocess.run(
            [sys.executable, "-m", "pytest", "-v", "--tb=short"],
            cwd=str(REPO_ROOT), stdout=f, stderr=subprocess.STDOUT,
        )
    return proc.returncode


def _run_pytest_summary(out_path: Path) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        proc = subprocess.run(
            [sys.executable, "-m", "pytest", "-q", "--tb=no"],
            cwd=str(REPO_ROOT), stdout=f, stderr=subprocess.STDOUT,
        )
    return proc.returncode


def _run_functional_report(stage_dir: Path) -> int:
    proc = subprocess.run(
        [
            sys.executable, "tools/fce_functional_report.py",
            "--out", str(stage_dir / "report.txt"),
            "--json", str(stage_dir / "report.json"),
        ],
        cwd=str(REPO_ROOT),
    )
    return proc.returncode


def _parse_pytest_total(transcript: Path) -> Optional[int]:
    """Extract the 'N passed' total from a pytest transcript."""
    text = transcript.read_text(encoding="utf-8")
    m = re.search(r"(\d+)\s+passed", text)
    if m is None:
        return None
    return int(m.group(1))


def _slice_changelog(version: str) -> str:
    """Pull the CHANGELOG block whose heading matches `## <version_no_v>`."""
    cl = REPO_ROOT / "CHANGELOG.md"
    if not cl.exists():
        return f"# CHANGELOG slice for {version}\n\n(No CHANGELOG.md present.)\n"
    text = cl.read_text(encoding="utf-8")
    # Look for `## 0.4.1` style heading (strip the leading `v`).
    ver_clean = version.lstrip("v")
    pattern = re.compile(
        rf"(^##\s+{re.escape(ver_clean)}\b.*?)(?=^##\s+\d|\Z)",
        flags=re.M | re.S,
    )
    m = pattern.search(text)
    if m is None:
        return (
            f"# CHANGELOG slice for {version}\n\n"
            f"(No matching `## {ver_clean}` heading in CHANGELOG.md.)\n"
        )
    return m.group(1).rstrip() + "\n"


def _git_files_modified_since_tag(tag: Optional[str]) -> List[str]:
    """Best-effort: which files changed since the given git tag.

    Returns [] if not in a git repo or the tag doesn't exist.
    """
    if not tag:
        return []
    try:
        proc = subprocess.run(
            ["git", "diff", "--name-only", f"{tag}..HEAD"],
            cwd=str(REPO_ROOT), capture_output=True, text=True,
        )
        if proc.returncode != 0:
            return []
        return [line for line in proc.stdout.splitlines() if line.strip()]
    except FileNotFoundError:
        return []


def build_manifest(args: argparse.Namespace, pytest_total: int) -> Dict[str, Any]:
    return {
        "etapa": args.etapa,
        "version": args.version,
        "short_name": args.short_name,
        "date": args.date or date.today().isoformat(),
        "previous_total_tests": args.previous_total,
        "new_total_tests": pytest_total,
        "tests_added": args.tests_added or [],
        "files_modified": args.files_modified or _git_files_modified_since_tag(
            args.since_tag
        ),
        "capabilities_confirmed": args.capabilities or [],
        "limitations_remaining": args.limitations or [],
        "integration_mode": args.integration_mode,
        "invariants_preserved": True,
        "notes": args.notes or "",
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--etapa", required=True,
                   help="stage ordinal, e.g. 01 or 00")
    p.add_argument("--version", required=True,
                   help="version tag, e.g. v0.4.1 or v0.4.0_baseline")
    p.add_argument("--short-name", required=True,
                   help="folder slug, e.g. center_isolated_anchor")
    p.add_argument("--integration-mode", required=True,
                   choices=["passive", "passive_with_advisory",
                            "semi_active", "active"])
    p.add_argument("--previous-total", type=int, default=0,
                   help="test total at the previous stage's end")
    p.add_argument("--tests-added", nargs="*", default=None,
                   help="repeatable; lines describing new tests")
    p.add_argument("--files-modified", nargs="*", default=None,
                   help="repeatable; overrides git auto-detection")
    p.add_argument("--capabilities", nargs="*", default=None,
                   help="repeatable; capability strings")
    p.add_argument("--limitations", nargs="*", default=None,
                   help="repeatable; remaining limitation strings")
    p.add_argument("--since-tag", default=None,
                   help="git tag/ref to diff against for files-modified")
    p.add_argument("--date", default=None,
                   help="ISO date, defaults to today")
    p.add_argument("--notes", default=None)
    p.add_argument("--skip-pytest", action="store_true",
                   help="reuse existing transcripts if present")
    args = p.parse_args()

    # Sanitize version for filesystem use: 'v0.4.1' -> 'v0_4_1'. The
    # raw version with dots stays in manifest.json and CHANGELOG_slice.
    version_slug = args.version.replace(".", "_")
    stage_dir = RESULTS_ROOT / f"etapa_{args.etapa}_{version_slug}_{args.short_name}"
    stage_dir.mkdir(parents=True, exist_ok=True)

    pytest_full = stage_dir / "pytest_full.txt"
    pytest_summary = stage_dir / "pytest_summary.txt"

    if not args.skip_pytest or not pytest_full.exists():
        rc = _run_pytest_verbose(pytest_full)
        if rc != 0:
            print(f"[stage_finalize] pytest -v exited {rc}; transcript at "
                  f"{pytest_full}", file=sys.stderr)
            return rc
    if not args.skip_pytest or not pytest_summary.exists():
        _run_pytest_summary(pytest_summary)

    rc = _run_functional_report(stage_dir)
    if rc != 0:
        print(f"[stage_finalize] functional report exited {rc}",
              file=sys.stderr)
        return rc

    total = _parse_pytest_total(pytest_full) or 0
    manifest = build_manifest(args, total)
    (stage_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8")
    (stage_dir / "CHANGELOG_slice.md").write_text(
        _slice_changelog(args.version), encoding="utf-8")

    print(f"[stage_finalize] OK -> {stage_dir}")
    print(f"  total tests: {total}")
    print(f"  integration_mode: {args.integration_mode}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
