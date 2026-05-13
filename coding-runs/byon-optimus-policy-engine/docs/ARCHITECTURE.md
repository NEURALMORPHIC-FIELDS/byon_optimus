# Architecture

## Overview

`policy-gated-workflow-engine` is a pure-Python library and CLI tool that
executes DAG-structured workflows while enforcing policy gates at every step.
All side effects are **simulated** — no real deployments, file writes, or
network calls occur during execution.
