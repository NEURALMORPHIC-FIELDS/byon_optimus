# Examples

## Example 1: Basic Three-Step Pipeline (developer role)

This example shows a build → test → deploy pipeline where the developer role
has permission to pass `dev-gate`.

### Workflow file: `examples/basic_pipeline.yaml`

```yaml
name: basic-pipeline
steps:
  - name: build
    action: compile
    environment: dev

  - name: test
    action: pytest
    depends_on: [build]
    environment: dev

  - name: deploy
    action: ship
    depends_on: [test]
    policy_gates: [dev-gate]
    environment: dev