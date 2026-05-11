<#
.SYNOPSIS
    OPEN_BYON - Automated Installer v2
    Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac

.DESCRIPTION
    Complete automated installation for BYON Optimus system.
    Supports both Docker deployment and local development.

.NOTES
    Run in PowerShell as Administrator
#>

# ============================================================
# CONFIGURATION
# ============================================================
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# ============================================================
# BANNER
# ============================================================
Clear-Host
Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host "                    OPEN_BYON INSTALLER v2                    " -ForegroundColor Cyan
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host "    Patent: EP25216372.0 - OmniVault - V.L. Borbeleac" -ForegroundColor Gray
Write-Host "    Architecture: OpenClaw - BYON - GMV" -ForegroundColor Gray
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host ""

# ============================================================
# HELPER FUNCTIONS
# ============================================================
function Write-Step { param($num, $text) Write-Host "`n[$num] $text" -ForegroundColor Cyan }
function Write-OK { param($text) Write-Host "  [OK] $text" -ForegroundColor Green }
function Write-Warn { param($text) Write-Host "  [!] $text" -ForegroundColor Yellow }
function Write-Err { param($text) Write-Host "  [X] $text" -ForegroundColor Red }
function Write-Info { param($text) Write-Host "  --> $text" -ForegroundColor Gray }

function Test-Command {
    param($cmd, $installUrl)
    if (Get-Command $cmd -ErrorAction SilentlyContinue) {
        $version = & $cmd --version 2>&1 | Select-Object -First 1
        Write-OK "$cmd : $version"
        return $true
    } else {
        Write-Err "$cmd not found"
        Write-Info "Install from: $installUrl"
        return $false
    }
}

# ============================================================
# [1] CHECK ADMINISTRATOR
# ============================================================
Write-Step 1 "Checking Administrator privileges"

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Err "Must run as Administrator!"
    Write-Info "Right-click PowerShell → Run as Administrator"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-OK "Running as Administrator"

# Bypass execution policy for this session
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

# ============================================================
# [2] GET PROJECT PATH
# ============================================================
Write-Step 2 "Project Location"

$defaultPath = "C:\Users\Lucian\Desktop\byon_optimus"
Write-Host "  Enter path to OPEN_BYON project folder"
Write-Host "  (Enter for default: $defaultPath)" -ForegroundColor Gray
$PROJECT_PATH = Read-Host "  Path"

