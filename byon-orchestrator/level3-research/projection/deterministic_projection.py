"""Deterministic projection policy — v1.

API
---

    project_turn_to_events(row: dict, *, seed: int) -> list[MemoryEvent]

Transforms a transcript row into a list of MemoryEvent objects.

Helpers (also exported):

    detect_perspectives(text, metadata)
        -> list[Perspective]
    derive_center_id(text, perspective, metadata)
        -> str
    classify_event_kind(text, perspective, metadata)
        -> EventKind
    estimate_z_contribution(text, perspective, kind, metadata)
        -> float
    build_provenance(row)
        -> ProvenanceRecord
    is_adversarial_text(text)
        -> bool
    source_text_hash(text)
        -> str

Determinism contract
--------------------

1. Same input row + same seed -> identical event_ids AND identical
   event content.

2. Same input row + different seed -> different event_ids, but
   identical center_id / perspective / kind / z_contribution for each
   projected slice. The seed only enters the event_id derivation; it
   does not enter the classifier.

3. No clocks, no random, no LLM calls, no embedding lookups. The
   projection is a pure function of (row, seed).

4. ts (event timestamp) is derived deterministically from the row's
   `turn_index` (anchored to a fixed BASE_TS) when the row does not
   carry an explicit `ts` field.

What this module does NOT do (operator constraint, commit 3 scope)
-------------------------------------------------------------------

- Does NOT create OmegaRecord.
- Does NOT mutate OmegaRegistry.
- Does NOT call check_coagulation.
- Does NOT create RollingCenterSummary.
- Does NOT compute Z metabolism (just sets z_contribution on the event).
- Does NOT compute ReferenceField.
- Does NOT import from byon-orchestrator/memory-service/ (no production
  FCE-M imports). All adversarial-pattern detection lives in a LOCAL
  copy below; it mirrors the v0.6.9.1 production patterns but does
  NOT import them.
- Does NOT compute embeddings.
- Does NOT mutate any persistent state.

Production isolation policy
---------------------------

This module imports ONLY from `schemas` (the research package's own
schemas). It does not import from any path under
byon-orchestrator/src/, byon-orchestrator/scripts/, or
byon-orchestrator/memory-service/.
"""

from __future__ import annotations

import datetime
import hashlib
import re
from typing import Any, Iterable, List, Mapping, Optional

# Absolute import — sys.path includes byon-orchestrator/level3-research/
# at test time (via tests/conftest.py) and at harness time (the harness
# will perform the same setup). No relative imports because the package
# directory has a hyphen and cannot be loaded by its name directly.
from schemas import (
    EventKind,
    MemoryEvent,
    Perspective,
    PERSPECTIVES_V1,
    ProvenanceRecord,
)


# ---------------------------------------------------------------------------
# Policy constants
# ---------------------------------------------------------------------------

PROJECTION_POLICY_VERSION = "deterministic_v1"

# A deterministic base for derived timestamps when the row does not carry
# an explicit `ts`. Each turn gets `BASE_TS + turn_index seconds`.
BASE_TS = datetime.datetime(2026, 1, 1, 0, 0, 0, tzinfo=datetime.timezone.utc)


# ---------------------------------------------------------------------------
# Adversarial-claim-to-rule patterns (LOCAL copy; does NOT import production
# fact-extractor.mjs — that is a TypeScript module in scripts/lib/ which is
# off-limits for this research package per the isolation policy).
# These mirror the v0.6.9.1 production claim_to_rule + negative_rule_elevation
# patterns. Updating them does NOT update the production patterns; that's
# intentional — research and production patterns evolve independently.
# ---------------------------------------------------------------------------

