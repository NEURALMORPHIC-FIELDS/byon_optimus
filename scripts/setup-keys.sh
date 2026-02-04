#!/bin/bash
# ============================================
# BYON Optimus - Key Setup Script
# ============================================
#
# Generates Ed25519 key pairs for the BYON security system.
# The Auditor uses these keys to sign Execution Orders.
# The Executor verifies signatures before executing.
#
# Usage:
#   ./scripts/setup-keys.sh           # Generate keys
#   ./scripts/setup-keys.sh --force   # Regenerate (overwrite existing)
#   ./scripts/setup-keys.sh --verify  # Verify existing keys
#
# Key Locations:
#   keys/auditor.private.pem  - Private key (Auditor only)
#   keys/auditor.public.pem   - Public key (Executor reads)
#   keys/public/              - Public keys directory for Executor
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

# Key paths
KEYS_DIR="$PROJECT_ROOT/keys"
PRIVATE_KEY="$KEYS_DIR/auditor.private.pem"
PUBLIC_KEY="$KEYS_DIR/auditor.public.pem"
PUBLIC_DIR="$KEYS_DIR/public"

# Default values
FORCE=false
VERIFY_ONLY=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --force|-f)
            FORCE=true
            shift
            ;;
        --verify|-v)
            VERIFY_ONLY=true
            shift
            ;;
        --help|-h)
            echo "BYON Optimus - Key Setup Script"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --force, -f   Regenerate keys (overwrites existing)"
            echo "  --verify, -v  Verify existing keys without generating"
            echo "  --help, -h    Show this help"
            echo ""
            echo "Generated keys:"
            echo "  keys/auditor.private.pem  - Private key for Auditor"
            echo "  keys/auditor.public.pem   - Public key for verification"
            echo "  keys/public/              - Public keys directory for Executor"
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
echo -e "${BLUE}║     BYON Optimus - Key Setup               ║${NC}"
echo -e "${BLUE}║     Algorithm: Ed25519                     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# ============================================
# Check OpenSSL
# ============================================
check_openssl() {
    if ! command -v openssl &> /dev/null; then
        echo -e "${RED}ERROR: OpenSSL is not installed${NC}"
        echo "Please install OpenSSL:"
        echo "  Ubuntu/Debian: sudo apt install openssl"
        echo "  MacOS: brew install openssl"
        echo "  Windows: Install from https://slproweb.com/products/Win32OpenSSL.html"
        exit 1
    fi

    # Check OpenSSL version supports Ed25519
    local version=$(openssl version)
    echo -e "OpenSSL: $version"

    # Ed25519 requires OpenSSL 1.1.1+
    if ! openssl genpkey -algorithm ed25519 2>&1 | grep -q "algorithm"; then
        # Test actual generation
        if ! openssl genpkey -algorithm ed25519 -out /dev/null 2>/dev/null; then
            echo -e "${YELLOW}WARNING: OpenSSL may not support Ed25519${NC}"
            echo -e "Falling back to RSA-4096..."
            return 1
        fi
    fi

    return 0
}

