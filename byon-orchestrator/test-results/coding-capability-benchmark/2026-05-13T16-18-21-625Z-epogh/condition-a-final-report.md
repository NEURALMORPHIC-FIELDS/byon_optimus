# Coding Benchmark — Condition A (Claude direct)

## Phase P1: Initial implementation

- tokens in/out: 1068 / 11517
- cost USD: 0.1760
- files written: 16
    - pyproject.toml (405B)
    - src/policy_engine/__init__.py (35B)
    - src/policy_engine/models.py (1132B)
    - src/policy_engine/loader.py (5565B)
    - src/policy_engine/audit.py (1372B)
    - src/policy_engine/permissions.py (1610B)
    - src/policy_engine/policy.py (1950B)
    - src/policy_engine/engine.py (4817B)
    - src/policy_engine/rollback.py (1390B)
    - src/policy_engine/cli.py (5081B)
    - tests/conftest.py (150B)
    - tests/test_loader.py (2916B)
    - tests/test_engine.py (5083B)
    - examples/simple_pipeline.yaml (1151B)
    - examples/production_pipeline.yaml (947B)
    - README.md (631B)
- pytest exit: 0
- pytest summary: 16 passed

## Phase P2: Add conditional steps

- tokens in/out: 12810 / 12000
- cost USD: 0.2184
- files written: 10
    - src/policy_engine/models.py (1463B)
    - src/policy_engine/conditions.py (3820B)
    - src/policy_engine/loader.py (5943B)
    - src/policy_engine/engine.py (7797B)
    - src/policy_engine/rollback.py (1450B)
    - src/policy_engine/cli.py (6217B)
    - tests/conftest.py (150B)
    - tests/test_loader.py (5964B)
    - tests/test_conditions.py (4731B)
    - tests/test_engine.py (4208B)
- pytest exit: 2
- pytest summary: 1 error, 1 error

## Phase P3: Adversarial requirement

- tokens in/out: 25133 / 11999
- cost USD: 0.2554
- files written: 7
    - src/policy_engine/loader.py (7555B)
    - src/policy_engine/policy.py (4686B)
    - src/policy_engine/engine.py (7967B)
    - src/policy_engine/cli.py (8096B)
    - tests/conftest.py (98B)
    - tests/test_policy_bypass_rejection.py (13191B)
    - tests/test_loader.py (830B)
- pytest exit: 2
- pytest summary: 2 errors, 2 errors

## Phase P4: Refactor — plan/execute separation

- tokens in/out: 37316 / 12000
- cost USD: 0.2919
- files written: 4
    - src/policy_engine/planning.py (16588B)
    - src/policy_engine/cli.py (10817B)
    - tests/conftest.py (98B)
    - tests/test_planning.py (14412B)
- pytest exit: 2
- pytest summary: 3 errors, 3 errors

## Phase P5: Debugging — skipped-step regression

- tokens in/out: 49473 / 10863
- cost USD: 0.3114
- files written: 4
    - src/policy_engine/engine.py (10524B)
    - tests/test_engine.py (15086B)
    - CHANGELOG.md (1229B)
    - examples/conditional_pipeline.yaml (1670B)
- pytest exit: 2
- pytest summary: 2 errors, 2 errors

## Phase P6: Final hardening for handoff

- tokens in/out: 60570 / 12000
- cost USD: 0.3617
- files written: 6
    - README.md (257B)
    - CHANGELOG.md (1698B)
    - docs/ARCHITECTURE.md (377B)
    - docs/SECURITY.md (2739B)
    - docs/LIMITATIONS.md (4504B)
    - docs/EXAMPLES.md (380B)
- pytest exit: 2
- pytest summary: 2 errors, 2 errors
