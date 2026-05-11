#!/bin/bash
# ============================================
# BYON Optimus - Stop Script
# ============================================
#
# Gracefully stops the BYON orchestration system.
#
# Usage:
#   ./scripts/stop-byon.sh           # Stop all services
#   ./scripts/stop-byon.sh --clean   # Stop and remove volumes
#   ./scripts/stop-byon.sh --hard    # Force stop (kill)
#
# Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac
# ============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Default values
CLEAN=false
HARD=false
REMOVE_IMAGES=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --clean|-c)
            CLEAN=true
            shift
            ;;
        --hard|-H)
            HARD=true
            shift
            ;;
        --remove-images|-r)
            REMOVE_IMAGES=true
            shift
            ;;
        --help|-h)
            echo "BYON Optimus - Stop Script"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --clean, -c         Stop and remove volumes (data will be lost!)"
            echo "  --hard, -H          Force stop (docker kill instead of stop)"
            echo "  --remove-images, -r Also remove Docker images"
            echo "  --help, -h          Show this help"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

cd "$PROJECT_ROOT"

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     BYON Optimus - Stopping System         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# ============================================
# Stop Executor first (air-gapped)
# ============================================
echo -e "${YELLOW}[1/4] Stopping executor (if running)...${NC}"

if docker ps -q -f name=byon-executor | grep -q .; then
    if [ "$HARD" = true ]; then
        docker kill byon-executor 2>/dev/null || true
    else
        docker stop byon-executor 2>/dev/null || true
    fi
    echo -e "${GREEN}✓ Executor stopped${NC}"
else
    echo -e "${YELLOW}  Executor not running${NC}"
fi

# ============================================
# Stop all services
# ============================================
echo -e "${YELLOW}[2/4] Stopping all services...${NC}"

if [ "$HARD" = true ]; then
    echo -e "${YELLOW}  Force stopping (kill)...${NC}"
    docker-compose kill 2>/dev/null || true
else
    docker-compose stop
fi

echo -e "${GREEN}✓ Services stopped${NC}"

# ============================================
# Remove containers
# ============================================
echo -e "${YELLOW}[3/4] Removing containers...${NC}"

if [ "$CLEAN" = true ]; then
    echo -e "${YELLOW}  Removing containers AND volumes...${NC}"
    docker-compose down -v --remove-orphans
    echo -e "${RED}  WARNING: Volumes removed - data may be lost${NC}"
else
    docker-compose down --remove-orphans
fi

echo -e "${GREEN}✓ Containers removed${NC}"

# ============================================
# Remove images if requested
# ============================================
if [ "$REMOVE_IMAGES" = true ]; then
    echo -e "${YELLOW}[4/4] Removing Docker images...${NC}"

    # Remove project images
    docker images --filter "reference=byon_optimus*" -q | xargs -r docker rmi -f 2>/dev/null || true
    docker images --filter "reference=byon-*" -q | xargs -r docker rmi -f 2>/dev/null || true

    echo -e "${GREEN}✓ Images removed${NC}"
else
    echo -e "${YELLOW}[4/4] Keeping Docker images (use --remove-images to delete)${NC}"
fi

# ============================================
# Summary
# ============================================
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     BYON Optimus - System Stopped          ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""

if [ "$CLEAN" = true ]; then
    echo -e "${RED}Volumes were removed. To start fresh:${NC}"
    echo -e "  ./scripts/start-byon.sh --build"
else
    echo -e "Data preserved. To restart:"
    echo -e "  ./scripts/start-byon.sh"
fi
echo ""

# Show remaining containers if any
REMAINING=$(docker ps -a --filter "name=byon" -q | wc -l)
if [ "$REMAINING" -gt 0 ]; then
    echo -e "${YELLOW}Note: $REMAINING BYON container(s) still exist (stopped)${NC}"
    echo -e "  Run: docker-compose down --remove-orphans"
fi
