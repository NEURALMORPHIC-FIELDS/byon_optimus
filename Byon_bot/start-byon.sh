#!/bin/bash

# Configuration
BYON_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEMORY_SERVICE_DIR="$BYON_ROOT/shared/memory"
OPENCLAW_DIR="$BYON_ROOT/openclaw-main"
PYTHON_CMD="python3"

echo "==================================================="
echo "      Byon Optimus Bot - System Startup"
echo "==================================================="
echo ""

# Check for Python
if ! command -v $PYTHON_CMD &> /dev/null; then
    echo "[ERROR] $PYTHON_CMD could not be found. Please install Python."
    exit 1
fi

# Start Memory Service
echo "[SYSTEM] Starting FHRSS+FCPE Memory Service..."
(
    cd "$MEMORY_SERVICE_DIR" || exit
    if [ -f "requirements.txt" ]; then
        pip install -r requirements.txt > /dev/null 2>&1
    fi
    $PYTHON_CMD memory_service.py
) &
MEMORY_PID=$!

echo "[SYSTEM] Memory Service started with PID $MEMORY_PID"

# Wait a moment
sleep 5

# Start OpenClaw
echo "[SYSTEM] Starting OpenClaw Gateway..."
cd "$OPENCLAW_DIR" || exit

if [ ! -d "node_modules" ]; then
    echo "[WARNING] node_modules not found. Attempting to install dependencies..."
    pnpm install
fi

echo "[SYSTEM] Launching OpenClaw..."
npm start

# Cleanup on exit
trap "kill $MEMORY_PID" EXIT