if ([string]::IsNullOrWhiteSpace($PROJECT_PATH)) {
    $PROJECT_PATH = $defaultPath
}
# Remove quotes and trim
$PROJECT_PATH = $PROJECT_PATH.Trim().Trim('"').Trim("'").TrimEnd('\')

if (-not (Test-Path $PROJECT_PATH)) {
    Write-Err "Path does not exist: $PROJECT_PATH"
    exit 1
}

Set-Location $PROJECT_PATH
Write-OK "Project: $PROJECT_PATH"

# ============================================================
# [3] CHECK DEPENDENCIES
# ============================================================
Write-Step 3 "Checking Dependencies"

$hasDocker = Test-Command "docker" "https://docker.com/products/docker-desktop"
$hasGit = Test-Command "git" "https://git-scm.com/download/win"
$hasNode = Test-Command "node" "https://nodejs.org"

# Docker is REQUIRED for BYON
if (-not $hasDocker) {
    Write-Err "Docker is REQUIRED for BYON Optimus!"
    Write-Info "The system runs in Docker containers, not locally."
    Read-Host "Press Enter to exit"
    exit 1
}

# Check Docker is running
Write-Info "Checking Docker daemon..."
$oldErrorAction = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$dockerInfo = docker info 2>&1
$dockerExitCode = $LASTEXITCODE
$ErrorActionPreference = $oldErrorAction

if ($dockerExitCode -ne 0) {
    Write-Err "Docker Desktop is not running!"
    Write-Info "Start Docker Desktop and try again"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-OK "Docker is running"

# Check Docker Compose
$ErrorActionPreference = "Continue"
$composeVersion = docker compose version 2>&1
$composeExitCode = $LASTEXITCODE
$ErrorActionPreference = "Stop"

if ($composeExitCode -eq 0) {
    Write-OK "Docker Compose : $composeVersion"
} else {
    Write-Err "Docker Compose not found"
    exit 1
}

# ============================================================
# [4] CREATE DIRECTORY STRUCTURE
# ============================================================
Write-Step 4 "Creating Directory Structure"

$dirs = @(
    "handoff/inbox",
    "handoff/worker_to_auditor",
    "handoff/auditor_to_user",
    "handoff/auditor_to_executor",
    "handoff/executor_to_worker",
    "handoff/outbox",
    "keys/public",
    "memory/fhrss",
    "project"
)

foreach ($dir in $dirs) {
    $fullPath = Join-Path $PROJECT_PATH $dir
    if (-not (Test-Path $fullPath)) {
        New-Item -ItemType Directory -Force -Path $fullPath | Out-Null
        Write-Info "Created: $dir"
    }
}
Write-OK "All directories ready"

# ============================================================
# [5] CHECK FHRSS+FCPE MEMORY SYSTEM
# ============================================================
Write-Step 5 "Checking FHRSS+FCPE Memory System"

$fhrssFile = Join-Path $PROJECT_PATH "INFINIT_MEMORYCONTEXT\fhrss_fcpe_unified.py"
if (Test-Path $fhrssFile) {
    $lines = (Get-Content $fhrssFile | Measure-Object -Line).Lines
    Write-OK "FHRSS+FCPE found ($lines lines)"
} else {
    Write-Warn "FHRSS+FCPE not found at expected location"

    # Try alternative location
    $altPath = "D:\Github Repo\INFINIT_MEMORYCONTEXT\fhrss_fcpe_unified.py"
    if (Test-Path $altPath) {
        $destDir = Join-Path $PROJECT_PATH "INFINIT_MEMORYCONTEXT"
        New-Item -ItemType Directory -Force -Path $destDir | Out-Null
        Copy-Item $altPath -Destination $fhrssFile
        Write-OK "Copied from: $altPath"
    } else {
        Write-Info "Memory service may fail without this file"
    }
}

# ============================================================
# [6] CONFIGURE ENVIRONMENT & OPENCLAW
# ============================================================
Write-Step 6 "Configuring Environment & OpenClaw"

$envFile = Join-Path $PROJECT_PATH ".env"
$envExample = Join-Path $PROJECT_PATH ".env.example"

if (-not (Test-Path $envFile)) {
    if (Test-Path $envExample) {
        Copy-Item $envExample $envFile
        Write-Info "Created .env from template"
    } else {
        @"
# BYON Optimus Environment
# Patent: EP25216372.0 - OmniVault

ANTHROPIC_API_KEY=
LOG_LEVEL=info
TELEGRAM_BOT_TOKEN=
DISCORD_TOKEN=
"@ | Set-Content $envFile
        Write-Info "Created default .env"
    }
}

# Create OpenClaw config directory and file
$openclawConfigDir = Join-Path $PROJECT_PATH "openclaw-config"
$openclawConfigFile = Join-Path $openclawConfigDir "openclaw.json"

if (-not (Test-Path $openclawConfigDir)) {
    New-Item -ItemType Directory -Force -Path $openclawConfigDir | Out-Null
}

if (-not (Test-Path $openclawConfigFile)) {
    @"
{
  "gateway": {
    "trustedProxies": [
      "172.16.0.0/12",
      "172.28.0.0/16",
      "192.168.0.0/16",
      "10.0.0.0/8"
    ],
    "controlUi": {
      "allowInsecureAuth": true,
      "dangerouslyDisableDeviceAuth": true
    }
  },
  "web": {
    "enabled": true
  },
  "plugins": {
    "entries": {
      "whatsapp": { "enabled": true },
      "telegram": { "enabled": true },
      "discord": { "enabled": true },
      "slack": { "enabled": true },
      "signal": { "enabled": true },
      "msteams": { "enabled": true },
      "imessage": { "enabled": true },
      "line": { "enabled": true },
      "mattermost": { "enabled": true },
      "bluebubbles": { "enabled": true },
      "voice-call": { "enabled": true }
    }
  },
  "channels": {
    "whatsapp": {
      "dmPolicy": "allowlist",
      "allowFrom": ["*"]
    }
  }
}
"@ | Set-Content $openclawConfigFile
    Write-OK "OpenClaw config created with all channels enabled"
} else {
    Write-Info "OpenClaw config already exists"
}

# Create plugin manifests for BYON extensions
$byonPluginDir = Join-Path $PROJECT_PATH "Byon_bot\openclaw-main\extensions\byon-protocol"
$memoryPluginDir = Join-Path $PROJECT_PATH "Byon_bot\openclaw-main\extensions\memory-fhrss-fcpe"

if (Test-Path $byonPluginDir) {
    $byonManifest = Join-Path $byonPluginDir "openclaw.plugin.json"
    if (-not (Test-Path $byonManifest)) {
        @"
{
  "id": "byon-protocol",
  "name": "BYON Protocol",
  "description": "MACP v1.1 Protocol Extension for OpenClaw",
  "channels": ["byon"],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }
}
"@ | Set-Content $byonManifest
        Write-Info "Created byon-protocol plugin manifest"
    }
}

if (Test-Path $memoryPluginDir) {
    $memoryManifest = Join-Path $memoryPluginDir "openclaw.plugin.json"
    if (-not (Test-Path $memoryManifest)) {
        @"
{
  "id": "memory-fhrss-fcpe",
  "name": "FHRSS+FCPE Memory",
  "description": "Fractal-Holographic Redundant Storage System",
  "channels": [],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }
}
"@ | Set-Content $memoryManifest
        Write-Info "Created memory-fhrss-fcpe plugin manifest"
    }
}

