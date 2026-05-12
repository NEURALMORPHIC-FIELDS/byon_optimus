/**
 * Scenario 1 — BYON architecture deep-dive (full-organism live).
 *
 * Probes the relational field formed by project_state + trust hierarchy
 * + contextual stabilization centers. The scenario is hand-curated so
 * the relational layer has concrete instances to observe.
 *
 * Each prompt is a single user-turn the runner feeds to the production
 * pipeline (memory store → search_all → Claude Sonnet 4.6 → store
 * reply → fce_assimilate_receipt). The runner caps actual turns at
 * `--turns` (default 30).
 */

export const SCENARIO_1 = Object.freeze({
    id: "scenario-1-byon-arch",
    title: "BYON architecture deep-dive",
    purpose: "project_state + trust hierarchy + contextual stabilization",
    expected_centers: Object.freeze([
        "byon::macp_pipeline::factual",
        "byon::trust_hierarchy::factual",
        "byon::release_state::project_state",
        "byon::auditor_signature::security_boundary",
        "byon::executor_air_gap::security_boundary",
    ]),
    prompts: Object.freeze([
        // Architecture recap (10 turns)
        "Explain BYON Optimus' MACP v1.1 pipeline: Worker, Auditor, Executor — what each does and why they are separated.",
        "Why is the Executor in network_mode=none in Docker? What invariant does this protect?",
        "Auditor signs ExecutionOrder with Ed25519. Who holds the private key and who verifies?",
        "Worker plans, Auditor signs, Executor executes — why must Worker never execute directly?",
        "Walk me through one full MACP cycle: EvidencePack -> PlanDraft -> ApprovalRequest -> ExecutionOrder -> JohnsonReceipt.",
        "What is the role of FCE-M in this pipeline? Is it authoritative or advisory?",
        "How does FAISS retrieval interact with the FCE-M morphogenetic layer?",
        "What does Contextual Pathway Stabilization v0.6.9.1 add over v0.6.6?",
        "Explain the seven domain prototypes recognized by the CPS phase machine.",
        "Why is the COLD -> STABILIZING -> WARM -> DRIFT phase machine important for response latency?",
        // Trust hierarchy (10 turns)
        "List the six trust tiers in BYON's memory: SYSTEM_CANONICAL > VERIFIED_PROJECT_FACT > DOMAIN_VERIFIED > USER_PREFERENCE > EXTRACTED_USER_CLAIM > DISPUTED_OR_UNSAFE. What does each mean?",
        "How is SYSTEM_CANONICAL different from VERIFIED_PROJECT_FACT? Give an example of each.",
        "Why is EXTRACTED_USER_CLAIM never authoritative? What happens if a user claim contradicts SYSTEM_CANONICAL?",
        "How does DOMAIN_VERIFIED get into memory? Which channel can write it?",
        "What HTTP status does memory-service return on a non-operator DOMAIN_VERIFIED ingestion attempt?",
        "How is DISPUTED_OR_UNSAFE flagged? What patterns trigger it?",
        "Explain operator-only ingestion: which CLI tools can add VERIFIED_PROJECT_FACT and DOMAIN_VERIFIED?",
        "Walk me through how `byon-domain.mjs` validates a domain fact before ingestion.",
        "What metadata is required on a DOMAIN_VERIFIED entry: jurisdiction, citation, retrieved_at, etc.?",
        "If a domain fact's `review_after` expires, what is the expected behavior?",
        // Release / project state (10 turns)
        "Walk me through the release progression from v0.6.4 to v0.6.9.1. What landed at each step?",
        "What is the current main branch HEAD and what tag is on it?",
        "How many PASS gates did v0.6.9.1 hit out of how many? What was the threshold?",
        "Was v0.6.9 tag-ready or did it need a follow-up? Why?",
        "What does 'Level 2 of 4' mean operationally? Why is this branch's research not promoted to Level 3?",
        "What is theta_s and what is its operator-locked value? Why is it never lowered, even on research branches?",
        "What is tau_coag and what is its operator-locked value? Why is it never lowered?",
        "What is L3-G10 and why does it require independent reproduction?",
        "What is the docker network_mode=none verification flow at deploy time?",
        "Summarize the architectural invariants of BYON Optimus in a short list.",
    ]),
});

export default SCENARIO_1;
