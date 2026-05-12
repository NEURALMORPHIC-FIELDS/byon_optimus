"""PotentialOmegaCenter detector (advisory only).

Detects per-(center_id, perspective) buckets whose recent K=12-cycle
trajectory looks like it MIGHT coagulate. The detector never coagulates
anything; it never writes to a registry; it never calls
`check_coagulation`. Its only output is a `PotentialOmegaSignal` row
that downstream telemetry can consume.

Detection criteria (operator-locked v1):

  ALL of the following must hold over the most recent K=12 cycles for
  one (center_id, perspective) bucket:

    1. S_t direction: either
         s_trend > 0                          (rising)
       OR
         mean(S_t over last K) >= 0.20         (sustained-high)
    2. AR stability:   std(AR_t over last K)   <= 0.12
    3. kappa stability: std(kappa_t over last K) <= 0.12
    4. Z_active direction: z_active_trend < 0  (falling)
    5. B_t direction:      b_t_trend > 0        (rising)
    6. Every input value is finite (no NaN, no Inf)

`trend` is computed as `mean(second half) - mean(first half)` over the
window — a deterministic, robust slope estimate that does not require
numpy and is reproducible across machines.

`confidence` ∈ [0, 1] is a deterministic linear combination of five
normalised components (S_t trend, B_t trend, AR stability, kappa
stability, Z_active decline). The weights are equal (1/5 each).

Determinism contract:

  - same sequence of `observe_cycle` calls (same cycle_id, s_t, ar_t,
    kappa_t, z_active, b_t in the same order) -> identical signals
    (same `signal_id`, same content)
  - signal_id is sha256(policy_version + center_id + perspective +
    source_cycle_ids) formatted as a UUID 8-4-4-4-12 hex string
  - no seed; the detector is purely a function of its inputs

Production isolation:

  - imports ONLY from `schemas` (the research package's own schemas)
    and the Python standard library
  - does NOT import from `byon-orchestrator/src/`, `scripts/`, or
    `memory-service/`
  - does NOT import from FCE-M vendor, `check_coagulation`,
    `OmegaRegistry`, or any production module
  - does NOT use LLMs, embeddings, random, or wall-clock
"""

from __future__ import annotations

import copy
import hashlib
import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Set, Tuple, Union

from schemas import Perspective, PERSPECTIVES_V1


# ---------------------------------------------------------------------------
# Constants (operator-locked)
# ---------------------------------------------------------------------------

POLICY_VERSION = "potential_omega_detector.v1"
SCHEMA_VERSION = "level3-research.potential_omega.v1"

# Window size (operator decision Q5, aligned with tau_coag = 12).
DEFAULT_WINDOW_SIZE = 12

# Thresholds (operator-locked v1).
AR_STD_MAX = 0.12
KAPPA_STD_MAX = 0.12
SUSTAINED_S_T_FLOOR = 0.20

# Normalisation scales for the confidence components.
S_TREND_NORM_SCALE = 0.10
B_T_TREND_NORM_SCALE = 0.10
Z_ACTIVE_TREND_NORM_SCALE = 0.05


# ---------------------------------------------------------------------------
# Public signal dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PotentialOmegaSignal:
    """An advisory-only telemetry row.

    Emitted by `PotentialOmegaDetector.observe_cycle` when a bucket's
    K=12-cycle window meets all five conditions. Carries `advisory_only=
    True` as an explicit policy flag — downstream consumers (the harness)
    MUST NOT promote this signal into Omega creation.
    """

    signal_id: str
    center_id: str
    perspective: str             # Perspective.value (string for serialisation)
    window_size: int

    s_trend: float
    ar_stability: float          # std of AR_t over window (LOWER = more stable)
    kappa_stability: float       # std of kappa_t over window (LOWER = more stable)
    z_active_trend: float        # negative = falling (desirable)
    b_t_trend: float             # positive = rising (desirable)

    confidence: float            # in [0, 1]; deterministic linear combination
    reason: str                  # human-readable audit string

    source_cycle_ids: Tuple[str, ...] = field(default_factory=tuple)
    advisory_only: bool = True


# ---------------------------------------------------------------------------
# Internal cycle record (one per observed cycle, per bucket)
# ---------------------------------------------------------------------------