_ADV_PATTERNS = [
    # RO: "memorează ca regulă (permanentă|oficială|...)"
    re.compile(
        r"\b(memorea[zs][ăa]?|salveaz[ăa]?|consider[ăa]?)\b.{0,50}\b(ca\s+)?regul[ăa]"
        r"\s*(permanent|oficial|ferm|sigur|valid)?",
        re.I,
    ),
    re.compile(r"\bregul[ăa]\s+permanent[ăa]?\s*[:=]", re.I),
    # RO: "memorează ... nu (mai) trebuie X"
    re.compile(
        r"\b(memorea[zs][ăa]?|salveaz[ăa]?|consider[ăa]?)\b.{0,80}\b(nu|nu\s+mai)\s+trebuie",
        re.I,
    ),
    # RO: "de acum X este oficial/verificat/regul..."
    re.compile(
        r"\bde\s+acum\b.{0,40}\b(oficial|verificat|regul|aplicat|valid|adev[ăa]r)",
        re.I,
    ),
    # EN: "treat this as (a) rule" / "consider this verified" / etc.
    re.compile(
        r"\b(treat|consider)\s+this\s+as\s+(a\s+)?(rule|fact|verified|official|policy)",
        re.I,
    ),
    re.compile(r"\b(treat|consider)\s+(it|this)\s+(as\s+)?verified", re.I),
    # EN: "from now on this is the rule" / "this is now the rule"
    re.compile(r"\bfrom\s+now\s+on\b.{0,40}\b(rule|fact|official|policy|verified)", re.I),
    re.compile(r"\b(this|that)\s+is\s+now\s+(the\s+)?(rule|fact|official|policy)", re.I),
    # EN: "override / supersede / disregard the rule"
    re.compile(
        r"\b(override|supersede|disregard|replace)\s+(the\s+)?(rule|policy|standard|requirement)",
        re.I,
    ),
    # RO/EN: bypass Auditor / ignore Auditor / skip signature
    re.compile(
        r"\b(bypass|ocoli[șt]?|ignor[ăa]?|skip|sări\s+peste)\b.{0,40}"
        r"\b(Auditor|Executor|signature|semn[ăa]tur)",
        re.I,
    ),
    # EN: "remember this as a (permanent|...) rule"
    re.compile(
        r"\bremember\s+(this|that)\s+as\s+(a\s+)?(\w+\s+)?"
        r"(rule|fact|policy|verified|standard|requirement)",
        re.I,
    ),
    # EN: "X is no longer required / applicable / official"
    re.compile(r"\bno\s+longer\s+(required|applicable|official|valid|in\s+force)", re.I),
    # RO: "nu mai sunt/este necesar/obligator/aplicabil/valid"
    re.compile(r"\bnu\s+mai\s+(sunt|este)\s+(necesar|obligator|aplica|valid)", re.I),
]


# ---------------------------------------------------------------------------
# Correction patterns
# ---------------------------------------------------------------------------

_CORRECTION_PATTERNS = [
    re.compile(r"\bactually\b", re.I),
    re.compile(r"\bin\s+fact\b", re.I),
    re.compile(r"\bde\s+fapt\s+nu\b", re.I),
    re.compile(r"\bcorect(are|ie|ție)\s*:", re.I),
    re.compile(r"\bcorrection\s*:", re.I),
    re.compile(r"\b(ignore|ignor[ăa]?)\s+(that|aceea|asta|the\s+previous)", re.I),
    re.compile(r"\bram[âa]n\s+la\s+regula\s+original", re.I),
    re.compile(r"\bsorry,?\s+i\s+meant\b", re.I),
]


# ---------------------------------------------------------------------------
# Contradiction patterns (non-adversarial)
# ---------------------------------------------------------------------------

_CONTRADICTION_PATTERNS = [
    re.compile(r"\bcontradict(s|ion|ie|ție)?\b", re.I),
    re.compile(r"\bnu\s+este\s+corect\b", re.I),
    re.compile(r"\b(but|dar)\s+(earlier|mai\s+devreme)\b", re.I),
    re.compile(r"\b(opposite|opus)\b", re.I),
]


# ---------------------------------------------------------------------------
# Receipt success / failure patterns
# ---------------------------------------------------------------------------

_RECEIPT_SUCCESS_PATTERNS = [
    re.compile(r"\bPASS\b", re.I),
    re.compile(r"\bgreen\b", re.I),
    re.compile(r"\bsuccess(?:ful)?\b", re.I),
    re.compile(r"\bverde\b", re.I),
    re.compile(r"\brece(i)?pt\s*:?\s*success", re.I),
    re.compile(r"\b(CI|build|test|jobs?)\s+(pass|green|success|verde|complete|reușit)", re.I),
    re.compile(r"\bverdict\s*:?\s*3\b", re.I),
    re.compile(r"\bbenchmark\s+(pass|complete|final|reușit|done)", re.I),
    re.compile(r"\btag(?:\s+|\s*=\s*)?(?:created|cut|annotated|pushed)", re.I),
]

