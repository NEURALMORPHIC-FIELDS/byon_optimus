@echo off
:: WFP Semantic Guard - Run UI
:: Run as Administrator for full functionality!

echo Starting WFP Semantic Guard UI...
echo.

:: Check driver status
sc query WfpGuard | findstr /i "RUNNING" >nul
if %errorlevel% neq 0 (
    echo NOTE: Driver is not running. UI will show "Disconnected" status.
    echo Run install_driver.bat as Administrator to install the driver.
    echo.
)

:: Start UI
cd /d "%~dp0"
start "" "ui\bin\Release\net8.0-windows\WfpSemanticGuard.exe"