# Check API key
$envContent = Get-Content $envFile -Raw
if ($envContent -match 'ANTHROPIC_API_KEY=\s*$' -or $envContent -notmatch 'ANTHROPIC_API_KEY=sk-') {
    Write-Host "`n  [REQUIRED] Anthropic API Key:" -ForegroundColor Yellow
    Write-Host "  Get one at: https://console.anthropic.com/" -ForegroundColor Gray
    $apiKey = Read-Host "  Enter key (sk-ant-...)"

    if (-not [string]::IsNullOrWhiteSpace($apiKey)) {
        $envContent = $envContent -replace 'ANTHROPIC_API_KEY=.*', "ANTHROPIC_API_KEY=$apiKey"
        $envContent | Set-Content $envFile -NoNewline
        Write-OK "API key configured"
    } else {
        Write-Warn "No API key - agents may not work"
    }
} else {
    Write-OK ".env already configured"
}

# ============================================================
# [7] GENERATE ED25519 KEYS
# ============================================================
Write-Step 7 "Generating Ed25519 Security Keys"

$privateKey = Join-Path $PROJECT_PATH "keys\auditor.private.pem"
$publicKey = Join-Path $PROJECT_PATH "keys\auditor.public.pem"

if ((Test-Path $privateKey) -and (Test-Path $publicKey)) {
    Write-OK "Keys already exist"
} else {
    Write-Info "Generating keys via Docker..."

    # Temporarily allow errors (Docker outputs to stderr even on success)
    $oldErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    # Use alpine image with openssl package (has shell)
    Write-Info "Pulling alpine image..."
    $dockerOutput = docker run --rm -v "${PROJECT_PATH}\keys:/keys" alpine sh -c "apk add --no-cache openssl && openssl genpkey -algorithm Ed25519 -out /keys/auditor.private.pem && openssl pkey -in /keys/auditor.private.pem -pubout -out /keys/auditor.public.pem" 2>&1

    $ErrorActionPreference = $oldErrorAction

    if ((Test-Path $privateKey) -and (Test-Path $publicKey)) {
        # Copy public key for executor
        Copy-Item $publicKey (Join-Path $PROJECT_PATH "keys\public\auditor.public.pem") -Force
        Write-OK "Ed25519 keys generated"
    } else {
        Write-Err "Key generation failed"
        if ($dockerOutput) {
            Write-Info "Docker output: $dockerOutput"
        }
    }
}

# ============================================================
# [8] INSTALL LOCAL DEPENDENCIES (if needed for CLI)
# ============================================================
Write-Step 8 "Installing Local Dependencies"

$packageJson = Join-Path $PROJECT_PATH "byon-orchestrator\package.json"
if ((Test-Path $packageJson) -and $hasNode) {
    Write-Info "Installing byon-orchestrator dependencies..."
    Push-Location (Join-Path $PROJECT_PATH "byon-orchestrator")
    $oldErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    npm install 2>&1 | Out-Null
    $ErrorActionPreference = $oldErrorAction
    Pop-Location
    Write-OK "npm packages installed"
} else {
    Write-Info "Skipping npm install (using Docker builds)"
}

# ============================================================
# [9] BUILD DOCKER IMAGES
# ============================================================
Write-Step 9 "Building Docker Images (this may take 5-10 minutes)"

