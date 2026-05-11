"""Tests for bridges/shape_translators.py."""

from __future__ import annotations

import numpy as np
import pytest

from unified_fragmergent_memory.bridges.shape_translators import (
    husimi_vector_to_value_emb,
    is_numerical_entry,
    is_symbolic_entry,
    numerical_to_symbolic_skeleton,
    symbolic_to_numerical_skeleton,
)


def test_is_symbolic_entry_positive():
    assert is_symbolic_entry({"entity_id": "dragon", "attr_type": "color"})
    assert is_symbolic_entry({"entity_id": "x", "attr_type": "y", "value_idx": 1})


def test_is_symbolic_entry_negative():
    assert not is_symbolic_entry({"entity_id": "dragon"})
    assert not is_symbolic_entry({"attr_type": "color"})
    assert not is_symbolic_entry({"entity_id": 42, "attr_type": "color"})
    assert not is_symbolic_entry("not a dict")
    assert not is_symbolic_entry({})


def test_is_numerical_entry_positive():
    assert is_numerical_entry({"vector": np.zeros(10)})
    assert is_numerical_entry({"v": np.ones(5, dtype=np.float32)})
    assert is_numerical_entry({"vector": np.array([1, 2, 3], dtype=np.int32)})


def test_is_numerical_entry_negative():
    assert not is_numerical_entry({"vector": [1, 2, 3]})
    assert not is_numerical_entry({"vector": np.array([], dtype=np.float64)})
    assert not is_numerical_entry({"v": np.array(["a", "b"])})
    assert not is_numerical_entry({})


def test_husimi_vector_to_value_emb_dtype_and_shape():
    v = np.ones(256, dtype=np.float32)
    out = husimi_vector_to_value_emb(v)
    assert out.dtype == np.float64
    assert out.shape == (256,)
    np.testing.assert_array_equal(out, np.ones(256))


def test_husimi_vector_to_value_emb_rejects_wrong_dim():
    with pytest.raises(ValueError):
        husimi_vector_to_value_emb(np.zeros((4, 4)))


def test_symbolic_to_numerical_skeleton_zero_vector():
    sym = {"entity_id": "dragon", "attr_type": "color", "value_idx": 5}
    num = symbolic_to_numerical_skeleton(sym, dim=64)
    assert num["vector"].shape == (64,)
    assert num["vector"].dtype == np.float64
    assert num["mi"] == 0.0
    assert num["label"] == 5
    assert num["_origin"] == "symbolic_skeleton"


def test_numerical_to_symbolic_skeleton_label_template():
    num = {"vector": np.ones(8), "label": 7, "mi": 1.5}
    sym = numerical_to_symbolic_skeleton(num)
    assert sym["entity_id"] == "vec_7"
    assert sym["attr_type"] == "numerical_label"
    assert sym["value_idx"] == 7
    assert sym["value_emb"] is not None
    assert sym["_origin"] == "numerical_skeleton"


def test_round_trip_symbolic_to_numerical_to_symbolic():
    sym1 = {"entity_id": "vec_3", "attr_type": "color", "value_idx": 3}
    num = symbolic_to_numerical_skeleton(sym1, dim=16)
    sym2 = numerical_to_symbolic_skeleton(num)
    assert sym2["value_idx"] == sym1["value_idx"]
    assert sym2["entity_id"] == "vec_3"
