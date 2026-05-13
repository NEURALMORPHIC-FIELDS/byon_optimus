# Architecture

## Overview

`policy-gated-workflow-engine` is a pure-Python library and CLI that loads
workflow definitions, validates them, plans their execution, enforces policy
gates, and records every decision to an append-only audit log.  All step
execution is **simulated** — no real network calls, shell commands, or
deployments are performed.

---

## Layer diagram
