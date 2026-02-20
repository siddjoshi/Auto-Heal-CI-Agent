#!/usr/bin/env bash
# ============================================================================
# Post-heal validation — ensures Copilot only modified allowed files
# ============================================================================
# Scans git diff to verify no protected files were modified.
#
# Protected paths:
#   - .github/workflows/
#   - .github/agents/
#   - .github/skills/
#   - scripts/
#
# Exit codes:
#   0 = all changes are safe
#   1 = protected files were modified (reverted automatically)
# ============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}[VALIDATE]${NC} Checking modified files..."

# Get list of modified files
CHANGED_FILES=$(git diff --name-only 2>/dev/null || echo "")
STAGED_FILES=$(git diff --cached --name-only 2>/dev/null || echo "")
ALL_CHANGED=$(echo -e "$CHANGED_FILES\n$STAGED_FILES" | sort -u | grep -v '^$' || true)

if [[ -z "$ALL_CHANGED" ]]; then
  echo -e "${YELLOW}[VALIDATE]${NC} No files changed."
  exit 0
fi

echo -e "${GREEN}[VALIDATE]${NC} Changed files:"
echo "$ALL_CHANGED" | sed 's/^/  /'

# Define protected paths
PROTECTED_PATTERNS=(
  "^\.github/workflows/"
  "^\.github/agents/"
  "^\.github/skills/"
  "^\.github/instructions/"
  "^scripts/"
  "^\.eslintrc"
  "^package\.json$"
  "^package-lock\.json$"
)

VIOLATIONS=()

while IFS= read -r file; do
  for pattern in "${PROTECTED_PATTERNS[@]}"; do
    if echo "$file" | grep -qE "$pattern"; then
      VIOLATIONS+=("$file")
      break
    fi
  done
done <<< "$ALL_CHANGED"

if [[ ${#VIOLATIONS[@]} -gt 0 ]]; then
  echo -e "${RED}[VALIDATE]${NC} Protected files were modified:"
  for v in "${VIOLATIONS[@]}"; do
    echo -e "${RED}  ✗ $v${NC}"
  done

  echo -e "${YELLOW}[VALIDATE]${NC} Reverting protected file changes..."
  for v in "${VIOLATIONS[@]}"; do
    git checkout -- "$v" 2>/dev/null || true
  done

  echo -e "${GREEN}[VALIDATE]${NC} Protected files reverted. Only src/ and tests/ changes remain."
fi

# Verify allowed files
ALLOWED_COUNT=0
while IFS= read -r file; do
  if echo "$file" | grep -qE "^(src/|tests/)"; then
    ALLOWED_COUNT=$((ALLOWED_COUNT + 1))
    echo -e "${GREEN}  ✓ $file${NC}"
  fi
done <<< "$ALL_CHANGED"

if [[ "$ALLOWED_COUNT" -eq 0 ]]; then
  echo -e "${RED}[VALIDATE]${NC} No allowed file changes found."
  exit 1
fi

echo -e "${GREEN}[VALIDATE]${NC} Validation passed: $ALLOWED_COUNT file(s) in allowed paths."
exit 0
