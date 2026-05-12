"""Z metabolism runtime for the Level 3 research package.

Public surface:

    class ZMetabolismRuntime:
        counters_for(center_id, perspective) -> ZCounters
        apply_event(event)                   -> ZCounters
        apply_summary(summary_event)         -> ZCounters
        b_t(center_id, perspective)          -> float
        snapshot()                           -> dict
        from_snapshot(payload)               -> ZMetabolismRuntime  (classmethod)
        audit_log()                          -> list[dict]

The runtime is INERT toward Omega: it does not call check_coagulation, it
does not register an OmegaRecord, it does not produce ReferenceField rows,
and it does not detect PotentialOmegaCenter. Those are subsequent commits.

The runtime is also production-isolated: it imports only from `schemas`
(the research package's own schemas) and the Python standard library.
"""

from .runtime import (
    SCHEMA_VERSION,
    ZMetabolismRuntime,
)

__all__ = [
    "SCHEMA_VERSION",
    "ZMetabolismRuntime",
]
