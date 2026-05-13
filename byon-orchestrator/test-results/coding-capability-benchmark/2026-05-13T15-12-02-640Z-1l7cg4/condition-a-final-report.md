# Coding Benchmark — Condition A (Claude direct)

## Phase P1: Initial implementation

- tokens in/out: 1068 / 10699
- cost USD: 0.1637
- files written: 15
    - pyproject.toml (460B)
    - src/policy_engine/__init__.py (35B)
    - src/policy_engine/models.py (1105B)
    - src/policy_engine/loader.py (3738B)
    - src/policy_engine/audit.py (1116B)
    - src/policy_engine/policy.py (1944B)
    - src/policy_engine/engine.py (6255B)
    - src/policy_engine/cli.py (3650B)
    - tests/conftest.py (98B)
    - tests/test_loader.py (3326B)
    - tests/test_engine.py (7528B)
    - tests/test_audit_persistence.py (834B)
    - examples/ci_pipeline.yaml (880B)
    - examples/production_deploy.yaml (552B)
    - README.md (209B)
- pytest exit: 1
- pytest summary: 1 failed, 24 passed

## Phase P2: Add conditional steps

- tokens in/out: 11992 / 12000
- cost USD: 0.2160
- files written: 8
    - src/policy_engine/conditions.py (5590B)
    - src/policy_engine/models.py (1338B)
    - src/policy_engine/loader.py (4459B)
    - src/policy_engine/engine.py (10232B)
    - src/policy_engine/cli.py (5065B)
    - tests/conftest.py (98B)
    - tests/test_conditions.py (6374B)
    - tests/test_engine.py (8781B)
- pytest exit: 2
- pytest summary: 1 error, 1 error

## Phase P3: Adversarial requirement

- tokens in/out: 24315 / 12000
- cost USD: 0.2529
- files written: 7
    - src/policy_engine/loader.py (6391B)
    - src/policy_engine/policy.py (4179B)
    - src/policy_engine/engine.py (9395B)
    - src/policy_engine/cli.py (6544B)
    - tests/conftest.py (98B)
    - tests/test_policy_bypass_rejection.py (15396B)
    - tests/test_loader.py (853B)
- pytest exit: 2
- pytest summary: 2 errors, 2 errors

## Phase P4: Refactor — plan/execute separation

- tokens in/out: 36499 / 12000
- cost USD: 0.2895
- files written: 5
    - src/policy_engine/planner.py (22243B)
    - src/policy_engine/engine.py (11603B)
    - src/policy_engine/cli.py (9668B)
    - tests/conftest.py (98B)
    - tests/test_planner.py (1272B)
- pytest exit: 2
- pytest summary: 3 errors, 3 errors

## Phase P5: Debugging — skipped-step regression

- tokens in/out: 48656 / 12000
- cost USD: 0.3260
- files written: 3
    - src/policy_engine/engine.py (14382B)
    - tests/test_regression_skipped_unblocks_dependents.py (17445B)
    - src/policy_engine/planner.py (7324B)
- pytest exit: 2
- pytest summary: 4 errors, 4 errors

## Phase P6: Final hardening for handoff

- tokens in/out: 60893 / 12000
- cost USD: 0.3627
- files written: 8
    - CHANGELOG.md (5655B)
    - docs/ARCHITECTURE.md (357B)
    - docs/SECURITY.md (2179B)
    - docs/LIMITATIONS.md (4128B)
    - docs/EXAMPLES.md (902B)
    - examples/conditional_deploy.yaml (675B)
    - examples/failure_and_rollback.yaml (545B)
    - README.md (705B)
- pytest exit: 2
- pytest summary: 4 errors, 4 errors
