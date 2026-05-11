/**
 * BYON-Omni Fact Extractor (v0.6.2)
 * ==================================
 *
 * Distills canonical facts from raw conversation turns. Output is structured
 * JSON stored as `MemoryType.FACT` with rich metadata so recall can:
 *   - Surface user preferences, architecture rules, security constraints.
 *   - Track corrections (newer facts mark older ones as superseded).
 *   - Filter by kind/subject for targeted retrieval.
 *
 * Design:
 *   - One LLM call per user turn (system message stays cached across turns).
 *   - Empty array on questions / small talk / acknowledgements.
 *   - Best-effort: extraction failure NEVER blocks the main pipeline.
 *
 * Output schema (each fact):
 *   {
 *     kind: "user_preference" | "architecture_rule" | "security_constraint"
 *         | "correction" | "project_fact" | "identity",
 *     subject: short string (e.g. "user", "Auditor", "Project X"),
 *     predicate: short string (e.g. "favorite_color_is", "must_be_private"),
 *     object: short string (e.g. "petrol blue", "no emojis"),
 *     confidence: 0..1,
 *     supersedes: optional short string describing fact this overrides,
 *     raw: original sentence (≤200 chars)
 *   }
 */

const EXTRACTION_SYSTEM_PROMPT = `You distill canonical FACTS from a single user message.

Output ONLY a JSON array. No prose, no markdown, no code fences. If no facts, output: []

Each fact object has these fields:
- kind: one of "user_preference", "architecture_rule", "security_constraint", "correction", "project_fact", "identity"
- subject: short noun (e.g. "user", "Auditor", "FCE-M", "Project X")
- predicate: short verb_phrase_with_underscores (e.g. "favorite_color_is", "must_be_private", "approves_actions")
- object: short value (e.g. "petrol blue", "no emojis ever", "Auditor")
- confidence: number 0..1
- supersedes: optional short string describing the older fact this overrides (only when user is correcting prior info)
- raw: original sentence (≤200 chars)

Rules:
- Skip questions, small talk, acknowledgements ("ok", "thanks").
- Skip facts that are too vague to be useful.
- "Actually X" or "Correction:" or "Not X but Y" → kind="correction" with supersedes set.
- "I prefer/like/want/dislike X" → kind="user_preference".
- "X must / has to / always / never" with architecture/system referent → kind="architecture_rule".
- "X is private/public/secret/sensitive" → kind="security_constraint".
- "X is/was Y" project-scoped fact → kind="project_fact".
- "I am Y" / "My name is Y" → kind="identity".

Be conservative: prefer 0 facts over wrong ones.`;

