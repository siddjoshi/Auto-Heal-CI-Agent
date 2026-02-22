#!/usr/bin/env bash
# ============================================================================
# Generic self-healing CI adapter
# ============================================================================
# Works with any CI system: Jenkins, CircleCI, Buildkite, Travis, etc.
#
# Prerequisites:
#   - Node.js 20+
#   - npm
#   - git
#
# Usage:
#   export HEAL_BACKEND=llm-api
#   export OPENAI_API_KEY=sk-...
#   bash adapters/generic/heal.sh [options]
#
# Options:
#   --log-file <path>     CI log file (default: ci.log)
#   --backend <name>      Override HEAL_BACKEND env var
#   --language <lang>     Override HEAL_LANGUAGE env var
#   --commit-mode <mode>  push|pr|none (default: none)
#   --attempt <n>         Attempt number (default: 1)
#   --max-attempts <n>    Max attempts (default: 3)
#   --dry-run             Diagnose only
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Defaults
LOG_FILE="${LOG_FILE:-ci.log}"
BACKEND="${HEAL_BACKEND:-llm-api}"
LANGUAGE="${HEAL_LANGUAGE:-node}"
COMMIT_MODE="none"
ATTEMPT=1
MAX_ATTEMPTS="${HEAL_MAX_ATTEMPTS:-3}"
DRY_RUN=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --log-file) LOG_FILE="$2"; shift 2 ;;
    --backend) BACKEND="$2"; shift 2 ;;
    --language) LANGUAGE="$2"; shift 2 ;;
    --commit-mode) COMMIT_MODE="$2"; shift 2 ;;
    --attempt) ATTEMPT="$2"; shift 2 ;;
    --max-attempts) MAX_ATTEMPTS="$2"; shift 2 ;;
    --dry-run) DRY_RUN="--dry-run"; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "[heal] Starting self-healing CI agent..."
echo "[heal] Backend: $BACKEND"
echo "[heal] Language: $LANGUAGE"
echo "[heal] Log file: $LOG_FILE"
echo "[heal] Attempt: $ATTEMPT / $MAX_ATTEMPTS"

# Ensure dependencies are installed
cd "$REPO_ROOT"
if [ ! -d "node_modules" ]; then
  echo "[heal] Installing dependencies..."
  npm ci --ignore-scripts 2>/dev/null || npm install 2>/dev/null || true
fi

# Run the engine
ARGS="--backend $BACKEND"
ARGS="$ARGS --language $LANGUAGE"
ARGS="$ARGS --log-file $LOG_FILE"
ARGS="$ARGS --attempt $ATTEMPT"
ARGS="$ARGS --max-attempts $MAX_ATTEMPTS"
ARGS="$ARGS --commit-mode $COMMIT_MODE"
ARGS="$ARGS --verbose"

if [ -n "$DRY_RUN" ]; then
  ARGS="$ARGS --dry-run"
fi

# shellcheck disable=SC2086
node "$REPO_ROOT/engine/index.js" $ARGS
EXIT_CODE=$?

echo "[heal] Done (exit code: $EXIT_CODE)"
exit $EXIT_CODE
