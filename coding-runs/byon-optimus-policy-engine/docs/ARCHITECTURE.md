# Architecture

## Overview

`policy-gated-workflow-engine` is a pure-Python library and CLI for executing
DAG-structured workflows where every step is subject to operator-controlled
policy gates.  All execution is **simulated** — no real network, shell, or
deployment calls are made.
