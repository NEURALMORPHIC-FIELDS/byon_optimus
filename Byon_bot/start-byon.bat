@echo off
SETLOCAL EnableDelayedExpansion

TITLE Byon Optimus Bot Launcher

echo ===================================================
echo       Byon Optimus Bot - System Startup
echo ===================================================
echo.

:: Configuration
set "BYON_ROOT=%~dp0"
set "MEMORY_SERVICE_DIR=%BYON_ROOT%shared\memory"
set "OPENCLAW_DIR=%BYON_ROOT%openclaw-main"
set "PYTHON_CMD=python"

:: Check for Python
%PYTHON_CMD% --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Please install Python and add it to PATH.
    pause
    exit /b 1
)

:: Start Memory Service
echo [SYSTEM] Starting FHRSS+FCPE Memory Service...
start "Byon Memory Service" cmd /k "cd /d "%MEMORY_SERVICE_DIR%" && echo Installing deps... && pip install -r requirements.txt && echo Starting service... && %PYTHON_CMD% memory_service.py"

:: Wait a moment for memory service to initialize
timeout /t 5 /nobreak >nul

:: Start OpenClaw
echo [SYSTEM] Starting OpenClaw Gateway...
cd /d "%OPENCLAW_DIR%"

:: Check if node_modules exists, offer to install if missing
if not exist "node_modules" (
    echo [WARNING] node_modules not found. Attempting to install dependencies with pnpm...
    call pnpm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies. Make sure pnpm is installed.
        pause
        exit /b 1
    )
)

echo [SYSTEM] Launching OpenClaw...
call npm start

pause
