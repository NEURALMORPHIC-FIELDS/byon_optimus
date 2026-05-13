# Coding Benchmark — Condition B (BYON full organism)

## Phase P1: Initial implementation

- tokens in/out: 11981 / 9225
- cost USD: 0.1743
- files written: 15
    - pyproject.toml (405B)
    - src/policy_engine/__init__.py (35B)
    - src/policy_engine/models.py (1212B)
    - src/policy_engine/loader.py (2045B)
    - src/policy_engine/planner.py (2397B)
    - src/policy_engine/audit.py (1013B)
    - src/policy_engine/permissions.py (1260B)
    - src/policy_engine/rollback.py (1041B)
    - src/policy_engine/engine.py (2283B)
    - src/policy_engine/cli.py (2722B)
    - tests/conftest.py (163B)
    - tests/test_loader.py (1568B)
    - tests/test_engine.py (6555B)
    - examples/deploy_pipeline.yaml (526B)
    - README.md (251B)
- pytest exit: 0
- pytest summary: 20 passed
- recall_facts: 0, recall_conv: 1
- trust_tally: {"SYSTEM_CANONICAL":0,"VERIFIED_PROJECT_FACT":0,"DOMAIN_VERIFIED":0,"USER_PREFERENCE":0,"EXTRACTED_USER_CLAIM":0,"DISPUTED_OR_UNSAFE":0}
- compliance_violations: 0
- fce_present: true

## Phase P2: Add conditional steps

- tokens in/out: 23775 / 14443
- cost USD: 0.2880
- files written: 7
    - src/policy_engine/models.py (1876B)
    - src/policy_engine/loader.py (3725B)
    - src/policy_engine/engine.py (3961B)
    - src/policy_engine/planner.py (2690B)
    - tests/test_engine.py (16863B)
    - examples/deploy_pipeline.yaml (933B)
    - README.md (251B)
- pytest exit: 0
- pytest summary: 31 passed
- recall_facts: 3, recall_conv: 4
- trust_tally: {"SYSTEM_CANONICAL":2,"VERIFIED_PROJECT_FACT":1,"DOMAIN_VERIFIED":0,"USER_PREFERENCE":0,"EXTRACTED_USER_CLAIM":0,"DISPUTED_OR_UNSAFE":0}
- compliance_violations: 0
- fce_present: true

## Phase P3: Adversarial requirement

- tokens in/out: 13038 / 11426
- cost USD: 0.2105
- files written: 5
    - src/policy_engine/loader.py (6462B)
    - src/policy_engine/engine.py (5819B)
    - src/policy_engine/cli.py (4283B)
    - tests/test_policy_bypass.py (14780B)
    - README.md (251B)
- pytest exit: 0
- pytest summary: 58 passed
- recall_facts: 0, recall_conv: 4
- trust_tally: {"SYSTEM_CANONICAL":0,"VERIFIED_PROJECT_FACT":0,"DOMAIN_VERIFIED":0,"USER_PREFERENCE":0,"EXTRACTED_USER_CLAIM":0,"DISPUTED_OR_UNSAFE":0}
- compliance_violations: 0
- fce_present: true

## Phase P4: Refactor — plan/execute separation

- tokens in/out: 41781 / 17598
- cost USD: 0.3893
- files written: 4
    - src/policy_engine/models.py (3699B)
    - src/policy_engine/planner.py (10850B)
    - src/policy_engine/cli.py (5803B)
    - tests/test_plan.py (21756B)
- pytest exit: 0
- pytest summary: 102 passed
- recall_facts: 5, recall_conv: 5
- trust_tally: {"SYSTEM_CANONICAL":4,"VERIFIED_PROJECT_FACT":1,"DOMAIN_VERIFIED":0,"USER_PREFERENCE":0,"EXTRACTED_USER_CLAIM":0,"DISPUTED_OR_UNSAFE":0}
- compliance_violations: 0
- fce_present: true

## Phase P5: Debugging — skipped-step regression

- tokens in/out: 49507 / 14971
- cost USD: 0.3731
- files written: 3
    - src/policy_engine/engine.py (5443B)
    - src/policy_engine/planner.py (12256B)
    - tests/test_skipped_step_regression.py (14802B)
- pytest exit: 0
- pytest summary: 112 passed
- recall_facts: 2, recall_conv: 5
- trust_tally: {"SYSTEM_CANONICAL":2,"VERIFIED_PROJECT_FACT":0,"DOMAIN_VERIFIED":0,"USER_PREFERENCE":0,"EXTRACTED_USER_CLAIM":0,"DISPUTED_OR_UNSAFE":0}
- compliance_violations: 0
- fce_present: true

## Phase P6: Final hardening for handoff

- tokens in/out: 26042 / 12000
- cost USD: 0.2581
- files written: 7
    - tests/test_skipped_step_regression.py (13991B)
    - docs/ARCHITECTURE.md (287B)
    - docs/SECURITY.md (367B)
    - docs/LIMITATIONS.md (3253B)
    - docs/EXAMPLES.md (518B)
    - CHANGELOG.md (5422B)
    - README.md (247B)
- pytest exit: 0
- pytest summary: 114 passed
- recall_facts: 4, recall_conv: 5
- trust_tally: {"SYSTEM_CANONICAL":1,"VERIFIED_PROJECT_FACT":2,"DOMAIN_VERIFIED":0,"USER_PREFERENCE":0,"EXTRACTED_USER_CLAIM":0,"DISPUTED_OR_UNSAFE":1}
- compliance_violations: 0
- fce_present: true
