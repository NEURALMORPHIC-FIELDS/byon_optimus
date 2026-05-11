# BYON Optimus - WFP Semantic Guard Integration

**Patent: EP25216372.0 - Omni-Qube-Vault - Vasile Lucian Borbeleac**

## Overview

This document describes the integration between BYON Optimus and WFP Semantic Guard, enabling kernel-level network protection with EXECUTION_INTENT authorization.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           BYON OPTIMUS                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────┐    ┌──────────┐    ┌──────────────┐    ┌──────────────┐ │
│   │  Worker  │───>│ Auditor  │───>│ BYON-WFP     │───>│  Executor    │ │
│   │  Agent   │    │  Agent   │    │   Bridge     │    │  (Air-gapped)│ │
│   └──────────┘    └────┬─────┘    └──────┬───────┘    └──────────────┘ │
│                        │                  │                              │
│                        │ Ed25519 Sign     │ IOCTL                       │
│                        ▼                  ▼                              │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │                    handoff/auditor_to_executor/                  │  │
│   │                        *.intent.json                             │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ IOCTL_WFP_GUARD_ADD_INTENT_RULE
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        KERNEL MODE                                       │
├─────────────────────────────────────────────────────────────────────────┤
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │                    WFP Semantic Guard Driver                     │  │
│   │  ┌─────────────┐ ┌─────────────┐ ┌──────────────────────────┐  │  │
│   │  │ Behavioral  │ │  Temporal   │ │   BYON Intent Rules      │  │  │
│   │  │ Detection   │ │ Fingerprint │ │   (EXECUTION_INTENT)     │  │  │
│   │  └─────────────┘ └─────────────┘ └──────────────────────────┘  │  │
│   │  ┌─────────────┐ ┌─────────────┐ ┌──────────────────────────┐  │  │
│   │  │Exfiltration │ │   Burst     │ │   Fragmergent Brain      │  │  │
│   │  │ Detection   │ │ Detection   │ │   (Anomaly Detection)    │  │  │
│   │  └─────────────┘ └─────────────┘ └──────────────────────────┘  │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │                    Windows Filtering Platform                    │  │
│   │                       (fwpkclnt.sys)                             │  │
│   └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. BYON-WFP Bridge Service (`ByonWfpBridge.exe`)

A .NET 8 Windows service that:
- Monitors `handoff/auditor_to_executor/` for `*.intent.json` files
- Verifies Ed25519 signatures from the Auditor
- Pushes authorized rules to the WFP kernel driver via IOCTL
- Manages intent lifecycle (expiry, max connections)

### 2. WFP Semantic Guard Driver (`WfpGuardDriver.sys`)

Kernel driver with new BYON IOCTLs:
- `IOCTL_WFP_GUARD_ADD_INTENT_RULE` (0x810) - Add execution intent
- `IOCTL_WFP_GUARD_REMOVE_INTENT_RULE` (0x811) - Remove intent
- `IOCTL_WFP_GUARD_CLEAR_INTENT_RULES` (0x812) - Clear all intents
- `IOCTL_WFP_GUARD_GET_INTENT_STATS` (0x813) - Get statistics
- `IOCTL_WFP_GUARD_VERIFY_INTENT` (0x814) - Verify authorization

### 3. EXECUTION_INTENT File Format

```json
{
  "intent_id": "uuid-timestamp",
  "process_id": 1234,
  "process_path": "C:\\path\\to\\executor.exe",
  "rule_type": "EXACT_IP",
  "remote_ip": "93.184.216.34",
  "remote_port": 443,
  "protocol": "TCP",
  "direction": "outbound",
  "created_at": "2025-01-30T12:00:00Z",
  "expires_at": "2025-01-30T12:05:00Z",
  "max_connections": 10,
  "description": "HTTPS request to example.com",
  "signature": "base64-ed25519-signature",
  "public_key": "base64-ed25519-pubkey"
}
```

## Security Model

### Authorization Flow

1. **Worker** requests network access for a task
2. **Auditor** reviews request and creates signed EXECUTION_INTENT
3. **Bridge** verifies signature and pushes rule to kernel
4. **Driver** allows only authorized traffic matching intent
5. **Executor** performs network operation (if allowed)

### Defense Layers

| Layer | Protection |
|-------|------------|
| **Application** | BYON Auditor review + Ed25519 signing |
| **User-Mode** | Bridge signature verification |
| **Kernel** | WFP intent rule matching |
| **Behavioral** | Fragmergent anomaly detection |

