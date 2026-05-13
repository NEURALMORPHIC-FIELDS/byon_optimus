# Architecture

## Overview

`policy-gated-workflow-engine` is a pure-Python, simulation-only workflow
runner.  Its central design principle is that **policy enforcement is
structurally impossible to disable from untrusted input**.  The engine never
touches the network, filesystem (beyond YAML/JSON loading and audit JSONL
writing), or any shell.
