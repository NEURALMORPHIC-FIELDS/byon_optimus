@echo off
:: BYON Optimus - Cleanup Script
:: Removes all Docker containers, images, and volumes from failed installations
:: Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac

echo.
echo ============================================
echo   BYON Optimus - CLEANUP
echo   This will remove all Docker resources
echo ============================================
echo.
echo WARNING: This will delete:
echo   - All byon_optimus containers
echo   - All byon_optimus images
echo   - All byon_optimus volumes
echo   - Dangling images and build cache
echo.
pause

cd /d "%~dp0"

echo.
echo [1/6] Stopping all containers...
docker compose down 2>nul

echo.
echo [2/6] Removing byon containers...
for /f "tokens=*" %%i in ('docker ps -a -q --filter "name=byon" 2^>nul') do docker rm -f %%i 2>nul

echo.
echo [3/6] Removing byon images...
for /f "tokens=*" %%i in ('docker images -q "byon_optimus*" 2^>nul') do docker rmi -f %%i 2>nul
for /f "tokens=*" %%i in ('docker images -q "*byon*" 2^>nul') do docker rmi -f %%i 2>nul

echo.
echo [4/6] Removing byon volumes...
for /f "tokens=*" %%i in ('docker volume ls -q --filter "name=byon" 2^>nul') do docker volume rm -f %%i 2>nul

echo.
echo [5/6] Removing dangling images...
docker image prune -f 2>nul

echo.
echo [6/6] Removing build cache...
docker builder prune -f 2>nul

echo.
echo ============================================
echo   CLEANUP COMPLETE
echo ============================================
echo.
echo You can now run INSTALL-CLICK-HERE.bat
echo to start a fresh installation.
echo.
pause