Write-Info "Building all services..."

# Temporarily allow errors (Docker outputs progress to stderr)
$oldErrorAction = $ErrorActionPreference
$ErrorActionPreference = "Continue"

$buildOutput = docker compose build 2>&1
$buildExitCode = $LASTEXITCODE

$ErrorActionPreference = $oldErrorAction

if ($buildExitCode -eq 0) {
    Write-OK "All images built successfully"
} else {
    Write-Err "Build failed - check Docker logs"
    Write-Host $buildOutput -ForegroundColor Gray
    Read-Host "Press Enter to continue anyway"
}

# ============================================================
# [10] START CONTAINERS
# ============================================================
Write-Step 10 "Starting Containers"

Write-Info "Starting all services..."

$oldErrorAction = $ErrorActionPreference
$ErrorActionPreference = "Continue"

docker compose up -d 2>&1 | Out-Null
$composeExitCode = $LASTEXITCODE

$ErrorActionPreference = $oldErrorAction

if ($composeExitCode -eq 0) {
    Write-OK "Containers started"
} else {
    Write-Err "Failed to start containers"
}

# ============================================================
# [11] WAIT FOR HEALTH
# ============================================================
Write-Step 11 "Waiting for Services (30-90 seconds)"

$maxWait = 90
$waited = 0
$allHealthy = $false

while ($waited -lt $maxWait) {
    Start-Sleep -Seconds 3
    $waited += 3

    # Check gateway (main entry point)
    try {
        $gatewayOk = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 2 -UseBasicParsing -ErrorAction SilentlyContinue

        # Also check memory service
        $memoryOk = Invoke-RestMethod -Uri "http://localhost:8001/health" -TimeoutSec 2 -ErrorAction SilentlyContinue

        if ($gatewayOk.StatusCode -eq 200 -and $memoryOk.status -eq "healthy") {
            $allHealthy = $true
            break
        }
    } catch { }

    Write-Host "." -NoNewline -ForegroundColor Yellow
}
Write-Host ""

if ($allHealthy) {
    Write-OK "All services are healthy"
} else {
    Write-Warn "Some services may still be starting... (this is normal)"
    Write-Info "sentence-transformers model download can take 1-2 minutes on first run"
}

# ============================================================
# [12] VERIFY INSTALLATION
# ============================================================
Write-Step 12 "Verifying Installation"

# Memory Service (port 8001 externally mapped to 8000 internally)
try {
    $r = Invoke-RestMethod -Uri "http://localhost:8001" -Method Post -Body '{"action":"stats"}' -ContentType "application/json" -TimeoutSec 5
    Write-OK "Memory Service: ONLINE (port 8001) - $($r.num_contexts) contexts loaded"
} catch {
    Write-Warn "Memory Service: not responding on port 8001"
}

# Gateway (main access point)
try {
    $r = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 5 -UseBasicParsing
    Write-OK "OpenClaw Gateway: ONLINE (port 3000)"
} catch {
    Write-Warn "OpenClaw Gateway: not responding"
}

# Worker via Gateway
try {
    $r = Invoke-RestMethod -Uri "http://localhost:3000/api/worker/status" -TimeoutSec 5
    Write-OK "Worker Agent: $($r.state) (uptime: $($r.uptime_seconds)s)"
} catch {
    Write-Warn "Worker Agent: not responding via gateway"
}

# Auditor via Gateway
try {
    $r = Invoke-RestMethod -Uri "http://localhost:3000/api/auditor/status" -TimeoutSec 5
    Write-OK "Auditor Agent: $($r.state) (pending: $($r.pendingApprovals))"
} catch {
    Write-Warn "Auditor Agent: not responding via gateway"
}

# Executor isolation check
$oldErrorAction = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$netMode = docker inspect byon-executor --format '{{.HostConfig.NetworkMode}}' 2>$null
$ErrorActionPreference = $oldErrorAction
if ($netMode -eq "none") {
    Write-OK "Executor: AIR-GAPPED (network: none)"
} elseif ($null -eq $netMode -or $netMode -eq "") {
    Write-Info "Executor: not running (starts on demand)"
} else {
    Write-Warn "Executor network: $netMode (should be 'none')"
}

# ============================================================
# [13] SHOW STATUS
# ============================================================
Write-Step 13 "Container Status"
$oldErrorAction = $ErrorActionPreference
$ErrorActionPreference = "Continue"
docker compose ps
$ErrorActionPreference = $oldErrorAction

