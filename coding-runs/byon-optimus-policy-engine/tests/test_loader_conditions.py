"""
Tests for condition validation in the workflow loader.
"""

import pytest

from policy_engine.loader import LoadError, parse_workflow


def _wf(step_extra: dict) -> dict:
    return {
        "name": "test",
        "steps": [{"name": "a", "action": "noop", **step_extra}],
    }


class TestLoaderConditionValidation:
    def test_valid_equals_condition(self):
        wf = parse_workflow(_wf({"condition": {"equals": {"var": "env", "value": "prod"}}}))
        assert wf.steps[0].condition == {"equals": {"var": "env", "value": "prod"}}

    def test_valid_not_equals_condition(self):
        wf = parse_workflow(_wf({"condition": {"not_equals": {"var": "env", "value": "prod"}}}))
        assert wf.steps[0].condition is not None

    def test_valid_in_condition(self):
        wf = parse_workflow(_wf({"condition": {"in": {"var": "env", "values": ["a", "b"]}}}))
        assert wf.steps[0].condition is not None

    def test_valid_not_in_condition(self):
        wf = parse_workflow(_wf({"condition": {"not_in": {"var": "env", "values": ["prod"]}}}))
        assert wf.steps[0].condition is not None

    def test_no_condition_is_valid(self):
        wf = parse_workflow(_wf({}))
        assert wf.steps[0].condition is None

    def test_condition_not_dict(self):
        with pytest.raises(LoadError, match="must be an object"):
            parse_workflow(_wf({"condition": "equals"}))

    def test_condition_unknown_operator(self):
        with pytest.raises(LoadError, match="unknown condition operator"):
            parse_workflow(_wf({"condition": {"gt": {"var": "x", "value": 1}}}))

    def test_condition_multiple_operators(self):
        with pytest.raises(LoadError, match="exactly one operator"):
            parse_workflow(_wf({"condition": {
                "equals": {"var": "x", "value": 1},
                "not_equals": {"var": "x", "value": 2},
            }}))

    def test_condition_missing_var(self):
        with pytest.raises(LoadError, match="must include 'var'"):
            parse_workflow(_wf({"condition": {"equals": {"value": "prod"}}}))

    def test_condition_equals_missing_value(self):
        with pytest.raises(LoadError, match="requires 'value'"):
            parse_workflow(_wf({"condition": {"equals": {"var": "x"}}}))

    def test_condition_in_missing_values(self):
        with pytest.raises(LoadError, match="requires 'values'"):
            parse_workflow(_wf({"condition": {"in": {"var": "x"}}}))

    def test_condition_in_values_not_list(self):
        with pytest.raises(LoadError, match="must be a list"):
            parse_workflow(_wf({"condition": {"in": {"var": "x", "values": "bad"}}}))

    def test_condition_operands_not_dict(self):
        with pytest.raises(LoadError, match="must be an object"):
            parse_workflow(_wf({"condition": {"equals": "bad"}}))