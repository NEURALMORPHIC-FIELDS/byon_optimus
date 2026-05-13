# Coding Benchmark — Condition A (Claude direct)

## Phase P1: Initial implementation

- tokens in/out: 1068 / 12000
- cost USD: 0.1832
- files written: 17
    - pyproject.toml (460B)
    - src/policy_engine/__init__.py (57B)
    - src/policy_engine/models.py (1114B)
    - src/policy_engine/loader.py (5695B)
    - src/policy_engine/audit.py (1620B)
    - src/policy_engine/permissions.py (2490B)
    - src/policy_engine/engine.py (5792B)
    - src/policy_engine/rollback.py (523B)
    - src/policy_engine/cli.py (5181B)
    - tests/conftest.py (167B)
    - tests/test_loader.py (4646B)
    - tests/test_engine.py (7876B)
    - tests/test_audit.py (1555B)
    - tests/test_permissions.py (1020B)
    - examples/simple_pipeline.yaml (1155B)
    - examples/minimal.yaml (207B)
    - README.md (634B)
- pytest exit: 0
- pytest summary: 25 passed

## Phase P2: Add conditional steps

- tokens in/out: 13296 / 12000
- cost USD: 0.2199
- files written: 9
    - src/policy_engine/conditions.py (5787B)
    - src/policy_engine/models.py (1294B)
    - src/policy_engine/loader.py (5689B)
    - src/policy_engine/engine.py (6901B)
    - src/policy_engine/cli.py (6779B)
    - tests/conftest.py (98B)
    - tests/test_conditions.py (5795B)
    - tests/test_engine_conditions.py (9398B)
    - tests/test_loader.py (292B)
- pytest exit: 0
- pytest summary: 60 passed

## Phase P3: Adversarial requirement

- tokens in/out: 25619 / 12000
- cost USD: 0.2569
- files written: 7
    - src/policy_engine/loader.py (7783B)
    - src/policy_engine/policy_mode.py (2653B)
    - src/policy_engine/engine.py (8273B)
    - src/policy_engine/cli.py (7534B)
    - tests/conftest.py (1949B)
    - tests/test_policy_bypass_rejection.py (15198B)
    - tests/test_loader.py (246B)
- pytest exit: 2
- pytest summary: 1 error, 1 error

## Phase P4: Refactor — plan/execute separation

- tokens in/out: 37803 / 12000
- cost USD: 0.2934
- files written: 9
    - src/policy_engine/planner.py (9505B)
    - src/policy_engine/plan_validator.py (6393B)
    - src/policy_engine/plan_renderer.py (4623B)
    - src/policy_engine/engine.py (7383B)
    - src/policy_engine/topology.py (1101B)
    - src/policy_engine/cli.py (9989B)
    - src/policy_engine/__init__.py (767B)
    - tests/conftest.py (3014B)
    - tests/test_planner.py (705B)
- pytest exit: 2
- pytest summary: 2 errors, 2 errors

## Phase P5: Debugging — skipped-step regression

- tokens in/out: 49960 / 12000
- cost USD: 0.3299
- files written: 3
    - src/policy_engine/engine.py (9856B)
    - src/policy_engine/planner.py (9586B)
    - tests/test_skip_propagation_regression.py (10285B)
- pytest exit: 2
- pytest summary: 3 errors, 3 errors

## Phase P6: Final hardening for handoff

- tokens in/out: 62197 / 12000
- cost USD: 0.3666
- files written: 7
    - docs/ARCHITECTURE.md (348B)
    - docs/SECURITY.md (1229B)
    - docs/LIMITATIONS.md (4899B)
    - docs/EXAMPLES.md (462B)
    - examples/conditional_pipeline.yaml (1066B)
    - CHANGELOG.md (1838B)
    - README.md (378B)
- pytest exit: 2
- pytest summary: 3 errors, 3 errors
