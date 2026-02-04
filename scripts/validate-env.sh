#!/bin/bash
# ============================================================================
# BYON Optimus - Environment Validation Script
# ============================================================================
# Validates .env configuration before deployment
# Usage: ./scripts/validate-env.sh
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
ERRORS=0
WARNINGS=0

# Load .env if exists
if [ -f ".env" ]; then
    set -a
    source .env
    set +a
else
    echo -e "${RED}ERROR: .env file not found${NC}"
    echo "  Copy .env.example to .env and configure it:"
    echo "  cp .env.example .env"
    exit 1
fi

echo ""
echo "============================================"
echo "BYON Optimus - Environment Validation"
echo "============================================"
echo ""

# ============================================================================
# REQUIRED VARIABLES
# ============================================================================

echo "Checking REQUIRED variables..."
echo ""

# ANTHROPIC_API_KEY
if [ -z "$ANTHROPIC_API_KEY" ] || [ "$ANTHROPIC_API_KEY" = "sk-ant-api03-your-key-here" ]; then
    echo -e "${RED}[ERROR] ANTHROPIC_API_KEY${NC} - Not configured"
    echo "        Get your key from: https://console.anthropic.com/"
    ((ERRORS++))
else
    if [[ "$ANTHROPIC_API_KEY" =~ ^sk-ant- ]]; then
        echo -e "${GREEN}[OK]${NC} ANTHROPIC_API_KEY - Configured (sk-ant-...)"
    else
        echo -e "${YELLOW}[WARN]${NC} ANTHROPIC_API_KEY - Unusual format (expected sk-ant-...)"
        ((WARNINGS++))
    fi
fi

# OPENCLAW_GATEWAY_TOKEN
if [ -z "$OPENCLAW_GATEWAY_TOKEN" ] || [ "$OPENCLAW_GATEWAY_TOKEN" = "your-generated-token-here" ]; then
    echo -e "${RED}[ERROR] OPENCLAW_GATEWAY_TOKEN${NC} - Not configured"
    echo "        Generate with: openssl rand -hex 32"
    ((ERRORS++))
else
    TOKEN_LEN=${#OPENCLAW_GATEWAY_TOKEN}
    if [ $TOKEN_LEN -ge 32 ]; then
        echo -e "${GREEN}[OK]${NC} OPENCLAW_GATEWAY_TOKEN - Configured (${TOKEN_LEN} chars)"
    else
        echo -e "${YELLOW}[WARN]${NC} OPENCLAW_GATEWAY_TOKEN - Token seems short (${TOKEN_LEN} chars, recommended 64)"
        ((WARNINGS++))
    fi
fi

# BYON_BRIDGE_SECRET
if [ -z "$BYON_BRIDGE_SECRET" ] || [ "$BYON_BRIDGE_SECRET" = "your-bridge-secret-here" ]; then
    echo -e "${YELLOW}[WARN]${NC} BYON_BRIDGE_SECRET - Not configured (HMAC signing disabled)"
    echo "        Generate with: openssl rand -hex 32"
    ((WARNINGS++))
else
    SECRET_LEN=${#BYON_BRIDGE_SECRET}
    if [ $SECRET_LEN -ge 32 ]; then
        echo -e "${GREEN}[OK]${NC} BYON_BRIDGE_SECRET - Configured (${SECRET_LEN} chars)"
    else
        echo -e "${YELLOW}[WARN]${NC} BYON_BRIDGE_SECRET - Secret seems short (${SECRET_LEN} chars, recommended 64)"
        ((WARNINGS++))
    fi
fi

# REDIS_PASSWORD
if [ -z "$REDIS_PASSWORD" ]; then
    echo -e "${YELLOW}[WARN]${NC} REDIS_PASSWORD - Not set (Redis accessible without auth)"
    echo "        Recommended for production: openssl rand -hex 24"
    ((WARNINGS++))
else
    echo -e "${GREEN}[OK]${NC} REDIS_PASSWORD - Configured"
fi

echo ""

# ============================================================================
# CHANNEL CREDENTIALS (at least one required)
# ============================================================================

echo "Checking CHANNEL credentials (at least one required)..."
echo ""

CHANNELS_CONFIGURED=0

# Telegram
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    echo -e "${GREEN}[OK]${NC} TELEGRAM_BOT_TOKEN - Configured"
    ((CHANNELS_CONFIGURED++))
fi

# Discord
if [ -n "$DISCORD_TOKEN" ]; then
    echo -e "${GREEN}[OK]${NC} DISCORD_TOKEN - Configured"
    ((CHANNELS_CONFIGURED++))
fi

# Slack
if [ -n "$SLACK_TOKEN" ]; then
    echo -e "${GREEN}[OK]${NC} SLACK_TOKEN - Configured"
    ((CHANNELS_CONFIGURED++))
fi

# WhatsApp
if [ -n "$WHATSAPP_API_KEY" ]; then
    echo -e "${GREEN}[OK]${NC} WHATSAPP_API_KEY - Configured"
    ((CHANNELS_CONFIGURED++))
fi

# Matrix
if [ -n "$MATRIX_ACCESS_TOKEN" ]; then
    echo -e "${GREEN}[OK]${NC} MATRIX_ACCESS_TOKEN - Configured"
    ((CHANNELS_CONFIGURED++))
fi

# Email
if [ -n "$EMAIL_SMTP_HOST" ]; then
    echo -e "${GREEN}[OK]${NC} EMAIL_SMTP_HOST - Configured"
    ((CHANNELS_CONFIGURED++))
fi

if [ $CHANNELS_CONFIGURED -eq 0 ]; then
    echo -e "${YELLOW}[WARN]${NC} No channels configured - BYON will have no communication channels"
    echo "        Configure at least one: TELEGRAM_BOT_TOKEN, DISCORD_TOKEN, SLACK_TOKEN, etc."
    ((WARNINGS++))
else
    echo ""
    echo "  Total channels configured: $CHANNELS_CONFIGURED"
fi

echo ""

# ============================================================================
# OPTIONAL SETTINGS
# ============================================================================

echo "Checking OPTIONAL settings..."
echo ""

# LOG_LEVEL
if [ -n "$LOG_LEVEL" ]; then
    case "$LOG_LEVEL" in
        debug|info|warn|error)
            echo -e "${GREEN}[OK]${NC} LOG_LEVEL=$LOG_LEVEL"
            ;;
        *)
            echo -e "${YELLOW}[WARN]${NC} LOG_LEVEL=$LOG_LEVEL - Unknown value (use: debug, info, warn, error)"
            ((WARNINGS++))
            ;;
    esac