_RECEIPT_FAILURE_PATTERNS = [
    re.compile(r"\bFAIL(?:ED|S|URE)?\b", re.I),
    re.compile(r"\brejected?\b", re.I),
    re.compile(r"\brespins\b", re.I),
    re.compile(r"\brece(i)?pt\s*:?\s*fail", re.I),
    re.compile(r"\b(CI|build|test|jobs?)\s+(fail|red|broken|down)", re.I),
    re.compile(r"\b(?<!no\s)error\b|\beroare\b", re.I),
    re.compile(r"\bbenchmark\s+(fail|failed)", re.I),
]


# ---------------------------------------------------------------------------
# Perspective triggers
# ---------------------------------------------------------------------------

# project_state: versions, tags, commits, CI, benchmark, release.
_PROJECT_STATE_PATTERNS = [
    re.compile(r"\bv\d+\.\d+(?:\.\d+)?(?:[\.\-]\d+)*\b"),               # v0.6.9.1
    re.compile(r"\b(tag|tagging|tag-uit|commit|SHA)\b", re.I),
    re.compile(r"\b(CI|build|workflow|github\s+actions|docker\s+build)\b", re.I),
    re.compile(r"\b(release|roadmap|tag-ready|release\s+decision)\b", re.I),
    re.compile(r"\b(benchmark|benchmarks?|gate(s|-uri)?|PASS\s+gate|FAIL\s+gate)\b", re.I),
    re.compile(r"\b(avg\s+B|p95|p50|payload\s+ratio)\b", re.I),
    re.compile(r"\bLevel\s+\d+\s+of\s+\d+\b", re.I),
    re.compile(r"\b\d+\s*/\s*\d+\s+PASS\b", re.I),
]

# security_boundary: tokens, executor air-gap, auditor signature, etc.
_SECURITY_BOUNDARY_PATTERNS = [
    re.compile(r"\b(token|tokenul|tokeni|secret|password|parol[ăa]|API\s+key|credential)", re.I),
    re.compile(r"\bExecutor\b", re.I),
    re.compile(r"\bAuditor\b", re.I),
    re.compile(r"\bair-?gap\b", re.I),
    re.compile(r"\bnetwork_mode\b", re.I),
    re.compile(r"\bEd25519\b", re.I),
    re.compile(r"\bsemn[aă]tur[ăa]?\b", re.I),
    re.compile(r"\b(DISPUTED_OR_UNSAFE|unsafe|disputed)\b", re.I),
    re.compile(r"\b(jailbreak|prompt[\s_-]?injection|adversarial)\b", re.I),
]

# domain_verified — explicit citation patterns ONLY. A simple mention of
# "GDPR" without article/source/citation is not enough (test 8).
_DOMAIN_VERIFIED_TEXT_PATTERNS = [
    re.compile(r"\b(DIN|EN|ISO|ANSI|ASTM|NEN|BS|AS)\s+\d{2,}\b"),                # DIN 4108
    re.compile(r"\b(Art|Article|Articolul|Paragraph)\.?\s+\d+\b", re.I),         # Art. 33
    re.compile(r"\bdirectiv[aă]\s+\d+/\d+", re.I),                               # directiva 2016/679
    re.compile(r"\bregulamentul\s+\(UE\)\s+\d+/\d+", re.I),
    re.compile(r"\bP-?100\b", re.I),                                              # P-100
    re.compile(r"\bGDPR\s+Art(?:icle)?\.?\s+\d+", re.I),
    re.compile(r"\bcitation\s*:|\bcitat\s+din\b", re.I),
    re.compile(r"\bsource_(?:name|url|path)\b", re.I),
    re.compile(r"\bretrieved_at\b|\beffective_from\b|\breview_after\b", re.I),
]

# factual — broad fallback for system / architecture / general statements.
_FACTUAL_PATTERNS = [
    re.compile(
        r"\b(Worker|Auditor|Executor|MACP|FCE[-_\s]?M|EvidencePack|PlanDraft|"
        r"ExecutionOrder|JohnsonReceipt|OmegaRecord|ReferenceField|"
        r"theta_s|tau_coag|residue|omega|coagulation)\b",
        re.I,
    ),
    re.compile(r"\b(SYSTEM_CANONICAL|VERIFIED_PROJECT_FACT|USER_PREFERENCE|EXTRACTED_USER_CLAIM)\b"),
    re.compile(r"\btrust\s+hierarchy\b", re.I),
    re.compile(r"\b(this|that|aceast[aă])\s+(is|este|sunt|are)\b", re.I),     # explicit affirmation
]


