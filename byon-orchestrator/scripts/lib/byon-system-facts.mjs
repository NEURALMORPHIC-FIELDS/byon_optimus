/**
 * BYON Canonical System Facts (v0.6.4a)
 * ======================================
 *
 * Architectural facts about BYON itself, intended to live in memory-service
 * as system-scope (thread_id=null) FACT rows so every conversation can recall
 * them regardless of thread.
 *
 * These are NOT user preferences — they describe the BYON-FCE-M system's
 * own architecture and security boundaries. They:
 *
 *   - Repair L-category failures where the LLM had no idea about MACP roles
 *     (Worker plans, Auditor approves, Executor air-gapped, etc.)
 *   - Give Auditor a stable "epistemic ground" facts catalogue.
 *   - Are tagged `__system__` so v0.6.2 cross-thread routing applies.
 *
 * Idempotent: a seed run that already happened is detected by content_hash.
 */

export const BYON_SYSTEM_FACTS = [
    // === MACP pipeline roles ===
    {
        kind: "architecture_rule",
        subject: "BYON",
        predicate: "implements",
        object: "MACP v1.1 multi-agent pipeline with three agents Worker Auditor Executor",
    },
    {
        kind: "architecture_rule",
        subject: "Worker",
        predicate: "plans_does_not_execute",
        object: "Worker reads inbox builds EvidencePack and PlanDraft never executes actions",
    },
    {
        kind: "architecture_rule",
        subject: "Auditor",
        predicate: "validates_and_approves",
        object: "Auditor validates EvidencePack and PlanDraft signs ExecutionOrder with Ed25519 never executes",
    },
    {
        kind: "architecture_rule",
        subject: "Executor",
        predicate: "executes_only_signed_orders",
        object: "Executor runs in air-gapped container network_mode none executes only Ed25519 signed ExecutionOrders",
    },
    {
        kind: "architecture_rule",
        subject: "Auditor",
        predicate: "signs_document",
        object: "Auditor signs ExecutionOrder before it reaches Executor",
    },
    {
        kind: "architecture_rule",
        subject: "Executor",
        predicate: "produces_document",
        object: "Executor produces JohnsonReceipt after execution reporting status and side effects",
    },
    // === FCE-M boundary ===
    {
        kind: "architecture_rule",
        subject: "FCE-M",
        predicate: "modifies_attention_not_truth",
        object: "FCE-M shapes attention context and risk advisory it never approves actions never overwrites epistemic truth",
    },
    {
        kind: "architecture_rule",
        subject: "FCE-M",
        predicate: "is_morphogenetic_memory_not_vector_store",
        object: "FCE-M is a native morphogenetic memory layer with OmegaRecord and ReferenceField it is not a vector store",
    },
    {
        kind: "architecture_rule",
        subject: "ReferenceField",
        predicate: "guides_interpretation_not_verdict",
        object: "ReferenceField guides how new events are classified aligned tensioned contested it never issues epistemic verdicts",
    },
    {
        kind: "architecture_rule",
        subject: "OmegaRecord",
        predicate: "is_irreversible",
        object: "OmegaRecord is an irreversible coagulation marker once registered it survives disputed expressions",
    },
    {
        kind: "architecture_rule",
        subject: "high_residue",
        predicate: "increases_review_priority_not_approval",
        object: "High residue advisory raises review priority and risk it never approves or executes",
    },
    {
        kind: "architecture_rule",
        subject: "contested_expression",
        predicate: "requires_review_not_blocks_truth",
        object: "Contested expression raises Auditor risk and demands explicit user review it does not change truth verdicts",
    },
    // === Security ===
    {
        kind: "security_constraint",
        subject: "Executor",
        predicate: "must_be_air_gapped",
        object: "Executor container has network_mode none cannot reach the network",
    },
    {
        kind: "security_constraint",
        subject: "WhatsApp_bridge",
        predicate: "is_text_only",
        object: "WhatsApp bridge converses only it cannot execute commands edit files run shells or push code",
    },
    {
        kind: "security_constraint",
        subject: "ExecutionOrder",
        predicate: "must_be_signed",
        object: "Every ExecutionOrder must carry a valid Ed25519 signature from the Auditor before Executor accepts it",
    },
    {
        kind: "security_constraint",
        subject: "fce_context",
        predicate: "is_metadata_only",
        object: "fce_context in EvidencePack is metadata only hashed center ids and counts no raw labels or text content",
    },
    // === Identity ===
    {
        kind: "identity",
        subject: "BYON-Omni",
        predicate: "is",
        object: "BYON-Omni is an autonomous assistant agent with FAISS semantic memory plus FCE-M morphogenetic memory layer",
    },
    {
        kind: "identity",
        subject: "BYON",
        predicate: "patent_held_by",
        object: "BYON Optimus is protected by patent EP25216372.0 Omni-Qube-Vault owned by Vasile Lucian Borbeleac FRAGMERGENT TECHNOLOGY SRL",
    },
];

