# Coding Benchmark — Condition B (BYON full organism)

## Phase P1: Initial implementation

- tokens in/out: 1697 / 8005
- cost USD: 0.1252
- files written: 15
    - pyproject.toml (405B)
    - src/policy_engine/__init__.py (35B)
    - src/policy_engine/models.py (1161B)
    - src/policy_engine/loader.py (2050B)
    - src/policy_engine/planner.py (2145B)
    - src/policy_engine/audit.py (1562B)
    - src/policy_engine/permissions.py (1274B)
    - src/policy_engine/rollback.py (925B)
    - src/policy_engine/engine.py (2807B)
    - src/policy_engine/cli.py (2879B)
    - tests/conftest.py (98B)
    - tests/test_loader.py (1743B)
    - tests/test_engine.py (6194B)
    - examples/deploy_pipeline.yaml (747B)
    - README.md (217B)
- pytest exit: 0
- pytest summary: 18 passed
- recall_facts: 2, recall_conv: 1
- trust_tally: {"SYSTEM_CANONICAL":2,"VERIFIED_PROJECT_FACT":0,"DOMAIN_VERIFIED":0,"USER_PREFERENCE":0,"EXTRACTED_USER_CLAIM":0,"DISPUTED_OR_UNSAFE":0}
- compliance_violations: 0
- fce_present: true

## Phase P2: Add conditional steps

- tokens in/out: 10266 / 9098
- cost USD: 0.1673
- files written: 7
    - src/policy_engine/models.py (1612B)
    - src/policy_engine/conditions.py (1150B)
    - src/policy_engine/loader.py (3705B)
    - src/policy_engine/engine.py (6308B)
    - tests/test_conditions.py (13869B)
    - examples/deploy_pipeline.yaml (963B)
    - README.md (217B)
- pytest exit: 0
- pytest summary: 41 passed
- recall_facts: 4, recall_conv: 3
- trust_tally: {"SYSTEM_CANONICAL":3,"VERIFIED_PROJECT_FACT":1,"DOMAIN_VERIFIED":0,"USER_PREFERENCE":0,"EXTRACTED_USER_CLAIM":0,"DISPUTED_OR_UNSAFE":0}
- compliance_violations: 0
- fce_present: true

## Phase P3: Adversarial requirement

- tokens in/out: 14067 / 12000
- cost USD: 0.2222
- files written: 6
    - src/policy_engine/loader.py (7257B)
    - src/policy_engine/policy_mode.py (1647B)
    - src/policy_engine/engine.py (8388B)
    - src/policy_engine/cli.py (5380B)
    - tests/test_policy_bypass.py (14999B)
    - tests/test_engine.py (2674B)
- pytest exit: 2
- pytest summary: 1 error, 1 error
- recall_facts: 1, recall_conv: 4
- trust_tally: {"SYSTEM_CANONICAL":1,"VERIFIED_PROJECT_FACT":0,"DOMAIN_VERIFIED":0,"USER_PREFERENCE":0,"EXTRACTED_USER_CLAIM":0,"DISPUTED_OR_UNSAFE":0}
- compliance_violations: 0
- fce_present: true

## Phase P4: Refactor — plan/execute separation

- tokens in/out: 17144 / 11838
- cost USD: 0.2290
- files written: 5
    - src/policy_engine/planner.py (4025B)
    - src/policy_engine/cli.py (6349B)
    - tests/test_engine.py (10162B)
    - tests/test_plan.py (10528B)
    - README.md (217B)
- pytest exit: 1
- pytest summary: 4 failed, 98 passed
- recall_facts: 5, recall_conv: 5
- trust_tally: {"SYSTEM_CANONICAL":4,"VERIFIED_PROJECT_FACT":1,"DOMAIN_VERIFIED":0,"USER_PREFERENCE":0,"EXTRACTED_USER_CLAIM":0,"DISPUTED_OR_UNSAFE":0}
- compliance_violations: 0
- fce_present: true

## Phase P5: Debugging — skipped-step regression

- tokens in/out: 22024 / 12000
- cost USD: 0.2461
- files written: 5
    - src/policy_engine/engine.py (7862B)
    - src/policy_engine/planner.py (4293B)
    - tests/test_plan.py (8477B)
    - tests/test_conditions.py (11816B)
    - CHANGELOG.md (1570B)
- pytest exit: 1
- pytest summary: 8 failed, 84 passed
- recall_facts: 3, recall_conv: 5
- trust_tally: {"SYSTEM_CANONICAL":3,"VERIFIED_PROJECT_FACT":0,"DOMAIN_VERIFIED":0,"USER_PREFERENCE":0,"EXTRACTED_USER_CLAIM":0,"DISPUTED_OR_UNSAFE":0}
- compliance_violations: 0
- fce_present: true

## Phase P6: Final hardening for handoff

- tokens in/out: 23087 / 12000
- cost USD: 0.2493
- files written: 9
    - src/policy_engine/cli.py (6521B)
    - pyproject.toml (411B)
    - tests/test_plan.py (9399B)
    - docs/ARCHITECTURE.md (295B)
    - docs/SECURITY.md (1783B)
    - docs/LIMITATIONS.md (2713B)
    - docs/EXAMPLES.md (500B)
    - README.md (245B)
    - CHANGELOG.md (925B)
- pytest exit: 1
- pytest summary: 2 failed, 93 passed
- recall_facts: 4, recall_conv: 5
- trust_tally: {"SYSTEM_CANONICAL":1,"VERIFIED_PROJECT_FACT":2,"DOMAIN_VERIFIED":0,"USER_PREFERENCE":0,"EXTRACTED_USER_CLAIM":0,"DISPUTED_OR_UNSAFE":1}
- compliance_violations: 0
- fce_present: true
