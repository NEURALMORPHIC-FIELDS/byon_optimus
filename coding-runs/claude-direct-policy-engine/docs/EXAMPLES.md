# Worked Examples

All examples use the `workflow` CLI installed via `pip install -e .` from the
repo root.  Workflow files live in `examples/`.

---

## Example 1 — Minimal Workflow (No Gates, No Conditions)

**File**: `examples/minimal.yaml`

```yaml
name: minimal-workflow
version: "1.0"
description: Minimal example with no policy gates.

gates: {}

steps:
  - id: hello
    name: Say Hello
    action: echo.hello
    params:
      message: "Hello, World!"