else
    echo -e "${GREEN}[OK]${NC} LOG_LEVEL - Using default (info)"
fi

# NODE_ENV
if [ -n "$NODE_ENV" ]; then
    case "$NODE_ENV" in
        production|development)
            echo -e "${GREEN}[OK]${NC} NODE_ENV=$NODE_ENV"
            ;;
        *)
            echo -e "${YELLOW}[WARN]${NC} NODE_ENV=$NODE_ENV - Unusual value (expected: production, development)"
            ((WARNINGS++))
            ;;
    esac
else
    echo -e "${GREEN}[OK]${NC} NODE_ENV - Using default (production)"
fi

# DISABLE_GMV_DAEMON
if [ "$DISABLE_GMV_DAEMON" = "true" ]; then
    echo -e "${GREEN}[OK]${NC} DISABLE_GMV_DAEMON=true (MVP mode)"
else
    echo -e "${GREEN}[OK]${NC} DISABLE_GMV_DAEMON - GMV daemon will be enabled"
fi

echo ""

# ============================================================================
# FILE/DIRECTORY CHECKS
# ============================================================================

echo "Checking required directories..."
echo ""

# Check handoff directories
HANDOFF_DIRS=("handoff/inbox" "handoff/outbox" "handoff/worker_to_auditor" "handoff/auditor_to_user" "handoff/auditor_to_executor" "handoff/executor_to_worker")

for DIR in "${HANDOFF_DIRS[@]}"; do
    if [ -d "$DIR" ]; then
        echo -e "${GREEN}[OK]${NC} $DIR exists"
    else
        echo -e "${YELLOW}[INFO]${NC} $DIR - Will be created on startup"
    fi
done

# Check keys directory
if [ -d "keys" ]; then
    echo -e "${GREEN}[OK]${NC} keys/ directory exists"
    if [ -f "keys/private/auditor.key" ]; then
        echo -e "${GREEN}[OK]${NC} keys/private/auditor.key exists"
    else
        echo -e "${YELLOW}[WARN]${NC} keys/private/auditor.key not found - Run: ./scripts/setup-keys.sh"
        ((WARNINGS++))
    fi
else
    echo -e "${YELLOW}[WARN]${NC} keys/ directory not found - Run: ./scripts/setup-keys.sh"
    ((WARNINGS++))
fi

# Check memory directory
if [ -d "memory" ]; then
    echo -e "${GREEN}[OK]${NC} memory/ directory exists"
else
    echo -e "${YELLOW}[INFO]${NC} memory/ - Will be created on startup"
fi

echo ""

# ============================================================================
# SUMMARY
# ============================================================================

echo "============================================"
echo "VALIDATION SUMMARY"
echo "============================================"

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}All checks passed!${NC}"
    echo ""
    echo "Ready to deploy:"
    echo "  docker-compose up -d"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}$WARNINGS warning(s), 0 errors${NC}"
    echo ""
    echo "You can proceed with deployment, but review warnings above."
    echo "  docker-compose up -d"
    exit 0
else
    echo -e "${RED}$ERRORS error(s), $WARNINGS warning(s)${NC}"
    echo ""
    echo "Please fix the errors above before deploying."
    exit 1
fi
