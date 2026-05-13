"""
Tests for the operator-controlled permissive mode.

Invariants verified:
  - Permissive mode is NEVER activated by workflow YAML.
  - Permissive mode is activated only by operator-controlled mechanisms
    (env var or CLI flag).
  - Every permissive override is recorded in the audit log as POLICY_OVERRIDDEN.
  - Permissive mode never silently elides policy decisions.
"""

from __future__ import annotations

import os
import pytest

from policy_engine.audit import AuditLog
from policy_engine.models import Step
from policy_engine.policy import PolicyEngine, PolicyGrants, PolicyMode


def _step(name: str = "deploy", policy_tags: list[str] | None = None) -> Step:
    return Step(
        name=name,
        action=name,
        depends_on=[],
        condition=None,
        policy_tags=policy_tags or [],
    )


def _production_context() -> dict:
    return {"environment": "production"}


class TestEnforcingMode:
    def test_production_denied_without_grant(self):
        audit = AuditLog()
        engine = PolicyEngine(
            grants=PolicyGrants.default(),
            audit=audit,
            mode=PolicyMode.ENFORCING,
        )
        decision = engine.check(_step(), _production_context())
        assert not decision.allowed
        assert decision.reason == "policy_violation"

    def test_production_allowed_with_grant(self):
        audit = AuditLog()
        engine = PolicyEngine(
            grants=PolicyGrants(allow_production=True),
            audit=audit,
            mode=PolicyMode.ENFORCING,
        )
        decision = engine.check(_step(), _production_context())
        assert decision.allowed
        assert not decision.overridden

    def test_enforcing_audit_denied(self):
        audit = AuditLog()
        engine = PolicyEngine(
            grants=PolicyGrants.default(),
            audit=audit,
            mode=PolicyMode.ENFORCING,
        )
        engine.check(_step(), _production_context())
        events = [e["event"] for e in audit.entries()]
        assert "POLICY_DENIED" in events
        assert "POLICY_OVERRIDDEN" not in events


class TestPermissiveModeOperatorControlled:
    def test_permissive_allows_but_marks_overridden(self):
        audit = AuditLog()
        engine = PolicyEngine(
            grants=PolicyGrants.default(),
            audit=audit,
            mode=PolicyMode.PERMISSIVE,
        )
        decision = engine.check(_step(), _production_context())
        assert decision.allowed
        assert decision.overridden is True
        assert decision.reason == "OVERRIDDEN"

    def test_permissive_audit_contains_overridden_event(self):
        audit = AuditLog()
        engine = PolicyEngine(
            grants=PolicyGrants.default(),
            audit=audit,
            mode=PolicyMode.PERMISSIVE,
        )
        engine.check(_step(), _production_context())
        events = [e["event"] for e in audit.entries()]
        assert "POLICY_OVERRIDDEN" in events

    def test_permissive_activation_is_audited(self):
        """Merely constructing a permissive engine must produce an audit entry."""
        audit = AuditLog()
        PolicyEngine(
            grants=PolicyGrants.default(),
            audit=audit,
            mode=PolicyMode.PERMISSIVE,
        )
        events = [e["event"] for e in audit.entries()]
        assert "POLICY_MODE_PERMISSIVE_ACTIVATED" in events

    def test_permissive_via_env_var(self, monkeypatch):
        monkeypatch.setenv("POLICY_ENGINE_MODE", "permissive")
        from policy_engine.policy import policy_mode_from_env
        assert policy_mode_from_env() == PolicyMode.PERMISSIVE

    def test_enforcing_is_default_when_env_unset(self, monkeypatch):
        monkeypatch.delenv("POLICY_ENGINE_MODE", raising=False)
        from policy_engine.policy import policy_mode_from_env
        assert policy_mode_from_env() == PolicyMode.ENFORCING

    def test_permissive_violations_still_recorded(self):
        """Even in permissive mode, violations must appear in the audit entry."""
        audit = AuditLog()
        engine = PolicyEngine(
            grants=PolicyGrants.default(),
            audit=audit,
            mode=PolicyMode.PERMISSIVE,
        )
        engine.check(_step(), _production_context())
        overridden = [
            e for e in audit.entries() if e["event"] == "POLICY_OVERRIDDEN"
        ]
        assert overridden
        assert overridden[0]["details"]["violations"]


class TestPermissiveModeNeverFromWorkflowYAML:
    """
    Permissive mode must NEVER be activated by anything inside the workflow file.
    This is a belt-and-suspenders test: the loader already rejects 'policy_gate',
    but we also verify the engine itself has no code path that reads policy mode
    from workflow data.
    """

    def test_workflow_context_cannot_set_permissive(self):
        """
        Even if somehow a workflow context contains policy_mode=permissive,
        the engine must not switch to permissive mode.
        """
        audit = AuditLog()
        # Engine is constructed in ENFORCING mode.
        engine = PolicyEngine(
            grants=PolicyGrants.default(),
            audit=audit,
            mode=PolicyMode.ENFORCING,
        )
        # Context that an attacker might inject via workflow YAML.
        malicious_context = {
            "environment": "production",
            "policy_mode": "permissive",
            "policy_gate": "bypass_all",
        }
        decision = engine.check(_step(), malicious_context)
        # Must still be denied — context values don't change the engine mode.
        assert not decision.allowed
        assert not decision.overridden