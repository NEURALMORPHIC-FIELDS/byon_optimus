"""Regression test: pyproject.toml must use the correct setuptools build backend.

PATCH_0001 was guard_blocked because build-backend was set to the non-existent
'setuptools.backends.legacy:build'. The correct value is 'setuptools.build_meta'.
"""
import pathlib
import tomllib  # stdlib >= 3.11; fallback below


def _load_pyproject() -> dict:
    root = pathlib.Path(__file__).parent.parent
    p = root / "pyproject.toml"
    try:
        with open(p, "rb") as f:
            return tomllib.load(f)
    except AttributeError:
        pass
    # Python < 3.11 fallback — parse just enough with a regex
    import re
    text = p.read_text(encoding="utf-8")
    m = re.search(r'build-backend\s*=\s*"([^"]+)"', text)
    assert m, "build-backend not found in pyproject.toml"
    return {"build-system": {"build-backend": m.group(1)}}


def test_build_backend_is_correct():
    """Regression for PATCH_0001: wrong build-backend caused guard_blocked."""
    data = _load_pyproject()
    backend = data["build-system"]["build-backend"]
    assert backend == "setuptools.build_meta", (
        f"Expected 'setuptools.build_meta', got '{backend}'. "
        "The value 'setuptools.backends.legacy:build' does not exist."
    )