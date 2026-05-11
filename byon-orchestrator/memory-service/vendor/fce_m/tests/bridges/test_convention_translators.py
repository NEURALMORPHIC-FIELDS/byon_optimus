"""Tests for bridges/convention_translators.py."""

from __future__ import annotations

from enum import Enum

import pytest

from unified_fragmergent_memory.bridges.convention_translators import (
    canonicalize_attr_family,
    enum_value_to_string,
    parse_slot_key,
    serialize_slot_key,
)


def test_canonicalize_aliases():
    assert canonicalize_attr_family("color") == "color"
    assert canonicalize_attr_family("Colour") == "color"
    assert canonicalize_attr_family("colours") == "color"
    assert canonicalize_attr_family("sizes") == "size"
    assert canonicalize_attr_family("LOCATIONS") == "location"


def test_canonicalize_passthrough_unknown():
    assert canonicalize_attr_family("opacity") == "opacity"
    assert canonicalize_attr_family("  Mood  ") == "mood"


def test_serialize_slot_key_format():
    assert serialize_slot_key("dragon", "color") == "dragon::color"


def test_parse_slot_key_inverse():
    e, a = parse_slot_key("dragon::color")
    assert e == "dragon"
    assert a == "color"


def test_parse_slot_key_rejects_missing_separator():
    with pytest.raises(ValueError):
        parse_slot_key("dragon-color")


class _Color(Enum):
    RED = "red"
    BLUE = "blue"


class _Numeric(Enum):
    LOW = 1
    HIGH = 2


def test_enum_value_to_string_str_enum():
    assert enum_value_to_string(_Color.RED) == "red"


def test_enum_value_to_string_int_enum():
    assert enum_value_to_string(_Numeric.HIGH) == "2"


def test_enum_value_to_string_passthrough_str():
    assert enum_value_to_string("plain") == "plain"


def test_enum_value_to_string_other():
    assert enum_value_to_string(42) == "42"
