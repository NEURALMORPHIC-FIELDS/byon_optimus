# Tech Stack - Agent Worker

## Runtime
- **Node.js**: >= 22
- **TypeScript**: Strict mode
- **Package Manager**: pnpm

## Base Framework
- **OpenClaw**: Fork from openclaw-main/
- Channels: WhatsApp, Telegram, Discord, WebChat

## Memory System
- **FHRSS**: Fractal-Holographic Redundant Storage System
- **FCPE**: Fractal-Chaotic Persistent Encoding
- **Embedding Model**: MiniLM (sentence-transformers)

## Codebase Indexing
- **AST Parser**: TypeScript Compiler API, Python ast module
- **Symbol Extraction**: Functions, classes, imports
- **Dependency Graph**: Who imports whom

## Key Dependencies
```json
{
  "dependencies": {
    "openclaw": "workspace:*",
    "@anthropic-ai/sdk": "latest",
    "sentence-transformers": "via Python bridge"
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
ROLE=worker
ANTHROPIC_API_KEY=<your-key>
MEMORY_STORE_PATH=/memory
HANDOFF_PATH=/handoff
```
