@echo off
:: BYON Optimus - One-Click Installer
:: Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac
::
:: Double-click this file to start the automatic installation.
:: It will automatically request Administrator privileges.

:: Check for admin rights
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ============================================
    echo   Requesting Administrator privileges...
    echo ============================================
    echo.

    :: Re-launch this script as Administrator
    powershell -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

:: We have admin rights - continue
echo.
echo ============================================
echo   BYON Optimus - Automatic Installer
echo   Patent: EP25216372.0 - OmniVault
echo   Running as Administrator
echo ============================================
echo.
echo This will install and configure BYON Optimus.
echo.
echo Press any key to start (or close this window to cancel)...
pause > nul

:: Get the directory of this batch file
cd /d "%~dp0"

:: Run PowerShell script directly (we already have admin)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-byon-v2.ps1"

pause
