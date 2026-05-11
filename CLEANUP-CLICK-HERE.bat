@echo off
:: BYON Optimus - One-Click Cleanup
:: Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cleanup.ps1"
