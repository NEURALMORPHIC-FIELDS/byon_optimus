# Security

## Threat Model

### Assets

| Asset | Why it matters |
|---|---|
| Policy gate decisions | Determines whether a step runs; must not be controllable by workflow config |
| Audit log | Provides the tamper-evident record of every gate decision and override |
| Production approval | Requires an explicit operator-controlled role grant |

### Trust Boundary
