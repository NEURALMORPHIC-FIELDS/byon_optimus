"""Tests for the condition evaluation module."""
import pytest

from policy_engine.conditions import (
    ConditionError,
    ConditionResult,
    evaluate_condition,
    validate_condition,
)


# ---------------------------------------------------------------------------
# validate_condition
# ---------------------------------------------------------------------------

class TestValidateCondition:
    def test_none_is_valid(self):
        validate_condition(None, "step1")  # must not raise

    def test_equals_valid(self):
        validate_condition({"equals": {"var": "env", "value": "prod"}}, "s")

    def test_not_equals_valid(self):
        validate_condition({"not_equals": {"var": "env", "value": "prod"}}, "s")

    def test_in_valid(self):
        validate_condition({"in": {"var": "env", "values": ["prod", "staging"]}}, "s")

    def test_not_in_valid(self):
        validate_condition({"not_in": {"var": "env", "values": ["dev"]}}, "s")

    def test_exists_valid(self):
        validate_condition({"exists": {"var": "flag"}}, "s")

    def test_not_exists_valid(self):
        validate_condition({"not_exists": {"var": "flag"}}, "s")

    def test_unknown_operator_raises(self):
        with pytest.raises(ConditionError, match="no recognised operator"):
            validate_condition({"banana": {}}, "step1")

    def test_non_dict_raises(self):
        with pytest.raises(ConditionError, match="must be a mapping"):
            validate_condition("equals", "step1")

    def test_multiple_operators_raises(self):
        with pytest.raises(ConditionError, match="exactly one operator"):
            validate_condition({"equals": {"var": "x", "value": 1}, "in": {"var": "x", "values": []}}, "s")

    def test_equals_missing_value_key_raises(self):
        with pytest.raises(ConditionError, match="'var' and 'value'"):
            validate_condition({"equals": {"var": "x"}}, "s")

    def test_in_missing_values_key_raises(self):
        with pytest.raises(ConditionError, match="'var' and 'values'"):
            validate_condition({"in": {"var": "x"}}, "s")

    def test_exists_missing_var_raises(self):
        with pytest.raises(ConditionError, match="'var' key"):
            validate_condition({"exists": {}}, "s")

    def test_var_must_be_string(self):
        with pytest.raises(ConditionError, match="non-empty string"):
            validate_condition({"equals": {"var": 123, "value": "x"}}, "s")


# ---------------------------------------------------------------------------
# evaluate_condition — equals / not_equals
# ---------------------------------------------------------------------------

class TestEvaluateEquals:
    def test_equals_true(self):
        r = evaluate_condition({"equals": {"var": "env", "value": "production"}}, {"env": "production"})
        assert r.passed is True
        assert "==" in r.reason

    def test_equals_false(self):
        r = evaluate_condition({"equals": {"var": "env", "value": "production"}}, {"env": "staging"})
        assert r.passed is False

    def test_equals_missing_var_is_false(self):
        r = evaluate_condition({"equals": {"var": "env", "value": "production"}}, {})
        assert r.passed is False

    def test_not_equals_true(self):
        r = evaluate_condition({"not_equals": {"var": "env", "value": "production"}}, {"env": "staging"})
        assert r.passed is True

    def test_not_equals_false(self):
        r = evaluate_condition({"not_equals": {"var": "env", "value": "prod"}}, {"env": "prod"})
        assert r.passed is False


# ---------------------------------------------------------------------------
# evaluate_condition — in / not_in
# ---------------------------------------------------------------------------

class TestEvaluateIn:
    def test_in_true(self):
        r = evaluate_condition({"in": {"var": "env", "values": ["prod", "staging"]}}, {"env": "prod"})
        assert r.passed is True

    def test_in_false(self):
        r = evaluate_condition({"in": {"var": "env", "values": ["prod", "staging"]}}, {"env": "dev"})
        assert r.passed is False

    def test_not_in_true(self):
        r = evaluate_condition({"not_in": {"var": "env", "values": ["prod"]}}, {"env": "dev"})
        assert r.passed is True

    def test_not_in_false(self):
        r = evaluate_condition({"not_in": {"var": "env", "values": ["prod"]}}, {"env": "prod"})
        assert r.passed is False


# ---------------------------------------------------------------------------
# evaluate_condition — exists / not_exists
# ---------------------------------------------------------------------------

class TestEvaluateExists:
    def test_exists_true(self):
        r = evaluate_condition({"exists": {"var": "feature_flag"}}, {"feature_flag": True})
        assert r.passed is True

    def test_exists_false_when_missing(self):
        r = evaluate_condition({"exists": {"var": "feature_flag"}}, {})
        assert r.passed is False

    def test_exists_false_when_none(self):
        r = evaluate_condition({"exists": {"var": "x"}}, {"x": None})
        assert r.passed is False

    def test_not_exists_true_when_missing(self):
        r = evaluate_condition({"not_exists": {"var": "x"}}, {})
        assert r.passed is True

    def test_not_exists_false_when_present(self):
        r = evaluate_condition({"not_exists": {"var": "x"}}, {"x": "value"})
        assert r.passed is False


# ---------------------------------------------------------------------------
# evaluate_condition — None condition (always run)
# ---------------------------------------------------------------------------

class TestEvaluateNone:
    def test_none_always_passes(self):
        r = evaluate_condition(None, {})
        assert r.passed is True
        assert r.reason == "no condition"