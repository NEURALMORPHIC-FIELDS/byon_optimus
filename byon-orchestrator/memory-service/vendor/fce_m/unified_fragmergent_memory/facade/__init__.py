"""Unified facade modules.

config: Config dataclass
memory_store: UnifiedMemoryStore (write, read, propagate, consolidate, audit_log)
scoring: hybrid lambda scoring router
propagation: consolidation and propagation router
encoder: entry encoding helpers
"""

from unified_fragmergent_memory.facade.config import Config
from unified_fragmergent_memory.facade.memory_store import UnifiedMemoryStore

__all__ = ["Config", "UnifiedMemoryStore"]
