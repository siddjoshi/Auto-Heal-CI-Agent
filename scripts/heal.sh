#!/usr/bin/env bash
# ============================================================================
# Self-Healing CI Orchestrator
# ============================================================================
# Analyzes CI failures using pluggable handlers, then invokes GitHub Copilot CLI
# to diagnose and fix the issue automatically.
#
# Usage: ./scripts/heal.sh [options]
#   --log-file <path>     Path to the CI log file (default: ci-output.log)
#   --max-attempts <n>    Maximum heal attempts (default: 3)
#   --mode <pr|direct>    Fix delivery mode (default: direct in CI, pr otherwise)
#   --dry-run             Diagnose only, do not apply fixes
#
# Environment:
#   GH_TOKEN              GitHub token with Copilot permissions (required)
#   GITHUB_REPOSITORY     Owner/repo (set by GitHub Actions)
#   GITHUB_SHA            Commit SHA (set by GitHub Actions)
#   GITHUB_REF_NAME       Branch name (set by GitHub Actions)
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HANDLERS_DIR="$SCRIPT_DIR/handlers"
PROMPTS_DIR="$SCRIPT_DIR/prompts"

# Defaults
LOG_FILE="${REPO_ROOT}/ci-output.log"
MAX_ATTEMPTS=3
MODE="direct"
DRY_RUN=false
ATTEMPT_FILE="${REPO_ROOT}/.heal-attempt-count"
AUDIT_DIR="${REPO_ROOT}/.heal-audit"

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ============================================================================
# Utility functions
# ============================================================================

log_info()  { echo -e "${BLUE}[HEAL]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[HEAL]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[HEAL]${NC} $*"; }
log_error() { echo -e "${RED}[HEAL]${NC} $*"; }

usage() {
  head -20 "$0" | grep '^#' | sed 's/^# *//'
  exit 1
}

# ============================================================================
# Parse arguments
# ============================================================================

while [[ $# -gt 0 ]]; do
  case "$1" in
    --log-file)    LOG_FILE="$2"; shift 2 ;;
    --max-attempts) MAX_ATTEMPTS="$2"; shift 2 ;;
    --mode)        MODE="$2"; shift 2 ;;
    --dry-run)     DRY_RUN=true; shift ;;
    -h|--help)     usage ;;
    *)             log_error "Unknown option: $1"; usage ;;
  esac
done

# ============================================================================
# Pre-flight checks
# ============================================================================

log_info "Starting self-healing orchestrator..."
log_info "Log file: $LOG_FILE"
log_info "Max attempts: $MAX_ATTEMPTS"
log_info "Mode: $MODE"
log_info "Dry run: $DRY_RUN"

# Run pre-flight safety checks
if [[ -f "$SCRIPT_DIR/safety-guard.sh" ]]; then
  if ! bash "$SCRIPT_DIR/safety-guard.sh" "$MAX_ATTEMPTS"; then
    log_error "Pre-flight safety checks failed. Aborting."
    exit 2
  fi
fi

# Check attempt count
CURRENT_ATTEMPT=1
if [[ -f "$ATTEMPT_FILE" ]]; then
  CURRENT_ATTEMPT=$(( $(cat "$ATTEMPT_FILE") + 1 ))
fi

if [[ "$CURRENT_ATTEMPT" -gt "$MAX_ATTEMPTS" ]]; then
  log_error "Maximum heal attempts ($MAX_ATTEMPTS) exhausted. Manual intervention required."
  exit 2
fi

echo "$CURRENT_ATTEMPT" > "$ATTEMPT_FILE"
log_info "Heal attempt: $CURRENT_ATTEMPT / $MAX_ATTEMPTS"

# Ensure audit directory exists
mkdir -p "$AUDIT_DIR"

# ============================================================================
# Step 1: Run failure handlers to classify the failure
# ============================================================================

log_info "Running failure handlers..."

DIAGNOSIS=""
FAILURE_TYPE=""
VALIDATION_CMD=""

