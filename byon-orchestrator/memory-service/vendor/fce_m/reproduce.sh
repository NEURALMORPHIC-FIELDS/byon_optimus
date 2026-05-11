#!/usr/bin/env bash
# Reproduce the FCE-M (Fragmergent Causal Exponentiation Memory)
# end-to-end run, including the legacy UFME demos preserved from
# v0.3.3 as audit anchors. Expected: 268 passing tests.
#
# Usage: bash reproduce.sh [--no-tests] [--no-demo]
#
# Steps:
#   1. Install the package in editable mode (with dev extras).
#   2. Run the test suite (passthrough + bridges + facade).
#   3. Run the end-to-end demo orchestrator.
#
# Each step prints a UTC timestamp banner. Exit code is non-zero if any step fails.

set -euo pipefail

run_tests=1
run_demo=1
for arg in "$@"; do
    case "$arg" in
        --no-tests) run_tests=0 ;;
        --no-demo)  run_demo=0  ;;
        *) echo "unknown flag: $arg"; exit 2 ;;
    esac
done

banner() {
    printf '\n========================================================\n'
    printf '%s | %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"
    printf '========================================================\n'
}

# Resolve the script directory regardless of invocation cwd.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

banner "PHASE 4 step 1: editable install"
# Pass relative path '.' from the repo root; pip on Windows handles the
# extras suffix [dev] cleanly when path is './'. The set -f disables
# shell glob expansion of the brackets.
( cd "${HERE}" && set -f && python -m pip install -e ".[dev]" )

if [ "$run_tests" -eq 1 ]; then
    banner "PHASE 4 step 2: pytest"
    python -m pytest "${HERE}/tests/" -v --tb=short
fi

if [ "$run_demo" -eq 1 ]; then
    banner "PHASE 4 step 3: end-to-end orchestrator demo (v0.1.0 facade smoke)"
    python -c "
from unified_fragmergent_memory.runtime import run_end_to_end_demo
report = run_end_to_end_demo()
print('OrchestratorReport:')
for key, val in report.__dict__.items():
    print(f'  {key}: {val}')
"
    banner "PHASE 4 step 4: cross-substrate cycle demo (v0.2.0, structural)"
    python -c "
from unified_fragmergent_memory.runtime import run_cross_substrate_demo
report = run_cross_substrate_demo()
print('CrossSubstrateLoopReport:')
print(f'  episodes_run: {report.episodes_run}')
print(f'  n_idempotent_steps: {report.n_idempotent_steps}')
print(f'  n_perturbed_steps: {report.n_perturbed_steps}')
print(f'  n_records_with_pressure: {report.n_records_with_pressure}')
print(f'  final_registry_size: {report.final_registry_size}')
print(f'  final_pressure_origin: {report.final_pressure_origin}')
print('  records:')
for i, r in enumerate(report.cross_substrate_records):
    print(f'    [{i}] ep={r.episode_id} ops={r.consolidation_op_counts} pert={r.tf_perturbations} idempotent={r.triggered_by_idempotent_step} pressure_origin={r.resulting_pressure_origin}')
"
    banner "PHASE 4 step 5: organism-driven synthetic-pressure demo (v0.2.1)"
    python -c "
from unified_fragmergent_memory.runtime import run_organism_driven_demo
result = run_organism_driven_demo()
print(f'cognitive_coupling_confirmed: {result[\"cognitive_coupling_confirmed\"]}')
print(f'n_diffs: {result[\"diff\"][\"n_diffs\"]}')
if result['diff']['details']:
    d = result['diff']['details'][0]
    print(f'first diff at episode_id={d[\"episode_id\"]} input={d[\"input\"]!r}')
    for field, (off, on) in d['fields'].items():
        print(f'  {field}: OFF={off} | ON={on}')
"
    banner "PHASE 4 step 6: natural cross-substrate coupling demo (v0.3.0, marker-level)"
    python -c "
from unified_fragmergent_memory.runtime import run_natural_coupling_demo
result = run_natural_coupling_demo()
print(f'natural_cognitive_coupling_confirmed: {result[\"natural_cognitive_coupling_confirmed\"]}')
print(f'provenance_chain_complete: {result[\"provenance_chain_complete\"]}')
print(f'n_diffs: {result[\"diff\"][\"n_diffs\"]}')
for d in result['diff']['details']:
    print(f'natural diff at episode_id={d[\"episode_id\"]} input={d[\"input\"]!r}')
    for field, (off, on) in d['fields'].items():
        print(f'  {field}: OFF={off} | ON={on}')
