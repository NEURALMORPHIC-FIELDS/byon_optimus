# Policy-Gated Workflow Engine

A pure-Python workflow engine with **policy gates**, **append-only audit
logging**, **conditional steps**, and **execution planning**.  All step
execution is **simulated** — no real network, shell, or deployment calls are
made.

---

## Run All Tests

```bash
pip install -e ".[dev]"   # or: pip install -e . && pip install pytest pyyaml
pytest