# ============================================
# Verify Existing Keys
# ============================================
verify_keys() {
    echo -e "${YELLOW}Verifying existing keys...${NC}"
    echo ""

    local all_valid=true

    # Check private key
    if [ -f "$PRIVATE_KEY" ]; then
        if openssl pkey -in "$PRIVATE_KEY" -check -noout 2>/dev/null; then
            echo -e "  ${GREEN}●${NC} Private key: Valid"
        else
            echo -e "  ${RED}●${NC} Private key: Invalid or corrupted"
            all_valid=false
        fi
    else
        echo -e "  ${RED}●${NC} Private key: Not found"
        all_valid=false
    fi

    # Check public key
    if [ -f "$PUBLIC_KEY" ]; then
        if openssl pkey -in "$PUBLIC_KEY" -pubin -check -noout 2>/dev/null; then
            echo -e "  ${GREEN}●${NC} Public key: Valid"
        else
            echo -e "  ${RED}●${NC} Public key: Invalid or corrupted"
            all_valid=false
        fi
    else
        echo -e "  ${RED}●${NC} Public key: Not found"
        all_valid=false
    fi

    # Check public directory
    if [ -d "$PUBLIC_DIR" ] && [ -f "$PUBLIC_DIR/auditor.public.pem" ]; then
        echo -e "  ${GREEN}●${NC} Public directory: Ready"
    else
        echo -e "  ${YELLOW}●${NC} Public directory: Needs setup"
        all_valid=false
    fi

    echo ""

    if [ "$all_valid" = true ]; then
        # Test sign/verify cycle
        echo -e "${YELLOW}Testing sign/verify cycle...${NC}"
        local test_data="BYON-TEST-$(date +%s)"
        local test_sig="/tmp/byon-test-sig-$$"

        if echo -n "$test_data" | openssl pkeyutl -sign -inkey "$PRIVATE_KEY" -out "$test_sig" 2>/dev/null; then
            if echo -n "$test_data" | openssl pkeyutl -verify -pubin -inkey "$PUBLIC_KEY" -sigfile "$test_sig" 2>/dev/null; then
                echo -e "  ${GREEN}●${NC} Sign/Verify: Working"
                rm -f "$test_sig"
                return 0
            fi
        fi

        rm -f "$test_sig"
        echo -e "  ${RED}●${NC} Sign/Verify: Failed"
        return 1
    fi

    return 1
}

# ============================================
# Generate Keys
# ============================================
generate_keys() {
    local use_ed25519=true

    # Check if Ed25519 is supported
    if ! check_openssl; then
        use_ed25519=false
    fi

    echo ""

    # Check existing keys
    if [ -f "$PRIVATE_KEY" ] && [ "$FORCE" = false ]; then
        echo -e "${YELLOW}Keys already exist at $KEYS_DIR${NC}"
        echo -e "Use --force to regenerate"
        echo ""
        verify_keys
        return
    fi

    # Create directories
    echo -e "${YELLOW}[1/4] Creating directories...${NC}"
    mkdir -p "$KEYS_DIR"
    mkdir -p "$PUBLIC_DIR"
    echo -e "${GREEN}✓ Directories created${NC}"

    # Generate keys
    echo -e "${YELLOW}[2/4] Generating key pair...${NC}"

    if [ "$use_ed25519" = true ]; then
        # Ed25519 (preferred)
        openssl genpkey -algorithm ed25519 -out "$PRIVATE_KEY"
        openssl pkey -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY"
        echo -e "${GREEN}✓ Ed25519 key pair generated${NC}"
    else
        # Fallback to RSA-4096
        echo -e "${YELLOW}Using RSA-4096 (Ed25519 not available)${NC}"
        openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out "$PRIVATE_KEY"
        openssl pkey -in "$PRIVATE_KEY" -pubout -out "$PUBLIC_KEY"
        echo -e "${GREEN}✓ RSA-4096 key pair generated${NC}"
    fi

    # Copy public key to public directory (for Executor)
    echo -e "${YELLOW}[3/4] Setting up public key directory...${NC}"
    cp "$PUBLIC_KEY" "$PUBLIC_DIR/auditor.public.pem"
    echo -e "${GREEN}✓ Public key copied to $PUBLIC_DIR${NC}"

    # Set permissions
    echo -e "${YELLOW}[4/4] Setting permissions...${NC}"
    chmod 600 "$PRIVATE_KEY"
    chmod 644 "$PUBLIC_KEY"
    chmod 644 "$PUBLIC_DIR/auditor.public.pem"
    echo -e "${GREEN}✓ Permissions set${NC}"

    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║     Keys Generated Successfully            ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "Key locations:"
    echo -e "  Private key: ${BLUE}$PRIVATE_KEY${NC}"
    echo -e "  Public key:  ${BLUE}$PUBLIC_KEY${NC}"
    echo -e "  Executor:    ${BLUE}$PUBLIC_DIR/auditor.public.pem${NC}"
    echo ""
    echo -e "${RED}IMPORTANT:${NC}"
    echo -e "  - Keep the private key secure!"
    echo -e "  - Only the Auditor should have access to the private key"
    echo -e "  - The Executor only needs the public key (in keys/public/)"
    echo ""

    # Verify the generated keys
    verify_keys
}

# ============================================
# Main
# ============================================

if [ "$VERIFY_ONLY" = true ]; then
    verify_keys
    exit $?
else
    generate_keys
fi
