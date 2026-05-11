"""unified-fragmergent-memory-engine.

Unified facade over three independent source projects, namespaced and reachable.

Source projects (read-only, R1):
- d_cortex: c:/Users/Lucian/Desktop/D_CORTEX_ULTIMATE/
- tf_engine: c:/Users/Lucian/Desktop/unified-fragmergent-memory-engine/.claude/extracted_sources/fragmergent-tf-engine/
- memory_engine_runtime: c:/Users/Lucian/Desktop/fragmergent-memory-engine/

Public surface:
    UnifiedMemoryStore: write, read, propagate, consolidate, audit_log
    Config: configuration dataclass
    sources.{d_cortex,tf_engine,memory_engine_runtime}: passthrough namespaces

Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
Licensed BSD-3-Clause. Patent EP25216372.0 (related, separately held).
"""

from unified_fragmergent_memory.facade.config import Config
from unified_fragmergent_memory.facade.memory_store import UnifiedMemoryStore

__version__ = "0.6.0"
__author__ = "Vasile Lucian Borbeleac"
__license__ = "BSD-3-Clause"

__all__ = [
    "UnifiedMemoryStore",
    "Config",
    "__version__",
    "__author__",
    "__license__",
]
