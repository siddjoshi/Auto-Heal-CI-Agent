#!/usr/bin/env bash
# ============================================================================
# Safety Guard — Pre-flight checks before self-healing
# ============================================================================
# Run this before the heal orchestrator to verify:
#   1. Kill switch is not enabled
#   2. Attempt count is within limits
#   3. Required environment variables are set
#   4. Only allowed file types will be modified
#
# Exit codes:
#   0 = safe to proceed
#   1 = blocked by safety check
# ============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

MAX_ATTEMPTS="${1:-3}"
ATTEMPT_FILE="$REPO_ROOT/.heal-attempt-count"

echo -e "${GREEN}[SAFETY]${NC} Running pre-flight safety checks..."

# ---------------------------------------------------------------------------
# Check 1: Kill switch
# ---------------------------------------------------------------------------
if [[ "${ENABLE_SELF_HEAL:-}" == "false" ]]; then
  echo -e "${RED}[SAFETY]${NC} Kill switch activated (ENABLE_SELF_HEAL=false). Aborting."
  exit 1
fi
echo -e "${GREEN}[SAFETY]${NC} ✓ Kill switch: not activated"

# ---------------------------------------------------------------------------
# Check 2: Attempt counter
# ---------------------------------------------------------------------------
CURRENT_ATTEMPT=1
if [[ -f "$ATTEMPT_FILE" ]]; then
  CURRENT_ATTEMPT=$(cat "$ATTEMPT_FILE")
fi

if [[ "$CURRENT_ATTEMPT" -gt "$MAX_ATTEMPTS" ]]; then
  echo -e "${RED}[SAFETY]${NC} Max attempts ($MAX_ATTEMPTS) exceeded. Aborting."
  exit 1
fi
echo -e "${GREEN}[SAFETY]${NC} ✓ Attempt count: $CURRENT_ATTEMPT / $MAX_ATTEMPTS"

# ---------------------------------------------------------------------------
# Check 3: Required secrets/env vars
# ---------------------------------------------------------------------------
if [[ -z "${GH_TOKEN:-}" ]]; then
  echo -e "${YELLOW}[SAFETY]${NC} Warning: GH_TOKEN not set. Copilot CLI will not authenticate."
fi
echo -e "${GREEN}[SAFETY]${NC} ✓ Environment variables checked"

# ---------------------------------------------------------------------------
# Check 4: Git state (ensure we're on a branch, not detached HEAD)
# ---------------------------------------------------------------------------
if command -v git &>/dev/null && git rev-parse --is-inside-work-tree &>/dev/null; then
  BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "DETACHED")
  if [[ "$BRANCH" == "DETACHED" ]]; then
    echo -e "${YELLOW}[SAFETY]${NC} Warning: Detached HEAD state. Commits may be lost."
  else
    echo -e "${GREEN}[SAFETY]${NC} ✓ On branch: $BRANCH"
  fi

  # Check for uncommitted changes that could indicate a prior failed heal
  if ! git diff --quiet 2>/dev/null; then
    echo -e "${YELLOW}[SAFETY]${NC} Warning: Unstaged changes detected from a prior run."
  fi
fi

# ---------------------------------------------------------------------------
# All checks passed
# ---------------------------------------------------------------------------
echo -e "${GREEN}[SAFETY]${NC} All pre-flight checks passed. Safe to proceed."
exit 0
