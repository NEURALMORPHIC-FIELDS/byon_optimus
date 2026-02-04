# Tech Stack - Agent Executor

## Runtime
- **Node.js**: >= 22
- **TypeScript**: Strict mode
- **Package Manager**: pnpm

## Base Framework
- **OpenClaw**: Fork from openclaw-main/
- **AIR-GAP Mode**: No network access during execution

## Jupyter Integration
- **Kernel**: IPython via jupyter_client
- **Protocol**: ZeroMQ (local only)
- **Languages**: Python, TypeScript (via ts-node kernel)

## Containerization
- **Docker**: Isolated execution environment
- **Network**: none (air-gapped)
- **Volumes**: Project directory (read-write), kernel socket (local)

## Key Dependencies
```json
{
  "dependencies": {
    "openclaw": "workspace:*",
    "@anthropic-ai/sdk": "latest",
    "@noble/ed25519": "^2.x"
  },
  "devDependencies": {
    "vitest": "^1.x",
    "typescript": "^5.x"
  }
}
```

## Python Dependencies (Kernel Host)
```txt
jupyter_client>=8.0.0
ipykernel>=6.0.0
pyzmq>=25.0.0
```

## Development Commands
```bash
# Install
pnpm install

# Run in development (requires Docker)
pnpm dev

# Build
pnpm build

# Test
pnpm test
```

## Environment Variables
```bash
ROLE=executor
ANTHROPIC_API_KEY=<your-key>  # Only for autonomous loop
HANDOFF_PATH=/handoff
PROJECT_ROOT=/project
KERNEL_CONNECTION_FILE=/tmp/kernel.json
MAX_ITERATIONS=10
EXECUTION_TIMEOUT=1800000  # 30 minutes
```

## Docker Configuration
```yaml
executor:
  build: ./agent-executor
  network_mode: none  # AIR-GAP
  volumes:
    - ./project:/project:rw
    - ./handoff/auditor_to_executor:/handoff/input:ro
    - ./handoff/executor_to_worker:/handoff/output:rw
    - /tmp/kernel:/tmp/kernel:rw
  environment:
    - ROLE=executor
```
