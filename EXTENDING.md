# Extending the Self-Healing Pipeline

This guide explains how to add new failure handlers, prompt templates, and Copilot skills to support additional CI failure types.

---

## Adding a New Failure Handler

Handlers are the primary extension point. To support a new failure type, create a shell script in `scripts/handlers/`.

### 1. Create the Handler Script

```bash
touch scripts/handlers/security-handler.sh
chmod +x scripts/handlers/security-handler.sh
```

### 2. Implement the Handler Contract

Every handler must follow this contract:

```bash
#!/usr/bin/env bash
# scripts/handlers/security-handler.sh
# Detects npm audit security vulnerabilities

set -euo pipefail

LOG_FILE="${1:-ci-output.log}"

# Check if this handler should match
if ! grep -qi "found.*vulnerabilities\|npm audit" "$LOG_FILE"; then
  exit 1  # Exit 1 = not my domain, skip to next handler
fi

# Parse the failure and output structured JSON
cat <<EOF
{
  "type": "security-failure",
  "healable": true,
  "failures": [
    {
      "description": "npm audit found security vulnerabilities",
      "severity": "high"
    }
  ],
  "relevantFiles": ["package.json", "package-lock.json"],
  "validationCommand": "npm audit --audit-level=moderate"
}
EOF

exit 0  # Exit 0 = handler matched
```

### Handler Contract Summary

| Aspect | Requirement |
|--------|-------------|
| **Input** | `$1` = path to CI log file |
| **Output** | JSON to stdout (on match) |
| **Exit 0** | Handler matched this failure type |
| **Exit 1** | Not this handler's domain (orchestrator tries next) |
| **Naming** | Must match `*-handler.sh` pattern |
| **Location** | `scripts/handlers/` directory |

### JSON Output Schema

```json
{
  "type": "string",              // Failure category identifier
  "healable": true,              // Whether AI can likely fix this
  "failures": [                  // Array of failure details
    {
      "testName": "string",      // Optional: test/rule name
      "file": "string",          // Optional: file path
      "line": 0,                 // Optional: line number
      "message": "string",       // Optional: error message
      "description": "string"    // Optional: human description
    }
  ],
  "relevantFiles": ["string"],   // Files Copilot should examine
  "validationCommand": "string"  // Command to verify the fix
}
```

That's it — the orchestrator auto-discovers any `*-handler.sh` file. No registration needed.

---

## Adding a New Prompt Template

Prompt templates live in `scripts/prompts/` and use `{{VARIABLE}}` placeholders.

### Available Template Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `{{FAILURE_TYPE}}` | Handler JSON `.type` | e.g., `test-failure`, `lint-failure` |
| `{{ATTEMPT_NUMBER}}` | Attempt counter | Current attempt (1, 2, 3) |
| `{{MAX_ATTEMPTS}}` | CLI argument | Maximum allowed attempts |
| `{{BRANCH_NAME}}` | `GITHUB_REF_NAME` | Current branch |
| `{{COMMIT_SHA}}` | `GITHUB_SHA` | Current commit |
| `{{FAILURE_DETAILS}}` | Handler JSON (serialized) | Full diagnosis |
| `{{VALIDATION_COMMAND}}` | Handler JSON `.validationCommand` | e.g., `npm test` |
| `{{CI_LOG_TAIL}}` | CI log file | Last 200 lines of CI output |

### Creating a Custom Template

```markdown
<!-- scripts/prompts/security-heal-prompt.md -->
# Security Vulnerability Fix

You are fixing security vulnerabilities found by npm audit.

## Failure Details
{{FAILURE_DETAILS}}

## Instructions
1. Update package versions in package.json to resolve vulnerabilities
2. Do NOT change application logic
3. Run `{{VALIDATION_COMMAND}}` to verify

## Attempt
This is attempt {{ATTEMPT_NUMBER}} of {{MAX_ATTEMPTS}}.
```

To use a custom template, modify `heal.sh` to select templates based on failure type.

---

## Adding Copilot Skills

Skills provide domain knowledge to the Copilot agent.

### 1. Create a Skill Directory

```
.github/skills/your-skill-name/SKILL.md
```

### 2. Write the SKILL.md

```markdown
---
description: "Knowledge about TypeScript migration patterns"
---

# TypeScript Migration Skill

## Capabilities
- Convert JavaScript files to TypeScript
- Add type annotations
- Fix type errors

## Patterns
- Use `interface` for object shapes
- Prefer `unknown` over `any`
- Enable `strict` mode in tsconfig.json
```

### 3. Add Path-Specific Instructions

```markdown
<!-- .github/instructions/types.instructions.md -->
---
applyTo: "**/*.ts"
---
# TypeScript File Rules
- Always include explicit return types
- Use readonly for immutable properties
```

---

## Adding Support for New Languages/Frameworks

### Example: Python + pytest

1. **Handler:** `scripts/handlers/pytest-handler.sh`
   - Parse pytest output for failed tests
   - Look for `.pytest_cache/` or pytest JSON report

2. **Prompt:** `scripts/prompts/python-heal-prompt.md`
   - Python-specific fix instructions

3. **Skills:** `.github/skills/python-testing/SKILL.md`
   - pytest patterns, Python conventions

4. **Instructions:** `.github/instructions/python.instructions.md`
   - Apply to `**/*.py`, include PEP 8 rules

5. **Workflow:** Add Python setup step in `ci.yml`

---

## Allowing Protected File Modifications

By default, `validate-changes.sh` blocks changes to workflows, scripts, and config files. To allow a new path:

Edit `scripts/validate-changes.sh` and modify the `PROTECTED_PATTERNS` array:

```bash
PROTECTED_PATTERNS=(
  "^\.github/workflows/"
  "^\.github/agents/"
  "^scripts/"
  # Remove or add patterns as needed
)
```

---

## Testing Your Handler Locally

```bash
# Generate a mock log file
echo "FAIL src/app.test.js" > /tmp/mock-ci.log
echo "Expected: 5, Received: 4" >> /tmp/mock-ci.log

# Test your handler
bash scripts/handlers/your-handler.sh /tmp/mock-ci.log
echo "Exit code: $?"

# Test the full orchestrator in dry-run mode
bash scripts/heal.sh --log-file /tmp/mock-ci.log --dry-run
```
