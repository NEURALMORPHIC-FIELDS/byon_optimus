# Policy-Gated Workflow Engine

A Python workflow engine where every step transition is gated by a
configurable, code-defined policy layer. Workflow configuration files
(YAML/JSON) are **untrusted input** — they can never disable or weaken
policy enforcement.

---

## Run all tests

```bash
pytest tests/ -v