"
    banner "PHASE 4 step 7: natural branch-flip demo (v0.3.1)"
    python -c "
from unified_fragmergent_memory.runtime import run_natural_branch_flip_demo
result = run_natural_branch_flip_demo()
print(f'natural_branch_flip_confirmed: {result[\"natural_branch_flip_confirmed\"]}')
print(f'provenance_chain_complete: {result[\"provenance_chain_complete\"]}')
print(f'n_branch_flips: {len(result[\"branch_flip_diffs\"])}')
for d in result['branch_flip_diffs']:
    print(f'branch flip at episode_id={d[\"episode_id\"]} input={d[\"input\"]!r}')
    for field, (off, on) in d['fields'].items():
        print(f'  {field}: OFF={off} | ON={on}')
chain = result['provenance_chain']
if chain is not None:
    print()
    print('provenance_chain (branch-flip):')
    for k, v in chain.to_json_safe().items():
        if isinstance(v, list):
            print(f'  {k}: {v}')
        elif isinstance(v, dict):
            print(f'  {k}: keys={sorted(v.keys())}')
        else:
            print(f'  {k}: {v}')
"
    banner "PHASE 4 step 8: auto-registration demo (v0.3.2)"
    python -c "
from unified_fragmergent_memory.runtime import run_auto_registration_demo
result = run_auto_registration_demo()
print(f'auto_registration_branch_flip_confirmed: {result[\"auto_registration_branch_flip_confirmed\"]}')
print(f'auto_registration_marker_diff_confirmed: {result[\"auto_registration_marker_diff_confirmed\"]}')
print(f'bidirectional_round_trip_verified: {result[\"bidirectional_round_trip_verified\"]}')
print(f'provenance_chain_complete: {result[\"provenance_chain_complete\"]}')
print(f'registry_before: {result[\"registry_before\"]}')
print(f'registry_after:  {result[\"registry_after\"]}')
print('auto_registrations:')
for ar in result['auto_registrations']:
    print(f'  slot=({ar[\"entity_id\"]!r}, {ar[\"attr_type\"]!r}) -> label={ar[\"label\"]} trace={ar[\"organism_trace_id\"]} ep={ar[\"episode_id\"]} auto_id={ar[\"auto_registration_id\"]}')
if result['branch_flip_diffs']:
    d = result['branch_flip_diffs'][0]
    print(f'branch flip at episode_id={d[\"episode_id\"]} input={d[\"input\"]!r}')
    print(f'  arbiter_decision: OFF={d[\"fields\"][\"arbiter_decision\"][0]} | ON={d[\"fields\"][\"arbiter_decision\"][1]}')
"
    banner "PHASE 4 step 9: async cross-substrate demo (v0.3.3)"
    python -c "
from unified_fragmergent_memory.runtime import run_async_coupling_demo
result = run_async_coupling_demo()
print(f'async_branch_flip_confirmed: {result[\"async_branch_flip_confirmed\"]}')
print(f'async_marker_diff_confirmed: {result[\"async_marker_diff_confirmed\"]}')
print(f'n_branch_flips: {len(result[\"branch_flip_diffs\"])}')
print(f'stale_pressure_applied_count: {result[\"stale_pressure_applied_count\"]}')
print(f'wrong_slot_pressure_applied_count: {result[\"wrong_slot_pressure_applied_count\"]}')
print(f'applied_pressures: {len(result[\"applied_pressure_log\"])}')
print(f'expired_pressures: {len(result[\"expired_pressure_log\"])}')
print('applied pressure log:')
for pp in result['applied_pressure_log']:
    print(f'  pressure_id={pp[\"pressure_id\"]} produced_at={pp[\"produced_at_episode\"]} applied_at={pp[\"applied_at_episode\"]} delay={pp[\"delay_steps\"]} target_slots={pp[\"target_slots\"]}')
if result['branch_flip_diffs']:
    d = result['branch_flip_diffs'][0]
    print(f'first branch flip: ep={d[\"episode_id\"]} input={d[\"input\"]!r}')
    for k, (off, on) in d['fields'].items():
        print(f'  {k}: OFF={off} | ON={on}')
"
fi

banner "reproduce.sh complete"
