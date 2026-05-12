"""Env-flagged read-only experimental endpoints for the Level 3
full-organism runtime experiment.

The module exposes a function `register_level3_endpoints(app, fcem_provider)`
that is OPT-IN. It is called only when the host application elects to,
and it inspects `BYON_LEVEL3_FULL_ORGANISM_EXPERIMENT` at registration
time. When the flag is unset, the function returns immediately without
adding any routes.

Strict isolation:
  - The endpoints are READ-ONLY. They never write to OmegaRegistry,
    never create OmegaRecord, never create ReferenceField, never call
    `check_coagulation`.
  - The module never modifies `theta_s` or `tau_coag`.
  - The module's import has NO side effects on `app` (registration
    requires an explicit call).
  - When the flag is OFF the registration is a no-op; the host
    application's behavior is unchanged.

Endpoints (all GET, no body, gated by flag):
  /level3/telemetry                — flag status + FCE module presence
  /level3/fce-metrics              — FCE state snapshot
  /level3/omega-registry-snapshot  — OmegaRegistry snapshot
  /level3/reference-field-snapshot — ReferenceField snapshot
  /level3/relational-field-snapshot — placeholder (relational layer
                                      is computed runner-side, not
                                      memory-service-side)
"""

from __future__ import annotations

import os
import sys
from typing import Any, Callable, Dict, Optional


LEVEL3_FLAG_NAME = "BYON_LEVEL3_FULL_ORGANISM_EXPERIMENT"


def _flag_enabled(env: Optional[Dict[str, str]] = None) -> bool:
    """Strict-boolean: returns True iff the env var is exactly 'true'.

    Any other value (including unset) returns False.
    """
    e = env if env is not None else os.environ
    return e.get(LEVEL3_FLAG_NAME) == "true"


def register_level3_endpoints(app, fcem_provider: Callable[[], Any]) -> bool:
    """Conditionally register the level3 read-only endpoints on `app`.

    Parameters
    ----------
    app : the FastAPI application
    fcem_provider : callable returning the current FCE-M backend object
                    (allows lazy access without a hard import).

    Returns
    -------
    bool : True iff endpoints were actually registered (flag was ON).

    Behavior:
      * If `BYON_LEVEL3_FULL_ORGANISM_EXPERIMENT` is not exactly 'true',
        this function logs nothing and returns False without touching
        `app`. Default OFF — no production behavior change.
      * If the flag is ON, five GET routes are added under `/level3/`.
        Each route is a read-only snapshot drawn from `fcem_provider()`
        and contains an explicit `is_level3_experiment_endpoint = True`
        marker plus a `forbidden_for_omega_creation = True` marker so
        any downstream consumer can verify the endpoint did not write
        anything.
    """
    if not _flag_enabled():
        return False

    try:
        from fastapi import HTTPException  # noqa: F401
    except Exception:
        # If FastAPI is not present in the calling app, abort
        # silently — the experiment runner is not running here.
        return False

    @app.get("/level3/telemetry")
    async def level3_telemetry():
        fcem = fcem_provider()
        return {
            "ok": True,
            "is_level3_experiment_endpoint": True,
            "forbidden_for_omega_creation": True,
            "level3_flag": LEVEL3_FLAG_NAME,
            "level3_flag_enabled": True,
            "fcem_enabled": bool(getattr(fcem, "enabled", False)),
            "advisory_only": True,
        }

    @app.get("/level3/fce-metrics")
    async def level3_fce_metrics():
        fcem = fcem_provider()
        if not getattr(fcem, "enabled", False):
            return {
                "ok": True,
                "is_level3_experiment_endpoint": True,
                "forbidden_for_omega_creation": True,
                "fce_state": None,
                "note": "fce backend disabled",
            }
        try:
            state = fcem.state()
        except Exception as e:
            return {
                "ok": False,
                "is_level3_experiment_endpoint": True,
                "forbidden_for_omega_creation": True,
                "error": str(e),
            }
        return {
            "ok": True,
            "is_level3_experiment_endpoint": True,
            "forbidden_for_omega_creation": True,
            "fce_state": state,
        }

    @app.get("/level3/omega-registry-snapshot")
    async def level3_omega_snapshot():
        fcem = fcem_provider()
        if not getattr(fcem, "enabled", False):
            return {
                "ok": True,
                "is_level3_experiment_endpoint": True,
                "forbidden_for_omega_creation": True,
                "omega_registry": None,
            }
        try:
            registry = fcem.omega_registry()
        except Exception as e:
            return {
                "ok": False,
                "is_level3_experiment_endpoint": True,
                "forbidden_for_omega_creation": True,
                "error": str(e),
            }
        return {
            "ok": True,
            "is_level3_experiment_endpoint": True,
            "forbidden_for_omega_creation": True,
            "omega_registry": registry,
        }

    @app.get("/level3/reference-field-snapshot")
    async def level3_reference_field_snapshot():
        fcem = fcem_provider()
        if not getattr(fcem, "enabled", False):
            return {
                "ok": True,
                "is_level3_experiment_endpoint": True,
                "forbidden_for_omega_creation": True,
                "reference_fields": None,
            }
        try:
            fields = fcem.reference_fields()
            events = fcem.reference_field_events()
        except Exception as e:
            return {
                "ok": False,
                "is_level3_experiment_endpoint": True,
                "forbidden_for_omega_creation": True,
                "error": str(e),
            }
        return {
            "ok": True,
            "is_level3_experiment_endpoint": True,
            "forbidden_for_omega_creation": True,
            "reference_fields": fields,
            "events": events,
        }

    @app.get("/level3/relational-field-snapshot")
    async def level3_relational_field_snapshot():
        # The relational field is computed runner-side (Node), not
        # server-side. This endpoint is a placeholder so the runner can
        # GET it for completeness and detect that the server agrees the
        # relational layer is runner-owned.
        return {
            "ok": True,
            "is_level3_experiment_endpoint": True,
            "forbidden_for_omega_creation": True,
            "relational_field_location": "runner-side (Node)",
            "server_side_relational_data": None,
        }

    return True
