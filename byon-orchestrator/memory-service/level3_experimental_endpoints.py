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


def register_level3_endpoints(
    app,
    fcem_provider: Callable[[], Any],
    handlers_provider: Optional[Callable[[], Any]] = None,
) -> bool:
    """Conditionally register the level3 read-only endpoints on `app`.

    Parameters
    ----------
    app : the FastAPI application
    fcem_provider : callable returning the current FCE-M backend object
                    (allows lazy access without a hard import).
    handlers_provider : optional callable returning the MemoryHandlers
                    instance — used by `/level3/embedder-info` to expose
                    the live embedder's class name, model name and
                    dimension.

    Returns
    -------
    bool : True iff endpoints were actually registered (flag was ON).

    Behavior:
      * If `BYON_LEVEL3_FULL_ORGANISM_EXPERIMENT` is not exactly 'true',
        this function logs nothing and returns False without touching
        `app`. Default OFF — no production behavior change.
      * If the flag is ON, several GET routes are added under `/level3/`.
        Each route is a read-only snapshot and contains explicit
        `is_level3_experiment_endpoint = True` and
        `forbidden_for_omega_creation = True` markers so any downstream
        consumer can verify the endpoint did not write anything.
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

    # /level3/fce-metrics: the DETAILED implementation lives later in this
    # function (it exposes per-center kappa/alpha/Z + the morphogenesis
    # log tail with S_t / AR). The earlier shallow stub has been removed
    # in commit 15 to prevent FastAPI from shadowing the detailed route.

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

    @app.get("/level3/embedder-info")
    async def level3_embedder_info():
        """Read-only embedder info. Allows the runner to verify the
        production embedder (sentence-transformers ProductionEmbedder)
        vs the fallback `SimpleEmbedder` deterministic hash embedder.
        """
        if handlers_provider is None:
            return {
                "ok": False,
                "is_level3_experiment_endpoint": True,
                "forbidden_for_omega_creation": True,
                "production_embeddings_live": False,
                "reason": "handlers_provider not supplied",
            }
        try:
            handlers_obj = handlers_provider()
        except Exception as e:
            return {
                "ok": False,
                "is_level3_experiment_endpoint": True,
                "forbidden_for_omega_creation": True,
                "production_embeddings_live": False,
                "reason": f"handlers_provider failed: {e}",
            }
        embedder = getattr(handlers_obj, "embedder", None)
        if embedder is None:
            return {
                "ok": False,
                "is_level3_experiment_endpoint": True,
                "forbidden_for_omega_creation": True,
                "production_embeddings_live": False,
                "reason": "handlers.embedder attribute missing",
            }
        cls_name = type(embedder).__name__
        production_live = cls_name == "ProductionEmbedder"
        model_name = getattr(embedder, "model_name", None)
        dim = getattr(embedder, "dim", None)
        return {
            "ok": True,
            "is_level3_experiment_endpoint": True,
            "forbidden_for_omega_creation": True,
            "embedder_class": cls_name,
            "embedder_name": model_name,
            "embedding_dim": dim,
            "backend": "FAISS-IndexFlatIP",
            "fallback_simple_embedder_active": cls_name == "SimpleEmbedder",
            "production_embeddings_live": production_live,
        }

    @app.get("/level3/fce-metrics")
    async def level3_fce_metrics():
        """Read-only FCE-M observer snapshot.

        Tries to expose per-center kappa / alpha / rho / lambda_ar /
        Z_norm / B_t / Omega state from the observer's `_agents` dict.
        S_t / AR / I_t are NOT directly retained as observer state in
        FCE-M v0.6.0 — they are computed at `step()` time and stored on
        emitted `MorphogenesisEvent` records (the `morphogenesis_log`).
        The endpoint therefore also exposes the recent log tail so the
        runner can derive max/mean S_t and AR observed since startup.
        """
        fcem = fcem_provider()
        if not getattr(fcem, "enabled", False):
            return {
                "ok": True,
                "is_level3_experiment_endpoint": True,
                "forbidden_for_omega_creation": True,
                "fce_metrics_exposed": False,
                "reason": "FCE-M backend disabled",
            }
        try:
            store = getattr(fcem, "_store", None)
            observer = None
            if store is not None and hasattr(store, "fce_omega_observer"):
                observer = store.fce_omega_observer()
        except Exception as e:
            return {
                "ok": False,
                "is_level3_experiment_endpoint": True,
                "forbidden_for_omega_creation": True,
                "fce_metrics_exposed": False,
                "reason": f"observer lookup failed: {e}",
            }
        if observer is None:
            return {
                "ok": True,
                "is_level3_experiment_endpoint": True,
                "forbidden_for_omega_creation": True,
                "fce_metrics_exposed": False,
                "reason": (
                    "FCE-M observer not yet instantiated; consolidate() may not "
                    "have run yet, or no MEMORY events seen on this server "
                    "process since startup"
                ),
            }
        # Per-center read-only snapshot via the observer.center_state API.
        per_center = []
        try:
            agents_dict = getattr(observer, "_agents", {}) or {}
            for center_key in list(agents_dict.keys()):
                try:
                    st = observer.center_state(center_key)
                except Exception:
                    continue
                if not st or not st.get("exists"):
                    continue
                z_norm = float(st.get("Z_norm", 0.0))
                b_t = 1.0 / (1.0 + z_norm) if z_norm >= 0 else None
                per_center.append({
                    "center_id": center_key,
                    "Omega": int(st.get("Omega", 0)),
                    "kappa": float(st.get("kappa", 0.0)),
                    "alpha": float(st.get("alpha", 0.0)),
                    "rho": float(st.get("rho", 0.0)),
                    "lambda_ar": float(st.get("lambda_ar", 0.0)),
                    "Z_norm": z_norm,
                    "B_t_from_Z": b_t,
                    "Phi_s_norm": float(st.get("Phi_s_norm", 0.0)),
                    "cycles": int(st.get("cycles", 0)),
                    "consec_above_threshold": int(st.get("consec_above_threshold", 0)),
                    "sine_type": str(st.get("sine_type", "unknown")),
                })
        except Exception:
            per_center = []
        # Tail of morphogenesis log (contains S_t / AR per event).
        log_tail = []
        try:
            log = getattr(observer, "morphogenesis_log", []) or []
            tail = log[-200:] if len(log) > 200 else list(log)
            for ev in tail:
                try:
                    log_tail.append({
                        "center_id": getattr(ev, "center_id", None) or getattr(ev, "semantic_center", None),
                        "S_t": float(getattr(ev, "S_t", 0.0)),
                        "AR": float(getattr(ev, "AR", 0.0)),
                        "kappa": float(getattr(ev, "kappa", 0.0)),
                        "cycle": int(getattr(ev, "cycle", 0)),
                        "episode_id": int(getattr(ev, "episode_id", -1)) if getattr(ev, "episode_id", None) is not None else None,
                    })
                except Exception:
                    continue
        except Exception:
            log_tail = []
        s_values = [e["S_t"] for e in log_tail if isinstance(e.get("S_t"), float)]
        ar_values = [e["AR"] for e in log_tail if isinstance(e.get("AR"), float)]
        max_S = max(s_values) if s_values else None
        mean_S = (sum(s_values) / len(s_values)) if s_values else None
        max_AR = max(ar_values) if ar_values else None
        mean_AR = (sum(ar_values) / len(ar_values)) if ar_values else None
        # Longest run above theta_s in the observed log.
        theta_s_val = float(getattr(observer, "theta_s", 0.28))
        tau_coag_val = int(getattr(observer, "tau_coag", 12))
        longest_run = 0
        cur_run = 0
        for v in s_values:
            if v >= theta_s_val:
                cur_run += 1
                if cur_run > longest_run:
                    longest_run = cur_run
            else:
                cur_run = 0
        return {
            "ok": True,
            "is_level3_experiment_endpoint": True,
            "forbidden_for_omega_creation": True,
            "fce_metrics_exposed": True,
            "theta_s": theta_s_val,
            "tau_coag": tau_coag_val,
            "per_center": per_center,
            "morphogenesis_log_tail_length": len(log_tail),
            "morphogenesis_log_tail": log_tail,
            "max_S_t_in_log": max_S,
            "mean_S_t_in_log": mean_S,
            "max_AR_in_log": max_AR,
            "mean_AR_in_log": mean_AR,
            "longest_run_above_theta_in_log": longest_run,
            "note": (
                "S_t / AR are recovered from the observer's morphogenesis_log "
                "(tail of last 200 events). I_t is NOT separately retained by "
                "FCE-M v0.6.0; if the runner needs I_t it must be computed "
                "from delta_X and Phi_s, which are not exposed by this surface."
            ),
        }

    return True