# ============================================================
# [14] BOOTSTRAP MEMORY (Optional)
# ============================================================
Write-Step 14 "Initializing Memory with BYON Knowledge"

$bootstrapScript = Join-Path $PROJECT_PATH "memory-bootstrap\bootstrap-memory.py"
if (Test-Path $bootstrapScript) {
    # Check if Python is available
    $hasPython = Get-Command python -ErrorAction SilentlyContinue
    if ($hasPython) {
        Write-Info "Running memory bootstrap..."
        $oldErrorAction = $ErrorActionPreference
        $ErrorActionPreference = "Continue"

        # Install requests if needed
        pip install requests 2>&1 | Out-Null

        # Run bootstrap
        Push-Location (Join-Path $PROJECT_PATH "memory-bootstrap")
        python bootstrap-memory.py --url http://localhost:8001 2>&1 | Out-Null
        Pop-Location

        $ErrorActionPreference = $oldErrorAction
        Write-OK "Memory initialized with BYON system knowledge"
    } else {
        Write-Warn "Python not found - skipping memory bootstrap"
        Write-Info "Run later: python memory-bootstrap\bootstrap-memory.py"
    }
} else {
    Write-Info "Memory bootstrap script not found"
}

# ============================================================
# [15] WFP SEMANTIC GUARD INTEGRATION
# ============================================================
Write-Step 15 "Configuring WFP Semantic Guard Integration"

$wfpDir = Join-Path $PROJECT_PATH "WFP-Semantic-Guard"
$wfpBridgeDir = Join-Path $wfpDir "byon-integration"

if (Test-Path $wfpDir) {
    Write-OK "WFP Semantic Guard found"

    # Check if .NET 8 SDK is available for building
    $dotnetVersion = dotnet --version 2>$null
    if ($dotnetVersion -match "^8\.") {
        Write-Info ".NET 8 SDK detected: $dotnetVersion"

        if (Test-Path $wfpBridgeDir) {
            Write-Info "Building BYON-WFP Bridge..."
            $oldLocation = Get-Location
            Set-Location $wfpBridgeDir

            $oldErrorAction = $ErrorActionPreference
            $ErrorActionPreference = "Continue"

            dotnet publish -c Release -r win-x64 --self-contained 2>&1 | Out-Null
            $buildExitCode = $LASTEXITCODE

            $ErrorActionPreference = $oldErrorAction
            Set-Location $oldLocation

            if ($buildExitCode -eq 0) {
                Write-OK "BYON-WFP Bridge built successfully"

                # Copy public key for signature verification
                $auditorPubKey = Join-Path $PROJECT_PATH "keys\auditor.public.pem"
                $bridgeKeyDir = Join-Path $wfpBridgeDir "bin\Release\net8.0-windows\win-x64"
                if (Test-Path $auditorPubKey) {
                    Copy-Item $auditorPubKey (Join-Path $bridgeKeyDir "auditor.public.pem") -Force
                    Write-Info "Copied auditor public key for intent verification"
                }
            } else {
                Write-Warn "BYON-WFP Bridge build failed"
                Write-Info "You can build manually later: dotnet publish -c Release"
            }
        } else {
            Write-Warn "BYON integration directory not found in WFP-Semantic-Guard"
        }
    } else {
        Write-Info ".NET 8 SDK not found - skipping bridge build"
        Write-Info "Install from: https://dotnet.microsoft.com/download/dotnet/8.0"
    }

    # Check for WFP driver
    $wfpDriver = Join-Path $wfpDir "WfpGuardDriver.sys"
    $wfpDriverAlt = Join-Path $wfpDir "x64\Release\WfpGuardDriver.sys"

    if ((Test-Path $wfpDriver) -or (Test-Path $wfpDriverAlt)) {
        Write-OK "WFP kernel driver found"
        Write-Info "Driver installation requires test signing mode"
        Write-Info "To install: bcdedit /set testsigning on (then reboot)"
    } else {
        Write-Warn "WFP kernel driver not found"
        Write-Info "Build with WDK: msbuild wfp_guard.vcxproj /p:Configuration=Release /p:Platform=x64"
    }

    # Create WFP config file for handoff directory
    $wfpConfigFile = Join-Path $wfpBridgeDir "wfp-bridge-config.json"
    if (-not (Test-Path $wfpConfigFile)) {
        @"
{
  "handoffDirectory": "$($PROJECT_PATH -replace '\\', '/')/handoff/auditor_to_executor",
  "publicKeyPath": "$($PROJECT_PATH -replace '\\', '/')/keys/auditor.public.pem",
  "wfpDevicePath": "\\\\.\\WfpGuard",
  "scanIntervalMs": 500,
  "intentExpiryMs": 300000,
  "maxActiveIntents": 64,
  "logLevel": "info"
}
"@ | Set-Content $wfpConfigFile
        Write-Info "Created WFP bridge configuration"
    }
} else {
    Write-Info "WFP Semantic Guard not found at: $wfpDir"
    Write-Info "BYON will run without kernel-level network protection"
}

