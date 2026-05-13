# Worked Examples

All examples use the `workflow` CLI installed via `pip install -e .`.
Workflow files are in the `examples/` directory.

---

## Example 1 — Basic CI Pipeline (all steps succeed)

**File**: `examples/ci_pipeline.yaml`

```yaml
id: ci_pipeline
name: CI/CD Pipeline Example
steps:
  - id: build
    name: Build Application
    action: build

  - id: unit_tests
    name: Run Unit Tests
    action: test
    depends_on: [build]
    policy_gate: test_gate

  - id: staging_deploy
    name: Deploy to Staging
    action: deploy
    depends_on: [unit_tests]
    environment: staging
    policy_gate: deploy_gate

  - id: db_migrate
    name: Database Migration
    action: migrate
    depends_on: [staging_deploy]
    environment: staging
    policy_gate: migrate_gate

  - id: notify_team
    name: Notify Team
    action: notify
    depends_on: [db_migrate]
    policy_gate: notify_gate