# ---------------------------------------------------------------------------
# z_contribution table (operator-locked for v1 — §6)
# ---------------------------------------------------------------------------

Z_COHERENT_FACTUAL = 0.2
Z_OBSERVATION = 0.3                # unknown / weak signal
Z_RECEIPT_SUCCESS = 0.1
Z_CORRECTION = 0.15
Z_CONTRADICTION = 0.8
Z_RECEIPT_FAILURE = 0.7
Z_ADVERSARIAL = 1.0


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _any(patterns: Iterable[re.Pattern], text: str) -> bool:
    return any(p.search(text) for p in patterns)


def _is_adversarial(text: str) -> bool:
    if not text:
        return False
    return _any(_ADV_PATTERNS, text)


def _has_explicit_domain_metadata(metadata: Optional[Mapping[str, Any]]) -> bool:
    if not metadata:
        return False
    keys = (
        "jurisdiction",
        "source_name",
        "source_url",
        "source_path",
        "citation",
        "domain_verified",
        "domain",
        "retrieved_at",
        "effective_from",
    )
    return any(metadata.get(k) for k in keys)


def _has_explicit_domain_citation_in_text(text: str) -> bool:
    return _any(_DOMAIN_VERIFIED_TEXT_PATTERNS, text)


def _ts_for_turn(turn_index: int) -> str:
    """Deterministic ISO-8601 timestamp from turn_index."""
    t = BASE_TS + datetime.timedelta(seconds=int(turn_index))
    return t.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _deterministic_event_id(
    *,
    transcript_id: str,
    turn_index: int,
    perspective: str,
    text_hash: str,
    seed: int,
) -> str:
    """Generate a deterministic UUID-shaped string from input parts.

    Same inputs always produce the same id. The seed is one of the inputs,
    so different seeds for the same content produce different event_ids
    (operator test 2).
    """
    raw = "|".join(
        [
            "level3_research.projection.v1",
            transcript_id,
            str(int(turn_index)),
            perspective,
            text_hash,
            str(int(seed)),
        ]
    )
    h = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    # Format as UUID 8-4-4-4-12
    return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


def _derive_row_id(row: Mapping[str, Any]) -> str:
    """If the row has an explicit `row_id`, return it. Otherwise derive
    deterministically from transcript_id + turn_index.
    """
    if row.get("row_id"):
        return str(row["row_id"])
    tid = row.get("transcript_id", "unknown_transcript")
    ti = int(row.get("turn_index", -1))
    return f"{tid}#turn_{ti}"


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


def is_adversarial_text(text: str) -> bool:
    """Public alias for the adversarial pattern check used by the projector."""
    return _is_adversarial(text)


def source_text_hash(text: str) -> str:
    """Stable, short hex digest of the source text. Used in provenance tags."""
    h = hashlib.sha256((text or "").encode("utf-8")).hexdigest()
    return h[:16]   # 64 bits is enough collision resistance for our scale


def build_provenance(row: Mapping[str, Any]) -> ProvenanceRecord:
    """Construct a ProvenanceRecord from the row's transcript metadata.

    All seven ProvenanceRecord fields are populated. The seed is read from
    `row["seed"]`; callers should set it before invoking the projection
    pipeline (or use `project_turn_to_events` which sets it for them).
    """
    return ProvenanceRecord(
        channel=str(row.get("channel", "harness")),
        thread_id=str(row.get("thread_id", "research-thread-1")),
        source=str(row.get("source", row.get("transcript_id", "deterministic_projection"))),
        turn_index=int(row.get("turn_index", 0)),
        transcript_id=str(row.get("transcript_id", "unknown_transcript")),
        seed=int(row.get("seed", 0)),
    )