export async function extractFactsFromMessage({
    anthropic,
    model,
    text,
    maxTokens = 400,
}) {
    if (!text || text.trim().length < 2) return [];
    try {
        const resp = await anthropic.messages.create({
            model,
            max_tokens: maxTokens,
            temperature: 0,
            system: EXTRACTION_SYSTEM_PROMPT,
            messages: [{ role: "user", content: text.slice(0, 4000) }],
        });
        const raw = resp.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("")
            .trim();

        // Strip markdown fences if model accidentally wraps
        const cleaned = raw
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```\s*$/i, "")
            .trim();

        let parsed;
        try {
            parsed = JSON.parse(cleaned);
        } catch {
            // Try to find a JSON array in the text
            const m = cleaned.match(/\[[\s\S]*\]/);
            if (!m) return [];
            try {
                parsed = JSON.parse(m[0]);
            } catch {
                return [];
            }
        }

        if (!Array.isArray(parsed)) return [];

        // Normalize + validate
        const valid = [];
        const allowedKinds = new Set([
            "user_preference", "architecture_rule", "security_constraint",
            "correction", "project_fact", "identity",
        ]);
        for (const f of parsed) {
            if (!f || typeof f !== "object") continue;
            if (!allowedKinds.has(f.kind)) continue;
            if (typeof f.subject !== "string" || !f.subject.trim()) continue;
            if (typeof f.predicate !== "string" || !f.predicate.trim()) continue;
            if (typeof f.object !== "string") continue;
            const conf = typeof f.confidence === "number"
                ? Math.max(0, Math.min(1, f.confidence))
                : 0.7;
            valid.push({
                kind: f.kind,
                subject: f.subject.trim().slice(0, 80),
                predicate: f.predicate.trim().slice(0, 80),
                object: f.object.trim().slice(0, 240),
                confidence: conf,
                supersedes: typeof f.supersedes === "string" && f.supersedes.trim()
                    ? f.supersedes.trim().slice(0, 240)
                    : undefined,
                raw: (f.raw || text.slice(0, 200)).slice(0, 200),
            });
        }
        return valid;
    } catch {
        return [];
    }
}

/**
 * Extract facts from a user message AND store them as FACT memories.
 *
 * Returns { facts, ctxIds, error? }. Never throws — best-effort.
 *
 * mem: async function for memory-service POSTs.
 */
export async function extractAndStoreFacts({
    anthropic,
    model,
    mem,
    text,
    role,
    threadId,
    channel,
}) {
    // Only extract from user messages (assistant replies are not facts about the user)
    if (role !== "user") return { facts: [], ctxIds: [] };

    const facts = await extractFactsFromMessage({ anthropic, model, text });
    if (facts.length === 0) return { facts: [], ctxIds: [] };

    // Facts about system architecture / global identity / shared constraints
    // are not scoped to a single user thread — they describe the system.
    // User preferences, project facts, corrections stay thread-scoped.
    const SYSTEM_KINDS = new Set([
        "architecture_rule",
        "security_constraint",
        "identity",
    ]);

    const ctxIds = [];
    for (const f of facts) {
        const isSystemScope = SYSTEM_KINDS.has(f.kind);
        // Render canonical fact text: "<subject> <predicate> <object>"
        const factText = `${f.subject} ${f.predicate.replace(/_/g, " ")} ${f.object}`;
        const tags = [f.kind, f.subject.replace(/\s+/g, "_")];
        if (isSystemScope) tags.push("__system__");

        // System-scope facts get thread_id=null so they're visible across threads.
        // User-scope facts retain the actual thread_id.
        const factThreadId = isSystemScope ? null : threadId;

        try {
            const res = await mem({
                action: "store",
                type: "fact",
                data: {
                    fact: factText,
                    source: `fact-extractor:${f.kind}:${role}:${threadId}`,
                    tags,
                    thread_id: factThreadId,
                    channel,
                },
            });
            if (res?.body?.ctx_id !== undefined) {
                ctxIds.push(res.body.ctx_id);
            }
        } catch {
            // ignore individual fact store failures
        }
    }
    return { facts, ctxIds };
}

/**
 * Format facts recalled from search_all into a tight, model-friendly block.
 *
 * Prioritizes by kind: corrections > security > architecture > preferences > identity > project.
 * Drops duplicates by subject+predicate (keeping the newest by timestamp metadata).
 */
export function formatFactsForPrompt(factHits, limit = 8) {
    if (!Array.isArray(factHits) || factHits.length === 0) return null;
    const kindPriority = {
        correction: 0,
        security_constraint: 1,
        architecture_rule: 2,
        user_preference: 3,
        identity: 4,
        project_fact: 5,
    };
    const tagOf = h => (h.metadata?.tags || []).find(t =>
        kindPriority[t] !== undefined,
    );
    const seen = new Map();
    for (const h of factHits) {
        const kind = tagOf(h) || "other";
        const key = (h.content || "").toLowerCase();
        if (seen.has(key)) continue;
        const t = h.metadata?.timestamp || 0;
        seen.set(key, { ...h, _kind: kind, _t: t });
    }
    const ordered = [...seen.values()].sort((a, b) => {
        const pa = kindPriority[a._kind] ?? 99;
        const pb = kindPriority[b._kind] ?? 99;
        if (pa !== pb) return pa - pb;
        return b._t - a._t; // newer first
    });
    const top = ordered.slice(0, limit);
    return top
        .map(h => `  · [${h._kind}|sim=${h.similarity.toFixed(2)}] ${h.content}`)
        .join("\n");
}
