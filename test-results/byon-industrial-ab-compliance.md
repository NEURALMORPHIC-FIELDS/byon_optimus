# BYON A/B — Style/Preference Compliance Report

This is a **separate metric** from the primary auto-scorer.

- The primary scorer measures **semantic recall**: does the response *mention* the rule (e.g. "no emoji")?
- This scorer measures **behavioral compliance**: does the response *actually obey* the rule (e.g. zero emoji codepoints in output)?

A response can score high on semantic recall and low on behavioral compliance — that gap is itself a real finding about whether structured memory is being *applied* to generation, not just *retrieved*.

**Severity tiers:** high (hard rule, e.g. emoji when forbidden, invented memory) → score 0–1; medium (e.g. language mismatch) → score 3; low (e.g. filler) → score 4; clean → score 5.

## Per-category compliance scores

| Category | n | avg A compliance | avg B compliance | delta | A violations | B violations |
|---|---:|---:|---:|---:|---:|---:|
| A | 10 | 5.00 | 4.60 | -0.40 | 0 | 1 |
| B | 10 | 5.00 | 5.00 | +0.00 | 0 | 0 |
| C | 10 | 5.00 | 5.00 | +0.00 | 0 | 0 |
| D | 12 | 5.00 | 5.00 | +0.00 | 0 | 0 |
| E | 12 | 5.00 | 5.00 | +0.00 | 0 | 0 |
| F | 10 | 5.00 | 5.00 | +0.00 | 0 | 0 |
| G | 6 | 5.00 | 5.00 | +0.00 | 0 | 0 |
| I | 12 | 5.00 | 5.00 | +0.00 | 0 | 0 |

## Violation breakdown by rule

### Category A

| rule | A count | B count |
|---|---:|---:|
| no_emoji | 0 | 1 |

## Concrete violation examples (top 20 across both conditions)

- **A/A1** [B, high] no_emoji: emoji codepoints found: ❌ ✅ (n=2)

## Headline finding

If A's compliance and B's compliance are roughly equal, the gap between semantic-recall scores and compliance scores is *systemic* — both LLMs ignore the rule equally despite retrieval. If B's compliance is significantly higher than A's, BYON's memory does shape generation behavior, not just retrieval. If B's compliance is *lower* than A's, the memory is being recalled but the prompt construction is letting the LLM ignore it — that's an actionable defect in the system-prompt scaffolding, not in the memory layer itself.

## Limitation of the initial auto-scorer (acknowledged)

The Section 4 scores (semantic recall) reward responses that *cite* a rule by keyword. The A1 emoji case illustrates this: B mentioned the user's "no emoji" preference (high semantic recall) and at the same time used emoji glyphs in its formatted headings (compliance violation). This is **not a memory failure — it is a behavioral-application failure**: the rule was recalled into the prompt but the model's generation did not honor it. That is exactly the kind of finding this benchmark is designed to surface.