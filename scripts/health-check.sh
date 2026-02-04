#!/bin/bash
# ============================================
# BYON Optimus - Health Check Script
# ============================================
#
# Checks the health status of all BYON services.
#
# Usage:
#   ./scripts/health-check.sh           # Check all services
#   ./scripts/health-check.sh --json    # Output as JSON
#   ./scripts/health-check.sh --watch   # Continuous monitoring
#
# Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac
# ============================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Default values
JSON_OUTPUT=false
WATCH_MODE=false
WATCH_INTERVAL=5

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --json|-j)
            JSON_OUTPUT=true
            shift
            ;;
        --watch|-w)
            WATCH_MODE=true
            shift
            ;;
        --interval|-i)
            WATCH_INTERVAL="$2"
            shift 2
            ;;
        --help|-h)
            echo "BYON Optimus - Health Check Script"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --json, -j            Output as JSON"
            echo "  --watch, -w           Continuous monitoring"
            echo "  --interval N, -i N    Watch interval in seconds (default: 5)"
            echo "  --help, -h            Show this help"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

cd "$PROJECT_ROOT"

# ============================================
# Health Check Functions
# ============================================

check_memory_service() {
    local status="unknown"
    local latency="N/A"
    local details=""

    local start_time=$(date +%s%N)
    local response=$(curl -s -w "\n%{http_code}" http://localhost:8000/health 2>/dev/null)
    local end_time=$(date +%s%N)

    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n-1)

    if [ "$http_code" = "200" ]; then
        status="healthy"
        latency=$(( (end_time - start_time) / 1000000 ))
        details="$body"
    elif [ -z "$http_code" ] || [ "$http_code" = "000" ]; then
        status="offline"
    else
        status="unhealthy"
        details="HTTP $http_code"
    fi

    echo "$status|$latency|$details"
}

check_container_health() {
    local container=$1
    local status="unknown"
    local details=""

    # Check if container exists
    if ! docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
        echo "not_found|N/A|Container does not exist"
        return
    fi

    # Check if container is running
    local running=$(docker ps --filter "name=^${container}$" --format '{{.Status}}')
    if [ -z "$running" ]; then
        echo "stopped|N/A|Container is not running"
        return
    fi

    # Check health status
    local health=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null)
    if [ -z "$health" ] || [ "$health" = "<no value>" ]; then
        # No health check defined
        status="running"
        details="$running"
    elif [ "$health" = "healthy" ]; then
        status="healthy"
        details="$running"
    elif [ "$health" = "starting" ]; then
        status="starting"
        details="$running"
    else
        status="unhealthy"
        details="$health - $running"
    fi

    echo "$status|N/A|$details"
}

check_redis() {
    local status="unknown"
    local details=""

    local response=$(docker exec byon-redis redis-cli ping 2>/dev/null)
    if [ "$response" = "PONG" ]; then
        status="healthy"
        details="PONG"
    elif [ -z "$response" ]; then
        status="offline"
        details="Cannot connect"
    else
        status="unhealthy"
        details="$response"
    fi

    echo "$status|N/A|$details"
}

check_handoff_dirs() {
    local status="healthy"
    local details=""
    local dirs=("inbox" "worker_to_auditor" "auditor_to_user" "auditor_to_executor" "executor_to_worker")

    for dir in "${dirs[@]}"; do
        if [ ! -d "handoff/$dir" ]; then
            status="warning"
            details="$details Missing: $dir;"
        fi
    done

    if [ -z "$details" ]; then
        details="All directories present"
    fi

    echo "$status|N/A|$details"
}

count_pending_files() {
    local dir=$1
    if [ -d "$dir" ]; then
        find "$dir" -name "*.json" 2>/dev/null | wc -l
    else
        echo "0"
    fi
}

# ============================================
# Main Health Check
# ============================================

