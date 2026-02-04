# BYON Optimus - Arhitectură

## Componente Principale

| Serviciu | Port | Rol |
|----------|------|-----|
| Worker Agent | 3002 | Procesează mesaje din canale (Telegram, Discord), construiește evidență și planuri |
| Auditor Agent | 3003 | Validează planuri, semnează cu Ed25519, verifică GMV compliance |
| Memory Service | 8000/8001 | FHRSS+FCPE - 73,000x compresie, 100% recovery la 40% pierdere date |
| OpenClaw Gateway | 3000 | UI unificat, proxy pentru toate serviciile |

## Flux de Date

```
Canale (Telegram/Discord)
         ↓
Worker Agent (procesare, evidență)
         ↓
Auditor Agent (validare, semnare)
         ↓
Executor (air-gapped, network_mode: none)
         ↓
Receipts → Worker → User
```

## Endpoint-uri API (prin Gateway)

- `/api/worker/status` - Status worker
- `/api/auditor/status` - Status auditor
- `/api/memory/stats` - Statistici FHRSS+FCPE
- `/api/memory/search?query=...` - Căutare semantică

## Tehnologii Cheie

| Tehnologie | Descriere |
|------------|-----------|
| **FHRSS** | Fractal-Holographic Redundant Storage System - Redundanță fractală |
| **FCPE** | Fractal-Chaotic Persistent Encoding - Compresie 73,000:1 |
| **GMV** | Global Memory Vectors - Contextul global al conversației |
| **MACP v1.1** | Machine Agent Communication Protocol |

## Note

- Executor rulează air-gapped (network_mode: none) pentru securitate
- Memory service oferă 100% data recovery chiar și la 40% pierdere
- Toate serviciile sunt accesibile prin Gateway ca proxy unificat