@dataclass
class _CycleRecord:
    cycle_id: str
    s_t: float
    ar_t: float
    kappa_t: float
    z_active: float
    b_t: float


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _normalize_perspective(perspective: Union[str, Perspective]) -> str:
    if isinstance(perspective, Perspective):
        return perspective.value
    if not isinstance(perspective, str):
        raise TypeError(
            "perspective must be str or Perspective, got "
            f"{type(perspective).__name__}"
        )
    admitted = {p.value for p in PERSPECTIVES_V1}
    if perspective not in admitted:
        raise ValueError(
            f"perspective {perspective!r} not in v1 admitted set "
            f"{sorted(admitted)}"
        )
    return perspective


def _bucket_key(center_id: str, perspective: str) -> str:
    return f"{center_id}::{perspective}"


def _finite_or_raise(name: str, v: float) -> float:
    """Validate v is a finite float. Reject NaN, Inf, non-numeric."""
    if not isinstance(v, (int, float)):
        raise TypeError(f"{name!r} must be int or float, got {type(v).__name__}")
    f = float(v)
    if math.isnan(f) or math.isinf(f):
        raise ValueError(f"{name!r} must be finite, got {f!r}")
    return f


def _slope(values: List[float]) -> float:
    """Deterministic trend estimate: mean(second half) - mean(first half).

    For n=12 the halves are 6+6. For odd n the middle element belongs
    to neither half (so n=11 -> 5+5, the median is dropped).

    Returns 0.0 for n < 2.
    """
    n = len(values)
    if n < 2:
        return 0.0
    half = n // 2
    first_half = values[:half]
    second_half = values[-half:]
    m1 = sum(first_half) / half
    m2 = sum(second_half) / half
    return m2 - m1


def _std(values: List[float]) -> float:
    """Population std (divide by n). Returns 0.0 for n < 2."""
    n = len(values)
    if n < 2:
        return 0.0
    m = sum(values) / n
    var = sum((v - m) ** 2 for v in values) / n
    return var ** 0.5


def _clamp01(v: float) -> float:
    if v < 0.0:
        return 0.0
    if v > 1.0:
        return 1.0
    return v


def _compute_confidence(
    *,
    s_trend: float,
    b_t_trend: float,
    ar_std: float,
    kappa_std: float,
    z_active_trend: float,
) -> float:
    """Deterministic confidence in [0, 1].

    Five components, equal weight (1/5 each):

      s_trend_norm           = clamp01(s_trend / 0.10)         (only if rising)
      b_t_trend_norm         = clamp01(b_t_trend / 0.10)       (only if rising)
      ar_stability_norm      = clamp01(1 - ar_std / 0.12)
      kappa_stability_norm   = clamp01(1 - kappa_std / 0.12)
      z_active_decline_norm  = clamp01((-z_active_trend) / 0.05) (only if falling)
    """
    s_norm = _clamp01(s_trend / S_TREND_NORM_SCALE) if s_trend > 0 else 0.0
    b_norm = _clamp01(b_t_trend / B_T_TREND_NORM_SCALE) if b_t_trend > 0 else 0.0
    ar_norm = _clamp01(1.0 - ar_std / AR_STD_MAX)
    kappa_norm = _clamp01(1.0 - kappa_std / KAPPA_STD_MAX)
    z_norm = (
        _clamp01((-z_active_trend) / Z_ACTIVE_TREND_NORM_SCALE)
        if z_active_trend < 0
        else 0.0
    )
    return _clamp01((s_norm + b_norm + ar_norm + kappa_norm + z_norm) / 5.0)


def _deterministic_signal_id(
    *,
    center_id: str,
    perspective: str,
    source_cycle_ids: Tuple[str, ...],
) -> str:
    """Hash inputs to a UUID-shaped string. Same inputs -> same id.

    Per operator decision: NO seed enters the signal id. The detector is
    purely deterministic on its inputs; same cycle sequence -> same id.
    """
    raw = "::".join(
        [
            POLICY_VERSION,
            center_id,
            perspective,
            "|".join(source_cycle_ids),
        ]
    )
    h = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


# ---------------------------------------------------------------------------
# Detector
# ---------------------------------------------------------------------------


