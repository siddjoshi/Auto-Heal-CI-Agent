# Self-Healing CI/CD Pipeline

A production-ready CI/CD pipeline that **automatically diagnoses and fixes failures** using GitHub Copilot CLI — no external AI services required.

When tests, lint, or builds fail, the pipeline invokes Copilot CLI as a custom agent to read the error output, identify the root cause, apply a targeted code fix, and re-run CI — all without human intervention.

---

## How It Works

```
push → CI runs (lint, test, build)
          ↓ failure
      Handler classifies failure type
          ↓
      Copilot CLI diagnoses & applies fix
          ↓
      Validate fix → commit & push
          ↓
      CI re-runs automatically
          ↓ (up to 3 attempts)
      Fallback: create GitHub Issue
```

### Pipeline Architecture

| Component | Location | Purpose |
|-----------|----------|---------|
| Sample App | `src/` | Express REST API (Task Manager) |
| Tests | `tests/` | Jest + supertest suite |
| CI Workflow | `.github/workflows/ci.yml` | 3-job pipeline: build → heal → fallback |
| Orchestrator | `scripts/heal.sh` | Main healing engine |
| Handlers | `scripts/handlers/` | Pluggable failure classifiers |
| Prompts | `scripts/prompts/` | Copilot prompt templates |
| Agent Profile | `.github/agents/auto-healer.md` | Custom Copilot agent instructions |
| Skills | `.github/skills/ci-healing/` | Domain knowledge for CI healing |
| Safety | `scripts/safety-guard.sh` | Pre-flight safety checks |

---

## Quick Start

### Prerequisites

- Node.js 20+
- GitHub repository with Actions enabled
- [GitHub Copilot CLI](https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-in-the-command-line) installed
- A GitHub PAT with **Copilot Requests** permission

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd Auto-heal-CI-Agent
npm install
```

### 2. Configure Repository Secrets

In your GitHub repo → **Settings → Secrets and variables → Actions**:

| Name | Type | Value |
|------|------|-------|
| `COPILOT_TOKEN` | Secret | PAT with Copilot Requests permission |
| `ENABLE_SELF_HEAL` | Variable | `true` (set to `false` to disable) |

### 3. Push and Watch

```bash
git push origin main
```

The pipeline will:
1. Run lint, build, and tests
2. Detect the **deliberate failures** included in the codebase
3. Invoke Copilot CLI to fix them automatically
4. Commit the fix and re-trigger CI

---

## Deliberate Failures (Demo)

The repo ships with intentional bugs so the pipeline has something to heal:

| File | Bug | Failure Type |
|------|-----|-------------|
| `src/app.js` | Uses `var` instead of `const` | ESLint `no-var` violation |
| `tests/taskService.test.js` | Wrong expected value in assertion | Jest test failure |
| `tests/edgeCases.test.js` | Incorrect edge case assertion | Jest test failure |

---

## Safety Mechanisms

| Mechanism | Description |
|-----------|-------------|
| **Max Retries** | Pipeline stops after 3 failed heal attempts |
| **Kill Switch** | Set `ENABLE_SELF_HEAL=false` repo variable to disable instantly |
| **File Sandboxing** | Only `src/` and `tests/` files are staged for commit |
| **Protected Files** | Workflow, script, and config changes are auto-reverted |
| **Pre-flight Checks** | `safety-guard.sh` validates environment before healing |
| **Audit Trail** | Every attempt logged in `.heal-audit/` with full diagnosis |
| **Concurrency Lock** | Only one heal pipeline runs per branch at a time |

---

## Project Structure

```
├── .github/
│   ├── agents/auto-healer.md       # Copilot agent profile
│   ├── instructions/                # Path-specific Copilot instructions
│   │   ├── src.instructions.md
│   │   └── tests.instructions.md
│   ├── skills/ci-healing/SKILL.md   # CI healing skill knowledge
│   ├── workflows/
│   │   ├── ci.yml                   # Main CI pipeline
│   │   └── heal-reusable.yml        # Reusable workflow
│   └── copilot-instructions.md      # Repo-wide Copilot instructions
├── scripts/
│   ├── handlers/                    # Failure type classifiers
│   │   ├── test-handler.sh
│   │   ├── lint-handler.sh
│   │   ├── build-handler.sh
│   │   └── dependency-handler.sh
│   ├── prompts/                     # Copilot prompt templates
│   │   ├── heal-prompt.md
│   │   └── diagnose-prompt.md
│   ├── heal.sh                      # Main orchestrator
│   ├── safety-guard.sh              # Pre-flight safety checks
│   └── validate-changes.sh          # Post-heal file validation
├── src/
│   ├── app.js                       # Express app setup
│   ├── server.js                    # HTTP server entry
│   ├── models/taskStore.js          # In-memory data store
│   ├── routes/tasks.js              # REST API routes
│   └── services/taskService.js      # Business logic
├── tests/
│   ├── routes.test.js               # API integration tests
│   ├── taskService.test.js          # Service unit tests
│   └── edgeCases.test.js            # Edge case tests
└── package.json
```

---

## Documentation

| Guide | Description |
|-------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, data flow, component interactions |
| [SETUP-GUIDE.md](SETUP-GUIDE.md) | Step-by-step setup for automated operation |
| [EXTENDING.md](EXTENDING.md) | How to add new failure handlers and use cases |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guidelines |

---

## Commands

```bash
npm test            # Run tests
npm run lint        # Run linter
npm start           # Start server on port 3000
npm run build       # Validate syntax (build check)
npm run test:json   # Tests with JSON output
npm run lint:json   # Lint with JSON output
```

---

## License

MIT

<!-- Workflow configuration verified: 2026-02-20 -->
