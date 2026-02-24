# Architecture

## System Overview

The Auto-Heal CI Agent is a platform-agnostic, multi-layered system that detects, diagnoses, and fixes CI failures automatically using pluggable AI backends. It has two implementation paths:

1. **Node.js Engine** (`engine/` + `handlers/` + `backends/`) — the primary, platform-agnostic implementation used by the GitHub Action
2. **Shell Scripts** (`scripts/`) — a legacy alternative used by the reusable workflow and for environments where shell orchestration is preferred

```
┌─────────────────────────────────────────────────────────────┐
│                    Any CI Platform                           │
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐ │
│  │ Build & Test  │──▶│  Auto-Heal   │──▶│    Fallback      │ │
│  │   (Job 1)     │   │   (Job 2)    │   │    (Job 3)       │ │
│  └──────────────┘   └──────────────┘   └──────────────────┘ │
│        │ fail              │                    │             │
│        ▼                   ▼                    ▼             │
│   Upload logs     Engine diagnoses +     Create Issue        │
│                   AI backend fixes                           │
└─────────────────────────────────────────────────────────────┘
```

## Component Architecture

### 1. CI Workflow (`ci.yml`)

Three sequential jobs with conditional execution:

| Job | Trigger | Purpose |
|-----|---------|---------|
| `build-and-test` | Every push/PR | Runs lint, build, tests; uploads artifacts on failure |
| `auto-heal` | Job 1 fails + kill switch off + attempts ≤ 3 | Invokes the heal-agent engine |
| `fallback` | Job 2 fails + attempts ≥ 3 | Creates GitHub Issue for manual review |

### 2. Node.js Engine (`engine/`)

The primary orchestration system — a pipeline of config → diagnose → fix → commit:

```
                  engine/index.js
                       │
         ┌─────────────┼──────────────┐
         ▼             ▼              ▼
   engine/config.js  engine/diagnose.js  engine/fix.js
         │             │                    │
         ▼             ▼                    ▼
   .heal-agent.yml  handlers/node/      backends/
   + env vars       - lint.js           - copilot-agent.js
   + defaults       - test.js           - copilot-cli.js
                    - build.js          - llm-api.js
                    - dependency.js
                                            │
                                            ▼
                                      engine/commit.js
                                      (stage → validate → push/PR)
```

| Module | Purpose |
|--------|---------|
| `engine/index.js` | CLI entry point. Parses args, loads config, runs diagnose → fix → commit pipeline |
| `engine/config.js` | Loads `.heal-agent.yml`, applies defaults, merges env var overrides |
| `engine/diagnose.js` | Runs handler chain sequentially — first match wins |
| `engine/fix.js` | Backend factory — selects AI backend by name, delegates fix generation |
| `engine/commit.js` | Git operations: detects changes, reverts protected paths, stages allowed files, commits/pushes or opens PR |

### 3. Handler Plugin System (`handlers/node/`)

Node.js handlers classify CI failures by parsing structured output and log files:

| Handler | Source File | Detects | Parses |
|---------|------------|---------|--------|
| `lint` | `handlers/node/lint.js` | ESLint violations | `lint-output.json` (ESLint JSON format) |
| `test` | `handlers/node/test.js` | Jest test failures | `test-results.json` (Jest JSON format) |
| `build` | `handlers/node/build.js` | Syntax/module/reference errors | CI log file via regex |
| `dependency` | `handlers/node/dependency.js` | npm install/audit failures | CI log file via regex |

**Execution order** (defined in `handlers/node/index.js`): lint → test → build → dependency. First match wins.

Each handler returns a diagnosis object:

```json
{
  "type": "lint-violation|test-failure|build-error|dependency-error",
  "handler": "lint|test|build|dependency",
  "healable": true,
  "failures": [
    {
      "file": "src/app.js",
      "line": 4,
      "rule": "no-var",
      "message": "Unexpected var, use let or const instead."
    }
  ],
  "relevantFiles": ["src/app.js"],
  "validationCommand": "npm run lint"
}
```

**Shell handlers** (`scripts/handlers/`) mirror the Node.js handlers as shell scripts with embedded Node one-liners for JSON parsing. They are used by the legacy shell orchestrator (`scripts/heal.sh`). Any file matching `*-handler.sh` is auto-discovered.

### 4. AI Backends (`backends/`)

Three pluggable backends handle AI-powered fix generation:

| Backend | File | Mechanism |
|---------|------|-----------|
| `copilot-agent` | `backends/copilot-agent.js` | Creates a GitHub Issue with structured diagnosis context and assigns the Copilot coding agent via GraphQL. Copilot autonomously creates a PR with the fix. |
| `copilot-cli` | `backends/copilot-cli.js` | Dynamically discovers `.github/agents/*.md`, `.github/skills/*/SKILL.md`, and `.github/instructions/*.md` from both repos. Builds a system prompt, calls the GitHub Models API, and parses JSON file-edit responses. |
| `llm-api` | `backends/llm-api.js` | Calls OpenAI, Anthropic, Azure OpenAI, or GitHub Models API directly. Parses code-block patches from the response and applies them within allowed paths. |

### 5. Copilot Agent Context Stack

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
│  prompts/heal-prompt.md                 │  Runtime prompt template
└─────────────────────────────────────────┘
```

### 6. CI Platform Adapters (`adapters/`)

| Platform | Adapter | Status |
|----------|---------|--------|
| GitHub Actions | `adapters/github-actions/action.yml` — Composite action | Ready |
| GitHub Actions | `adapters/github-actions/heal-reusable.yml` — Reusable workflow | Ready |
| Azure DevOps | `adapters/azure-devops/heal-task.yml` — Pipeline template | Ready |
| Generic (any CI) | `adapters/generic/heal.sh` — Shell script | Ready |
| GitLab CI | `adapters/gitlab-ci/` — Placeholder | Not yet implemented |

### 7. Safety Layer

```
Pre-heal:                       Post-heal:
┌─────────────────────┐         ┌──────────────────────┐
│ engine/commit.js     │         │ engine/commit.js     │
│ safety-guard.sh      │         │ validate-changes.sh  │
│ ├─ Kill switch       │         │ ├─ Protected paths   │
│ ├─ Attempt counter   │         │ │   (.github/, etc.) │
│ ├─ GH_TOKEN check    │         │ ├─ Auto-revert       │
│ └─ Git state check   │         │ └─ Allowed paths     │
└─────────────────────┘         │     (src/, tests/)   │
                                └──────────────────────┘
```

## Data Flow

```
CI Failure
    │
    ├── ci-output.log         (raw CI output)
    ├── test-results.json     (Jest JSON report, if available)
    ├── lint-output.json      (ESLint JSON report, if available)
    │
    ▼ Handler chain classifies (engine/diagnose.js)
    │
    ├── Diagnosis JSON        (structured failure data)
    │
    ▼ AI backend generates fix (engine/fix.js → backends/)
    │
    ├── Modified files        (in src/ or tests/ only)
    │
    ▼ Changes validated (engine/commit.js)
    │
    ├── Protected files reverted
    ├── Only allowed paths staged
    │
    ├── .heal-audit/          (attempt logs)
    │   ├── attempt-1.json    (diagnosis + result)
    │   └── llm-response-1.txt (raw AI output)
    │
    └── Git commit + push / PR (triggers next CI run)
```

## Reusable Workflow

`.github/workflows/heal-reusable.yml` enables cross-repository adoption:

```yaml
# In any other repo's workflow:
jobs:
  heal:
    uses: your-org/Auto-heal-CI-Agent/.github/workflows/heal-reusable.yml@main
    with:
      test-command: 'npm test'
      lint-command: 'npm run lint'
      build-command: 'npm run build'
      node-version: '20'
      max-attempts: 3
    secrets:
      copilot-token: ${{ secrets.COPILOT_TOKEN }}
```

> **Note:** The reusable workflow uses the legacy shell orchestrator (`scripts/heal.sh`), not the Node.js engine. The composite action (`action.yml`) uses the Node.js engine.

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Dual implementation (Node.js engine + shell scripts) | Node.js engine for structured, multi-backend use; shell scripts for lightweight, Copilot CLI-only environments |
| Plugin-based handlers | New failure types added by dropping a module into `handlers/<language>/` |
| Pluggable AI backends | Choose between Copilot coding agent, Copilot CLI, or direct LLM API based on CI platform and preferences |
| Template-based prompts | Prompts can be tuned independently of orchestrator logic |
| File sandboxing | AI can only modify source/test files, never infrastructure |
| Audit trail | Every attempt is logged for debugging and compliance |
| Attempt counter | Prevents infinite heal loops |
| Agent instructions layering | AI gets project context + domain expertise + path-specific rules |