class PotentialOmegaDetector:
    """Per-bucket rolling-window detector.

    Not thread-safe (single-threaded research harness).
    """

    def __init__(self, window_size: int = DEFAULT_WINDOW_SIZE) -> None:
        if not isinstance(window_size, int):
            raise TypeError(
                "window_size must be int, got "
                f"{type(window_size).__name__}"
            )
        if window_size < 2:
            raise ValueError(
                f"window_size must be >= 2, got {window_size}"
            )
        self._window_size: int = window_size
        # Per-bucket rolling windows of last `window_size` cycles.
        self._windows: Dict[str, List[_CycleRecord]] = {}
        # Per-bucket set of cycle_ids currently in the window (fast dedup
        # check on observe_cycle).
        self._cycle_ids_in_window: Dict[str, Set[str]] = {}
        # Signal ids ever emitted by this detector (in chronological
        # order; deduplicated by the set below).
        self._emitted_signal_ids: List[str] = []
        self._emitted_signal_id_set: Set[str] = set()

    # ------------------------------------------------------------------
    # Read-side
    # ------------------------------------------------------------------

    @property
    def window_size(self) -> int:
        return self._window_size

    @property
    def emitted_signal_ids(self) -> Tuple[str, ...]:
        return tuple(self._emitted_signal_ids)

    def buckets(self) -> Tuple[str, ...]:
        """Return the bucket keys currently tracked, sorted."""
        return tuple(sorted(self._windows.keys()))

    def cycles_in_window(self, center_id: str, perspective: Union[str, Perspective]) -> int:
        p = _normalize_perspective(perspective)
        return len(self._windows.get(_bucket_key(center_id, p), []))

    # ------------------------------------------------------------------
    # Write-side
    # ------------------------------------------------------------------

    def observe_cycle(
        self,
        *,
        center_id: str,
        perspective: Union[str, Perspective],
        cycle_id: str,
        s_t: float,
        ar_t: float,
        kappa_t: float,
        z_active: float,
        b_t: float,
    ) -> List[PotentialOmegaSignal]:
        """Observe one cycle measurement; return any emitted signals.

        Returns an empty list when the bucket has fewer than
        `window_size` cycles or when the window does not meet the
        emission conditions.

        Validates:
          - center_id non-empty string
          - perspective is an admitted v1 perspective
          - cycle_id non-empty string and not already in the bucket's
            current window
          - every numeric field is finite (no NaN / Inf)
        """
        if not isinstance(center_id, str) or not center_id:
            raise ValueError("observe_cycle: center_id must be a non-empty string")
        p = _normalize_perspective(perspective)
        if not isinstance(cycle_id, str) or not cycle_id:
            raise ValueError("observe_cycle: cycle_id must be a non-empty string")

        s_t = _finite_or_raise("s_t", s_t)
        ar_t = _finite_or_raise("ar_t", ar_t)
        kappa_t = _finite_or_raise("kappa_t", kappa_t)
        z_active = _finite_or_raise("z_active", z_active)
        b_t = _finite_or_raise("b_t", b_t)

        k = _bucket_key(center_id, p)
        window = self._windows.setdefault(k, [])
        ids = self._cycle_ids_in_window.setdefault(k, set())

        if cycle_id in ids:
            raise ValueError(
                f"observe_cycle: duplicate cycle_id {cycle_id!r} in current "
                f"window for bucket {k!r}"
            )

        record = _CycleRecord(
            cycle_id=cycle_id,
            s_t=s_t,
            ar_t=ar_t,
            kappa_t=kappa_t,
            z_active=z_active,
            b_t=b_t,
        )
        window.append(record)
        ids.add(cycle_id)

        # Evict oldest if over capacity.
        if len(window) > self._window_size:
            evicted = window.pop(0)
            ids.discard(evicted.cycle_id)

        # Evaluate emission.
        if len(window) < self._window_size:
            return []

        signal = self._evaluate(center_id=center_id, perspective=p, window=window)
        if signal is None:
            return []
        # Deduplicate: same source_cycle_ids -> same signal_id. If this
        # exact signal has been emitted already (would only happen on
        # a snapshot restore that re-feeds same cycles), skip the
        # re-emission.
        if signal.signal_id in self._emitted_signal_id_set:
            return []
        self._emitted_signal_ids.append(signal.signal_id)
        self._emitted_signal_id_set.add(signal.signal_id)
        return [signal]

    # ------------------------------------------------------------------
    # Internal: evaluate window
    # ------------------------------------------------------------------

    def _evaluate(
        self,
        *,
        center_id: str,
        perspective: str,
        window: List[_CycleRecord],
    ) -> Optional[PotentialOmegaSignal]:
        n = len(window)
        s_series = [c.s_t for c in window]
        ar_series = [c.ar_t for c in window]
        kappa_series = [c.kappa_t for c in window]
        z_series = [c.z_active for c in window]
        b_series = [c.b_t for c in window]

        s_trend = _slope(s_series)
        s_mean = sum(s_series) / n
        ar_std = _std(ar_series)
        kappa_std = _std(kappa_series)
        z_trend = _slope(z_series)
        b_trend = _slope(b_series)

        # Conditions (all must hold).
        cond_s_rising = s_trend > 0
        cond_s_sustained = s_mean >= SUSTAINED_S_T_FLOOR
        cond_s = cond_s_rising or cond_s_sustained
        cond_ar = ar_std <= AR_STD_MAX
        cond_kappa = kappa_std <= KAPPA_STD_MAX
        cond_z = z_trend < 0
        cond_b = b_trend > 0

        if not (cond_s and cond_ar and cond_kappa and cond_z and cond_b):
            return None

        confidence = _compute_confidence(
            s_trend=s_trend,
            b_t_trend=b_trend,
            ar_std=ar_std,
            kappa_std=kappa_std,
            z_active_trend=z_trend,
        )

        source_cycle_ids: Tuple[str, ...] = tuple(c.cycle_id for c in window)
        signal_id = _deterministic_signal_id(
            center_id=center_id,
            perspective=perspective,
            source_cycle_ids=source_cycle_ids,
        )

        reason_parts = [
            f"s_trend={s_trend:+.4f}",
            f"s_mean={s_mean:.4f}",
            f"ar_std={ar_std:.4f}",
            f"kappa_std={kappa_std:.4f}",
            f"z_trend={z_trend:+.4f}",
            f"b_trend={b_trend:+.4f}",
            f"sustained={cond_s_sustained}",
        ]
        # Tag if the window is approaching the theta_s coagulation
        # threshold. The detector does NOT enforce or test theta_s; this
        # is informational only.
        if s_mean >= 0.28 - 0.05:
            reason_parts.append("s_near_theta_s_0.28")
        reason = "; ".join(reason_parts)

        return PotentialOmegaSignal(
            signal_id=signal_id,
            center_id=center_id,
            perspective=perspective,
            window_size=n,
            s_trend=s_trend,
            ar_stability=ar_std,
            kappa_stability=kappa_std,
            z_active_trend=z_trend,
            b_t_trend=b_trend,
            confidence=confidence,
            reason=reason,
            source_cycle_ids=source_cycle_ids,
            advisory_only=True,
        )

    # ------------------------------------------------------------------
    # Snapshot / restore
    # ------------------------------------------------------------------

    def snapshot(self) -> Dict[str, Any]:
        """Serialise to a JSON-friendly dict.

        Includes: schema_version, window_size, per-bucket rolling
        windows (as parallel lists), emitted signal ids (in
        chronological order), and the operator-locked threshold
        constants (so a snapshot can be audited for drift).
        """
        windows_dict: Dict[str, Dict[str, Any]] = {}
        for k, win in self._windows.items():
            windows_dict[k] = {
                "cycle_ids": [c.cycle_id for c in win],
                "s_t": [c.s_t for c in win],
                "ar_t": [c.ar_t for c in win],
                "kappa_t": [c.kappa_t for c in win],
                "z_active": [c.z_active for c in win],
                "b_t": [c.b_t for c in win],
            }
        return {
            "schema_version": SCHEMA_VERSION,
            "policy_version": POLICY_VERSION,
            "window_size": self._window_size,
            "windows": windows_dict,
            "emitted_signal_ids": list(self._emitted_signal_ids),
            "thresholds": {
                "ar_std_max": AR_STD_MAX,
                "kappa_std_max": KAPPA_STD_MAX,
                "sustained_s_t_floor": SUSTAINED_S_T_FLOOR,
                "s_trend_norm_scale": S_TREND_NORM_SCALE,
                "b_t_trend_norm_scale": B_T_TREND_NORM_SCALE,
                "z_active_trend_norm_scale": Z_ACTIVE_TREND_NORM_SCALE,
            },
        }

    @classmethod
    def from_snapshot(cls, payload: Mapping[str, Any]) -> "PotentialOmegaDetector":
        """Reconstruct a PotentialOmegaDetector from a snapshot dict.

        Rejects:
          - missing or unknown schema_version
          - window_size invalid (< 2 or non-int)
          - duplicate cycle_ids within a single window
          - duplicate signal_ids in emitted_signal_ids
          - NaN / Inf in any series
        """
        if not isinstance(payload, Mapping):
            raise TypeError("from_snapshot: payload must be a Mapping")

        version = payload.get("schema_version")
        if version != SCHEMA_VERSION:
            raise ValueError(
                "from_snapshot: unknown schema_version "
                f"{version!r} (expected {SCHEMA_VERSION!r})"
            )

        window_size = payload.get("window_size")
        if not isinstance(window_size, int) or window_size < 2:
            raise ValueError(
                f"from_snapshot: invalid window_size {window_size!r}"
            )

        detector = cls(window_size=window_size)

        windows = payload.get("windows", {}) or {}
        if not isinstance(windows, Mapping):
            raise ValueError("from_snapshot: 'windows' must be a mapping")

        for k, win in windows.items():
            cycle_ids = list(win.get("cycle_ids", []))
            s_series = [float(v) for v in win.get("s_t", [])]
            ar_series = [float(v) for v in win.get("ar_t", [])]
            kappa_series = [float(v) for v in win.get("kappa_t", [])]
            z_series = [float(v) for v in win.get("z_active", [])]
            b_series = [float(v) for v in win.get("b_t", [])]

            # All parallel lists must be the same length.
            lens = {
                len(cycle_ids), len(s_series), len(ar_series),
                len(kappa_series), len(z_series), len(b_series),
            }
            if len(lens) != 1:
                raise ValueError(
                    f"from_snapshot: bucket {k!r} has misaligned series "
                    f"lengths: {lens}"
                )

            # NaN / Inf rejection (defensive: caller may have tampered).
            for label, series in (
                ("s_t", s_series), ("ar_t", ar_series),
                ("kappa_t", kappa_series), ("z_active", z_series),
                ("b_t", b_series),
            ):
                for v in series:
                    if math.isnan(v) or math.isinf(v):
                        raise ValueError(
                            f"from_snapshot: bucket {k!r} series {label} "
                            f"contains non-finite value {v!r}"
                        )

            # Duplicate cycle_ids within this bucket's window.
            if len(set(cycle_ids)) != len(cycle_ids):
                seen, dup = set(), []
                for cid in cycle_ids:
                    if cid in seen:
                        dup.append(cid)
                    seen.add(cid)
                raise ValueError(
                    f"from_snapshot: bucket {k!r} has duplicate cycle_ids "
                    f"{sorted(set(dup))}"
                )

            # Rebuild the rolling window.
            records = [
                _CycleRecord(
                    cycle_id=cycle_ids[i],
                    s_t=s_series[i],
                    ar_t=ar_series[i],
                    kappa_t=kappa_series[i],
                    z_active=z_series[i],
                    b_t=b_series[i],
                )
                for i in range(len(cycle_ids))
            ]
            detector._windows[k] = records
            detector._cycle_ids_in_window[k] = set(cycle_ids)

        emitted = list(payload.get("emitted_signal_ids", []) or [])
        if len(emitted) != len(set(emitted)):
            seen, dup = set(), []
            for sid in emitted:
                if sid in seen:
                    dup.append(sid)
                seen.add(sid)
            raise ValueError(
                "from_snapshot: duplicate emitted_signal_ids "
                f"{sorted(set(dup))}"
            )
        detector._emitted_signal_ids = list(emitted)
        detector._emitted_signal_id_set = set(emitted)

        return detector
