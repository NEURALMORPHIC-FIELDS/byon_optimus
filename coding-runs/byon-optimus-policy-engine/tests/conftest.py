import sys
from pathlib import Path

# REQ_TESTS_NOT_OPTIONAL: ensure src/ is on path without install
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))