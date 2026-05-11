#!/bin/bash
# ============================================
# BYON Optimus - Start Script
# ============================================
#
# Starts the BYON orchestration system with proper
# initialization order and health verification.
#
# Usage:
#   ./scripts/start-byon.sh           # Start all services
#   ./scripts/start-byon.sh --dev     # Start in development mode
#   ./scripts/start-byon.sh --build   # Rebuild images before starting
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
DEV_MODE=false
BUILD=false
DETACH=true

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dev|-d)
            DEV_MODE=true
            shift
            ;;
        --build|-b)
            BUILD=true
            shift
            ;;
        --foreground|-f)
            DETACH=false
            shift
            ;;
        --help|-h)
            echo "BYON Optimus - Start Script"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --dev, -d        Start in development mode (hot-reload)"
            echo "  --build, -b      Rebuild images before starting"
            echo "  --foreground, -f Run in foreground (don't detach)"
            echo "  --help, -h       Show this help"
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
echo -e "${BLUE}║     BYON Optimus - Starting System         ║${NC}"
echo -e "${BLUE}║     Patent: EP25216372.0 - OmniVault       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# ============================================
# Pre-flight checks
# ============================================
echo -e "${YELLOW}[1/6] Running pre-flight checks...${NC}"

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}ERROR: Docker is not installed${NC}"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo -e "${RED}ERROR: Docker daemon is not running${NC}"
    exit 1
fi

# Check docker-compose
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${RED}ERROR: docker-compose is not installed${NC}"
    exit 1
fi

# Check .env file
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}WARNING: .env file not found${NC}"
    if [ -f ".env.example" ]; then
        echo -e "${YELLOW}Creating .env from .env.example...${NC}"
        cp .env.example .env
        echo -e "${YELLOW}Please edit .env with your API keys before continuing${NC}"
    fi
fi

# Check ANTHROPIC_API_KEY
if [ -f ".env" ]; then
    source .env
    if [ -z "$ANTHROPIC_API_KEY" ] || [ "$ANTHROPIC_API_KEY" == "sk-ant-api03-your-key-here" ]; then
        echo -e "${RED}ERROR: ANTHROPIC_API_KEY not set in .env${NC}"
        echo -e "${YELLOW}Please add your Anthropic API key to .env${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✓ Pre-flight checks passed${NC}"

# ============================================
# Setup directories
# ============================================
echo -e "${YELLOW}[2/6] Setting up directories...${NC}"

# Create required directories
mkdir -p handoff/{inbox,worker_to_auditor,auditor_to_user,auditor_to_executor,executor_to_worker,outbox}
mkdir -p memory
mkdir -p keys
mkdir -p project

# Set permissions (for Linux/Mac)
if [[ "$OSTYPE" != "msys" && "$OSTYPE" != "win32" ]]; then
    chmod -R 777 handoff memory 2>/dev/null || true
fi

echo -e "${GREEN}✓ Directories ready${NC}"

# ============================================
# Setup keys if needed
# ============================================
echo -e "${YELLOW}[3/6] Checking Ed25519 keys...${NC}"

if [ ! -f "keys/auditor.private.pem" ] || [ ! -f "keys/auditor.public.pem" ]; then
    echo -e "${YELLOW}Keys not found, generating...${NC}"
    "$SCRIPT_DIR/setup-keys.sh"
fi

echo -e "${GREEN}✓ Keys ready${NC}"

# ============================================
# Build images if requested
# ============================================
if [ "$BUILD" = true ]; then
    echo -e "${YELLOW}[4/6] Building Docker images...${NC}"

    if [ "$DEV_MODE" = true ]; then
        docker-compose -f docker-compose.yml -f docker-compose.dev.yml build
    else
        docker-compose build
    fi

    echo -e "${GREEN}✓ Images built${NC}"
else
    echo -e "${YELLOW}[4/6] Skipping build (use --build to rebuild)${NC}"
fi

# ============================================
# Start services
# ============================================
echo -e "${YELLOW}[5/6] Starting services...${NC}"

COMPOSE_CMD="docker-compose"
if [ "$DEV_MODE" = true ]; then
    COMPOSE_CMD="docker-compose -f docker-compose.yml -f docker-compose.dev.yml"
    echo -e "${BLUE}Starting in DEVELOPMENT mode${NC}"
else
    echo -e "${BLUE}Starting in PRODUCTION mode${NC}"
fi

if [ "$DETACH" = true ]; then
    $COMPOSE_CMD up -d
else
    $COMPOSE_CMD up
    exit 0
fi

echo -e "${GREEN}✓ Services started${NC}"

# ============================================
# Wait for health
# ============================================
echo -e "${YELLOW}[6/6] Waiting for services to be healthy...${NC}"

# Wait for memory service
echo -n "  Waiting for memory-service..."
for i in {1..30}; do
    if curl -s http://localhost:8000/health > /dev/null 2>&1; then
        echo -e " ${GREEN}✓${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e " ${RED}TIMEOUT${NC}"
        echo -e "${RED}Memory service failed to start. Check logs:${NC}"
        echo "  docker-compose logs memory-service"
        exit 1
    fi
    sleep 2
    echo -n "."
done

# Wait for worker
echo -n "  Waiting for byon-worker..."
for i in {1..20}; do
    if docker ps --filter "name=byon-worker" --filter "health=healthy" | grep -q byon-worker; then
        echo -e " ${GREEN}✓${NC}"
        break
    fi
    if [ $i -eq 20 ]; then
        echo -e " ${YELLOW}SLOW (continuing)${NC}"
        break
    fi
    sleep 2
    echo -n "."
done

# Wait for auditor
echo -n "  Waiting for byon-auditor..."
for i in {1..20}; do
    if docker ps --filter "name=byon-auditor" --filter "health=healthy" | grep -q byon-auditor; then
        echo -e " ${GREEN}✓${NC}"
        break
    fi
    if [ $i -eq 20 ]; then
        echo -e " ${YELLOW}SLOW (continuing)${NC}"
        break
    fi
    sleep 2
    echo -n "."
done

# ============================================
# Summary
# ============================================
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     BYON Optimus - System Running          ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Services:"
echo -e "  ${GREEN}●${NC} Memory Service:    http://localhost:8000"
echo -e "  ${GREEN}●${NC} OpenClaw Gateway:  http://localhost:3000"
echo -e "  ${GREEN}●${NC} OpenClaw API:      http://localhost:8080"
echo ""
echo -e "Commands:"
echo -e "  View logs:         docker-compose logs -f"
echo -e "  Check health:      ./scripts/health-check.sh"
echo -e "  Stop system:       ./scripts/stop-byon.sh"
echo ""
if [ "$DEV_MODE" = true ]; then
    echo -e "${BLUE}Development mode active - hot-reload enabled${NC}"
    echo -e "  Redis Commander: http://localhost:8082 (if tools profile enabled)"
fi
