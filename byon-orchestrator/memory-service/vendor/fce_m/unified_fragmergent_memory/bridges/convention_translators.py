"""Convention translation across source projects.

Source projects use different enum classes, key formats, and scoring scales
for similar concepts. This module provides translation helpers.
"""

from __future__ import annotations

from enum import Enum
from typing import Tuple


def canonicalize_attr_family(attr: str) -> str:
    """Canonicalize an attribute family name to runtime/d_cortex convention.

    Convention: lowercase singular noun. Aliases mapped: 'colour' -> 'color',
    'sizes' -> 'size'.
    """
    s = attr.strip().lower()
    aliases = {
        "colour": "color",
        "colours": "color",
        "colors": "color",
        "sizes": "size",
        "states": "state",
        "moods": "mood",
        "locations": "location",
    }
    return aliases.get(s, s)


def serialize_slot_key(entity_id: str, attr_type: str) -> str:
    """Serialize a (entity_id, attr_type) tuple key as 'entity::attr'.

    This is the same convention as v15_7a_core._serialize_tuple_key. Provided
    here as a convenience without forcing import of the runtime source.
    """
    return f"{entity_id}::{attr_type}"


def parse_slot_key(key: str) -> Tuple[str, str]:
    """Inverse of serialize_slot_key. Raises ValueError if separator missing."""
    if "::" not in key:
        raise ValueError(f"slot key {key!r} does not contain '::' separator")
    head, _, tail = key.partition("::")
    return head, tail


def enum_value_to_string(value: object) -> str:
    """Return a stable string for an enum member, str, or value.

    Handles AmbiguityFlag (v15.2 7-value), V15_4_AmbiguityFlag (v15.4 10-value),
    CommitPath, EpistemicStatus, RoleLabel, and plain strings or ints.
    """
    if isinstance(value, Enum):
        return str(value.value) if not isinstance(value.value, str) else value.value
    if isinstance(value, str):
        return value
    return str(value)
