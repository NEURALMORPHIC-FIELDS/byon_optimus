"""
Unit tests for condition evaluation (conditions.py).
"""

import pytest

from policy_engine.conditions import ConditionError, evaluate


# ---------------------------------------------------------------------------
# equals
# ---------------------------------------------------------------------------

class TestEquals:
    def test_true_when_match(self):
        assert evaluate({"equals": {"var": "env", "value": "production"}}, {"env": "production"}) is True

    def test_false_when_no_match(self):
        assert evaluate({"equals": {"var": "env", "value": "production"}}, {"env": "staging"}) is False

    def test_false_when_var_missing(self):
        # Missing var resolves to None; None != "production"
        assert evaluate({"equals": {"var": "env", "value": "production"}}, {}) is False

    def test_true_when_var_is_none_and_value_is_none(self):
        assert evaluate({"equals": {"var": "x", "value": None}}, {}) is True

    def test_numeric_equality(self):
        assert evaluate({"equals": {"var": "count", "value": 3}}, {"count": 3}) is True
        assert evaluate({"equals": {"var": "count", "value": 3}}, {"count": 4}) is False


# ---------------------------------------------------------------------------
# not_equals
# ---------------------------------------------------------------------------

class TestNotEquals:
    def test_true_when_different(self):
        assert evaluate({"not_equals": {"var": "env", "value": "production"}}, {"env": "staging"}) is True

    def test_false_when_same(self):
        assert evaluate({"not_equals": {"var": "env", "value": "production"}}, {"env": "production"}) is False


# ---------------------------------------------------------------------------
# in
# ---------------------------------------------------------------------------

class TestIn:
    def test_true_when_member(self):
        assert evaluate({"in": {"var": "env", "values": ["staging", "production"]}}, {"env": "staging"}) is True

    def test_false_when_not_member(self):
        assert evaluate({"in": {"var": "env", "values": ["staging", "production"]}}, {"env": "dev"}) is False

    def test_false_when_var_missing(self):
        assert evaluate({"in": {"var": "env", "values": ["staging"]}}, {}) is False


# ---------------------------------------------------------------------------
# not_in
# ---------------------------------------------------------------------------

class TestNotIn:
    def test_true_when_not_member(self):
        assert evaluate({"not_in": {"var": "env", "values": ["production"]}}, {"env": "dev"}) is True

    def test_false_when_member(self):
        assert evaluate({"not_in": {"var": "env", "values": ["production"]}}, {"env": "production"}) is False


# ---------------------------------------------------------------------------
# Error cases
# ---------------------------------------------------------------------------

class TestConditionErrors:
    def test_not_a_dict(self):
        with pytest.raises(ConditionError, match="must be a dict"):
            evaluate("equals", {})

    def test_multiple_operators(self):
        with pytest.raises(ConditionError, match="exactly one operator"):
            evaluate({"equals": {"var": "x", "value": 1}, "not_equals": {"var": "x", "value": 2}}, {})

    def test_unknown_operator(self):
        with pytest.raises(ConditionError, match="Unknown condition operator"):
            evaluate({"gt": {"var": "x", "value": 1}}, {"x": 5})

    def test_operands_not_dict(self):
        with pytest.raises(ConditionError, match="must be a dict"):
            evaluate({"equals": "bad"}, {})

    def test_missing_var(self):
        with pytest.raises(ConditionError, match="must include 'var'"):
            evaluate({"equals": {"value": "x"}}, {})

    def test_equals_missing_value(self):
        with pytest.raises(ConditionError, match="requires 'value'"):
            evaluate({"equals": {"var": "x"}}, {"x": 1})

    def test_in_missing_values(self):
        with pytest.raises(ConditionError, match="requires 'values'"):
            evaluate({"in": {"var": "x"}}, {"x": 1})

    def test_in_values_not_list(self):
        with pytest.raises(ConditionError, match="must be a list"):
            evaluate({"in": {"var": "x", "values": "not-a-list"}}, {"x": 1})