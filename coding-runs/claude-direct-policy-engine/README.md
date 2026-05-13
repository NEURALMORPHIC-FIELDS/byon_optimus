# policy-gated-workflow-engine

A pure-Python, simulation-only workflow engine with:

- **DAG execution** — steps run in dependency order.
- **Policy gates** — roles control which gates may be passed.
- **Conditional steps** — steps skipped when a condition is false.
- **Execution planning** — preview what *would* happen before running.
- **Append-only audit log** — every decision is recorded, nothing erased.
- **Rollback** — undo successful steps in reverse order (simulated).

No real deployment, network call, or shell command is ever issued.
See [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) for the full scope boundary.

---

## Run All Tests

```bash
pip install -e ".[dev]"
pytest -v