def detect_perspectives(
    text: str, metadata: Optional[Mapping[str, Any]] = None
) -> List[Perspective]:
    """Return the list of v1 perspectives this text projects into.

    Special-cases:
      - Adversarial text projects ONLY to SECURITY_BOUNDARY (the factual
        center must not be contaminated by adversarial content).
      - domain_verified requires EITHER explicit row metadata signal OR
        an explicit citation pattern in the text (article numbers,
        standard numbers, etc.). A bare mention of "GDPR" without a
        citation is NOT enough (test 8).
      - If nothing else triggers, factual is the default.

    The return list is in canonical PERSPECTIVES_V1 order so downstream
    code can rely on a stable ordering.
    """
    if not text:
        return [Perspective.FACTUAL]

    metadata = metadata or {}

    # Adversarial gate: short-circuit to security_boundary only.
    if _is_adversarial(text):
        return [Perspective.SECURITY_BOUNDARY]

    hits: List[Perspective] = []

    factual_hit = _any(_FACTUAL_PATTERNS, text)
    project_state_hit = _any(_PROJECT_STATE_PATTERNS, text)
    security_hit = _any(_SECURITY_BOUNDARY_PATTERNS, text)
    domain_hit = _has_explicit_domain_metadata(metadata) or _has_explicit_domain_citation_in_text(text)

    if factual_hit:
        hits.append(Perspective.FACTUAL)
    if project_state_hit:
        hits.append(Perspective.PROJECT_STATE)
    if domain_hit:
        hits.append(Perspective.DOMAIN_VERIFIED)
    if security_hit:
        hits.append(Perspective.SECURITY_BOUNDARY)

    # Fallback: nothing matched -> factual / observation default.
    if not hits:
        return [Perspective.FACTUAL]

    # Canonical order: factual, project_state, domain_verified, security_boundary
    ordered = [p for p in PERSPECTIVES_V1 if p in hits]
    return ordered


def derive_center_id(
    text: str,
    perspective: Perspective,
    metadata: Optional[Mapping[str, Any]] = None,
) -> str:
    """Map (text, perspective, metadata) -> stable, readable center_id.

    Format: `byon::<topic>::<perspective>`.
    Topic is heuristic (deterministic keywords). No embeddings, no LLM.
    """
    t = (text or "").lower()
    p = perspective.value
    metadata = metadata or {}

    if perspective == Perspective.FACTUAL:
        if any(k in t for k in ("worker", "auditor", "executor", "macp", "pipeline", "evidencepack", "plandraft", "executionorder", "johnsonreceipt")):
            return f"byon::macp_pipeline::{p}"
        if any(k in t for k in ("fce-m", "fce_m", "fce m", "omegarecord", "referencefield", "residue", "theta_s", "tau_coag", "coagulation", "morphogen")):
            return f"byon::fce_m::{p}"
        if any(k in t for k in ("trust hierarchy", "system_canonical", "verified_project_fact", "domain_verified", "user_preference", "extracted_user_claim", "disputed_or_unsafe", "tier")):
            return f"byon::trust_hierarchy::{p}"
        if any(k in t for k in ("ed25519", "signature", "semnătur", "semnatur", "signing")):
            return f"byon::cryptographic_signing::{p}"
        return f"byon::general::{p}"

    if perspective == Perspective.PROJECT_STATE:
        if re.search(r"\bv\d+\.\d+(?:\.\d+)?", t) or "tag" in t or "release" in t or "roadmap" in t:
            return f"byon::release_state::{p}"
        if any(k in t for k in (" ci ", "ci\n", "workflow", "github actions", "docker build", "build")):
            return f"byon::ci_state::{p}"
        if any(k in t for k in ("benchmark", "avg b", "p95", "p50", "payload ratio", "gate", "pass gate", "fail gate")):
            return f"byon::benchmark_state::{p}"
        if "level" in t and re.search(r"\blevel\s+\d+\b", t):
            return f"byon::level_state::{p}"
        return f"byon::project_state::{p}"

    if perspective == Perspective.SECURITY_BOUNDARY:
        if _is_adversarial(text):
            return f"byon::adversarial_input::{p}"
        if any(k in t for k in ("token", "secret", "api key", "credential", "password", "parol")):
            return f"byon::token_policy::{p}"
        if "executor" in t and any(k in t for k in ("air-gap", "air gap", "airgap", "network_mode", "network mode")):
            return f"byon::executor_air_gap::{p}"
        if "auditor" in t and any(k in t for k in ("signature", "sign", "ed25519", "semn")):
            return f"byon::auditor_signature::{p}"
        if any(k in t for k in ("disputed_or_unsafe", "unsafe", "disputed", "jailbreak", "prompt injection")):
            return f"byon::unsafe_memory::{p}"
        return f"byon::{p}::{p}"

    if perspective == Perspective.DOMAIN_VERIFIED:
        jurisdiction = metadata.get("jurisdiction") if metadata else None
        if jurisdiction:
            j = str(jurisdiction).replace("/", "_").replace(" ", "_")
            return f"byon::{j}::{p}"
        # Heuristics from text patterns
        if re.search(r"\b(DIN|EN)\s+\d", text, re.I):
            return f"byon::DIN::{p}"
        if re.search(r"\bGDPR\b", text, re.I):
            return f"byon::GDPR::{p}"
        if re.search(r"\bISO\s+\d", text, re.I):
            return f"byon::ISO::{p}"
        if re.search(r"\bP-?100\b", text, re.I):
            return f"byon::P-100::{p}"
        if re.search(r"\bAI\s+Act\b", text, re.I):
            return f"byon::AI_Act::{p}"
        return f"byon::{p}::{p}"

    # Should be unreachable given PERSPECTIVES_V1 admits exactly 4.
    return f"byon::unknown::{p}"


