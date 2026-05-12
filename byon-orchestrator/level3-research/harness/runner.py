"""LongNaturalTranscriptHarness — replay loop + telemetry aggregation.

Integrates the previous five research commits into a single end-to-end
pipeline that consumes transcript rows and emits aggregated telemetry:

    transcript row
      -> deterministic projection (commit 3)
      -> CenterEventBuffer.append (commit 2)
      -> ZMetabolismRuntime.apply_event (commit 4)
      -> DeterministicSummaryPolicyV1.build_summary (commit 5)
         when policy.should_summarize(buffer) returns True
      -> ZMetabolismRuntime.apply_summary (commit 4)
      -> CenterEventBuffer.archive_event for every source event
         (option B: harness compresses the buffer's active set after
         a summary so the next summary can fire on fresh content)
      -> PotentialOmegaDetector.observe_cycle (commit 6)
         with surrogate metrics from telemetry.py
      -> per-cycle telemetry record + signal collection

The harness does NOT:

  - call check_coagulation
  - register OmegaRecord
  - create ReferenceField
  - set is_omega_anchor
  - import from byon-orchestrator/src/, scripts/, or memory-service/
  - import FCE-M production
  - claim Level 3
  - touch `main`

Every telemetry record carries `metric_source =
"research_surrogate_v1_not_fce_production"` so an outside reader
cannot mistake the surrogate metrics for production coagulation
evidence.
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple, Union

from potential_omega import PotentialOmegaDetector, PotentialOmegaSignal
from projection import project_turn_to_events
from schemas import (
    CenterEventBuffer,
    MemoryEvent,
    Perspective,
    SummaryEvent,
)
from summary_policy import (
    DeterministicSummaryPolicyV1,
    NoSummaryCandidate,
    REASON_CORRECTION,
    REASON_RECEIPT,
    REASON_STABLE_PATTERN,
)
from z_metabolism import ZMetabolismRuntime

from .telemetry import (
    METRIC_SOURCE,
    compute_ar_t,
    compute_kappa_t,
    compute_s_t,
    signal_to_dict,
    summary_event_to_dict,
)


SCHEMA_VERSION = "level3-research.harness.v1"


# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------


class LongNaturalTranscriptHarness:
    """Single-threaded research harness over a transcript JSONL file.

    Parameters
    ----------
    seed : int
        The seed passed to `project_turn_to_events` and used as
        `summary_id_seed` for the summary policy.
    transcript_id : str
        The transcript identifier injected into each row's provenance.
    summary_policy : DeterministicSummaryPolicyV1, optional
        Defaults to a fresh `DeterministicSummaryPolicyV1()`.
    omega_detector : PotentialOmegaDetector, optional
        Defaults to `PotentialOmegaDetector(window_size=12)`.
    """

    def __init__(
        self,
        *,
        seed: int,
        transcript_id: str,
        summary_policy: Optional[DeterministicSummaryPolicyV1] = None,
        omega_detector: Optional[PotentialOmegaDetector] = None,
    ) -> None:
        if not isinstance(seed, int):
            raise TypeError(
                f"seed must be int, got {type(seed).__name__}"
            )
        if not isinstance(transcript_id, str) or not transcript_id:
            raise ValueError(
                "transcript_id must be a non-empty string"
            )

        self.seed: int = seed
        self.transcript_id: str = transcript_id
        self.summary_policy: DeterministicSummaryPolicyV1 = (
            summary_policy if summary_policy is not None
            else DeterministicSummaryPolicyV1()
        )
        self.omega_detector: PotentialOmegaDetector = (
            omega_detector if omega_detector is not None
            else PotentialOmegaDetector(window_size=12)
        )

        # Internal state.
        self._runtime: ZMetabolismRuntime = ZMetabolismRuntime()
        self._buffers: Dict[Tuple[str, str], CenterEventBuffer] = {}
        self._summary_events: List[SummaryEvent] = []
        self._potential_omega_signals: List[PotentialOmegaSignal] = []
        self._b_t_observations: List[float] = []
        self._cycle_records: List[Dict[str, Any]] = []
        self._audit_flags: List[str] = []
        self._n_rows: int = 0
        self._n_events: int = 0

    # ------------------------------------------------------------------
    # Public entry points
    # ------------------------------------------------------------------

    def run_jsonl(self, path: Union[str, Path]) -> Dict[str, Any]:
        """Parse a JSONL transcript and run every non-empty row.

        Returns the same aggregate as `run_rows`.
        """
        rows: List[Dict[str, Any]] = []
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                rows.append(json.loads(line))
        return self.run_rows(rows)

    def run_rows(self, rows: List[Mapping[str, Any]]) -> Dict[str, Any]:
        """Run a list of transcript rows through the replay loop."""
        if not isinstance(rows, list):
            raise TypeError("run_rows: rows must be a list of dicts")
        for row in rows:
            if not isinstance(row, Mapping):
                raise TypeError(
                    f"run_rows: each row must be a Mapping, got {type(row).__name__}"
                )
            self._process_row(row)
        return self.telemetry()

    def telemetry(self) -> Dict[str, Any]:
        """Build the aggregated telemetry dict from current state.

        Idempotent — calling twice returns equivalent (deep-equal) data.
        """
        invariant_ok = self._verify_invariants()

        z_total_final = 0.0
        z_active_final = 0.0
        z_resolved_final = 0.0
        z_archived_final = 0.0
        per_center: Dict[str, Dict[str, Any]] = {}
        per_perspective: Dict[str, Dict[str, Any]] = {}

        for (cid, p), buf in sorted(self._buffers.items()):
            counters = self._runtime.counters_for(cid, p)
            z_total_final += counters.z_total
            z_active_final += counters.z_active
            z_resolved_final += counters.z_resolved
            z_archived_final += counters.z_archived

            summaries_here = sum(
                1
                for s in self._summary_events
                if s.summary.center_id == cid and s.summary.perspective == p
            )
            signals_here = sum(
                1
                for s in self._potential_omega_signals
                if s.center_id == cid and s.perspective == p
            )

            key = f"{cid}::{p}"
            per_center[key] = {
                "center_id": cid,
                "perspective": p,
                "events_total": buf.total_count(),
                "events_active": buf.active_count(),
                "events_archived": buf.archived_count(),
                "summaries": summaries_here,
                "potential_omega_signals": signals_here,
                "z_total": counters.z_total,
                "z_active": counters.z_active,
                "z_resolved": counters.z_resolved,
                "z_archived": counters.z_archived,
                "b_t_final": self._runtime.b_t(cid, p),
            }

            agg = per_perspective.setdefault(p, {
                "events": 0,
                "summaries": 0,
                "potential_omega_signals": 0,
                "centers": 0,
                "z_total": 0.0,
                "z_active": 0.0,
                "z_resolved": 0.0,
                "z_archived": 0.0,
            })
            agg["events"] += buf.total_count()
            agg["summaries"] += summaries_here
            agg["potential_omega_signals"] += signals_here
            agg["centers"] += 1
            agg["z_total"] += counters.z_total
            agg["z_active"] += counters.z_active
            agg["z_resolved"] += counters.z_resolved
            agg["z_archived"] += counters.z_archived

        b_t_min = min(self._b_t_observations) if self._b_t_observations else None
        b_t_max = max(self._b_t_observations) if self._b_t_observations else None
        b_t_final = self._b_t_observations[-1] if self._b_t_observations else None

        return {
            "schema_version": SCHEMA_VERSION,
            "metric_source": METRIC_SOURCE,
            "transcript_id": self.transcript_id,
            "seed": self.seed,
            "n_rows": self._n_rows,
            "n_events": self._n_events,
            "n_centers": len(self._buffers),
            "n_summaries": len(self._summary_events),
            "n_potential_omega_signals": len(self._potential_omega_signals),
            "per_center_summary": per_center,
            "per_perspective_summary": per_perspective,
            "z_total_final": z_total_final,
            "z_active_final": z_active_final,
            "z_resolved_final": z_resolved_final,
            "z_archived_final": z_archived_final,
            "b_t_min": b_t_min,
            "b_t_max": b_t_max,
            "b_t_final": b_t_final,
            "potential_omega_signals": [
                signal_to_dict(s) for s in self._potential_omega_signals
            ],
            "summary_events": [
                summary_event_to_dict(s) for s in self._summary_events
            ],
            "cycle_records": list(self._cycle_records),
            "audit_flags": list(self._audit_flags),
            "invariant_ok": invariant_ok,
        }

    # ------------------------------------------------------------------
    # Read-side helpers
    # ------------------------------------------------------------------

    @property
    def summary_events(self) -> Tuple[SummaryEvent, ...]:
        return tuple(self._summary_events)

    @property
    def potential_omega_signals(self) -> Tuple[PotentialOmegaSignal, ...]:
        return tuple(self._potential_omega_signals)

    @property
    def n_rows(self) -> int:
        return self._n_rows

    @property
    def n_events(self) -> int:
        return self._n_events

    def buffer_for(self, center_id: str, perspective: Union[str, Perspective]) -> CenterEventBuffer:
        """Return the CenterEventBuffer for (center_id, perspective).

        Raises KeyError if the bucket has not been touched yet.
        """
        if isinstance(perspective, Perspective):
            p = perspective.value
        else:
            p = perspective
        return self._buffers[(center_id, p)]

    # ------------------------------------------------------------------
    # Internal: row processing
    # ------------------------------------------------------------------

    def _process_row(self, row: Mapping[str, Any]) -> None:
        self._n_rows += 1

        enriched = dict(row)
        enriched.setdefault("transcript_id", self.transcript_id)
        enriched.setdefault("seed", self.seed)

        events = project_turn_to_events(enriched, seed=self.seed)
        self._n_events += len(events)

        touched_buckets: List[Tuple[str, str]] = []
        for event in events:
            key = (event.center_id, event.perspective)
            buf = self._get_or_create_buffer(event.center_id, event.perspective)
            buf.append(event)
            try:
                self._runtime.apply_event(event)
            except ValueError as e:
                # Duplicate event_id (shouldn't happen — projection
                # produces unique ids per turn). Record for audit.
                self._audit_flags.append(f"runtime_apply_event_rejected: {e}")
                continue
            if key not in touched_buckets:
                touched_buckets.append(key)

        # Try summarisation on each touched bucket (in canonical order).
        turn_index = int(row.get("turn_index", -1))
        for (cid, p) in touched_buckets:
            buf = self._buffers[(cid, p)]
            if not self.summary_policy.should_summarize(buf):
                continue
            try:
                se = self.summary_policy.build_summary(
                    buf,
                    summary_id_seed=self.seed,
                    episode_index=turn_index,
                )
            except NoSummaryCandidate as e:
                self._audit_flags.append(f"summary_no_candidate: {e}")
                continue

            try:
                self._runtime.apply_summary(se)
            except ValueError as e:
                # Duplicate summary_id — happens only if a previous run
                # already applied this exact summary. Skip and record.
                self._audit_flags.append(f"runtime_apply_summary_rejected: {e}")
                continue

            # Option B (per design discussion): archive ALL events in the
            # summary's source_event_ids so the buffer's active set
            # compresses and subsequent summaries fire on fresh content.
            # The runtime tracks the fine-grained resolved/archived split;
            # the buffer's archive bit is the harness's compression
            # signal.
            for src_id in se.summary.source_event_ids:
                reason = self._tombstone_reason_for(se, src_id)
                try:
                    buf.archive_event(src_id, reason=reason)
                except KeyError:
                    # Already gone from buffer (shouldn't happen — buffer
                    # never deletes — but be defensive).
                    self._audit_flags.append(
                        f"buffer_archive_missing_id: {src_id!r}"
                    )

            self._summary_events.append(se)

        # Emit one cycle per touched bucket AFTER summary application,
        # so the cycle telemetry reflects the post-summary state.
        for (cid, p) in touched_buckets:
            self._emit_cycle(cid, p, turn_index=turn_index)

    def _emit_cycle(self, center_id: str, perspective: str, *, turn_index: int) -> None:
        buf = self._buffers[(center_id, perspective)]
        counters = self._runtime.counters_for(center_id, perspective)
        b_t = self._runtime.b_t(center_id, perspective)
        active = buf.active_events()
        ar_t = compute_ar_t(active)
        kappa_t = compute_kappa_t(active)
        s_t = compute_s_t(ar_t, kappa_t, b_t)

        # Deterministic cycle id including seed (so two seeds produce
        # different cycle id streams; matches operator test 16).
        cycle_id = (
            f"cyc::{center_id}::{perspective}"
            f"::turn{turn_index:08d}::seed{self.seed}"
        )

        try:
            signals = self.omega_detector.observe_cycle(
                center_id=center_id,
                perspective=perspective,
                cycle_id=cycle_id,
                s_t=s_t,
                ar_t=ar_t,
                kappa_t=kappa_t,
                z_active=counters.z_active,
                b_t=b_t,
            )
        except ValueError as e:
            # Duplicate cycle_id (shouldn't happen since turn_index is
            # unique per (cid, p) within a transcript run). Audit.
            self._audit_flags.append(f"detector_observe_rejected: {e}")
            signals = []

        for sig in signals:
            self._potential_omega_signals.append(sig)
            # Belt-and-braces: an advisory-only signal that somehow
            # arrives with advisory_only=False is a contract break.
            if not sig.advisory_only:
                self._audit_flags.append(
                    f"signal_not_advisory_only: {sig.signal_id!r}"
                )

        self._b_t_observations.append(b_t)
        self._cycle_records.append({
            "cycle_id": cycle_id,
            "center_id": center_id,
            "perspective": perspective,
            "turn_index": turn_index,
            "z_total": counters.z_total,
            "z_active": counters.z_active,
            "z_resolved": counters.z_resolved,
            "z_archived": counters.z_archived,
            "b_t": b_t,
            "s_t": s_t,
            "ar_t": ar_t,
            "kappa_t": kappa_t,
            "active_events_count": buf.active_count(),
            "archived_events_count": buf.archived_count(),
            "summaries_count_so_far": sum(
                1
                for s in self._summary_events
                if s.summary.center_id == center_id
                and s.summary.perspective == perspective
            ),
        })

    # ------------------------------------------------------------------
    # Internal: helpers
    # ------------------------------------------------------------------

    def _get_or_create_buffer(self, center_id: str, perspective: str) -> CenterEventBuffer:
        key = (center_id, perspective)
        buf = self._buffers.get(key)
        if buf is None:
            buf = CenterEventBuffer(
                center_id=center_id,
                perspective=perspective,
                # The harness runs unbounded transcripts; pick a generous
                # max so eviction never silently archives during a 500-
                # turn run. Operator can override via subclass if needed.
                max_events=2048,
            )
            self._buffers[key] = buf
        return buf

    def _tombstone_reason_for(self, se: SummaryEvent, event_id: str) -> str:
        """Find the tombstone reason for `event_id` on this summary.

        Falls back to a pattern-derived reason if the summary did not
        emit an explicit tombstone (e.g. correction_chain v1 emits 0
        tombstones because it archives no events).
        """
        for tomb in se.tombstone_pointers:
            if tomb.archived_event_id == event_id and tomb.reason:
                return tomb.reason
        text = (se.summary.summary_text or "").lower()
        if "correction chain" in text:
            return REASON_CORRECTION
        if "receipt chain" in text:
            return REASON_RECEIPT
        return REASON_STABLE_PATTERN

    def _verify_invariants(self) -> bool:
        """Verify the harness state's invariants. Returns True iff all hold.

        Each violation is recorded as an `audit_flag`.

        Invariants:
          - Every (center, perspective) bucket's ZCounters satisfies
            conservation (`z_active + z_resolved + z_archived == z_total`).
          - Every potential-omega signal carries `advisory_only=True`.
          - Every summary's archived_event_ids is a subset of its
            source_event_ids (already enforced by RollingCenterSummary,
            checked here as a final read).
        """
        ok = True
        for (cid, p) in self._buffers.keys():
            counters = self._runtime.counters_for(cid, p)
            if not counters.conservation_holds():
                self._audit_flags.append(
                    f"conservation_violated: {cid!r}/{p!r} "
                    f"(z_total={counters.z_total}, "
                    f"sum={counters.z_active + counters.z_resolved + counters.z_archived})"
                )
                ok = False

        for sig in self._potential_omega_signals:
            if not sig.advisory_only:
                self._audit_flags.append(
                    f"signal_not_advisory_only: {sig.signal_id!r}"
                )
                ok = False

        for se in self._summary_events:
            src = set(se.summary.source_event_ids)
            arch = set(se.summary.archived_event_ids)
            if not arch.issubset(src | set(se.summary.resolved_event_ids)):
                self._audit_flags.append(
                    f"summary_archived_not_subset: {se.summary.summary_id!r}"
                )
                ok = False

        return ok
