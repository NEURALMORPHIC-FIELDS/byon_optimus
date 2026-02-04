@echo off
:: WFP Semantic Guard - Driver Installation Script
:: Run as Administrator!

echo ============================================
echo   WFP Semantic Guard - Driver Installation
echo ============================================
echo.

:: Check for admin privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: This script must be run as Administrator!
    echo Right-click and select "Run as administrator"
    pause
    exit /b 1
)

:: Check test signing mode
bcdedit /enum | findstr /i "testsigning.*Yes" >nul
if %errorlevel% neq 0 (
    echo WARNING: Test Signing Mode is NOT enabled!
    echo.
    echo To enable test signing mode:
    echo   1. Run: bcdedit /set testsigning on
    echo   2. Restart your computer
    echo   3. Run this script again
    echo.
    choice /c YN /m "Enable test signing now (requires reboot)?"
    if errorlevel 2 goto :skip_testsign
    bcdedit /set testsigning on
    echo.
    echo Test signing enabled. Please REBOOT and run this script again.
    pause
    exit /b 0
)
:skip_testsign

echo Test signing mode: OK
echo.

:: Navigate to build directory
cd /d "%~dp0build\Release"

:: Stop existing service if running
echo Stopping existing service (if any)...
sc stop WfpGuard >nul 2>&1
timeout /t 2 /nobreak >nul

:: Remove existing driver
echo Removing existing driver (if any)...
sc delete WfpGuard >nul 2>&1
pnputil /delete-driver wfp_guard.inf /uninstall >nul 2>&1
timeout /t 2 /nobreak >nul

:: Install driver
echo Installing driver...
pnputil /add-driver wfp_guard.inf /install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install driver!
    echo Trying alternative method...

    :: Copy driver manually
    copy /y WfpGuardDriver.sys %SystemRoot%\System32\drivers\ >nul

    :: Create service manually
    sc create WfpGuard type= kernel start= demand binPath= %SystemRoot%\System32\drivers\WfpGuardDriver.sys DisplayName= "WFP Semantic Guard"
)

echo.
echo Starting driver service...
sc start WfpGuard
if %errorlevel% neq 0 (
    echo WARNING: Failed to start service. Check Event Viewer for details.
) else (
    echo Driver started successfully!
)

echo.
echo ============================================
echo   Driver Status
echo ============================================
sc query WfpGuard

echo.
echo Installation complete!
echo You can now run the UI: ui\bin\Release\net8.0-windows\WfpSemanticGuard.exe
echo.
pause
