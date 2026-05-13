# Examples

## Example 1: Simple Dev Build

A two-step workflow that builds and tests in a `dev` environment.
Both steps require the `dev-gate`, satisfied by the `developer` role.

**File: `examples/simple_build.yaml`**

```yaml
name: simple-build
steps:
  - name: build
    action: build_image
    environment: dev
    policy_gates: [dev-gate]
    params:
      image: myapp:latest

  - name: unit-tests
    action: run_tests
    environment: dev
    depends_on: [build]
    policy_gates: [dev-gate]