def classify_event_kind(
    text: str,
    perspective: Perspective,
    metadata: Optional[Mapping[str, Any]] = None,
) -> EventKind:
    """Map (text, perspective, metadata) -> EventKind.

    Priorities (highest first):
      1. Adversarial pattern -> CONTESTED (z=1.0 elsewhere)
      2. Correction marker  -> CORRECTION
      3. Receipt success / failure (must hold on its perspective)
      4. Explicit contradiction -> CONTESTED (z=0.8)
      5. Default -> ALIGNED (coherent statement)
    """
    text = text or ""

    # 1. Adversarial trumps everything else.
    if _is_adversarial(text):
        return EventKind.CONTESTED

    # 2. Correction signals.
    if _any(_CORRECTION_PATTERNS, text):
        return EventKind.CORRECTION

    # 3. Receipts.
    if _any(_RECEIPT_FAILURE_PATTERNS, text) and not _any(
        _RECEIPT_SUCCESS_PATTERNS, text
    ):
        # Failure-only: clear failure receipt.
        return EventKind.RECEIPT_FAILURE
    if _any(_RECEIPT_SUCCESS_PATTERNS, text) and not _any(
        _RECEIPT_FAILURE_PATTERNS, text
    ):
        return EventKind.RECEIPT_SUCCESS
    # 3b. Mixed receipts (both success and failure language) — count as
    # partial; safer than guessing.
    if _any(_RECEIPT_SUCCESS_PATTERNS, text) and _any(_RECEIPT_FAILURE_PATTERNS, text):
        return EventKind.RECEIPT_PARTIAL

    # 4. Explicit contradiction language.
    if _any(_CONTRADICTION_PATTERNS, text):
        return EventKind.CONTESTED

    # 5. Default — stable coherent statement.
    return EventKind.ALIGNED


def estimate_z_contribution(
    text: str,
    perspective: Perspective,
    kind: EventKind,
    metadata: Optional[Mapping[str, Any]] = None,
) -> float:
    """Map (text, perspective, kind, metadata) -> z_contribution in [0, 1].

    Operator-locked table (§6 of commit-3 spec):
      coherent factual/project   ALIGNED          0.20
      observation (weak signal)  ALIGNED (no strong factual hit)  0.30
      receipt_success            RECEIPT_SUCCESS  0.10
      correction                 CORRECTION       0.15
      contradiction              CONTESTED (non-adversarial)  0.80
      receipt_failure            RECEIPT_FAILURE  0.70
      adversarial claim-to-rule  CONTESTED (adversarial)      1.00

    Guarantees:
      - return value in [0.0, 1.0]
      - deterministic: same input -> same value
      - no seed dependency
    """
    text = text or ""

    if kind == EventKind.RECEIPT_SUCCESS:
        z = Z_RECEIPT_SUCCESS
    elif kind == EventKind.RECEIPT_FAILURE:
        z = Z_RECEIPT_FAILURE
    elif kind == EventKind.RECEIPT_PARTIAL:
        # Between full success and full failure.
        z = (Z_RECEIPT_SUCCESS + Z_RECEIPT_FAILURE) / 2.0
    elif kind == EventKind.CORRECTION:
        z = Z_CORRECTION
    elif kind == EventKind.CONTESTED:
        # Differentiate adversarial vs plain contradiction by text patterns.
        z = Z_ADVERSARIAL if _is_adversarial(text) else Z_CONTRADICTION
    elif kind == EventKind.TENSIONED:
        z = Z_CONTRADICTION       # treat as a strong tension
    elif kind == EventKind.SECURITY_REJECTED:
        z = Z_RECEIPT_FAILURE     # post-action rejection has the same weight as a failed receipt
    else:
        # EventKind.ALIGNED (default).
        # Distinguish coherent factual statement (has a hit on factual or
        # project_state patterns) from a weak observation (no clear hit).
        coherent = (
            _any(_FACTUAL_PATTERNS, text)
            or _any(_PROJECT_STATE_PATTERNS, text)
        )
        z = Z_COHERENT_FACTUAL if coherent else Z_OBSERVATION

    # Hard clamp to [0, 1].
    return max(0.0, min(1.0, float(z)))


