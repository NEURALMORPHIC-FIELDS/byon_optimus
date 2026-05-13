# 00 — Protected baseline before full-organism capability benchmark

**Created:** 2026-05-13
**Operator directive:** `NO CANONICALIZATION BEFORE COMPREHENSIVE FULL-ORGANISM BENCHMARK`
**Working branch (NEW):** `validation/full-organism-capability-benchmark`
**Branched from:** `research/level3-full-organism-runtime` @ `0c0e1f1` (commit 17)

## Protection scope

Before the benchmark runs, the following branches and commits are tag-frozen so that
the upcoming benchmark, regression check, and gate evaluation cannot accidentally
overwrite a previously validated state. Until all benchmark gates pass the operator
has explicitly forbidden:

- modifying `main`
- deleting any branch
- creating tags or releases (besides these protective `backup/pre-validation-*` tags)
- merging anything into `main`
- canonizing a model
- repository cleanup of any kind

## Protected baseline (SHA snapshot)

| Branch | SHA | Backup tag | Status |
| ------ | --- | ---------- | ------ |
| main | `15a7c478afcb394169ed74d89060bd494c8ea169` | `backup/pre-validation-20260513T092621Z/main` | PROTECTED — do not touch |
| master | `15a7c478afcb394169ed74d89060bd494c8ea169` | `backup/pre-validation-20260513T092621Z/master` | PROTECTED — do not touch (mirror of main) |
| research/level3-full-organism-runtime | `0c0e1f1eded35cfd53667c2f6b4a2005b13e3ca2` | `backup/pre-validation-20260513T092621Z/research-level3-full-organism-runtime` | PROTECTED — commit 17 lives here |
| research/level-3-natural-omega | `ef689e935d68336e84f01955232132a5008294ab` | `backup/pre-validation-20260513T092621Z/research-level-3-natural-omega` | PROTECTED — alternate Level 3 research line |
| backup/legacy-remote-main | `79aac3471dec0477a6b9b1708a713f3ffd51afd3` | `backup/pre-validation-20260513T092621Z/backup-legacy-remote-main` | PROTECTED — pre-existing legacy backup |

## Recovery instructions (if anything goes wrong during validation)

```bash
# Restore main exactly to its pre-validation state
git update-ref refs/heads/main backup/pre-validation-20260513T092621Z/main

# Restore the research branch where commit 17 lives
git update-ref refs/heads/research/level3-full-organism-runtime backup/pre-validation-20260513T092621Z/research-level3-full-organism-runtime

# Drop the validation branch entirely
git branch -D validation/full-organism-capability-benchmark
```

The backup tags themselves are not to be deleted until canonization is approved.

## Rules in force during validation work

1. All benchmark code, artifacts, and docs land on `validation/full-organism-capability-benchmark`.
2. `main` remains pinned at `15a7c47` until the operator explicitly approves a merge after gates pass.
3. No tag/release on top of the validation branch (the only tags added are the protective `backup/pre-validation-*` tags listed above).
4. No deletion of any of the three research branches.
5. No cleanup of research code, no archiving, no doc simplification.
6. No manual `OmegaRegistry.register`, no `theta_s` / `tau_coag` change, no Level 3 claim.
7. Forbidden verdict tokens (must never appear in any benchmark output):
   `LEVEL_3_REACHED`, `OMEGA_CREATED_MANUALLY`, `SYNTHETIC_OMEGA`, `THRESHOLD_LOWERED`,
   `CANONICAL_WITHOUT_BENCHMARK`, `CLEANUP_BEFORE_CANONIZATION`.
8. Cost is reported, not artificially capped. Operator has stated cost ceilings are not
   to be imposed unless they ask for them.

## Verdicts allowed in benchmark output

- `FULL_ORGANISM_CAPABILITY_BENCHMARK_COMPLETE`
- `BYON_OUTPERFORMS_CLAUDE_DIRECT`
- `NO_CLEAR_USER_VALUE_ADVANTAGE`
- `MEMORY_ADVANTAGE_NOT_PROVEN`
- `TRUST_SAFETY_ADVANTAGE_NOT_PROVEN`
- `STRUCTURAL_REFERENCE_ADVANTAGE_NOT_PROVEN`
- `FULL_ORGANISM_INCOMPLETE_MODULES_INACTIVE`
- `REGRESSION_FROM_PREVIOUS_VALIDATED_MODEL`
- `CANONIZATION_APPROVED`
- `CANONIZATION_BLOCKED`
- `FULL_LEVEL3_NOT_DECLARED`