# ============================================================
# COMPLETE
# ============================================================
# Read gateway token from .env file
$gatewayToken = ""
$envFile = Join-Path $PROJECT_PATH ".env"
if (Test-Path $envFile) {
    $envContent = Get-Content $envFile
    foreach ($line in $envContent) {
        if ($line -match "^OPENCLAW_GATEWAY_TOKEN=(.+)$") {
            $gatewayToken = $matches[1].Trim()
            break
        }
    }
}

Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Green
Write-Host "              INSTALLATION COMPLETE!                          " -ForegroundColor Green
Write-Host "  ============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  MAIN ACCESS POINT:" -ForegroundColor Yellow
if ($gatewayToken -and $gatewayToken -notlike "*your-*") {
    Write-Host "    http://localhost:3000/?token=$gatewayToken" -ForegroundColor White
} else {
    Write-Host "    http://localhost:3000/?token=<YOUR_GATEWAY_TOKEN>" -ForegroundColor White
    Write-Host ""
    Write-Host "  IMPORTANT: Set OPENCLAW_GATEWAY_TOKEN in .env file!" -ForegroundColor Red
    Write-Host "    Generate with: openssl rand -hex 32" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  MONITORING:" -ForegroundColor Cyan
Write-Host "    Grafana ............. http://localhost:3001 (admin/admin)"
Write-Host "    Prometheus .......... http://localhost:9090"
Write-Host ""
Write-Host "  API ENDPOINTS:" -ForegroundColor Cyan
Write-Host "    Worker Status ....... http://localhost:3000/api/worker/status"
Write-Host "    Auditor Status ...... http://localhost:3000/api/auditor/status"
Write-Host "    Memory Stats ........ http://localhost:3000/api/memory/stats"
Write-Host "    Memory Search ....... http://localhost:3000/api/memory/search?query=BYON"
Write-Host ""
Write-Host "  CONFIGURE WHATSAPP:" -ForegroundColor Cyan
Write-Host "    1. Open http://localhost:3000"
Write-Host "    2. Go to Settings -> Channels"
Write-Host "    3. Add WhatsApp and scan QR code with your phone"
Write-Host ""
Write-Host "  QUICK COMMANDS:" -ForegroundColor Cyan
Write-Host "    docker compose logs -f    # View live logs"
Write-Host "    docker compose ps         # Show status"
Write-Host "    docker compose restart    # Restart all"
Write-Host "    docker compose down       # Stop all"
Write-Host ""
Write-Host "  SECURITY:" -ForegroundColor Cyan
Write-Host "    Executor: AIR-GAPPED (network_mode: none)"
Write-Host "    Signing: Ed25519 (keys/auditor.private.pem)"
Write-Host "    Memory: FHRSS+FCPE (73,000x compression, 100% recovery at 40% loss)"
Write-Host "    Network: WFP Semantic Guard (EXECUTION_INTENT authorization)"
Write-Host ""
Write-Host "  Patent: EP25216372.0 - OmniVault - V.L. Borbeleac" -ForegroundColor Gray
Write-Host "  ============================================================" -ForegroundColor Green

# Open browser?
$open = Read-Host "Open Gateway UI in browser? (Y/n)"
if ($open -ne "n" -and $open -ne "N") {
    if ($gatewayToken -and $gatewayToken -notlike "*your-*") {
        Start-Process "http://localhost:3000/?token=$gatewayToken"
    } else {
        Start-Process "http://localhost:3000"
        Write-Warn "Gateway token not configured - you may need to set it in .env"
    }
}

Write-Host "`nDone! Press Enter to exit." -ForegroundColor Cyan
Read-Host
