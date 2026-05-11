# BYON Optimus - Deep Cleanup Script
# Removes all Docker resources from failed installations
# Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac

Write-Host ""
Write-Host "============================================" -ForegroundColor Yellow
Write-Host "  BYON Optimus - DEEP CLEANUP" -ForegroundColor Yellow
Write-Host "============================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "This will remove:" -ForegroundColor Red
Write-Host "  - All byon_optimus containers"
Write-Host "  - All byon_optimus images"
Write-Host "  - All byon_optimus volumes"
Write-Host "  - All byon_optimus networks"
Write-Host "  - Docker build cache"
Write-Host ""
$confirm = Read-Host "Continue? (y/N)"
if ($confirm -ne "y" -and $confirm -ne "Y") {
    Write-Host "Cancelled." -ForegroundColor Gray
    exit 0
}

Set-Location $PSScriptRoot
$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "[1/7] Stopping docker compose..." -ForegroundColor Cyan
docker compose down --remove-orphans 2>$null

Write-Host ""
Write-Host "[2/7] Stopping all byon containers..." -ForegroundColor Cyan
$containers = docker ps -a -q --filter "name=byon" 2>$null
if ($containers) {
    docker stop $containers 2>$null
    docker rm -f $containers 2>$null
    Write-Host "  Removed containers" -ForegroundColor Green
} else {
    Write-Host "  No containers found" -ForegroundColor Gray
}

Write-Host ""
Write-Host "[3/7] Removing byon images..." -ForegroundColor Cyan
$images = docker images -q "*byon*" 2>$null
$images2 = docker images -q "byon_optimus*" 2>$null
$allImages = @($images) + @($images2) | Where-Object { $_ } | Select-Object -Unique
if ($allImages) {
    foreach ($img in $allImages) {
        docker rmi -f $img 2>$null
    }
    Write-Host "  Removed $($allImages.Count) images" -ForegroundColor Green
} else {
    Write-Host "  No images found" -ForegroundColor Gray
}

Write-Host ""
Write-Host "[4/7] Removing related images (alpine, node, python)..." -ForegroundColor Cyan
docker rmi alpine/openssl:latest 2>$null
docker rmi alpine:latest 2>$null
Write-Host "  Done" -ForegroundColor Green

Write-Host ""
Write-Host "[5/7] Removing byon volumes..." -ForegroundColor Cyan
$volumes = docker volume ls -q --filter "name=byon" 2>$null
if ($volumes) {
    foreach ($vol in $volumes) {
        docker volume rm -f $vol 2>$null
    }
    Write-Host "  Removed volumes" -ForegroundColor Green
} else {
    Write-Host "  No volumes found" -ForegroundColor Gray
}

Write-Host ""
Write-Host "[6/7] Removing byon networks..." -ForegroundColor Cyan
$networks = docker network ls -q --filter "name=byon" 2>$null
if ($networks) {
    foreach ($net in $networks) {
        docker network rm $net 2>$null
    }
    Write-Host "  Removed networks" -ForegroundColor Green
} else {
    Write-Host "  No networks found" -ForegroundColor Gray
}

Write-Host ""
Write-Host "[7/7] Cleaning Docker system..." -ForegroundColor Cyan
docker image prune -f 2>$null
docker builder prune -f 2>$null
docker system prune -f 2>$null
Write-Host "  System cleaned" -ForegroundColor Green

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  CLEANUP COMPLETE!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Now run: INSTALL-CLICK-HERE.bat" -ForegroundColor Cyan
Write-Host ""
Read-Host "Press Enter to exit"
