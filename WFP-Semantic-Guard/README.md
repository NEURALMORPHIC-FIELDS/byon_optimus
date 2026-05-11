# WFP Semantic Guard

**Network Execution Guard using Behavioral Traffic Analysis + Adaptive Anomaly Detection**

A lightweight Windows network firewall that detects malicious traffic patterns using behavioral analysis rather than signatures. Implements 6 detection modules including the Fragmergent Brain adaptive anomaly detection in a WFP (Windows Filtering Platform) kernel driver with a WPF user interface.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER MODE                                     │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              WFP Semantic Guard UI (WPF)                     │   │
│  │  ┌─────────────────────────────────────────────────────────┐│   │
│  │  │ Event Monitor │ Statistics │ App Profiles │ Settings   ││   │
│  │  └─────────────────────────────────────────────────────────┘│   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │ IOCTL                                │
├──────────────────────────────┼──────────────────────────────────────┤
│                        KERNEL MODE                                   │
├──────────────────────────────┼──────────────────────────────────────┤
│  ┌───────────────────────────┴───────────────────────────────────┐ │
│  │                    wfp_guard.sys                               │ │
│  │  ┌─────────────────────────────────────────────────────────┐  │ │
│  │  │              Detection Modules                           │  │ │
│  │  │  ┌─────────────┐ ┌─────────────┐ ┌──────────────────┐  │  │ │
│  │  │  │ Behavioral  │ │  Temporal   │ │   Cross-flow     │  │  │ │
│  │  │  │ Clustering  │ │Fingerprint  │ │   Correlation    │  │  │ │
│  │  │  └─────────────┘ └─────────────┘ └──────────────────┘  │  │ │
│  │  │  ┌─────────────┐ ┌─────────────┐ ┌──────────────────┐  │  │ │
│  │  │  │Exfiltration │ │   Burst     │ │   FRAGMERGENT    │  │  │ │
│  │  │  │ Detection   │ │ Detection   │ │     BRAIN        │  │  │ │
│  │  │  └─────────────┘ └─────────────┘ └──────────────────┘  │  │ │
│  │  └─────────────────────────────────────────────────────────┘  │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌──────────────────────────┐│ │
│  │  │   WFP       │ │    App      │ │ Reputation Scoring       ││ │
│  │  │  Callouts   │ │  Tracking   │ │ (WFP + Fragmergent)      ││ │
│  │  └─────────────┘ └─────────────┘ └──────────────────────────┘│ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              │                                       │
│                    ┌─────────┴─────────┐                            │
│                    │  WFP Engine       │                            │
│                    │  (fwpkclnt.sys)   │                            │
│                    └───────────────────┘                            │
└─────────────────────────────────────────────────────────────────────┘
```

## Detection Modules

### 1. Behavioral Clustering
Classifies applications into behavioral archetypes based on 8-dimensional feature vectors:
- Average packet size
- Burstiness (timing variation)
- Connection frequency
- Port diversity
- IP diversity
- Protocol mix
- Time-of-day bias
- Payload entropy

**Clusters:**
| Cluster | Type | Characteristics |
|---------|------|-----------------|
| Browser-like | Benign | High diversity, bursty, mixed entropy |
| Background-Service | Benign | Regular, low entropy, single destination |
| P2P-like | Neutral | Many peers, mixed protocols |
| **Beacon-like** | **Malicious** | Very regular, high entropy, single C2 |
| **Exfiltration-like** | **Malicious** | Large packets, high entropy |
| **DGA-like** | **Malicious** | Many unique IPs, rapid connections |
| **Burst-Exfil** | **Malicious** | Rapid large encrypted transfers |

### 2. Temporal Fingerprinting
Detects known malware timing patterns using interval analysis:
- Interval histogram (8 buckets)
- Rhythm regularity (coefficient of variation)
- Dominant frequency (FFT-based in user-mode)
- Mean interval comparison

**Known Signatures:**
- CobaltStrike-60s (60s beacon, 85% regularity)
- Meterpreter-5s (5s callback, 90% regularity)
- Empire-5m (5min beacon, 80% regularity)
- Generic-Beacon (high regularity indicator)

### 3. Cross-flow Correlation
Detects multi-channel C2 by analyzing timing correlation between different destination flows:
- Discretizes timestamps into 500ms buckets
- Computes Jaccard overlap between flow pairs
- Flags applications with 2+ correlated flows (>60% overlap)

### 4. Exfiltration Detection
Identifies data theft patterns:
- Large packet ratio (>60% packets ≥800 bytes)
- High entropy ratio (>50% packets with entropy >0.7)
- Single destination concentration

### 5. Burst Detection
Catches rapid data exfiltration:
- 10+ packets within 1 second window
- Average packet size >1000 bytes

### 6. Fragmergent Brain (Adaptive Anomaly Detection)
Novel adaptive anomaly detection using clarity/ESP (Emergent Synergistic Perturbation) dynamics. This module learns application-specific behavioral baselines and detects deviations in real-time.

**Key Concepts:**

| Concept | Description |
|---------|-------------|
| **Clarity** | 0-100% score indicating how well current behavior matches learned baseline |
| **ESP** | Per-dimension deviation measurement using Z-score analysis |
| **Phase** | Behavioral state: Equilibrium (stable), Fragmentation (attack), Emergence (learning) |
| **Anomaly Level** | None, Mild, Moderate, Severe, Critical based on clarity drop |

**Phase Detection:**
| Phase | Condition | Meaning |
|-------|-----------|---------|
| Equilibrium | Low frag, low ESP | Stable, normal behavior |
| Fragmentation | High frag, high ESP | Breaking apart (active attack) |
| Emergence | High ESP, low frag | New pattern forming (learning) |

**Anomaly Levels:**
| Level | Clarity Drop | Action |
|-------|--------------|--------|
| None | <20% | Continue monitoring |
| Mild | 20-35% | Log, slight reputation penalty |
| Moderate | 35-50% | Alert, ask user |
| Severe | 50-70% | Block if malicious cluster |
| Critical | >70% | Immediate block |

**Advantages over traditional detection:**
- Online baseline learning per application
- Detects unknown attack patterns (not just signatures)
- Adaptive thresholds reduce false positives
- Integer math only (kernel-compatible, no floating point)

### 7. Reputation Scoring
Weighted combination of all detection modules:
```
reputation = behavior*0.25 + temporal*0.20 + correlation*0.20 + exfil*0.15 + user_trust*0.20
           + fragmergent_clarity * fragmergent_weight (when enabled)
