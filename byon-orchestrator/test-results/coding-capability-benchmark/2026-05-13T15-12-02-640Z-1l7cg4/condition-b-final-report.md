# Coding Benchmark — Condition B (BYON full organism)

## Phase P1: Initial implementation

- tokens in/out: 1646 / 8786
- cost USD: 0.1367
- files written: 15
    - pyproject.toml (405B)
    - src/policy_engine/__init__.py (57B)
    - src/policy_engine/models.py (456B)
    - src/policy_engine/loader.py (3794B)
    - src/policy_engine/policy.py (1950B)
    - src/policy_engine/audit.py (1433B)
    - src/policy_engine/rollback.py (947B)
    - src/policy_engine/engine.py (4159B)
    - src/policy_engine/cli.py (3409B)
    - tests/conftest.py (98B)
    - tests/test_loader.py (3166B)
    - tests/test_engine.py (5774B)
    - examples/ci_pipeline.yaml (273B)
    - examples/production_deploy.yaml (486B)
    - README.md (165B)
- pytest exit: 0
- pytest summary: 20 passed
- recall_facts: 2, recall_conv: 1
- trust_tally: {"SYSTEM_CANONICAL":2,"VERIFIED_PROJECT_FACT":0,"DOMAIN_VERIFIED":0,"USER_PREFERENCE":0,"EXTRACTED_USER_CLAIM":0,"DISPUTED_OR_UNSAFE":0}
- compliance_violations: 0
- fce_present: true

## Phase P2: Add conditional steps

- tokens in/out: 1581 / 12000
- cost USD: 0.1847
- files written: 12
    - src/policy_engine/conditions.py (2877B)
    - src/policy_engine/models.py (1935B)
    - src/policy_engine/engine.py (8900B)
    - src/policy_engine/loader.py (4866B)
    - src/policy_engine/audit.py (1432B)
    - src/policy_engine/policy.py (1411B)
    - src/policy_engine/__init__.py (718B)
    - tests/test_conditions.py (4291B)
    - tests/test_engine_conditions.py (11741B)
    - tests/test_loader_conditions.py (2833B)
    - examples/conditional_workflow.yaml (916B)
    - examples/run_conditional.py (1266B)
- pytest exit: 2
- pytest summary: 2 errors, 2 errors
- recall_facts: 5, recall_conv: 3
- trust_tally: {"SYSTEM_CANONICAL":5,"VERIFIED_PROJECT_FACT":0,"DOMAIN_VERIFIED":0,"USER_PREFERENCE":0,"EXTRACTED_USER_CLAIM":0,"DISPUTED_OR_UNSAFE":0}
- compliance_violations: 0
- fce_present: true

## Phase P3: Adversarial requirement

- tokens in/out: 1752 / 11999
- cost USD: 0.1852
- files written: 11
    - src/policy_engine/loader.py (3811B)
    - src/policy_engine/policy.py (7203B)
    - src/policy_engine/models.py (1998B)
    - src/policy_engine/audit.py (1711B)
    - src/policy_engine/conditions.py (1576B)
    - src/policy_engine/engine.py (8603B)
    - src/policy_engine/cli.py (2544B)
    - src/policy_engine/__init__.py (683B)
    - tests/test_policy_bypass_rejected.py (7060B)
    - tests/test_policy_permissive_mode.py (5656B)
    - tests/test_engine.py (4604B)
- pytest exit: 2
- pytest summary: 4 errors, 4 errors
- recall_facts: 3, recall_conv: 4
- trust_tally: {"SYSTEM_CANONICAL":3,"VERIFIED_PROJECT_FACT":0,"DOMAIN_VERIFIED":0,"USER_PREFERENCE":0,"EXTRACTED_USER_CLAIM":0,"DISPUTED_OR_UNSAFE":0}
- compliance_violations: 0
- fce_present: true

## Phase P4: Refactor — plan/execute separation

- tokens in/out: 1720 / 12000
- cost USD: 0.1852
- files written: 10
    - src/policy_engine/execution_plan.py (6872B)
    - src/policy_engine/planner.py (3953B)
    - src/policy_engine/workflow.py (4456B)
    - src/policy_engine/conditions.py (3748B)
    - src/policy_engine/policies.py (3523B)
    - src/policy_engine/engine.py (7499B)
    - src/policy_engine/audit.py (1199B)
    - src/policy_engine/cli.py (6228B)
    - src/policy_engine/__init__.py (1586B)
    - tests/test_execution_plan.py (5538B)
- pytest exit: 2
- pytest summary: 6 errors, 6 errors
- recall_facts: 5, recall_conv: 5
- trust_tally: {"SYSTEM_CANONICAL":4,"VERIFIED_PROJECT_FACT":1,"DOMAIN_VERIFIED":0,"USER_PREFERENCE":0,"EXTRACTED_USER_CLAIM":0,"DISPUTED_OR_UNSAFE":0}
- compliance_violations: 0
- fce_present: true

## Phase P5: Debugging — skipped-step regression

- tokens in/out: 1661 / 8232
- cost USD: 0.1285
- files written: 5
    - src/policy_engine/executor.py (10416B)
    - src/policy_engine/loader.py (4633B)
    - src/policy_engine/policy.py (1748B)
    - tests/test_skipped_step_regression.py (7765B)
    - CHANGELOG.md (743B)
- pytest exit: 2
- pytest summary: 9 errors, 9 errors
- recall_facts: 4, recall_conv: 5
- trust_tally: {"SYSTEM_CANONICAL":3,"VERIFIED_PROJECT_FACT":1,"DOMAIN_VERIFIED":0,"USER_PREFERENCE":0,"EXTRACTED_USER_CLAIM":0,"DISPUTED_OR_UNSAFE":0}
- compliance_violations: 1
- fce_present: true

## Phase P6: Final hardening for handoff

- tokens in/out: 1768 / 11715
- cost USD: 0.1810
- files written: 8
    - docs/ARCHITECTURE.md (262B)
    - docs/SECURITY.md (4707B)
    - docs/LIMITATIONS.md (3563B)
    - docs/EXAMPLES.md (411B)
    - CHANGELOG.md (3000B)
    - README.md (310B)
    - policy_engine/loader.py (7676B)
    - tests/test_invariants.py (8596B)
- pytest exit: 2
- pytest summary: 10 errors, 10 errors
- recall_facts: 5, recall_conv: 5
- trust_tally: {"SYSTEM_CANONICAL":3,"VERIFIED_PROJECT_FACT":2,"DOMAIN_VERIFIED":0,"USER_PREFERENCE":0,"EXTRACTED_USER_CLAIM":0,"DISPUTED_OR_UNSAFE":0}
- compliance_violations: 0
- fce_present: true
