"""Unit tests for the conditions module."""
import pytest

from policy_engine.conditions import (
    ConditionError,
    evaluate_condition,
    validate_condition,
)


# ── evaluate_condition ────────────────────────────────────────────────────────

class TestEquals:
    def test_true_when_equal(self):
        assert evaluate_condition({"equals": {"var": "env", "value": "production"}},
                                  {"env": "production"})

    def test_false_when_not_equal(self):
        assert not evaluate_condition({"equals": {"var": "env", "value": "production"}},
                                      {"env": "staging"})

    def test_missing_var_is_none(self):
        # var absent in context → ctx.get returns None → None != "x"
        assert not evaluate_condition({"equals": {"var": "x", "value": "y"}}, {})

    def test_value_can_be_int(self):
        assert evaluate_condition({"equals": {"var": "n", "value": 3}}, {"n": 3})


class TestNotEquals:
    def test_true_when_different(self):
        assert evaluate_condition({"not_equals": {"var": "env", "value": "production"}},
                                  {"env": "staging"})

    def test_false_when_same(self):
        assert not evaluate_condition({"not_equals": {"var": "env", "value": "x"}},
                                      {"env": "x"})


class TestIn:
    def test_true_when_member(self):
        cond = {"in": {"var": "env", "values": ["staging", "production"]}}
        assert evaluate_condition(cond, {"env": "staging"})

    def test_false_when_not_member(self):
        cond = {"in": {"var": "env", "values": ["staging", "production"]}}
        assert not evaluate_condition(cond, {"env": "development"})


class TestNotIn:
    def test_true_when_not_member(self):
        cond = {"not_in": {"var": "env", "values": ["production"]}}
        assert evaluate_condition(cond, {"env": "development"})

    def test_false_when_member(self):
        cond = {"not_in": {"var": "env", "values": ["production"]}}
        assert not evaluate_condition(cond, {"env": "production"})


class TestExists:
    def test_true_when_present_and_truthy(self):
        assert evaluate_condition({"exists": {"var": "flag"}}, {"flag": "yes"})

    def test_false_when_absent(self):
        assert not evaluate_condition({"exists": {"var": "flag"}}, {})

    def test_false_when_falsy(self):
        assert not evaluate_condition({"exists": {"var": "flag"}}, {"flag": ""})


class TestNotExists:
    def test_true_when_absent(self):
        assert evaluate_condition({"not_exists": {"var": "x"}}, {})

    def test_false_when_present(self):
        assert not evaluate_condition({"not_exists": {"var": "x"}}, {"x": "v"})


class TestAnd:
    def test_all_true(self):
        cond = {"and": {"clauses": [
            {"equals": {"var": "a", "value": 1}},
            {"equals": {"var": "b", "value": 2}},
        ]}}
        assert evaluate_condition(cond, {"a": 1, "b": 2})

    def test_one_false(self):
        cond = {"and": {"clauses": [
            {"equals": {"var": "a", "value": 1}},
            {"equals": {"var": "b", "value": 99}},
        ]}}
        assert not evaluate_condition(cond, {"a": 1, "b": 2})

    def test_empty_clauses_is_vacuously_true(self):
        assert evaluate_condition({"and": {"clauses": []}}, {})


class TestOr:
    def test_one_true(self):
        cond = {"or": {"clauses": [
            {"equals": {"var": "env", "value": "production"}},
            {"equals": {"var": "env", "value": "staging"}},
        ]}}
        assert evaluate_condition(cond, {"env": "staging"})

    def test_all_false(self):
        cond = {"or": {"clauses": [
            {"equals": {"var": "env", "value": "production"}},
        ]}}
        assert not evaluate_condition(cond, {"env": "development"})

    def test_empty_clauses_is_vacuously_false(self):
        assert not evaluate_condition({"or": {"clauses": []}}, {})


# ── error paths ───────────────────────────────────────────────────────────────

class TestErrors:
    def test_no_operator_raises(self):
        with pytest.raises(ConditionError, match="No recognised operator"):
            evaluate_condition({"unknown_op": {}}, {})

    def test_multiple_operators_raises(self):
        with pytest.raises(ConditionError, match="multiple operators"):
            evaluate_condition(
                {"equals": {"var": "a", "value": 1},
                 "not_equals": {"var": "a", "value": 2}},
                {"a": 1},
            )

    def test_non_dict_condition_raises(self):
        with pytest.raises(ConditionError):
            evaluate_condition("bad", {})

    def test_missing_var_key_raises(self):
        with pytest.raises(ConditionError, match="requires key 'var'"):
            evaluate_condition({"equals": {"value": "x"}}, {})

    def test_missing_value_key_raises(self):
        with pytest.raises(ConditionError, match="requires key 'value'"):
            evaluate_condition({"equals": {"var": "x"}}, {})

    def test_non_list_values_raises(self):
        with pytest.raises(ConditionError, match="must be a list"):
            evaluate_condition({"in": {"var": "x", "values": "not-a-list"}}, {})


# ── validate_condition ────────────────────────────────────────────────────────

class TestValidateCondition:
    def test_valid_equals_passes(self):
        validate_condition({"equals": {"var": "env", "value": "production"}})

    def test_valid_and_with_nested_passes(self):
        validate_condition({"and": {"clauses": [
            {"equals": {"var": "a", "value": 1}},
            {"in": {"var": "b", "values": [1, 2]}},
        ]}})

    def test_invalid_raises(self):
        with pytest.raises(ConditionError):
            validate_condition({"bad_op": {}})

    def test_nested_invalid_raises(self):
        with pytest.raises(ConditionError):
            validate_condition({"and": {"clauses": [
                {"equals": {"var": "a", "value": 1}},
                {"nope": {}},   # invalid nested op
            ]}})