for handler in "$HANDLERS_DIR"/*-handler.sh; do
  if [[ ! -f "$handler" ]]; then
    continue
  fi

  handler_name=$(basename "$handler" .sh)
  log_info "  Trying handler: $handler_name"

  if handler_output=$(bash "$handler" "$LOG_FILE" 2>/dev/null); then
    log_ok "  Handler matched: $handler_name"
    DIAGNOSIS="$handler_output"
    FAILURE_TYPE=$(echo "$handler_output" | node -e "
      let d=''; process.stdin.on('data',c=>d+=c);
      process.stdin.on('end',()=>{ try{console.log(JSON.parse(d).type)}catch(e){console.log('unknown')} });
    ")
    VALIDATION_CMD=$(echo "$handler_output" | node -e "
      let d=''; process.stdin.on('data',c=>d+=c);
      process.stdin.on('end',()=>{ try{console.log(JSON.parse(d).validationCommand)}catch(e){console.log('npm test')} });
    ")
    break
  fi
done

if [[ -z "$DIAGNOSIS" ]]; then
  log_warn "No handler matched the failure. Falling back to generic diagnosis."
  FAILURE_TYPE="unknown"
  VALIDATION_CMD="npm test"
  DIAGNOSIS='{"type":"unknown","healable":true,"failures":[],"relevantFiles":[]}'
fi

log_info "Failure type: $FAILURE_TYPE"

# Save diagnosis to audit log
AUDIT_FILE="$AUDIT_DIR/attempt-${CURRENT_ATTEMPT}.json"
cat > "$AUDIT_FILE" <<EOF
{
  "attempt": $CURRENT_ATTEMPT,
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "failureType": "$FAILURE_TYPE",
  "diagnosis": $DIAGNOSIS,
  "branch": "${GITHUB_REF_NAME:-local}",
  "commit": "${GITHUB_SHA:-unknown}"
}
EOF

log_info "Audit log saved: $AUDIT_FILE"

# ============================================================================
# Step 2: Build the Copilot prompt
# ============================================================================

log_info "Building Copilot prompt..."

# Read prompt template
PROMPT_TEMPLATE=$(cat "$PROMPTS_DIR/heal-prompt.md")

# Read CI log tail (last 200 lines)
CI_LOG_TAIL=""
if [[ -f "$LOG_FILE" ]]; then
  CI_LOG_TAIL=$(tail -200 "$LOG_FILE" 2>/dev/null || echo "Log file not readable")
fi

# Substitute template variables
PROMPT="$PROMPT_TEMPLATE"
PROMPT="${PROMPT//\{\{FAILURE_TYPE\}\}/$FAILURE_TYPE}"
PROMPT="${PROMPT//\{\{ATTEMPT_NUMBER\}\}/$CURRENT_ATTEMPT}"
PROMPT="${PROMPT//\{\{MAX_ATTEMPTS\}\}/$MAX_ATTEMPTS}"
PROMPT="${PROMPT//\{\{BRANCH_NAME\}\}/${GITHUB_REF_NAME:-local}}"
PROMPT="${PROMPT//\{\{COMMIT_SHA\}\}/${GITHUB_SHA:-unknown}}"
PROMPT="${PROMPT//\{\{VALIDATION_COMMAND\}\}/$VALIDATION_CMD}"

# Substitute multiline values using temp files
PROMPT=$(echo "$PROMPT" | sed "s|{{FAILURE_DETAILS}}|$(echo "$DIAGNOSIS" | sed 's/[&/\]/\\&/g' | tr '\n' ' ')|g")
PROMPT=$(echo "$PROMPT" | sed "s|{{CI_LOG_TAIL}}|See attached log file|g")

# ============================================================================
# Step 3: Invoke Copilot CLI
# ============================================================================

if [[ "$DRY_RUN" == "true" ]]; then
  log_warn "Dry run mode — skipping Copilot invocation."
  log_info "Diagnosis:"
  echo "$DIAGNOSIS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(d));"
  exit 0
fi

log_info "Invoking Copilot CLI for auto-heal..."

# Check if copilot CLI is available
if ! command -v copilot &>/dev/null; then
  # Try npx as fallback
  if command -v npx &>/dev/null; then
    COPILOT_CMD="npx -y @github/copilot"
  else
    log_error "Copilot CLI not found. Install with: npm install -g @github/copilot"
    exit 1
  fi
else
  COPILOT_CMD="copilot"
fi

# Write prompt to temp file (avoids shell escaping issues)
PROMPT_FILE=$(mktemp)
echo "$PROMPT" > "$PROMPT_FILE"

# Invoke Copilot CLI in programmatic mode
$COPILOT_CMD \
  -p "$(cat "$PROMPT_FILE")" \
  --agent=auto-healer \
  --allow-all-tools \
  2>&1 | tee "$AUDIT_DIR/copilot-output-${CURRENT_ATTEMPT}.log"

COPILOT_EXIT=$?
rm -f "$PROMPT_FILE"

if [[ "$COPILOT_EXIT" -ne 0 ]]; then
  log_error "Copilot CLI exited with code $COPILOT_EXIT"
  exit 1
fi

# ============================================================================
# Step 3.5: Validate changed files (safety sandbox)
# ============================================================================

if [[ -f "$SCRIPT_DIR/validate-changes.sh" ]]; then
  log_info "Validating changed files against safety policy..."
  bash "$SCRIPT_DIR/validate-changes.sh" || log_warn "Change validation had warnings."
fi

# ============================================================================
# Step 4: Validate the fix
# ============================================================================

log_info "Validating fix with: $VALIDATION_CMD"

if eval "$VALIDATION_CMD" 2>&1 | tee "$AUDIT_DIR/validation-${CURRENT_ATTEMPT}.log"; then
  log_ok "Fix validated successfully!"

  # Update audit with success
  node -e "
    const fs = require('fs');
    const audit = JSON.parse(fs.readFileSync('$AUDIT_FILE', 'utf8'));
    audit.result = 'success';
    audit.validationPassed = true;
    fs.writeFileSync('$AUDIT_FILE', JSON.stringify(audit, null, 2));
  "

  # Reset attempt counter on success
  rm -f "$ATTEMPT_FILE"
  log_ok "Self-healing completed successfully on attempt $CURRENT_ATTEMPT!"
else
  log_warn "Validation failed. Fix may be incomplete."

  # Update audit with failure
  node -e "
    const fs = require('fs');
    const audit = JSON.parse(fs.readFileSync('$AUDIT_FILE', 'utf8'));
    audit.result = 'validation-failed';
    audit.validationPassed = false;
    fs.writeFileSync('$AUDIT_FILE', JSON.stringify(audit, null, 2));
  "

  if [[ "$CURRENT_ATTEMPT" -ge "$MAX_ATTEMPTS" ]]; then
    log_error "All $MAX_ATTEMPTS attempts exhausted. Creating issue for manual review."
    exit 2
  else
    log_warn "Will retry on next CI run (attempt $(( CURRENT_ATTEMPT + 1 )) / $MAX_ATTEMPTS)"
    exit 1
  fi
fi
