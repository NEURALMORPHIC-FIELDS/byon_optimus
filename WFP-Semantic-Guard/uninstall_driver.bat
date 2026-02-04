@echo off
:: WFP Semantic Guard - Driver Uninstallation Script
:: Run as Administrator!

echo ============================================
echo   WFP Semantic Guard - Driver Uninstall
echo ============================================
echo.

:: Check for admin privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: This script must be run as Administrator!
    pause
    exit /b 1
)

:: Stop service
echo Stopping service...
sc stop WfpGuard
timeout /t 3 /nobreak >nul

:: Delete service
echo Removing service...
sc delete WfpGuard

:: Remove driver file
echo Removing driver file...
del /f "%SystemRoot%\System32\drivers\WfpGuardDriver.sys" 2>nul

:: Remove from driver store
echo Cleaning driver store...
pnputil /delete-driver wfp_guard.inf /uninstall 2>nul

echo.
echo Uninstallation complete!
echo.
pause
