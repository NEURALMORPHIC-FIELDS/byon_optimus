# Tech Stack - Agent Auditor

## Runtime
- **Node.js**: >= 22
- **TypeScript**: Strict mode
- **Package Manager**: pnpm

## Base Framework
- **OpenClaw**: Fork from openclaw-main/
- No direct channel access (receives from Worker)

## Security Libraries
- **Ed25519**: tweetnacl or @noble/ed25519
- **Hash**: SHA-256 native crypto
- **JSON Schema**: ajv for validation

## Key Dependencies
```json
{
  "dependencies": {
    "openclaw": "workspace:*",
    "@anthropic-ai/sdk": "latest",
    "ajv": "^8.x",
    "@noble/ed25519": "^2.x"
  }
}
```

## Development Commands
```bash
# Install
pnpm install

# Run in development
pnpm dev

# Build
pnpm build

# Test
pnpm test
```

## Environment Variables
```bash
ROLE=auditor
ANTHROPIC_API_KEY=<your-key>
HANDOFF_PATH=/handoff
USER_APPROVAL_ENDPOINT=<webhook-url>
```
