# Worked Examples

Three complete examples showing the engine's behaviour end to end.

---

## Example 1 — Simple CI pipeline (developer role)

**Workflow file:** `examples/simple_pipeline.yaml`

This pipeline runs lint → test → build → deploy-staging → notify.
`deploy-staging` requires the `staging-gate`, which a `developer` role does
not hold.

### Step 1: validate
