"""Env-flagged read-only experimental endpoints for the Level 3
full-organism runtime experiment.

The module exposes a function `register_level3_endpoints(app, fcem_provider)`
that is OPT-IN. It is called only when the host application elects to,
and it inspects `BYON_LEVEL3_FULL_ORGANISM_EXPERIMENT` at registration
time. When the flag is unset, the function returns immediately without
adding any routes.

Strict isolation:
  - Read endpoints are READ-ONLY. They never write to OmegaRegistry,
    never create OmegaRecord, never create ReferenceField, never call
    `check_coagulation`.
  - Two endpoints write — but only into the experiment namespace
    (thread_id prefix `level3_full_organism_`), with explicit
    `is_structural_reference=true` and `is_level3_experiment=true`
    markers, using the production memory store path (same FAISS
    embed + FCE-M assimilate pipeline as a normal store action).
  - The module never modifies `theta_s` or `tau_coag`.
  - The module's import has NO side effects on `app` (registration
    requires an explicit call).
  - When the flag is OFF the registration is a no-op; the host
    application's behavior is unchanged.

Endpoints (gated by flag):
  GET  /level3/telemetry                — flag status + FCE module presence
  GET  /level3/fce-metrics              — FCE per-center + morphogenesis log
  GET  /level3/omega-registry-snapshot  — OmegaRegistry snapshot
  GET  /level3/reference-field-snapshot — ReferenceField snapshot
  GET  /level3/relational-field-snapshot — placeholder (runner-side)
  GET  /level3/embedder-info            — embedder class / model / dim
  POST /level3/persist-structural-reference   — write a structural ref
  POST /level3/retrieve-structural-references — thread-scoped recall
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

    # ------------------------------------------------------------------
    # commit 17: write + read endpoints for structural references.
    #
    # We encode the structural metadata in the FACT entry's `tags` list
    # so we don't have to extend production handler signatures. Each
    # entry is stored via the production `handlers.store_fact(...)` path
    # (full FAISS embed). Retrieval uses thread-scoped `search_facts`
    # and post-filters on the `level3:structural_reference` tag prefix.
    #
    # Both endpoints enforce the experiment namespace
    # (thread_id prefix `level3_full_organism_`). The write endpoint
    # rejects origin `endogenous_derivative_candidate` — that label is
    # only reachable via the runner's state machine.
    #
    # Note: `from __future__ import annotations` at module top turns
    # type hints into strings, and FastAPI cannot resolve types defined
    # in a function-local scope through string evaluation. We therefore
    # use plain `dict` parameter typing for the JSON body — FastAPI
    # auto-parses the request body into a dict.
    # ------------------------------------------------------------------
    from fastapi import HTTPException

    EXPERIMENT_THREAD_PREFIX = "level3_full_organism_"
    EXPERIMENT_CHANNEL = "level3-structural-identity-runner"
    STRUCTURAL_TAG_PREFIX = "level3:structural_reference"

    def _structural_tags_from_body(body, fallback_node_id=None):
        node_id = str(body.get("structural_node_id", "") or fallback_node_id or "")
        origin = str(body.get("origin", "operator_seeded") or "operator_seeded")
        trust_tier = str(body.get("trust_tier", "VERIFIED_PROJECT_FACT") or "VERIFIED_PROJECT_FACT")
        assim_state = str(body.get("assimilation_state", "seeded_reference") or "seeded_reference")
        run_id = str(body.get("run_id", "") or "")
        phase_id = str(body.get("phase_id", "phase0_seed") or "phase0_seed")
        scenario_id = str(body.get("scenario_id", phase_id) or phase_id)
        source_turn_id = str(body.get("source_turn_id", "") or "")
        title = str(body.get("title", "") or "")
        return [
            STRUCTURAL_TAG_PREFIX,
            "level3:experiment",
            f"level3:node:{node_id}",
            f"level3:origin:{origin}",
            f"level3:trust:{trust_tier}",
            f"level3:state:{assim_state}",
            f"level3:run:{run_id}",
            f"level3:phase:{phase_id}",
            f"level3:scenario:{scenario_id}",
            f"level3:source_turn:{source_turn_id}",
            f"level3:title:{title[:120]}",
        ], {
            "structural_node_id": node_id,
            "origin": origin,
            "trust_tier": trust_tier,
            "assimilation_state": assim_state,
            "run_id": run_id,
            "phase_id": phase_id,
            "scenario_id": scenario_id,
            "source_turn_id": source_turn_id,
            "title": title,
        }

    def _decode_structural_tags(tags):
        """Recover structural metadata from a tag list."""
        if not isinstance(tags, list):
            return None
        if STRUCTURAL_TAG_PREFIX not in tags:
            return None
        out = {
            "structural_node_id": None,
            "origin": None,
            "trust_tier": None,
            "assimilation_state": None,
            "run_id": None,
            "phase_id": None,
            "scenario_id": None,
            "source_turn_id": None,
            "title": None,
        }
        for t in tags:
            if not isinstance(t, str):
                continue
            if t.startswith("level3:node:"):
                out["structural_node_id"] = t[len("level3:node:"):]
            elif t.startswith("level3:origin:"):
                out["origin"] = t[len("level3:origin:"):]
            elif t.startswith("level3:trust:"):
                out["trust_tier"] = t[len("level3:trust:"):]
            elif t.startswith("level3:state:"):
                out["assimilation_state"] = t[len("level3:state:"):]
            elif t.startswith("level3:run:"):
                out["run_id"] = t[len("level3:run:"):]
            elif t.startswith("level3:phase:"):
                out["phase_id"] = t[len("level3:phase:"):]
            elif t.startswith("level3:scenario:"):
                out["scenario_id"] = t[len("level3:scenario:"):]
            elif t.startswith("level3:source_turn:"):
                out["source_turn_id"] = t[len("level3:source_turn:"):]
            elif t.startswith("level3:title:"):
                out["title"] = t[len("level3:title:"):]
        return out

    @app.post("/level3/persist-structural-reference")
    async def level3_persist_structural_reference(body: dict):
        """Persist a single operator-introduced structural reference via
        the production `handlers.store_fact(...)` path. Metadata is
        encoded in the fact's `tags` list using the `level3:*` prefix
        scheme; full FAISS embed is performed by the production
        embedder.
        """
        thread_id = str(body.get("thread_id", "") or "")
        if not thread_id.startswith(EXPERIMENT_THREAD_PREFIX):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"thread_id must start with {EXPERIMENT_THREAD_PREFIX!r} "
                    "for the level3 experiment namespace"
                ),
            )
        canonical_text = str(body.get("canonical_text", "") or "")
        if not canonical_text.strip():
            raise HTTPException(status_code=400, detail="canonical_text required")
        structural_node_id = str(body.get("structural_node_id", "") or "")
        if not structural_node_id.strip():
            raise HTTPException(status_code=400, detail="structural_node_id required")
        origin = str(body.get("origin", "operator_seeded") or "operator_seeded")
        if origin == "endogenous_derivative_candidate":
            raise HTTPException(
                status_code=400,
                detail=(
                    "origin=endogenous_derivative_candidate is reserved; "
                    "only the runner can advance a STATE to that label"
                ),
            )
        if handlers_provider is None:
            raise HTTPException(
                status_code=500,
                detail="handlers_provider not supplied to level3 registration",
            )
        handlers_obj = handlers_provider()
        tags, decoded = _structural_tags_from_body(body, fallback_node_id=structural_node_id)
        try:
            ctx_id = handlers_obj.store_fact(
                fact=canonical_text,
                source="level3-structural-identity",
                tags=tags,
                thread_id=thread_id,
                channel=EXPERIMENT_CHANNEL,
                trust=decoded["trust_tier"],
                disputed=False,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"store_fact failed: {e}")
        return {
            "ok": True,
            "is_level3_experiment_endpoint": True,
            "is_level3_write_endpoint": True,
            "forbidden_for_omega_creation": True,
            "ctx_id": ctx_id,
            "thread_id": thread_id,
            "structural_metadata": decoded,
            "stored_tags": tags,
        }

    @app.post("/level3/retrieve-structural-references")
    async def level3_retrieve_structural_references(body: dict):
        """Thread-scoped recall of structural references. Routes
        through the production `handlers.search_facts(...)` path with
        `scope="thread"`, then post-filters on the structural tag
        prefix.
        """
        thread_id = str(body.get("thread_id", "") or "")
        if not thread_id.startswith(EXPERIMENT_THREAD_PREFIX):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"thread_id must start with {EXPERIMENT_THREAD_PREFIX!r} "
                    "for the level3 experiment namespace"
                ),
            )
        query = str(body.get("query", "") or "")
        top_k = int(body.get("top_k", 20) or 20)
        if handlers_provider is None:
            raise HTTPException(
                status_code=500,
                detail="handlers_provider not supplied to level3 registration",
            )
        handlers_obj = handlers_provider()
        effective_query = query if query.strip() else "structural reference"
        try:
            search_result = handlers_obj.search_facts(
                query=effective_query,
                top_k=top_k,
                threshold=0.0,
                thread_id=thread_id,
                scope="thread",
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"search_facts failed: {e}")
        # search_facts returns a dict like {"success": True, "results": [...]}
        # or a list of hits directly depending on internals — handle both.
        raw_hits = []
        if isinstance(search_result, dict):
            raw_hits = search_result.get("results") or search_result.get("hits") or []
        elif isinstance(search_result, list):
            raw_hits = search_result
        structural_hits = []
        for h in raw_hits:
            if not isinstance(h, dict):
                continue
            md = h.get("metadata") if isinstance(h.get("metadata"), dict) else h
            tags = md.get("tags") if isinstance(md, dict) else None
            decoded = _decode_structural_tags(tags or [])
            if decoded is None:
                continue
            structural_hits.append({
                "ctx_id": h.get("ctx_id"),
                "content": h.get("content"),
                "similarity": h.get("similarity"),
                "structural_metadata": decoded,
                "thread_id": md.get("thread_id") if isinstance(md, dict) else thread_id,
                "channel": md.get("channel") if isinstance(md, dict) else None,
                "tags": tags,
            })
        return {
            "ok": True,
            "is_level3_experiment_endpoint": True,
            "forbidden_for_omega_creation": True,
            "thread_id": thread_id,
            "query": query,
            "top_k": top_k,
            "scope": "thread",
            "n_structural_references": len(structural_hits),
            "structural_references": structural_hits,
            "raw_hit_count": len(raw_hits),
        }

    return True