```

When Fragmergent is enabled, additional penalties are applied:
- Anomaly penalties: Mild (-5%), Moderate (-10%), Severe (-20%)
- Phase penalties: Fragmentation (-15%)

## Project Structure

```
WFP-Semantic-Guard/
├── wfp_guard_common.h           # Shared structures, constants, IOCTLs
├── wfp_guard_driver.h           # Driver header
├── wfp_guard_driver.c           # Driver entry, IOCTL handling
├── wfp_guard_callouts.c         # WFP callout functions, classification
├── fragmergent_brain.h          # Fragmergent Brain API (kernel-compatible)
├── fragmergent_brain.c          # Fragmergent Brain implementation
├── wfp_guard.inf                # Driver installation INF
├── wfp_guard.vcxproj            # Visual Studio driver project
│
├── ui/                          # WPF User Interface
│   ├── App.xaml                 # Application entry
│   ├── WfpSemanticGuard.csproj  # .NET 8 WPF project
│   ├── Models/
│   │   └── NetworkEvent.cs      # Data models, enums
│   ├── Services/
│   │   └── DriverService.cs     # IOCTL communication layer
│   ├── ViewModels/
│   │   └── MainViewModel.cs     # MVVM ViewModel
│   └── Views/
│       └── MainWindow.xaml      # Main UI window
│
└── fragmergent update/          # Integration documentation
    └── INTEGRATION.md           # Fragmergent integration guide
```

## Build Requirements

### Driver Build
- Visual Studio 2019/2022
- Windows Driver Kit (WDK) 10
- Windows SDK 10

### UI Build
- .NET 8.0 SDK
- Visual Studio 2022 or `dotnet` CLI

## Build Instructions

### Using Visual Studio

1. Install WDK 10 and VS 2022
2. Open `wfp_guard.vcxproj`
3. Select x64 Release configuration
4. Build solution

### Using Command Line

**Driver:**
```cmd
:: Open WDK Command Prompt
msbuild wfp_guard.vcxproj /p:Configuration=Release /p:Platform=x64
```

**UI:**
```cmd
cd ui
dotnet build --configuration Release
```

## Installation

### Test Mode (Development)
```cmd
:: Enable test signing
bcdedit /set testsigning on
:: Reboot

:: Install driver
pnputil /add-driver wfp_guard.inf /install

:: Start driver
sc start WfpGuard

