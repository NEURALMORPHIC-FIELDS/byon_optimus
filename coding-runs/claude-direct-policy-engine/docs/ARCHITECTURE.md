# Architecture

## Overview

`policy-gated-workflow-engine` is a **pure-Python, simulation-only** workflow
engine.  It loads workflow definitions from YAML or JSON, plans and executes
the steps in dependency order, enforces policy gates, and records every
decision in an append-only audit log.  No real deployment, network, or shell
command is ever issued.
