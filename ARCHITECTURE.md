# Architecture

## System Overview

The self-healing CI/CD pipeline is a multi-layered system that detects, diagnoses, and fixes CI failures automatically using GitHub Copilot CLI.

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Actions                            │
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐ │
│  │ Build & Test  │──▶│  Auto-Heal   │──▶│    Fallback      │ │
│  │   (Job 1)     │   │   (Job 2)    │   │    (Job 3)       │ │
│  └──────────────┘   └──────────────┘   └──────────────────┘ │
│        │ fail              │                    │             │
│        ▼                   ▼                    ▼             │
│   Upload logs     Orchestrator + CLI     Create Issue        │
└─────────────────────────────────────────────────────────────┘
```

## Component Architecture

### 1. CI Workflow (`ci.yml`)

Three sequential jobs with conditional execution:

| Job | Trigger | Purpose |
|-----|---------|---------|
| `build-and-test` | Every push/PR | Runs lint, build, tests; uploads artifacts on failure |
| `auto-heal` | Job 1 fails + kill switch off + attempts ≤ 3 | Invokes healing orchestrator |
| `fallback` | Job 2 fails + attempts ≥ 3 | Creates GitHub Issue for manual review |

### 2. Orchestrator (`scripts/heal.sh`)

The central engine that coordinates the entire healing process:

```
                    heal.sh
                       │
         ┌─────────────┼──────────────┐
         ▼             ▼              ▼
   safety-guard   handlers/*.sh   prompts/*.md
         │             │              │
         ▼             ▼              ▼
   Pre-flight      Classify       Render prompt
   checks          failure        template
                       │              │
                       └──────┬───────┘
                              ▼
                       Copilot CLI
                       (auto-healer agent)
                              │
                              ▼
                    validate-changes.sh
                              │
                              ▼
                    Validation command
                    (npm test, npm run lint)
                              │
                       ┌──────┴──────┐
                       ▼             ▼
                    Success       Failure
                    (commit)      (retry)
```

**Execution flow:**

1. **Pre-flight** — `safety-guard.sh` checks kill switch, attempt limits, environment
2. **Classify** — Iterates through `handlers/` until one matches the failure
3. **Render** — Substitutes `{{VARIABLES}}` in prompt template with diagnosis data
4. **Invoke** — Calls `copilot -p <prompt> --agent=auto-healer --allow-all-tools`
5. **Sandbox** — `validate-changes.sh` reverts any modifications to protected files
6. **Validate** — Runs the appropriate validation command (e.g., `npm test`)
7. **Commit** — Stages only `src/` and `tests/`, commits, and pushes

### 3. Handler Plugin System (`scripts/handlers/`)

Handlers are shell scripts that classify CI failures by parsing log files and test output:

```
Handler Contract:
  Input:  $1 = path to CI log file
  Output: JSON to stdout with structure:
          {
            "type": "test-failure|lint-failure|build-failure|dependency-failure",
            "healable": true|false,
            "failures": [...],
            "relevantFiles": [...],
            "validationCommand": "npm test"
          }
  Exit:   0 = handler matched this failure
          1 = not this handler's domain (skip)
```

| Handler | Detects | Parses |
|---------|---------|--------|
| `test-handler.sh` | Jest test failures | `test-results.json` |
| `lint-handler.sh` | ESLint violations | `lint-output.json` |
| `build-handler.sh` | Syntax/module errors | CI log text patterns |
| `dependency-handler.sh` | npm install/audit issues | CI log text patterns |

Handlers are auto-discovered — any file matching `*-handler.sh` in the handlers directory is executed.

### 4. Copilot Agent Stack

Layered instruction system that gives Copilot maximum context:

```
┌─────────────────────────────────────────┐
│  .github/copilot-instructions.md        │  Repo-wide context
├─────────────────────────────────────────┤
│  .github/agents/auto-healer.md          │  Agent persona + rules
├─────────────────────────────────────────┤
│  .github/skills/ci-healing/SKILL.md     │  Domain expertise
├─────────────────────────────────────────┤
│  .github/instructions/src.instructions  │  Path-specific guidance
│  .github/instructions/tests.instructions│
├─────────────────────────────────────────┤
│  scripts/prompts/heal-prompt.md         │  Runtime prompt template
└─────────────────────────────────────────┘
```

### 5. Safety Layer

```
Pre-heal:                       Post-heal:
┌─────────────────────┐         ┌──────────────────────┐
│ safety-guard.sh     │         │ validate-changes.sh  │
│ ├─ Kill switch      │         │ ├─ Protected paths   │
│ ├─ Attempt counter  │         │ ├─ Auto-revert       │
│ ├─ GH_TOKEN check   │         │ └─ Allowed paths     │
│ └─ Git state check  │         │     (src/, tests/)   │
└─────────────────────┘         └──────────────────────┘
```

## Data Flow

```
CI Failure
    │
    ├── ci-output.log         (raw CI output)
    ├── test-results.json     (Jest JSON report)
    ├── lint-output.json      (ESLint JSON report)
    │
    ▼ Handler classifies
    │
    ├── Diagnosis JSON        (structured failure data)
    │
    ▼ Template rendered
    │
    ├── Copilot prompt        (complete context for AI)
    │
    ▼ Copilot CLI runs
    │
    ├── Modified files        (in src/ or tests/)
    │
    ▼ Changes validated
    │
    ├── .heal-audit/          (attempt logs)
    │   ├── attempt-1.json
    │   ├── copilot-output-1.log
    │   └── validation-1.log
    │
    └── Git commit + push     (triggers next CI run)
```

## Reusable Workflow

`heal-reusable.yml` enables cross-repository adoption:

```yaml
# In any other repo's workflow:
jobs:
  heal:
    uses: your-org/Auto-heal-CI-Agent/.github/workflows/heal-reusable.yml@main
    with:
      max-attempts: 3
      fix-delivery: pr
      copilot-model: claude-sonnet-4-5
    secrets:
      copilot-token: ${{ secrets.COPILOT_TOKEN }}
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Plugin-based handlers | New failure types added by dropping a script into `handlers/` |
| Template-based prompts | Prompts can be tuned independently of orchestrator logic |
| File sandboxing | Copilot can only modify source/test files, never infra |
| Audit trail | Every attempt is logged for debugging and compliance |
| Attempt counter via file | Works across workflow re-runs without external state |
| Agent instructions layering | Copilot gets project context + domain expertise + path rules |