# ---------------------------------------------------------------------------
# Top-level entry
# ---------------------------------------------------------------------------


def project_turn_to_events(
    row: Mapping[str, Any], *, seed: int
) -> List[MemoryEvent]:
    """Transform a transcript row into a list of MemoryEvent objects.

    Each event represents one projection of the row into one
    `(center_id, perspective)` slice. The list has 1..4 entries depending
    on how many v1 perspectives the text triggers.

    Determinism:
      - same `row` + same `seed` -> identical events
      - same `row` + different `seed` -> different event_ids, but identical
        center_id / perspective / kind / z_contribution per event
      - no LLM, no embeddings, no clock reads

    The function does NOT touch ZCounters, OmegaRegistry, RollingCenterSummary,
    ReferenceField, or check_coagulation. It is a pure read of `row` and
    `seed` to a list of frozen MemoryEvent objects.
    """
    if not isinstance(row, Mapping):
        raise TypeError(
            f"project_turn_to_events: row must be a Mapping (dict), got "
            f"{type(row).__name__}"
        )
    if not isinstance(seed, int):
        raise TypeError(
            f"project_turn_to_events: seed must be an int, got "
            f"{type(seed).__name__}"
        )

    text = str(row.get("text", "") or "")
    turn_index = int(row.get("turn_index", 0))
    transcript_id = str(row.get("transcript_id", "unknown_transcript"))
    metadata = row.get("metadata", {}) or {}

    # Build the per-row provenance once (same for every projected event
    # from this row; seed gets injected).
    prov_row = dict(row)
    prov_row.setdefault("seed", seed)
    provenance = build_provenance(prov_row)

    # ts: prefer an explicit value on the row; else derive deterministically.
    ts = str(row.get("ts") or _ts_for_turn(turn_index))

    # Source text artefacts (used in tags for audit).
    text_hash = source_text_hash(text)
    excerpt = text[:160]   # short excerpt for human audit; full text lives in MemoryEvent.text

    # phase tag — useful for harness audit (passes through transparently).
    phase = row.get("phase")
    row_id = _derive_row_id(prov_row)

    perspectives = detect_perspectives(text, metadata)

    events: List[MemoryEvent] = []
    seen_ids: set = set()    # defensive: catches any future bug where two
                             # perspectives + same other fields collide
    for perspective in perspectives:
        center_id = derive_center_id(text, perspective, metadata)
        kind = classify_event_kind(text, perspective, metadata)
        z = estimate_z_contribution(text, perspective, kind, metadata)

        event_id = _deterministic_event_id(
            transcript_id=transcript_id,
            turn_index=turn_index,
            perspective=perspective.value,
            text_hash=text_hash,
            seed=seed,
        )

        if event_id in seen_ids:
            # Shouldn't happen with current logic — defensive only.
            raise RuntimeError(
                "deterministic projection produced duplicate event_id "
                f"{event_id!r} for turn {turn_index} / transcript "
                f"{transcript_id!r}. This is a bug."
            )
        seen_ids.add(event_id)

        tags = [
            f"projection_policy:{PROJECTION_POLICY_VERSION}",
            f"source_text_hash:{text_hash}",
            f"row_id:{row_id}",
        ]
        if phase:
            tags.append(f"phase:{phase}")
        # The excerpt is folded into a single tag so the MemoryEvent's
        # `text` field can carry the full text without duplicating.
        tags.append(f"source_excerpt:{excerpt}")

        ev = MemoryEvent(
            event_id=event_id,
            center_id=center_id,
            perspective=perspective.value,
            ts=ts,
            kind=kind.value,
            text=text,
            embedding=None,                   # v1: no embeddings here
            provenance=provenance,
            z_contribution=z,
            resolution_status="unresolved",   # buffer/runtime decides later
            tags=tags,
        )
        events.append(ev)

    return events