/**
 * Render the canonical fact corpus as a compact text block suitable for
 * inclusion in the LLM system prompt. This is a deterministic, retrieval-
 * independent surface — facts are ALWAYS in scope.
 */
export function renderCanonicalFactsBlock() {
    const lines = ["## Canonical BYON architecture facts (authoritative)"];
    for (const f of BYON_SYSTEM_FACTS) {
        lines.push(`- [${f.kind}] ${f.subject}: ${f.predicate.replace(/_/g, " ")} → ${f.object}`);
    }
    return lines.join("\n");
}

/**
 * Seed canonical system facts into memory-service.
 *
 * Idempotent: probes for a sentinel fact first; skips seeding if already present.
 *
 * Returns { seeded: number, skipped: boolean, ctxIds: number[], error?: string }.
 *
 * `mem` is the async POST helper used by other suites (returns { body, ok }).
 */
export async function seedSystemFacts(mem, { verbose = true } = {}) {
    // Idempotency probe: search for a sentinel fact via system scope
    try {
        const probe = await mem({
            action: "search",
            type: "fact",
            query: "Executor must be air gapped network_mode none",
            top_k: 3,
            threshold: 0.0,
            scope: "thread",
            thread_id: null, // system scope
        });
        const hits = probe?.body?.results || [];
        if (hits.length > 0 && (hits[0]?.similarity || 0) > 0.7) {
            if (verbose) {
                console.log(
                    `[seed] system facts already seeded (probe sim=${hits[0].similarity.toFixed(2)}). Skipping.`,
                );
            }
            return { seeded: 0, skipped: true, ctxIds: [] };
        }
    } catch {
        // probe failure → proceed with seeding
    }

    const ctxIds = [];
    let errors = 0;
    for (const f of BYON_SYSTEM_FACTS) {
        const factText = `${f.subject} ${f.predicate.replace(/_/g, " ")} ${f.object}`;
        const tags = [f.kind, f.subject.replace(/\s+/g, "_"), "__system__", "byon-bootstrap"];
        try {
            const res = await mem({
                action: "store",
                type: "fact",
                data: {
                    fact: factText,
                    source: `byon-bootstrap:${f.kind}`,
                    tags,
                    thread_id: null, // SYSTEM scope per v0.6.2 routing
                    channel: "system",
                },
            });
            if (res?.body?.ctx_id !== undefined) {
                ctxIds.push(res.body.ctx_id);
            }
        } catch {
            errors++;
        }
    }
    if (verbose) {
        console.log(
            `[seed] ${ctxIds.length}/${BYON_SYSTEM_FACTS.length} system facts seeded (errors=${errors}).`,
        );
    }
    return { seeded: ctxIds.length, skipped: false, ctxIds, error: errors > 0 ? `${errors} stores failed` : undefined };
}