### Key Points

- **Air-gapped Executor**: No network by default (`network_mode: none`)
- **Intent-based access**: Only authorized destinations allowed
- **Time-limited**: Intents expire automatically
- **Connection-limited**: Max connections per intent
- **Cryptographic**: Ed25519 signature verification

## Installation

### Prerequisites

- Windows 10/11 (x64)
- .NET 8.0 SDK
- Windows Driver Kit (WDK) 10 for driver build
- Test signing enabled for driver installation

### Build Steps

```powershell
# Build the bridge service
cd WFP-Semantic-Guard\byon-integration
dotnet publish -c Release -r win-x64 --self-contained

# Build the driver (requires WDK)
cd WFP-Semantic-Guard
msbuild wfp_guard.vcxproj /p:Configuration=Release /p:Platform=x64
```

### Driver Installation

```cmd
:: Enable test signing (requires reboot)
bcdedit /set testsigning on

:: Install driver
pnputil /add-driver wfp_guard.inf /install

:: Start driver
sc start WfpGuard
```

### Run Bridge Service

```powershell
# Run directly
.\ByonWfpBridge.exe

# Or install as Windows service
sc create ByonWfpBridge binPath= "C:\path\to\ByonWfpBridge.exe" start= auto
sc start ByonWfpBridge
```

## Configuration

### wfp-bridge-config.json

```json
{
  "handoffDirectory": "C:/Users/Lucian/Desktop/byon_optimus/handoff/auditor_to_executor",
  "publicKeyPath": "C:/Users/Lucian/Desktop/byon_optimus/keys/auditor.public.pem",
  "wfpDevicePath": "\\\\.\\WfpGuard",
  "scanIntervalMs": 500,
  "intentExpiryMs": 300000,
  "maxActiveIntents": 64,
  "logLevel": "info"
}
```

## API Reference

### Intent Rule Structure

```c
typedef struct _WFP_GUARD_INTENT_RULE {
    CHAR    IntentId[64];           // Unique intent ID
    UINT32  ProcessId;              // Authorized process ID
    WCHAR   ProcessPath[260];       // Process executable path

    WFP_INTENT_RULE_TYPE RuleType;  // EXACT_IP, IP_RANGE, etc.
    UINT32  RemoteIpV4;             // Target IP address
    UINT32  RemoteIpV4End;          // Range end (for IP_RANGE)
    UINT16  RemotePort;             // Target port (0 = any)
    UINT8   Protocol;               // TCP/UDP/any
    UINT8   Direction;              // outbound/inbound/both

    UINT64  CreatedTimestamp;       // Creation time
    UINT64  ExpiresTimestamp;       // Expiry time (0 = no expiry)
    UINT32  MaxConnections;         // Max allowed connections
    UINT32  ConnectionsUsed;        // Connections used

    CHAR    Description[128];       // Human-readable description
    UINT8   SignatureValid;         // Signature verification status
} WFP_GUARD_INTENT_RULE;
```

### Rule Types

| Type | Description |
|------|-------------|
| `INTENT_TYPE_EXACT_IP` | Exact IP:port match |
| `INTENT_TYPE_IP_RANGE` | IP address range (CIDR-like) |
| `INTENT_TYPE_PORT_ONLY` | Any IP, specific port |
| `INTENT_TYPE_DOMAIN` | Domain-based (resolved to IPs) |
| `INTENT_TYPE_WILDCARD` | Wildcard domain matching |

## Troubleshooting

### Bridge not connecting to driver

```powershell
# Check driver status
sc query WfpGuard

# Check device exists
Get-WmiObject -Class Win32_PnPEntity | Where-Object { $_.Name -like "*WfpGuard*" }
```

### Intents not being processed

```powershell
# Check handoff directory
Get-ChildItem handoff\auditor_to_executor\*.intent.json

# Check bridge logs
Get-Content ByonWfpBridge.log -Tail 50
```

### Signature verification failing

```powershell
# Verify public key exists
Test-Path keys\auditor.public.pem

# Check key format (should be PEM)
Get-Content keys\auditor.public.pem
```

## Performance

| Metric | Value |
|--------|-------|
| Intent processing latency | <10ms |
| Max concurrent intents | 64 (configurable) |
| Kernel overhead | <2ms per connection |
| Memory per intent | ~1KB |

## License

MIT License - Network Execution Guard Project

**Author:** Lucian Borbeleac / Digital Systems Creator
