# Extending the Auto-Heal CI Agent

This guide explains how to add new failure handlers, AI backends, prompt templates, and Copilot skills.

---

## Adding a New Node.js Handler

Node.js handlers are the primary extension point. They live in `handlers/<language>/` and are used by the engine when invoked via the GitHub Action.

### 1. Create the Handler Module

Create a new file in `handlers/node/` (or `handlers/python/`, etc.):

```javascript
// handlers/node/security.js
const fs = require('fs');
const path = require('path');

function detect(logFile, _artifactDir) {
  const log = fs.readFileSync(logFile, 'utf-8');

  if (!/found \d+ vulnerabilities|npm audit/i.test(log)) {
    return null; // Not this handler's domain
  }

  return {
    type: 'security-vulnerability',
    handler: 'security',
    healable: true,
    failures: [
      {
        description: 'npm audit found security vulnerabilities',
        severity: 'high'
      }
    ],
    relevantFiles: ['package.json', 'package-lock.json'],
    validationCommand: 'npm audit --audit-level=moderate'
  };
}

module.exports = { detect };
```

### 2. Register the Handler

Add it to the handler chain in `handlers/node/index.js`:

```javascript
const lint = require('./lint');
const test = require('./test');
const build = require('./build');
const dependency = require('./dependency');
const security = require('./security');  // Add this

// Execution order matters — first match wins
const handlers = [lint, test, build, dependency, security];

module.exports = { handlers };
```

### Handler Contract (Node.js)

| Aspect | Requirement |
|--------|-------------|
| **Export** | `{ detect }` function |
| **Input** | `(logFile, artifactDir)` — paths to CI log and artifact directory |
| **Return (match)** | Diagnosis object (see schema below) |
| **Return (no match)** | `null` |
| **Location** | `handlers/<language>/` directory |
| **Registration** | Add to the `handlers` array in `handlers/<language>/index.js` |

### Diagnosis Object Schema

```json
{
  "type": "string",              // Failure category identifier
  "handler": "string",           // Handler name
  "healable": true,              // Whether AI can likely fix this
  "failures": [                  // Array of failure details
    {
      "file": "string",          // Optional: file path
      "line": 0,                 // Optional: line number
      "rule": "string",          // Optional: lint rule or test name
      "message": "string",       // Optional: error message
      "description": "string"    // Optional: human description
    }
  ],
  "relevantFiles": ["string"],   // Files the AI should examine
  "validationCommand": "string"  // Command to verify the fix
}
```

---

## Adding a Shell Handler (Legacy)

Shell handlers in `scripts/handlers/` are used by the legacy shell orchestrator (`scripts/heal.sh`) and the reusable workflow. Any file matching `*-handler.sh` is auto-discovered — no registration needed.

```bash
#!/usr/bin/env bash
# scripts/handlers/security-handler.sh
set -euo pipefail

LOG_FILE="${1:-ci-output.log}"

# Exit 1 = not my domain (skip to next handler)
if ! grep -qi "found.*vulnerabilities\|npm audit" "$LOG_FILE"; then
  exit 1
fi

# Exit 0 = handler matched; output JSON to stdout
cat <<EOF
{
  "type": "security-failure",
  "healable": true,
  "failures": [{"description": "npm audit found security vulnerabilities"}],
  "relevantFiles": ["package.json"],
  "validationCommand": "npm audit --audit-level=moderate"
}
EOF
exit 0
```

| Aspect | Requirement |
|--------|-------------|
| **Input** | `$1` = path to CI log file |
| **Output** | JSON to stdout (on match) |
| **Exit 0** | Handler matched |
| **Exit 1** | Not this handler's domain |
| **Naming** | Must match `*-handler.sh` |
| **Location** | `scripts/handlers/` |

---

## Adding a New AI Backend

Backends live in `backends/` and are selected by the `backend` action input.

### 1. Create the Backend Module

```javascript
// backends/my-custom-backend.js

async function fix(diagnosis, config) {
  // diagnosis = the diagnosis object from a handler
  // config = merged configuration from .heal-agent.yml + env vars

  // Call your AI service, generate file edits
  // Return a result object
  return {
    success: true,
    filesChanged: ['src/app.js'],
    description: 'Fixed lint violation'
  };
}

module.exports = { fix };
```

### 2. Register the Backend

Add a case to the backend factory in `engine/fix.js`:

```javascript
case 'my-custom-backend':
  backend = require('../backends/my-custom-backend');
  break;
```

---

## Adding Prompt Templates

Prompt templates in `prompts/` use `{{VARIABLE}}` placeholders that are substituted at runtime.

### Available Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `{{FAILURE_TYPE}}` | Diagnosis `.type` | e.g., `lint-violation`, `test-failure` |
| `{{FAILURE_DETAILS}}` | Diagnosis JSON | Full serialized diagnosis |
| `{{ATTEMPT_NUMBER}}` | Action input / env | Current attempt (1, 2, 3) |
| `{{MAX_ATTEMPTS}}` | Action input / env | Maximum allowed attempts |
| `{{VALIDATION_COMMAND}}` | Diagnosis `.validationCommand` | e.g., `npm run lint` |
| `{{BRANCH_NAME}}` | `GITHUB_REF_NAME` | Current branch |
| `{{COMMIT_SHA}}` | `GITHUB_SHA` | Current commit |
| `{{CI_LOG_TAIL}}` | CI log file | Last lines of CI output |

### Creating a Custom Template

```markdown
<!-- prompts/security-heal-prompt.md -->
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

---

## Adding Copilot Skills

Skills provide domain knowledge to the `copilot-cli` backend (which auto-discovers them).

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

> **Note:** The `copilot-cli` backend discovers skills from both the action repository and the consumer repository at runtime.

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

## Adding Support for New Languages

### Example: Python + pytest

1. **Create handler directory:** `handlers/python/`

2. **Add Node.js handlers:**
   - `handlers/python/pytest.js` — parse pytest JSON report
   - `handlers/python/flake8.js` — parse flake8 output
   - `handlers/python/index.js` — export the handler chain

3. **Add prompt template:** `prompts/python-heal-prompt.md`

4. **Add skills:** `.github/skills/python-testing/SKILL.md`

5. **Add instructions:** `.github/instructions/python.instructions.md` (apply to `**/*.py`)

6. **Update action.yml:** Add `python` to the `language` input options

7. **Update engine:** Wire the `python` language to `handlers/python/index.js` in the engine

---

## Testing Locally

### Test a Node.js handler

```bash
node -e "
  const handler = require('./handlers/node/lint');
  const result = handler.detect('lint-output.json', '.');
  console.log(JSON.stringify(result, null, 2));
"
```

### Test a shell handler

```bash
echo "FAIL src/app.test.js" > /tmp/mock-ci.log
bash scripts/handlers/test-handler.sh /tmp/mock-ci.log
echo "Exit code: $?"
```

### Test the full engine in dry-run mode

```bash
node engine/index.js \
  --backend copilot-cli \
  --language node \
  --log-file ci-output.log \
  --dry-run
```
