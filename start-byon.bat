@echo off
REM ============================================================
REM BYON-Omni Local Runner (no Docker)
REM ============================================================
REM Starts in order:
REM   1. memory-service (Python FAISS + FCE-M, port 8000)
REM   2. WhatsApp bridge (Node, requires QR scan on first run)
REM
REM Stop with Ctrl+C in each window.
REM ============================================================

setlocal

cd /d "%~dp0"

echo.
echo [start-byon] Starting memory-service (port 8000) in a new window...
echo [start-byon] FCE-M morphogenetic layer: enabled.
echo [start-byon] Hybrid backend: FAISS + FCE-Omega.
echo.

start "byon-memory-service" cmd /k "cd /d byon-orchestrator\memory-service && set MEMORY_BACKEND=hybrid&& set FCEM_ENABLED=true&& set MEMORY_STORAGE_PATH=./memory_storage&& python server.py"

echo [start-byon] Waiting 25s for memory-service to download model and start...
timeout /t 25 /nobreak >nul

echo.
echo [start-byon] Starting WhatsApp bridge in a new window...
echo [start-byon] Scan the QR code with your phone on first run.
echo [start-byon] Once linked, the session persists in byon-orchestrator/whatsapp-session/
echo.

start "byon-whatsapp-bridge" cmd /k "cd /d byon-orchestrator && node --env-file=../.env scripts/byon-whatsapp-bridge.mjs"

echo.
echo [start-byon] Two windows opened: memory-service + WhatsApp bridge.
echo [start-byon] Send a WhatsApp message to your linked number to talk to BYON.
echo.
endlocal
