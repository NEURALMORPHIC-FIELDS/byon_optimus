"""Unit tests for the conditions module."""
import pytest
from policy_engine.conditions import evaluate, parse_condition, ConditionError
from policy_engine.models import ConditionExpr


# ---------------------------------------------------------------------------
# evaluate() — all operators
# ---------------------------------------------------------------------------

class TestEquals:
    def test_true(self):
        c = ConditionExpr("equals", "env", "production")
        assert evaluate(c, {"env": "production"}) is True

    def test_false(self):
        c = ConditionExpr("equals", "env", "production")
        assert evaluate(c, {"env": "staging"}) is False

    def test_missing_var_is_false(self):
        c = ConditionExpr("equals", "env", "production")
        assert evaluate(c, {}) is False


class TestNotEquals:
    def test_true(self):
        c = ConditionExpr("not_equals", "env", "production")
        assert evaluate(c, {"env": "staging"}) is True

    def test_false(self):
        c = ConditionExpr("not_equals", "env", "production")
        assert evaluate(c, {"env": "production"}) is False


class TestIn:
    def test_true(self):
        c = ConditionExpr("in", "tier", ["gold", "platinum"])
        assert evaluate(c, {"tier": "gold"}) is True

    def test_false(self):
        c = ConditionExpr("in", "tier", ["gold", "platinum"])
        assert evaluate(c, {"tier": "bronze"}) is False

    def test_value_not_list_raises(self):
        c = ConditionExpr("in", "tier", "gold")
        with pytest.raises(ConditionError, match="list"):
            evaluate(c, {"tier": "gold"})


class TestNotIn:
    def test_true(self):
        c = ConditionExpr("not_in", "tier", ["gold", "platinum"])
        assert evaluate(c, {"tier": "bronze"}) is True

    def test_false(self):
        c = ConditionExpr("not_in", "tier", ["gold", "platinum"])
        assert evaluate(c, {"tier": "gold"}) is False

    def test_value_not_list_raises(self):
        c = ConditionExpr("not_in", "tier", "gold")
        with pytest.raises(ConditionError, match="list"):
            evaluate(c, {"tier": "bronze"})


class TestExists:
    def test_true(self):
        c = ConditionExpr("exists", "webhook", None)
        assert evaluate(c, {"webhook": "https://..."}) is True

    def test_false_missing(self):
        c = ConditionExpr("exists", "webhook", None)
        assert evaluate(c, {}) is False

    def test_false_none_value_still_present(self):
        # var is present (even if None) → exists is True
        c = ConditionExpr("exists", "webhook", None)
        assert evaluate(c, {"webhook": None}) is True


class TestNotExists:
    def test_true(self):
        c = ConditionExpr("not_exists", "webhook", None)
        assert evaluate(c, {}) is True

    def test_false(self):
        c = ConditionExpr("not_exists", "webhook", None)
        assert evaluate(c, {"webhook": "x"}) is False


def test_unknown_operator_raises():
    c = ConditionExpr("greater_than", "count", 5)
    with pytest.raises(ConditionError, match="Unknown condition operator"):
        evaluate(c, {"count": 10})


# ---------------------------------------------------------------------------
# parse_condition()
# ---------------------------------------------------------------------------

def test_parse_equals():
    raw = {"equals": {"var": "environment", "value": "production"}}
    c = parse_condition(raw, "step-1")
    assert c.operator == "equals"
    assert c.var == "environment"
    assert c.value == "production"


def test_parse_in():
    raw = {"in": {"var": "tier", "value": ["gold", "silver"]}}
    c = parse_condition(raw, "step-1")
    assert c.operator == "in"
    assert c.value == ["gold", "silver"]


def test_parse_exists_no_value_field():
    raw = {"exists": {"var": "slack_webhook"}}
    c = parse_condition(raw, "step-1")
    assert c.operator == "exists"
    assert c.value is None


def test_parse_rejects_unknown_operator():
    raw = {"greater_than": {"var": "x", "value": 5}}
    with pytest.raises(ValueError, match="condition must contain one of"):
        parse_condition(raw, "step-1")


def test_parse_rejects_multiple_operators():
    raw = {"equals": {"var": "x", "value": 1}, "not_equals": {"var": "x", "value": 2}}
    with pytest.raises(ValueError, match="exactly one operator"):
        parse_condition(raw, "step-1")


def test_parse_rejects_missing_var():
    raw = {"equals": {"value": "production"}}
    with pytest.raises(ValueError, match="var.*non-empty string"):
        parse_condition(raw, "step-1")


def test_parse_rejects_non_dict_body():
    raw = {"equals": "production"}
    with pytest.raises(ValueError, match="must be a mapping"):
        parse_condition(raw, "step-1")