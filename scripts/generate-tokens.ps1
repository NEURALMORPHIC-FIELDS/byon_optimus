# Generate secure random tokens for BYON Optimus
# Run with: powershell -ExecutionPolicy Bypass -File scripts/generate-tokens.ps1

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  BYON Optimus - Token Generator" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Generate Gateway Token (64 hex characters)
$gatewayBytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($gatewayBytes)
$gatewayToken = [BitConverter]::ToString($gatewayBytes) -replace '-',''
$gatewayToken = $gatewayToken.ToLower()

# Generate Bridge Secret (64 hex characters)
$bridgeBytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bridgeBytes)
$bridgeSecret = [BitConverter]::ToString($bridgeBytes) -replace '-',''
$bridgeSecret = $bridgeSecret.ToLower()

# Generate Redis Password (32 alphanumeric characters)
$chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
$redisPassword = -join (1..32 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })

# Generate Grafana Password (16 alphanumeric characters)
$grafanaPassword = -join (1..16 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })

Write-Host "Generated Tokens:" -ForegroundColor Green
Write-Host ""
Write-Host "OPENCLAW_GATEWAY_TOKEN=$gatewayToken"
Write-Host "BYON_BRIDGE_SECRET=$bridgeSecret"
Write-Host "REDIS_PASSWORD=$redisPassword"
Write-Host "GRAFANA_PASSWORD=$grafanaPassword"
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan

# Ask if user wants to update .env
$update = Read-Host "Update .env file with these tokens? (Y/n)"
if ($update -ne "n" -and $update -ne "N") {
    $envPath = Join-Path $PSScriptRoot "..\\.env"

    if (Test-Path $envPath) {
        $content = Get-Content $envPath -Raw

        # Replace placeholders
        $content = $content -replace 'OPENCLAW_GATEWAY_TOKEN=.*', "OPENCLAW_GATEWAY_TOKEN=$gatewayToken"
        $content = $content -replace 'BYON_BRIDGE_SECRET=.*', "BYON_BRIDGE_SECRET=$bridgeSecret"
        $content = $content -replace 'REDIS_PASSWORD=.*', "REDIS_PASSWORD=$redisPassword"

        # Add GRAFANA_PASSWORD if not present
        if ($content -notmatch 'GRAFANA_PASSWORD=') {
            $content += "`nGRAFANA_PASSWORD=$grafanaPassword"
        } else {
            $content = $content -replace 'GRAFANA_PASSWORD=.*', "GRAFANA_PASSWORD=$grafanaPassword"
        }

        Set-Content $envPath $content
        Write-Host ""
        Write-Host ".env file updated successfully!" -ForegroundColor Green
    } else {
        Write-Host "Error: .env file not found at $envPath" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "IMPORTANT: You still need an Anthropic API Key!" -ForegroundColor Yellow
Write-Host "Get one from: https://console.anthropic.com/settings/keys" -ForegroundColor Yellow
