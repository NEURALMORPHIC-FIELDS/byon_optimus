# Examples — Policy-Gated Workflow Engine

Three worked examples, from simple to complex.

---

## Example 1 — Linear Build-Test-Deploy Pipeline

### Workflow file (`examples/linear_pipeline.yaml`)

```yaml
name: linear_pipeline
steps:
  - name: build
    handler: shell_build

  - name: test
    handler: shell_test
    depends_on: [build]

  - name: deploy
    handler: shell_deploy
    depends_on: [test]