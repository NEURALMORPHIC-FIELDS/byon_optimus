"""UnifiedMemoryStore: the single facade entry point.

Routes write / read / propagate / consolidate / audit_log to the appropriate
source backend per the routing policy in docs/ROUTING.md.

Per CC1 user resolution 2026-05-06: symbolic entries default-route to
memory_engine_runtime, numerical entries default-route to tf_engine.
Explicit source= overrides.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from unified_fragmergent_memory.bridges.shape_translators import (
    is_numerical_entry,
    is_symbolic_entry,
)
from unified_fragmergent_memory.facade.config import Config


class UnifiedMemoryStore:
    """Unified facade over d_cortex, tf_engine, memory_engine_runtime.

    The store is stateful per backend: tf_engine has a numerical bank; the
    runtime adapter has a MiniBank + ProvisionalMemory + BankStabilityIndex
    + audit log. State is initialized lazily on first use of the relevant
    source so that importing this module does not force importing any source.
    """

    VALID_SOURCES = ("d_cortex", "tf_engine", "memory_engine_runtime", "auto")

    def __init__(self, config: Optional[Config] = None) -> None:
        self.config = config or Config()
        self.config.validate()
        self._tf_bank: Optional[Dict[str, np.ndarray]] = None
        self._tf_bank_entries_buffer: List[Dict[str, Any]] = []
        self._runtime_adapter = None
        self._runtime_episode_id: int = 0
        # Cross-substrate state (Pas 5, v0.2.0). Internal to the store; not in Config.
        # Per Q3 user resolution 2026-05-06: registry is part of store identity, lazy.
        self._label_slot_registry: Dict[Tuple[str, str], int] = {}
        self._next_label_id: int = 0
        self._cross_substrate_receptor = None
        self._cross_substrate_last_pressure = None
        self._cross_substrate_audit: List[Any] = []
        # v0.3.2: per-slot auto-registration metadata (provenance back to the
        # organism trace that triggered the registration). Bidirectional via
        # _label_slot_registry forward and lookup_slot_by_label reverse.
        self._auto_registrations: Dict[Tuple[str, str], Any] = {}
        # v0.4.0: FCE-Omega morphogenetic observer (passive). Lazy: only
        # constructed if config.fce_omega_enabled and consolidate() runs.
        # Per misiunea.txt Etapa 1, the observer never mutates UFME state.
        self._fce_observer = None

    def _route(self, entry: Optional[Dict[str, Any]], source: str) -> str:
        """Resolve the active source backend.

        See docs/ROUTING.md for the policy.
        """
        if source not in self.VALID_SOURCES:
            raise ValueError(
                f"source must be one of {self.VALID_SOURCES}, got {source!r}"
            )
        if source != "auto":
            return source
        if self.config.default_routing == "explicit":
            raise ValueError(
                "Config.default_routing='explicit' but source='auto'. "
                "Pass an explicit source= argument."
            )
        if entry is not None:
            if is_symbolic_entry(entry):
                return "memory_engine_runtime"
            if is_numerical_entry(entry):
                return "tf_engine"
        raise ValueError(
            "Entry shape not recognized. Provide entity_id+attr_type for symbolic "
            "or vector for numerical, or pass source= explicitly. Candidate "
            "sources: d_cortex, tf_engine, memory_engine_runtime."
        )

    def _ensure_runtime_adapter(self) -> Any:
        """Lazily construct the runtime DCortexAdapter."""
        if self._runtime_adapter is not None:
            return self._runtime_adapter
        from unified_fragmergent_memory.sources.memory_engine_runtime import (
            DCortexAdapter,
        )
        self._runtime_adapter = DCortexAdapter(
            mode=self.config.runtime_latent_mode,
            N_promote=self.config.runtime_n_promote,
            M_retrograde=self.config.runtime_m_retrograde,
            K_promote_age=self.config.runtime_k_promote_age,
            K_prune_stale=self.config.runtime_k_prune_stale,
        )
        return self._runtime_adapter

    # write ---------------------------------------------------------------
    def write(self, entry: Dict[str, Any], source: str = "auto") -> Dict[str, Any]:
        """Write an entry to the active source backend.

        Symbolic entries route to memory_engine_runtime; the adapter projects
        the entry as a slot_event with zone_after=COMMITTED.

        Numerical entries route to tf_engine; entries accumulate in an
        in-memory buffer until `seal_tf_bank()` is called or until a read
        triggers automatic sealing.
        """
        target = self._route(entry, source)
        if target == "tf_engine":
            return self._write_tf_engine(entry)
        if target == "memory_engine_runtime":
            return self._write_runtime(entry)
        if target == "d_cortex":
            return self._write_d_cortex(entry)
        raise NotImplementedError(f"write target {target} not handled")

    def _write_tf_engine(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        if not is_numerical_entry(entry):
            raise NotImplementedError(
                "tf_engine accepts only numerical-vector entries (key 'vector' "
                "or 'v' with numpy.ndarray). Got keys: "
                f"{sorted(entry.keys())}"
            )
        vec = entry.get("vector", entry.get("v"))
        record = {
            "vector": np.asarray(vec, dtype=np.float64),
            "mi": float(entry.get("mi", 0.0)),
            "label": int(entry.get("label", -1)),
            "beta": float(entry.get("beta", 0.0)),
            "sigma": float(entry.get("sigma", 1.0)),
        }
        self._tf_bank_entries_buffer.append(record)
        return {"target": "tf_engine", "buffer_size": len(self._tf_bank_entries_buffer)}

    def _write_runtime(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        if not is_symbolic_entry(entry):
            raise NotImplementedError(
                "memory_engine_runtime accepts only symbolic entries (entity_id+attr_type). "
                f"Got keys: {sorted(entry.keys())}"
            )
        adapter = self._ensure_runtime_adapter()
        # Translate to the adapter's expected slot_event schema:
        # keys (entity, family, value_after, value_before, zone_before,
        # zone_after, episode_id, write_step, reason). Zone strings are
        # uppercase (COMMITTED, PROVISIONAL, DISPUTED, NONE).
        zone_after_raw = str(entry.get("zone_after", "committed")).upper()
        zone_before_raw = str(entry.get("zone_before", "empty")).upper()
        value_after = entry.get("value_after") or entry.get("value_str") or str(
            entry.get("value_idx", "")
        )
        slot_event = {
            "entity": entry["entity_id"],
            "family": entry["attr_type"],
            "value_after": value_after,
            "value_before": entry.get("value_before"),
            "zone_before": zone_before_raw,
            "zone_after": zone_after_raw,
            "episode_id": entry.get("episode_id", self._runtime_episode_id),
            "write_step": entry.get("write_step", 0),
            "reason": entry.get("source_text", entry.get("reason", "")),
        }
        adapter.ingest_slot_event(slot_event)
        return {"target": "memory_engine_runtime", "ingested": "slot_event"}

    def _write_d_cortex(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        # Per O11: the d_cortex passthrough for the consolidation step is the
        # runtime adapter. So source=d_cortex on a write is equivalent to
        # source=memory_engine_runtime for symbolic entries.
        if is_symbolic_entry(entry):
            result = self._write_runtime(entry)
            result["target"] = "d_cortex (via memory_engine_runtime O11 passthrough)"
            return result
        raise NotImplementedError(
            "d_cortex backend accepts only symbolic entries. Numerical entries "
            "should be written with source='tf_engine'."
        )

    # read ----------------------------------------------------------------
    def read(self, query: Dict[str, Any], source: str = "auto",
             scoring: str = "softmax", lambda_: float = 0.5) -> Any:
        """Read from the active source backend.

        For numerical sources: returns weights array via softmax/mi/hybrid.
        For symbolic sources: returns slot match info dict.
        """
        target = self._route(query, source)
        if target == "tf_engine":
            return self._read_tf_engine(query, scoring=scoring, lambda_=lambda_)
        if target in ("memory_engine_runtime", "d_cortex"):
            if scoring == "hybrid":
                raise NotImplementedError(
                    f"scoring='hybrid' is only supported by tf_engine. "
                    f"Active source: {target}."
                )
            return self._read_symbolic(query, target)
        raise NotImplementedError(f"read target {target} not handled")

    def _read_tf_engine(self, query: Dict[str, Any], scoring: str,
                        lambda_: float) -> np.ndarray:
        bank = self._seal_tf_bank()
        q_vec = query.get("vector", query.get("v"))
        if q_vec is None:
            raise ValueError("tf_engine read requires 'vector' or 'v' in query")
        q_vec = np.asarray(q_vec, dtype=np.float64)
        if scoring == "softmax":
            from unified_fragmergent_memory.facade.scoring import softmax_score
            return softmax_score(q_vec, bank["vectors"],
                                 temperature=self.config.tf_engine_temperature_softmax)
        if scoring == "mi":
            from unified_fragmergent_memory.facade.scoring import mi_score
            q_mi = float(query.get("mi", 0.0))
            return mi_score(q_mi, bank["mis"],
                            temperature=self.config.tf_engine_temperature_mi)
        if scoring == "hybrid":
            from unified_fragmergent_memory.facade.scoring import hybrid_score
            q_mi = float(query.get("mi", 0.0))
            return hybrid_score(q_vec, q_mi, bank["vectors"], bank["mis"],
                                lambda_=lambda_,
                                temperature=self.config.tf_engine_temperature_softmax,
                                mi_scale=self.config.bridges_mi_scale)
        raise ValueError(f"unknown scoring {scoring!r}")

    def _read_symbolic(self, query: Dict[str, Any], target: str) -> Dict[str, Any]:
        from unified_fragmergent_memory.facade.scoring import slot_match_score
        return slot_match_score(query, source=target)

    def _seal_tf_bank(self) -> Dict[str, np.ndarray]:
        """Convert the buffered entries into a tf_engine-shaped bank dict.

        The bank shape mirrors tf_engine.build_memory_bank: vectors, mis,
        labels, betas, sigmas, mi_targets. mi_targets is derived as the
        per-unique-label mean of mis (matches tf_engine convention where
        each label has a target MI value).
        """
        if self._tf_bank is not None and not self._tf_bank_entries_buffer:
            return self._tf_bank
        if not self._tf_bank_entries_buffer and self._tf_bank is None:
            raise RuntimeError(
                "tf_engine bank is empty. Write at least one entry before reading."
            )
        # Append buffer entries to existing bank, or build fresh.
        if self._tf_bank is None:
            vectors = np.stack([e["vector"] for e in self._tf_bank_entries_buffer])
            mis = np.array([e["mi"] for e in self._tf_bank_entries_buffer])
            labels = np.array([e["label"] for e in self._tf_bank_entries_buffer])
            betas = np.array([e["beta"] for e in self._tf_bank_entries_buffer])
            sigmas = np.array([e["sigma"] for e in self._tf_bank_entries_buffer])
        else:
            vectors = np.concatenate([
                self._tf_bank["vectors"],
                np.stack([e["vector"] for e in self._tf_bank_entries_buffer]),
            ])
            mis = np.concatenate([self._tf_bank["mis"],
                                  np.array([e["mi"] for e in self._tf_bank_entries_buffer])])
            labels = np.concatenate([self._tf_bank["labels"],
                                     np.array([e["label"] for e in self._tf_bank_entries_buffer])])
            betas = np.concatenate([self._tf_bank["betas"],
                                    np.array([e["beta"] for e in self._tf_bank_entries_buffer])])
            sigmas = np.concatenate([self._tf_bank["sigmas"],
                                     np.array([e["sigma"] for e in self._tf_bank_entries_buffer])])
        # Derive mi_targets as one entry per unique label, ordered by label index.
        unique_labels = np.unique(labels[labels >= 0])
        mi_targets: List[float] = []
        for lbl in unique_labels:
            mi_targets.append(float(np.mean(mis[labels == lbl])))
        self._tf_bank = {
            "vectors": vectors, "mis": mis, "labels": labels,
            "betas": betas, "sigmas": sigmas,
            "mi_targets": mi_targets,
        }
        self._tf_bank_entries_buffer = []
        return self._tf_bank

    # propagate -----------------------------------------------------------
    def propagate(self, query: Dict[str, Any], n_steps: int = 5,
                  method: str = "softmax", source: str = "auto",
                  lambda_: float = 0.5) -> Dict[str, Any]:
        """Iterative attention-EMA propagation. Numerical sources only."""
        target = self._route(query, source)
        if target != "tf_engine":
            raise NotImplementedError(
                f"propagate is only supported by tf_engine. Active source: {target}. "
                f"For symbolic sources, use consolidate(episode_id) instead."
            )
        bank = self._seal_tf_bank()
        q_vec = np.asarray(query.get("vector", query.get("v")), dtype=np.float64)
        q_mi = float(query.get("mi", 0.0))
        if method == "hybrid":
            from unified_fragmergent_memory.facade.propagation import propagate_hybrid
            return propagate_hybrid(
                q_vec=q_vec, q_mi=q_mi, bank=bank, lambda_=lambda_,
                n_steps=n_steps, alpha=self.config.tf_engine_alpha,
                k_top=self.config.tf_engine_k_top,
                true_label=int(query.get("true_label", -1)),
            )
        from unified_fragmergent_memory.facade.propagation import propagate as _propagate
        return _propagate(
            q_vec=q_vec, q_mi=q_mi, bank=bank,
            n_steps=n_steps, method=method,
            alpha=self.config.tf_engine_alpha,
            k_top=self.config.tf_engine_k_top,
            temperature_softmax=self.config.tf_engine_temperature_softmax,
            temperature_mi=self.config.tf_engine_temperature_mi,
            true_label=int(query.get("true_label", -1)),
        )

    # consolidate ---------------------------------------------------------
    def consolidate(self, episode_id: Optional[int] = None,
                    source: str = "auto") -> Dict[str, int]:
        """Run the v15.7a 4-op consolidator pipeline at end_episode.

        Symbolic sources only. For tf_engine, raises NotImplementedError.
        """
        target = self._route(None, source) if source != "auto" else "memory_engine_runtime"
        if target == "tf_engine":
            raise NotImplementedError(
                "consolidate is only supported by symbolic sources "
                "(memory_engine_runtime, d_cortex). For tf_engine use propagate()."
            )
        adapter = self._ensure_runtime_adapter()
        if episode_id is None:
            self._runtime_episode_id += 1
            episode_id = self._runtime_episode_id
        signals = adapter.end_episode(episode_id)
        # The adapter returns LatentSignals. We convert to a dict snapshot.
        op_counts = adapter.metrics_snapshot().get("last_pipeline_ops", {})

        # v0.4.0 passive hook: run the FCE-Omega observer if enabled. The
        # observer is read-only — its report does NOT change the return
        # shape contract from prior versions (kept as nested key so callers
        # that ignore it keep working).
        fce_report = None
        if self.config.fce_omega_enabled:
            observer = self._ensure_fce_observer()
            report = observer.observe_after_consolidate(adapter, int(episode_id))
            fce_report = report.to_json_safe()

        return {
            "episode_id": episode_id,
            "ops": op_counts,
            "signals_summary": {
                "promote_candidate": getattr(signals, "promote_candidate", None) is not None,
                "retrograde_candidate": getattr(signals, "retrograde_candidate", None) is not None,
                "prune_candidate": getattr(signals, "prune_candidate", None) is not None,
            },
            "fce_omega_report": fce_report,
        }

    # audit_log -----------------------------------------------------------
    def audit_log(self, source: str = "auto") -> List[Any]:
        """Return the audit log. tf_engine has none and raises if audit_strict."""
        target = self._route(None, source) if source != "auto" else "memory_engine_runtime"
        if target == "tf_engine":
            if self.config.audit_strict:
                raise NotImplementedError("tf_engine has no audit log")
            return []
        adapter = self._ensure_runtime_adapter()
        return list(adapter.audit_log())

    # cross-substrate registry --------------------------------------------
    def register_label_slot(self, entity_id: str, attr_type: str,
                            label: Optional[int] = None) -> int:
        """Register a (entity_id, attr_type) slot under a tf_engine label.

        Lazy: if the slot already has a label, return it. If `label` is None,
        allocate the next available integer. Returns the label id.

        Per Q3 user resolution 2026-05-06: registry is internal store state,
        not part of Config. Persisted via persist_label_slot_registry().
        """
        slot = (str(entity_id), str(attr_type))
        if slot in self._label_slot_registry:
            return self._label_slot_registry[slot]
        if label is None:
            label = self._next_label_id
            self._next_label_id = max(self._next_label_id, label) + 1
        else:
            label = int(label)
            self._next_label_id = max(self._next_label_id, label + 1)
        self._label_slot_registry[slot] = label
        return label

    def persist_label_slot_registry(self, path: str) -> None:
        """Write the registry to a JSON file at `path`.

        Format: {"slots": [{"entity_id": ..., "attr_type": ..., "label": ...}, ...],
                 "next_label_id": int}.
        Atomic via tmp-then-rename if possible.
        """
        import json
        import os
        payload = {
            "slots": [
                {"entity_id": e, "attr_type": a, "label": int(label)}
                for (e, a), label in sorted(self._label_slot_registry.items())
            ],
            "next_label_id": int(self._next_label_id),
        }
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
        os.replace(tmp, path)

    def load_label_slot_registry(self, path: str) -> None:
        """Read a registry JSON written by persist_label_slot_registry."""
        import json
        import os
        if not os.path.exists(path):
            return
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        self._label_slot_registry = {
            (s["entity_id"], s["attr_type"]): int(s["label"])
            for s in payload.get("slots", [])
        }
        self._next_label_id = int(payload.get("next_label_id", 0))

    # v0.3.2: bidirectional auto-registration --------------------------------
    INVALID_EPISTEMIC_STATUSES_FOR_AUTO_REG = frozenset({
        "PARSER_FAILURE", "PARSE_UNCERTAIN", "REJECTED",
    })

    def lookup_slot_by_label(self, label: int) -> Optional[Tuple[str, str]]:
        """Reverse mapping: tf label -> (entity_id, attr_type).

        Returns the first slot found with that label, or None. Used by the
        cross-substrate cycle to map propagation results back to symbolic
        slots, and by tests to verify the bidirectional contract.
        """
        for slot, lbl in self._label_slot_registry.items():
            if lbl == label:
                return slot
        return None

    def auto_register_from_trace(self, trace_summary: Any,
                                 episode_id: int) -> Optional[Any]:
        """v0.3.2 entry point. Auto-register a slot observed via Organism.perceive
        as a tf label with full provenance.

        Validation rules (per v0.3.2 spec):
          1. trace.intent must be 'WRITE' (READ traces do not register slots).
          2. trace.head_entity and slot_attr must both be present and non-empty.
          3. trace.epistemic_status must NOT be in
             {PARSER_FAILURE, PARSE_UNCERTAIN, REJECTED}.
          4. trace.memory_target_zone must NOT be None or 'NONE'.

        Returns:
          - AutoRegistration metadata if registered (or already registered).
          - None if validation rejected the trace (no registration occurred).

        Bidirectional: registers in _label_slot_registry (forward) and stores
        provenance metadata in _auto_registrations (reverse-lookup-able via
        lookup_slot_by_label).
        """
        from unified_fragmergent_memory.runtime.organism_driven import AutoRegistration
        import hashlib

        if getattr(trace_summary, "intent", None) != "WRITE":
            return None
        entity_id = getattr(trace_summary, "slot_entity", None) or getattr(
            trace_summary, "head_entity", None
        )
        attr_type = getattr(trace_summary, "slot_attr", None)
        if not entity_id or not attr_type:
            return None
        if str(getattr(trace_summary, "epistemic_status", "")) in (
            self.INVALID_EPISTEMIC_STATUSES_FOR_AUTO_REG
        ):
            return None
        zone = getattr(trace_summary, "memory_target_zone", None)
        if zone is None or str(zone).upper() == "NONE":
            return None

        slot = (str(entity_id), str(attr_type))
        if slot in self._auto_registrations:
            return self._auto_registrations[slot]

        # Forward registration (idempotent on _label_slot_registry).
        label = self.register_label_slot(slot[0], slot[1])

        # Provenance ID: deterministic from slot + trace + episode.
        seed = "::".join([
            "auto_reg", slot[0], slot[1], str(label),
            str(getattr(trace_summary, "trace_id", "")),
            str(int(episode_id)),
        ])
        auto_reg_id = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]

        record = AutoRegistration(
            entity_id=slot[0],
            attr_type=slot[1],
            label=int(label),
            organism_trace_id=str(getattr(trace_summary, "trace_id", "")),
            episode_id=int(episode_id),
            write_step=int(getattr(trace_summary, "write_step", -1)),
            auto_registration_id=auto_reg_id,
            epistemic_status=str(getattr(trace_summary, "epistemic_status", "")),
            memory_target_zone=str(zone) if zone is not None else None,
        )
        self._auto_registrations[slot] = record
        return record

    def auto_registrations_snapshot(self) -> List[Dict[str, Any]]:
        """JSON-safe snapshot of all auto-registrations."""
        return [r.to_json_safe() for r in self._auto_registrations.values()]

    def persist_auto_registrations(self, path: str) -> None:
        """Write auto-registrations to a JSON file."""
        import json
        import os
        payload = {"auto_registrations": self.auto_registrations_snapshot()}
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
        os.replace(tmp, path)

    def load_auto_registrations(self, path: str) -> None:
        """Read auto-registrations JSON written by persist_auto_registrations."""
        import json
        import os
        from unified_fragmergent_memory.runtime.organism_driven import AutoRegistration
        if not os.path.exists(path):
            return
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        self._auto_registrations = {}
        for entry in payload.get("auto_registrations", []):
            rec = AutoRegistration.from_json_safe(entry)
            self._auto_registrations[(rec.entity_id, rec.attr_type)] = rec
            # Mirror into the forward registry too, so the registry is
            # consistent on reload.
            self._label_slot_registry[(rec.entity_id, rec.attr_type)] = int(rec.label)
            self._next_label_id = max(self._next_label_id, int(rec.label) + 1)

    # FCE-Omega observer (v0.4.0, passive integration) -------------------
    def _ensure_fce_observer(self) -> Any:
        """Lazily construct the FCE-Omega observer.

        Called only inside consolidate() when config.fce_omega_enabled is
        True. Importing the observer module is deferred so callers who do
        not enable FCE-Omega never pay the cost of resolving the FCE-Omega
        source at import time.
        """
        if self._fce_observer is not None:
            return self._fce_observer
        from unified_fragmergent_memory.runtime.fce_omega_observer import (
            FCEOmegaObserver,
        )
        self._fce_observer = FCEOmegaObserver(
            D=self.config.fce_omega_D,
            theta_s=self.config.fce_omega_theta_s,
            tau_coag=self.config.fce_omega_tau_coag,
            seed=self.config.fce_omega_seed,
            multiperspectival_enabled=self.config.fce_multiperspectival_enabled,
            multiperspectival_anchor_eta=self.config.fce_multiperspectival_anchor_eta,
            multiperspectival_theta_pair=self.config.fce_multiperspectival_theta_pair,
            advisory_mode=self.config.fce_advisory_mode,
            reference_fields_enabled=self.config.fce_reference_fields_enabled,
        )
        return self._fce_observer

    def fce_omega_observer(self) -> Optional[Any]:
        """Read-only handle to the observer (None if FCE-Omega is off or
        consolidate() has not run yet)."""
        return self._fce_observer

    def omega_registry_snapshot(self) -> Dict[str, Any]:
        """Return the Omega registry snapshot.

        Empty {"count": 0, ...} if no observer exists yet. The registry is
        an audit artifact; it does not influence routing or epistemic state.
        """
        if self._fce_observer is None:
            return {
                "count": 0, "active": 0, "contested": 0,
                "inexpressed": 0, "records": [],
            }
        return self._fce_observer.omega_registry.snapshot()

    def fce_reference_fields(self) -> List[Dict[str, Any]]:
        """v0.6.0: snapshot of all active ReferenceFields. Each entry
        carries omega_id, center_key, field_vector (frozen at
        coagulation), strength, expression_state, and provenance back
        to the OmegaRecord. Empty if no observer or
        fce_reference_fields_enabled is False."""
        if self._fce_observer is None:
            return []
        from dataclasses import asdict
        return [asdict(rf) for rf in self._fce_observer.reference_field_registry.all()]

    def fce_reference_field(self, center_key: str) -> Optional[Dict[str, Any]]:
        """v0.6.0: single ReferenceField by center, or None."""
        if self._fce_observer is None:
            return None
        from dataclasses import asdict
        rf = self._fce_observer.reference_field_registry.get(center_key)
        return asdict(rf) if rf is not None else None

    def fce_reference_field_events(self) -> List[Dict[str, Any]]:
        """v0.6.0: morphogenetic classification log: every observation
        on a center with a ReferenceField gets a kind in {aligned,
        expression_reinforcing, tensioned, orthogonal,
        contested_expression, residue_amplifying}. Audit only."""
        if self._fce_observer is None:
            return []
        from dataclasses import asdict
        return [asdict(ev) for ev in self._fce_observer.reference_field_events]

    def fce_omega_field_interactions(self) -> List[Dict[str, Any]]:
        """v0.6.0: inter-ReferenceField traces for co-active coagulated
        pairs (field_alignment, field_tension, resonance_score,
        interference_score). Centers without an OmegaRecord cannot
        appear in this trace."""
        if self._fce_observer is None:
            return []
        from dataclasses import asdict
        return [asdict(ofi) for ofi in self._fce_observer.omega_field_interactions]

    def fce_advisory_feedback(self) -> List[Dict[str, Any]]:
        """v0.5.1: append-only advisory feedback emitted by the observer
        in `priority_only` mode. Empty when the observer is in
        `read_only` mode or has not been constructed yet.

        Each entry is a JSON-safe dict with bounded `priority_delta` in
        [-1, 1] and full provenance back to trace ids, omega ids and
        relation candidate ids. Reading does NOT modify state; this is
        priority-metadata, never an epistemic verdict.
        """
        if self._fce_observer is None:
            return []
        from dataclasses import asdict
        return [asdict(fb) for fb in self._fce_observer.advisory_feedback_log]

    def fce_priority_recommendations(self) -> List[Dict[str, Any]]:
        """Alias filter: only kinds with positive priority_delta. Useful
        for consumers that want a "raise this center's priority" list
        without the fragmented / negative-delta downgrades."""
        return [
            fb for fb in self.fce_advisory_feedback()
            if fb.get("priority_delta", 0.0) > 0.0
        ]

    def fce_interaction_log(self) -> List[Dict[str, Any]]:
        """v0.5.0: read-only audit of directional inter-center
        interactions composed by the multiperspectival observer. Empty
        if multiperspectival mode is off or no co-active pairs have
        been observed yet."""
        if self._fce_observer is None:
            return []
        from dataclasses import asdict
        return [asdict(t) for t in self._fce_observer.interaction_log]

    def fce_relation_candidates(self) -> List[Dict[str, Any]]:
        """v0.5.0: read-only list of shared-coagulation candidates
        produced when two co-active centers both crossed THETA_PAIR.
        Mission §1: candidates do NOT auto-set individual Omega; each
        center still has to coagulate on its own threshold rule."""
        if self._fce_observer is None:
            return []
        from dataclasses import asdict
        return [asdict(r) for r in self._fce_observer.relation_candidates]

    def fce_advisory_hints(self) -> List[Dict[str, Any]]:
        """Read-only advisory hints from the FCE-Omega observer.

        Per misiunea.txt: hints describe morphogenetic state (residue,
        coagulation, fragmentation, contestation). They never alter UFME
        memory or the runtime's epistemic decisions; consumers apply them
        as advice only. Returns [] when the observer has not been
        constructed yet.
        """
        if self._fce_observer is None:
            return []
        return self._fce_observer.advisory_hints()

    def fce_morphogenesis_log(self) -> List[Dict[str, Any]]:
        """Read-only morphogenesis log entries. Empty list if observer
        never ran."""
        if self._fce_observer is None:
            return []
        return [
            {
                "episode_id": r.episode_id,
                "cycle": r.cycle,
                "semantic_center": r.semantic_center,
                "zone_seen": r.zone_seen,
                "S_t": r.S_t,
                "AR": r.AR,
                "kappa": r.kappa,
                "alpha": r.alpha,
                "rho": r.rho,
                "lambda_ar": r.lambda_ar,
                "Z_norm": r.Z_norm,
                "delta_X_norm": r.delta_X_norm,
                "omega": r.omega,
                "newly_coagulated": r.newly_coagulated,
                "omega_id": r.omega_id,
                "anchor": r.anchor,
            }
            for r in self._fce_observer.morphogenesis_log
        ]

    # snapshot ------------------------------------------------------------
    def metrics_snapshot(self) -> Dict[str, Any]:
        """Return inspection metrics across all active backends."""
        snap: Dict[str, Any] = {
            "config": self.config.__dict__,
            "tf_engine": {
                "bank_size": (
                    len(self._tf_bank["mis"]) if self._tf_bank is not None else 0
                ),
                "buffered_entries": len(self._tf_bank_entries_buffer),
            },
            "memory_engine_runtime": {},
            "cross_substrate": {
                "registry_size": len(self._label_slot_registry),
                "next_label_id": int(self._next_label_id),
                "has_last_pressure": self._cross_substrate_last_pressure is not None,
                "receptor_initialized": self._cross_substrate_receptor is not None,
            },
            "fce_omega": (
                self._fce_observer.metrics_snapshot()
                if self._fce_observer is not None
                else {"enabled": bool(self.config.fce_omega_enabled), "initialized": False}
            ),
        }
        if self._runtime_adapter is not None:
            snap["memory_engine_runtime"] = self._runtime_adapter.metrics_snapshot()
        return snap