run_health_check() {
    local timestamp=$(date -Iseconds)

    # Check all services
    local memory_result=$(check_memory_service)
    local worker_result=$(check_container_health "byon-worker")
    local auditor_result=$(check_container_health "byon-auditor")
    local executor_result=$(check_container_health "byon-executor")
    local gateway_result=$(check_container_health "openclaw-gateway")
    local redis_result=$(check_redis)
    local handoff_result=$(check_handoff_dirs)

    # Count pending items
    local pending_approvals=$(count_pending_files "handoff/auditor_to_user")
    local pending_executions=$(count_pending_files "handoff/auditor_to_executor")
    local pending_receipts=$(count_pending_files "handoff/executor_to_worker")
    local inbox_messages=$(count_pending_files "handoff/inbox")

    if [ "$JSON_OUTPUT" = true ]; then
        # JSON output
        cat << EOF
{
  "timestamp": "$timestamp",
  "services": {
    "memory_service": {
      "status": "$(echo $memory_result | cut -d'|' -f1)",
      "latency_ms": "$(echo $memory_result | cut -d'|' -f2)",
      "details": "$(echo $memory_result | cut -d'|' -f3)"
    },
    "byon_worker": {
      "status": "$(echo $worker_result | cut -d'|' -f1)",
      "details": "$(echo $worker_result | cut -d'|' -f3)"
    },
    "byon_auditor": {
      "status": "$(echo $auditor_result | cut -d'|' -f1)",
      "details": "$(echo $auditor_result | cut -d'|' -f3)"
    },
    "byon_executor": {
      "status": "$(echo $executor_result | cut -d'|' -f1)",
      "details": "$(echo $executor_result | cut -d'|' -f3)"
    },
    "openclaw_gateway": {
      "status": "$(echo $gateway_result | cut -d'|' -f1)",
      "details": "$(echo $gateway_result | cut -d'|' -f3)"
    },
    "redis": {
      "status": "$(echo $redis_result | cut -d'|' -f1)",
      "details": "$(echo $redis_result | cut -d'|' -f3)"
    }
  },
  "handoff": {
    "status": "$(echo $handoff_result | cut -d'|' -f1)",
    "pending_approvals": $pending_approvals,
    "pending_executions": $pending_executions,
    "pending_receipts": $pending_receipts,
    "inbox_messages": $inbox_messages
  }
}
EOF
    else
        # Human-readable output
        echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
        echo -e "${BLUE}║     BYON Optimus - Health Status           ║${NC}"
        echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
        echo -e "  Timestamp: $timestamp"
        echo ""

        echo -e "${CYAN}Services:${NC}"

        # Memory Service
        local mem_status=$(echo $memory_result | cut -d'|' -f1)
        local mem_latency=$(echo $memory_result | cut -d'|' -f2)
        print_status "Memory Service" "$mem_status" "(${mem_latency}ms)"

        # Worker
        local worker_status=$(echo $worker_result | cut -d'|' -f1)
        print_status "BYON Worker" "$worker_status"

        # Auditor
        local auditor_status=$(echo $auditor_result | cut -d'|' -f1)
        print_status "BYON Auditor" "$auditor_status"

        # Executor
        local executor_status=$(echo $executor_result | cut -d'|' -f1)
        print_status "BYON Executor" "$executor_status" "(air-gapped)"

        # Gateway
        local gateway_status=$(echo $gateway_result | cut -d'|' -f1)
        print_status "OpenClaw Gateway" "$gateway_status"

        # Redis
        local redis_status=$(echo $redis_result | cut -d'|' -f1)
        print_status "Redis" "$redis_status"

        echo ""
        echo -e "${CYAN}Handoff Queues:${NC}"
        echo -e "  Pending Approvals:   $pending_approvals"
        echo -e "  Pending Executions:  $pending_executions"
        echo -e "  Pending Receipts:    $pending_receipts"
        echo -e "  Inbox Messages:      $inbox_messages"
        echo ""
    fi
}

print_status() {
    local name=$1
    local status=$2
    local extra=$3

    local icon=""
    local color=""

    case $status in
        healthy|running)
            icon="●"
            color=$GREEN
            ;;
        starting)
            icon="◐"
            color=$YELLOW
            ;;
        unhealthy|stopped|offline)
            icon="●"
            color=$RED
            ;;
        warning)
            icon="▲"
            color=$YELLOW
            ;;
        *)
            icon="○"
            color=$YELLOW
            ;;
    esac

    printf "  ${color}${icon}${NC} %-20s %s %s\n" "$name" "$status" "$extra"
}

# ============================================
# Run
# ============================================

if [ "$WATCH_MODE" = true ]; then
    echo -e "${YELLOW}Watching health status (Ctrl+C to stop)...${NC}"
    echo ""
    while true; do
        clear
        run_health_check
        echo ""
        echo -e "${YELLOW}Refreshing in ${WATCH_INTERVAL}s... (Ctrl+C to stop)${NC}"
        sleep "$WATCH_INTERVAL"
    done
else
    run_health_check
fi
