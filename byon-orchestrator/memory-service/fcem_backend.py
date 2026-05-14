#!/usr/bin/env python3
"""
FCE-M Backend Adapter
=====================

Wraps `unified_fragmergent_memory.UnifiedMemoryStore` for use inside the BYON
memory-service. Adds a morphogenetic memory layer on top of FAISS without
breaking the existing FAISS API.

Translation rules (BYON memory type -> FCE-M symbolic entry):
  - code         -> entity_id = file_path, attr_type = "code"
  - conversation -> entity_id = thread_id (or role), attr_type = "conversation"
  - fact         -> entity_id = source,    attr_type = "fact"

label is a hash-derived small int that buckets similar content under the same
semantic center. This is intentionally coarse — FCE-Omega's morphogenesis is
about REPEATED COHERENCE on a center, not about exact-content matching.

The backend exposes:
  - assimilate_event(...)       : add a memory event (called on store)
  - consolidate()                : drive an FCE-Omega cycle
  - state()                      : full FCE state snapshot
  - advisory()                   : priority recommendations for the planner
  - omega_registry()             : coagulated semantic centers
  - reference_fields()           : projected ReferenceFields
  - morphogenesis_report(...)    : Worker EvidencePack context
  - persist() / load()           : JSON disk persistence

Patent: EP25216372.0 (FHRSS/Omni-Qube-Vault). FCE-M is BSD-3-Clause.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sys
import time
from pathlib import Path
from threading import RLock
from typing import Any, Dict, List, Optional

logger = logging.getLogger("byon-fcem-backend")

# Make vendored FCE-M importable without an editable install
_VENDOR_PATH = Path(__file__).resolve().parent / "vendor" / "fce_m"
if str(_VENDOR_PATH) not in sys.path:
    sys.path.insert(0, str(_VENDOR_PATH))

try:
    from unified_fragmergent_memory import Config, UnifiedMemoryStore  # type: ignore  # noqa: E402
    FCEM_IMPORT_OK = True
except Exception as _e:  # pragma: no cover - import diagnostic only
    logger.exception("FCE-M vendored package failed to import: %s", _e)
    FCEM_IMPORT_OK = False
    Config = None  # type: ignore[assignment]
    UnifiedMemoryStore = None  # type: ignore[assignment]


# Map BYON memory type -> a coarse label space size. Different centers per type.
_LABEL_SPACE = 256


def _label_of(content: str) -> int:
    """Stable hash -> small int, used as FCE-Omega 'label' for symbolic writes."""
    h = hashlib.blake2b(content.encode("utf-8", "replace"), digest_size=4).digest()
    return int.from_bytes(h, "big") % _LABEL_SPACE


class FcemBackend:
    """FCE-M backend adapter for the BYON memory-service.

    Thread-safe (single global Lock). Operations are best-effort: any FCE-M
    error is logged and swallowed so the FAISS path is never blocked.
    """

    def __init__(
        self,
        enabled: bool,
        storage_path: str,
        advisory_mode: str = "priority_only",
        omega_enabled: bool = True,
        reference_fields_enabled: bool = True,
        multiperspectival_enabled: bool = True,
        consolidate_every_n_events: int = 5,
        # v0.6.4c — coherent-repeat dedup threshold
        coherent_repeat_threshold: float = 0.92,
        coherent_history_size: int = 20,
    ) -> None:
        self.enabled = bool(enabled) and FCEM_IMPORT_OK
        self.storage_dir = Path(storage_path) / "fcem"
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.consolidate_every_n_events = max(1, consolidate_every_n_events)
        self._lock = RLock()
        self._events_since_consolidate = 0
        self._store: Optional[Any] = None
        self._init_error: Optional[str] = None

        # v0.6.4c — per-center embedding history for coherent-repeat detection.
        # When a new event arrives whose embedding is >threshold similar to a
        # recent one on the same center, we *suppress the symbolic slot_event*
        # (which is what adds residue Z) but still let the numerical field
        # signature flow through (keeps AR / κ healthy). Goal: drive Z down
        # so B_t = 1/(1+Z) stays high enough for S_t to cross θ_s.
        self.coherent_repeat_threshold = float(coherent_repeat_threshold)
        self.coherent_history_size = max(2, int(coherent_history_size))
        self._embedding_history: Dict[str, List[Any]] = {}  # entity_id -> [np.array, ...]
        self.dedup_stats = {
            "events_seen": 0,
            "coherent_repeats_skipped": 0,
            "first_writes": 0,
        }

        if not self.enabled:
            logger.warning("FCE-M backend disabled (import failure or env flag).")
            return

        try:
            cfg = Config(  # type: ignore[misc]
                fce_omega_enabled=omega_enabled,
                fce_reference_fields_enabled=reference_fields_enabled,
                fce_multiperspectival_enabled=multiperspectival_enabled,
                fce_advisory_mode=advisory_mode,
            )
            self._store = UnifiedMemoryStore(cfg)  # type: ignore[misc]
            self.load()
            logger.info(
                "FCE-M backend ready (omega=%s, refs=%s, multipersp=%s, advisory=%s).",
                omega_enabled,
                reference_fields_enabled,
                multiperspectival_enabled,
                advisory_mode,
            )
        except Exception as exc:  # pragma: no cover - init diagnostic
            self.enabled = False
            self._init_error = repr(exc)
            logger.exception("FCE-M backend init failed; disabling. %s", exc)

    # ---- write path ---------------------------------------------------------

    def assimilate_receipt(
        self,
        order_id: str,
        status: str,
        based_on_evidence: Optional[str] = None,
        summary: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Map a JohnsonReceipt outcome into an FCE-M morphogenetic event.

        Per misiunea.txt Etapa 7:
            success            -> aligned-like event
            partial            -> tensioned
            failed             -> residue_amplifying
            rejected/security  -> contested_expression

        We emit a symbolic write on a center keyed by the evidence (or order)
        identifier with a label that encodes the status. The next consolidate
        cycle will incorporate this into ReferenceField/Omega dynamics.
        """
        if not self.enabled or self._store is None:
            return {"fce_status": "disabled"}

        status_str = (status or "").lower()
        status_to_label = {
            "success": 1,
            "partial": 2,
            "failed": 3,
            "failure": 3,
            "rejected": 4,
            "security_rejected": 4,
        }
        label = status_to_label.get(status_str, 0)
        entity_id = (based_on_evidence or order_id or "exec::unknown")[:120]

        with self._lock:
            try:
                result = self._store.write(
                    {
                        "entity_id": entity_id,
                        "attr_type": "execution_result",
                        "label": label,
                    }
                )

                # v0.6.3: numerical companion for receipts. We craft a deterministic
                # 16-dim field signature from status + duration + token counts so the
                # FCE-Ω observer gets richer signal than a single label.
                numerical_written = False
                try:
                    import numpy as _np
                    sig = _np.zeros(16, dtype=_np.float64)
                    # one-hot status across first 5 dims
                    onehot = {1: 0, 2: 1, 3: 2, 4: 3}
                    if label in onehot:
                        sig[onehot[label]] = 1.0
                    else:
                        sig[4] = 1.0  # unknown
                    s = summary or {}
                    if isinstance(s, dict):
                        toks = s.get("tokens", {}) or {}
                        sig[5] = float((toks.get("in") or 0)) / 1000.0
                        sig[6] = float((toks.get("out") or 0)) / 1000.0
                        sig[7] = float((s.get("latency_ms") or 0)) / 10000.0
                    # Stable hash-derived perturbation across remaining dims so
                    # different orders produce different signatures even with
                    # identical status (helps FCE-Ω accumulate variation).
                    h = hashlib.blake2b(
                        (order_id or "").encode("utf-8", "replace"), digest_size=8
                    ).digest()
                    for i, b in enumerate(h):
                        sig[8 + i] = (b / 255.0) - 0.5
                    self._store.write({
                        "vector": sig,
                        "entity_id": entity_id,
                        "attr_type": "execution_result",
                    })
                    numerical_written = True
                except Exception as exc_num:
                    logger.debug("receipt numerical signature skipped: %s", exc_num)

                self._events_since_consolidate += 1
                consolidated = False
                if self._events_since_consolidate >= self.consolidate_every_n_events:
                    self._store.consolidate()
                    self._events_since_consolidate = 0
                    consolidated = True
                return {
                    "fce_status": "assimilated_receipt",
                    "entity_id": entity_id,
                    "attr_type": "execution_result",
                    "status": status_str,
                    "label": label,
                    "summary": summary or {},
                    "write_result": result,
                    "field_signature_injected": numerical_written,
                    "consolidated": consolidated,
                }
            except Exception as exc:
                logger.warning("FCE-M assimilate_receipt failed: %s", exc)
                return {"fce_status": "error", "error": repr(exc)}

    def assimilate_event(
        self,
        mem_type: str,
        ctx_id: int,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        embedding: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """Translate a BYON store call into an FCE-M symbolic write.

        v0.6.3 — Field-signature injection: when an embedding is supplied, we
        also write a NUMERICAL entry (a `{vector: np.ndarray}`) to UFME. The
        tf_engine bank then carries a real field signature for this semantic
        center, which feeds AR_t in the FCE-Ω observer. Label-only writes keep
        AR_t low; with embedding-backed numerical writes, AR / κ / S_t can grow.

        Returns a small dict describing what the morphogenesis layer saw.
        Never raises; on failure returns {'fce_status': 'skipped', ...}.
        """
        if not self.enabled or self._store is None:
            return {"fce_status": "disabled"}

        meta = metadata or {}
        entity_id = self._entity_for(mem_type, meta)
        attr_type = mem_type
        label = _label_of(content or "")
        numerical_written = False
        coherent_repeat = False
        max_sim_to_recent = 0.0

        with self._lock:
            self.dedup_stats["events_seen"] += 1
            try:
                # v0.6.4c — coherent-repeat dedup against recent embeddings
                if embedding is not None:
                    try:
                        import numpy as _np
                        new_vec = _np.asarray(embedding, dtype=_np.float64).reshape(-1)
                        n = _np.linalg.norm(new_vec)
                        if n > 0:
                            new_vec_norm = new_vec / n
                            history = self._embedding_history.get(entity_id, [])
                            for prev_vec_norm in history:
                                sim = float(_np.dot(new_vec_norm, prev_vec_norm))
                                if sim > max_sim_to_recent:
                                    max_sim_to_recent = sim
                            coherent_repeat = max_sim_to_recent >= self.coherent_repeat_threshold

                            # Update history (LRU)
                            history.append(new_vec_norm)
                            if len(history) > self.coherent_history_size:
                                history.pop(0)
                            self._embedding_history[entity_id] = history
                    except Exception:
                        # Dedup is best-effort; on any failure fall through to normal write
                        coherent_repeat = False
                        max_sim_to_recent = 0.0

                # v0.6.4c (revised): symbolic write ALWAYS happens (it is what
                # builds AR — suppressing it killed AR in earlier experiment).
                # Instead: for coherent repeats, use a STABLE label keyed on
                # (entity_id, attr_type) so all coherent events reinforce the
                # SAME slot instead of dispersing across many label-slots. This
                # keeps AR high while limiting Z growth.
                if coherent_repeat:
                    self.dedup_stats["coherent_repeats_skipped"] += 1
                    label = _label_of(f"__coherent_anchor::{entity_id}::{attr_type}")
                else:
                    self.dedup_stats["first_writes"] += 1
                result = self._store.write(
                    {"entity_id": entity_id, "attr_type": attr_type, "label": label}
                )

                # v0.6.3: numerical companion (always — keeps field signature alive
                # even when symbolic was suppressed).
                if embedding is not None:
                    try:
                        import numpy as _np
                        vec = _np.asarray(embedding, dtype=_np.float64).reshape(-1)
                        if vec.size > 0:
                            num_entry = {
                                "vector": vec,
                                "entity_id": entity_id,
                                "attr_type": attr_type,
                            }
                            self._store.write(num_entry)
                            numerical_written = True
                    except Exception as exc_num:
                        logger.debug("numerical companion write skipped: %s", exc_num)

                # Every event triggers consolidate counter (v0.6.4c revised:
                # symbolic write happens regardless; what changed is the label).
                report = None
                self._events_since_consolidate += 1
                if self._events_since_consolidate >= self.consolidate_every_n_events:
                    report = self._store.consolidate()
                    self._events_since_consolidate = 0

                return {
                    "fce_status": "assimilated",
                    "entity_id": entity_id,
                    "attr_type": attr_type,
                    "label": label,
                    "write_result": result,
                    "field_signature_injected": numerical_written,
                    "coherent_repeat_suppressed": coherent_repeat,
                    "max_sim_to_recent": round(max_sim_to_recent, 4),
                    "consolidated": bool(report),
                }
            except Exception as exc:  # pragma: no cover - runtime diagnostic
                logger.warning("FCE-M assimilate_event failed: %s", exc)
                return {"fce_status": "error", "error": repr(exc)}

    # ---- read path ----------------------------------------------------------

    def runtime_provenance(self) -> Dict[str, Any]:
        """FSOAT 2026-05-14: machine-readable proof of which FCE-M runtime loaded.

        Reports whether the EXTERNAL fragmergent-memory-engine v15.7a runtime
        was loaded (via FCEM_MEMORY_ENGINE_ROOT) or the vendored minimal
        in-memory shim. The FSOAT external-runtime validation gates on
        `shim_used == False` and `runtime_source == "external_v15_7a"`.
        """
        try:
            from unified_fragmergent_memory.sources import (  # type: ignore
                memory_engine_runtime as _mer,
            )
            if hasattr(_mer, "runtime_provenance"):
                prov = dict(_mer.runtime_provenance())
            else:  # older vendored module without the helper
                prov = {
                    "enabled": True,
                    "runtime_source": getattr(_mer, "RUNTIME_SOURCE", "unknown"),
                    "runtime_root": getattr(_mer, "RUNTIME_ROOT", str(getattr(_mer, "SOURCE_ROOT", ""))),
                    "shim_used": bool(getattr(_mer, "SHIM_USED", not getattr(_mer, "AVAILABLE", False))),
                    "adapter_class": getattr(_mer, "ADAPTER_CLASS_NAME", "unknown"),
                    "available": bool(getattr(_mer, "AVAILABLE", False)),
                }
            prov["env_fcem_memory_engine_root"] = os.environ.get("FCEM_MEMORY_ENGINE_ROOT")
            return prov
        except Exception as exc:  # pragma: no cover - runtime diagnostic
            logger.warning("FCE-M runtime_provenance() failed: %s", exc)
            return {
                "enabled": self.enabled,
                "runtime_source": "unknown",
                "shim_used": None,
                "error": repr(exc),
                "env_fcem_memory_engine_root": os.environ.get("FCEM_MEMORY_ENGINE_ROOT"),
            }

    def state(self) -> Dict[str, Any]:
        """Full snapshot — small, safe to ship to TypeScript."""
        if not self.enabled or self._store is None:
            return {
                "enabled": False,
                "init_error": self._init_error,
                "fcem_runtime": self.runtime_provenance(),
            }
        try:
            return {
                "enabled": True,
                "omega_registry": self._store.omega_registry_snapshot(),
                "reference_fields_count": len(self._store.fce_reference_fields() or []),
                "advisory_count": len(self._store.fce_advisory_feedback() or []),
                "events_since_consolidate": self._events_since_consolidate,
                # v0.6.4c — dedup observability
                "dedup": dict(self.dedup_stats),
                "coherent_repeat_threshold": self.coherent_repeat_threshold,
                # FSOAT 2026-05-14 — runtime-source provenance
                "fcem_runtime": self.runtime_provenance(),
            }
        except Exception as exc:
            logger.warning("FCE-M state() failed: %s", exc)
            return {"enabled": True, "error": repr(exc), "fcem_runtime": self.runtime_provenance()}

    def advisory(self) -> List[Dict[str, Any]]:
        if not self.enabled or self._store is None:
            return []
        try:
            return list(self._store.fce_advisory_feedback() or [])
        except Exception as exc:
            logger.warning("FCE-M advisory() failed: %s", exc)
            return []

    def priority_recommendations(self) -> List[Dict[str, Any]]:
        if not self.enabled or self._store is None:
            return []
        try:
            return list(self._store.fce_priority_recommendations() or [])
        except Exception as exc:
            logger.warning("FCE-M priority_recommendations() failed: %s", exc)
            return []

    def omega_registry(self) -> Dict[str, Any]:
        if not self.enabled or self._store is None:
            return {"count": 0, "active": 0, "contested": 0, "inexpressed": 0, "records": []}
        try:
            return dict(self._store.omega_registry_snapshot() or {})
        except Exception as exc:
            logger.warning("FCE-M omega_registry() failed: %s", exc)
            return {"count": 0, "active": 0, "contested": 0, "inexpressed": 0, "records": []}

    def reference_fields(self) -> List[Dict[str, Any]]:
        if not self.enabled or self._store is None:
            return []
        try:
            return list(self._store.fce_reference_fields() or [])
        except Exception as exc:
            logger.warning("FCE-M reference_fields() failed: %s", exc)
            return []

    def reference_field_events(self) -> List[Dict[str, Any]]:
        if not self.enabled or self._store is None:
            return []
        try:
            return list(self._store.fce_reference_field_events() or [])
        except Exception as exc:
            logger.warning("FCE-M reference_field_events() failed: %s", exc)
            return []

    def consolidate(self) -> Dict[str, Any]:
        if not self.enabled or self._store is None:
            return {"fce_status": "disabled"}
        try:
            with self._lock:
                rep = self._store.consolidate()
                self._events_since_consolidate = 0
                self.persist()
                return {"fce_status": "consolidated", "report": rep}
        except Exception as exc:
            logger.warning("FCE-M consolidate() failed: %s", exc)
            return {"fce_status": "error", "error": repr(exc)}

    def morphogenesis_report(self, query: Optional[str] = None) -> Dict[str, Any]:
        """Compact summary intended for Worker EvidencePack `fce_context`.

        Metadata-only — no labels, no entity_ids that could leak content.
        """
        if not self.enabled or self._store is None:
            return {"enabled": False}

        try:
            reg = self._store.omega_registry_snapshot() or {}
            refs = self._store.fce_reference_fields() or []
            adv = self._store.fce_advisory_feedback() or []
            prio = self._store.fce_priority_recommendations() or []
            relation_candidates = []
            try:
                relation_candidates = list(self._store.fce_relation_candidates() or [])
            except Exception:
                relation_candidates = []

            # Surface only counts + sanitized centers (hashed) for safety
            high_residue: List[str] = []
            contested: List[str] = []
            aligned: List[str] = []
            for r in refs:
                state = (r or {}).get("expression_state", "")
                center = (r or {}).get("center_key", "")
                center_hash = hashlib.blake2b(center.encode("utf-8", "replace"), digest_size=4).hexdigest()
                if state == "contested":
                    contested.append(center_hash)
                elif state == "active":
                    aligned.append(center_hash)
                elif state == "inexpressed":
                    high_residue.append(center_hash)

            return {
                "enabled": True,
                "omega_active": int(reg.get("active", 0)),
                "omega_contested": int(reg.get("contested", 0)),
                "omega_inexpressed": int(reg.get("inexpressed", 0)),
                "omega_total": int(reg.get("count", 0)),
                "reference_fields_count": len(refs),
                "aligned_reference_fields": aligned[:8],
                "contested_expressions": contested[:8],
                "high_residue_centers": high_residue[:8],
                "advisory_count": len(adv),
                "priority_recommendations_count": len(prio),
                "relation_candidates_count": len(relation_candidates),
                "query": query,
                "morphogenesis_summary": (
                    f"omega:{reg.get('active', 0)}/{reg.get('count', 0)} "
                    f"refs:{len(refs)} adv:{len(adv)} prio:{len(prio)}"
                ),
            }
        except Exception as exc:
            logger.warning("FCE-M morphogenesis_report() failed: %s", exc)
            return {"enabled": True, "error": repr(exc)}

    # ---- persistence --------------------------------------------------------

    def persist(self) -> None:
        if not self.enabled or self._store is None:
            return
        try:
            with self._lock:
                snapshot = {
                    "version": "0.6.0",
                    "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "omega_registry": self._store.omega_registry_snapshot(),
                    "reference_fields": self._store.fce_reference_fields(),
                    "reference_field_events": self._store.fce_reference_field_events(),
                    "advisory_feedback": self._store.fce_advisory_feedback(),
                    "morphogenesis_log": self._store.fce_morphogenesis_log(),
                }
                target = self.storage_dir / "fcem_snapshot.json"
                tmp = target.with_suffix(".json.tmp")
                tmp.write_text(json.dumps(snapshot, default=str, indent=2), encoding="utf-8")
                os.replace(tmp, target)
        except Exception as exc:  # pragma: no cover
            logger.warning("FCE-M persist() failed: %s", exc)

    def load(self) -> None:
        """Best-effort load — snapshot is informational; in-memory state is
        rebuilt from live writes/consolidations. We just verify presence.
        """
        target = self.storage_dir / "fcem_snapshot.json"
        if target.exists():
            try:
                _ = json.loads(target.read_text(encoding="utf-8"))
                logger.info("FCE-M snapshot present at %s.", target)
            except Exception as exc:
                logger.warning("FCE-M snapshot unreadable: %s", exc)

    # ---- helpers ------------------------------------------------------------

    @staticmethod
    def _entity_for(mem_type: str, metadata: Dict[str, Any]) -> str:
        """Pick a stable semantic anchor per memory type.

        v0.6.2: facts now prefer thread_id (when not system-scope) over `source`
        so per-thread morphogenesis stays cleanly scoped. System-scope facts
        (architecture_rule, security_constraint, identity) carry thread_id=None
        and fall back to a shared "byon::system" anchor so they coagulate on a
        single global center.
        """
        if mem_type == "code":
            return str(metadata.get("file_path") or "code::unknown")
        if mem_type == "conversation":
            return str(
                metadata.get("thread_id")
                or metadata.get("channel")
                or metadata.get("role")
                or "conversation::default"
            )
        if mem_type == "fact":
            tid = metadata.get("thread_id")
            if tid:
                return str(tid)
            # System-scope fact (no thread): use a shared system center
            tags = metadata.get("tags") or []
            if isinstance(tags, list) and "__system__" in tags:
                return "byon::system"
            return str(metadata.get("source") or "fact::unknown")
        return f"{mem_type}::default"
