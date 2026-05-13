# Architecture — Policy-Gated Workflow Engine

## Overview

The policy-gated workflow engine executes multi-step workflows where every
step transition is gated by a configurable policy layer. No step may execute
unless the policy engine explicitly permits it.