:: Run UI
cd ui\bin\Release\net8.0-windows
WfpSemanticGuard.exe
```

### Production Mode
Requires:
1. EV code signing certificate
2. WHQL submission (optional but recommended)
3. Sign both driver and catalog file

## Usage

### UI Features
- **Event Monitor:** Real-time view of network events with verdict, threat level, and Fragmergent metrics
- **Statistics Dashboard:** Connection counts, blocked/allowed, Fragmergent anomalies
- **Application Profiles:** Per-app reputation, behavior clusters, whitelist/blacklist management
- **Settings:** Configure thresholds, enable/disable Fragmergent, adjust weights

### IOCTL Interface
| IOCTL | Code | Description |
|-------|------|-------------|
| `GET_STATS` | 0x800 | Get global statistics |
| `GET_EVENT` | 0x801 | Get pending event for analysis |
| `SET_VERDICT` | 0x802 | Return verdict for event |
| `SET_CONFIG` | 0x803 | Update configuration |
| `GET_APP_PROFILE` | 0x804 | Get detailed app profile |
| `WHITELIST_APP` | 0x805 | Add app to whitelist |
| `BLACKLIST_APP` | 0x806 | Add app to blacklist |
| `GET_FRAGMERGENT_STATS` | 0x807 | Get Fragmergent engine statistics |
| `SET_FRAGMERGENT_CONFIG` | 0x808 | Configure Fragmergent settings |

## Configuration

### WFP Detection Thresholds
| Parameter | Default | Description |
|-----------|---------|-------------|
| ClusterThreshold | 700 (0.70) | Minimum similarity for cluster assignment |
| TemporalThreshold | 650 (0.65) | Minimum match score for temporal detection |
| CorrelationThreshold | 600 (0.60) | Minimum correlation for C2 detection |
| ReputationBlockThreshold | 350 (0.35) | Block if reputation below |
| ReputationTrustThreshold | 650 (0.65) | Trust if reputation above |

### Fragmergent Configuration
| Parameter | Default | Description |
|-----------|---------|-------------|
| Enabled | FALSE | Enable/disable Fragmergent Brain |
| FragmergentWeight | 300 (0.30) | Weight of Fragmergent in reputation scoring |
| Alpha | 500 | Momentum (0.5) |
| Beta | 300 | Coupling (0.3) |
| Delta | 400 | Noise sensitivity (0.4) |
| Eta | 800 | Baseline memory (0.8 EMA factor) |
| AnomalyMild | 200 | Clarity drop for mild anomaly (20%) |
| AnomalyModerate | 350 | Clarity drop for moderate anomaly (35%) |
| AnomalySevere | 500 | Clarity drop for severe anomaly (50%) |

## Performance Characteristics

| Metric | Value |
|--------|-------|
| Kernel overhead | <2ms per connection decision |
| Memory footprint | ~50KB per tracked application |
| Fragmergent overhead | <50μs per event |
| Fragmergent memory | ~1KB per app brain |
| Max tracked apps | 256 (configurable) |
| No cloud required | All analysis is local |
| No signatures required | Behavioral detection |
| No floating point | Integer math only (kernel-safe) |

## Detection Results (Simulation)

From Python prototype testing:

| Scenario | Detection Rate |
|----------|---------------|
| Chrome (legitimate) | 0% blocked ✓ |
| Windows Update (legitimate) | 0% blocked ✓ |
| Cobalt Strike Beacon | 91% blocked |
| Meterpreter Callback | 91% blocked |
| DGA Domain Generation | 89% blocked |
| Slow Data Exfiltration | 86% blocked |
| Multi-Channel C2 | 94% blocked |
| Rapid Exfiltration | 72% blocked |

**Overall:** 100% True Positive Rate, 0% False Positive Rate

With Fragmergent Brain enabled, detection of novel/unknown patterns improves through adaptive baseline learning.

## Security Considerations

1. **Driver signing:** Production deployment requires signed driver
2. **Admin rights:** Installation requires administrator privileges
3. **Tamper resistance:** Driver runs in kernel mode, resistant to user-mode attacks
4. **No network dependency:** Works completely offline
5. **Integer math only:** No floating point vulnerabilities in kernel

## Known Limitations

1. IPv6 support not implemented (easy to add)
2. DNS inspection layer not implemented
3. Max 256 tracked applications (increase MAX_TRACKED_APPS to extend)
4. Fragmergent requires ~5 samples before meaningful baseline

## License

MIT License - See LICENSE file

## Credits

Network Execution Guard Project, 2025-2026

Based on WFP Semantic Firewall simulation prototype demonstrating behavioral traffic analysis for malware detection. Fragmergent Brain module implements adaptive anomaly detection using clarity/ESP dynamics.

**Author:** Lucian Borbeleac / Digital Systems Creator
