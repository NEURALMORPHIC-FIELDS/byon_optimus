"""Perspective slices for multi-perspective fan-out (Q4).

Operator decision Q4 (2026-05-12) admits exactly FOUR perspectives in v1:

  - factual           — truth-conditional claims
  - project_state     — versions, tags, SHAs, infra state
  - domain_verified   — operator-asserted external facts (DOMAIN_VERIFIED)
  - security_boundary — air-gap, token policy, refusal rules

The remaining four perspectives from design-doc §5.1
(`preference`, `style`, `execution_boundary`, `narrative`) are NOT admitted in
v1. They may be added in v2 under a separate amendment.

Each perspective is its own center namespace. A single user turn may project
into 0..4 perspectives (fan-out); each projected center accumulates its own
S_t / B_t / Z_active independently, subject to the same `theta_s = 0.28` /
`tau_coag = 12` rule.
"""

from __future__ import annotations

from enum import Enum
from typing import Tuple


class Perspective(str, Enum):
    """The four v1 perspectives. String-valued so JSONL serialisation is stable."""

    FACTUAL = "factual"
    PROJECT_STATE = "project_state"
    DOMAIN_VERIFIED = "domain_verified"
    SECURITY_BOUNDARY = "security_boundary"


# Canonical immutable tuple. Iteration order is the documentation order.
PERSPECTIVES_V1: Tuple[Perspective, ...] = (
    Perspective.FACTUAL,
    Perspective.PROJECT_STATE,
    Perspective.DOMAIN_VERIFIED,
    Perspective.SECURITY_BOUNDARY,
)


def is_admitted_v1(perspective: str) -> bool:
    """Return True if the given perspective name is admitted in v1.

    Useful as a defensive check at JSONL load time. Returns False (rather
    than raises) so the caller can decide how to handle off-policy data.
    """
    try:
        Perspective(perspective)
        return True
    except ValueError:
        return False
