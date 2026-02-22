# heal-agent

**Platform-agnostic self-healing CI/CD agent** — automatically diagnose and fix pipeline failures using GitHub Copilot or any LLM API.

Works with **any CI/CD platform**: GitHub Actions, Azure DevOps, GitLab CI, Jenkins, CircleCI, Buildkite, and more.

---

## How It Works

```
┌──────────────┐     ┌───────────────┐     ┌──────────────┐     ┌────────────┐
│  CI Failure   │────▶│  Diagnosis    │────▶│  AI Fix      │────▶│  Commit    │
│  (log file)   │     │  Engine       │     │  Engine      │     │  Adapter   │
└──────────────┘     └───────────────┘     └──────────────┘     └────────────┘
                      handlers/node/        backends/            engine/
                      - lint violations     - copilot-agent      commit.js
                      - test failures       - copilot-cli
                      - build errors        - llm-api
                      - dependency issues
```

1. **Diagnose** — Handler chain parses CI logs to identify the failure type, affected files, and validation command.
2. **Fix** — A pluggable AI backend generates the code fix.
3. **Commit** — Changes are staged, validated against path rules, and committed/pushed.

---

## Quick Start

### GitHub Actions (Copilot Agent)

```yaml
# .github/workflows/ci.yml
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test 2>&1 | tee ci.log
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: ci-log
          path: ci.log

  auto-heal:
    needs: build-and-test
    if: failure()
    uses: ./.github/workflows/heal-reusable.yml
    with:
      backend: copilot-agent
      language: node
    secrets:
      gh-pat: ${{ secrets.GH_PAT }}
```

### Any CI Platform (LLM API)

```bash
# Set your LLM API key
export OPENAI_API_KEY=sk-...

# Run the heal agent
node engine/index.js \
  --backend llm-api \
  --language node \
  --log-file ci.log \
  --commit-mode push \
  --verbose
```

Or use the generic shell adapter:

```bash
export HEAL_BACKEND=llm-api
export OPENAI_API_KEY=sk-...
bash adapters/generic/heal.sh --log-file ci.log --commit-mode pr
```

---

## AI Backends

| Backend | Platform Requirement | How It Works |
|---------|---------------------|--------------|
| `copilot-agent` | GitHub only | Creates an Issue + assigns Copilot coding agent to generate a PR |
| `copilot-cli` | Any (with Copilot license) | Invokes Copilot CLI binary to edit files directly |
| `llm-api` | Any | Calls OpenAI, Anthropic, Azure OpenAI, or GitHub Models API |

### copilot-agent (GitHub-native)

Best for GitHub-hosted repos. Creates a detailed Issue with diagnosis and assigns the Copilot coding agent.

**Required:** `GH_PAT` secret with `repo` scope.

### copilot-cli

For CI environments where the Copilot CLI binary is available.

**Required:** `COPILOT_TOKEN` environment variable.

### llm-api (fully platform-agnostic)

Works anywhere with an API key. Supports multiple providers:

| Provider | API Key Env Var | Additional Config |
|----------|----------------|-------------------|
| OpenAI | `OPENAI_API_KEY` | — |
| Anthropic | `ANTHROPIC_API_KEY` | — |
| Azure OpenAI | `AZURE_OPENAI_API_KEY` | `AZURE_OPENAI_ENDPOINT` |
| GitHub Models | `GITHUB_MODELS_API_KEY` | — |

Fallback: `LLM_API_KEY` works for any provider.

---

## Configuration

Place a `.heal-agent.yml` in your repository root:

```yaml
backend: llm-api
language: node

llm:
  provider: openai
  model: gpt-4o

paths:
  allowed:
    - src/
    - tests/
    - lib/
  protected:
    - .github/
    - scripts/
    - .env

commands:
  lint: npm run lint
  test: npm test
  build: npm run build

max-attempts: 3
auto-merge: false
```

All settings can be overridden via environment variables:

| Env Var | Description |
|---------|-------------|
| `HEAL_BACKEND` | Backend selection |
| `HEAL_LANGUAGE` | Language ecosystem |
| `HEAL_LLM_PROVIDER` | LLM provider name |
| `HEAL_LLM_MODEL` | LLM model name |

---

## CLI Reference

```
heal-agent [options]

Options:
  --backend <name>      copilot-agent, copilot-cli, llm-api
  --language <lang>     node, python, go, dotnet
  --log-file <path>     Path to CI log file
  --repo-root <path>    Repository root (default: cwd)
  --attempt <n>         Current attempt number
  --max-attempts <n>    Maximum heal attempts
  --commit-mode <mode>  push, pr, or none
  --dry-run             Diagnose only
  --verbose             Detailed output
  --help                Show help
```

---

## CI Platform Adapters

Ready-to-use templates for popular CI platforms:

| Platform | Adapter | Path |
|----------|---------|------|
| GitHub Actions | Composite action | `adapters/github-actions/action.yml` |
| GitHub Actions | Reusable workflow | `adapters/github-actions/heal-reusable.yml` |
| Azure DevOps | Pipeline template | `adapters/azure-devops/heal-task.yml` |
| GitLab CI | CI template | `adapters/gitlab-ci/.heal-ci.yml` |
| Generic (any) | Shell script | `adapters/generic/heal.sh` |

---

## Architecture

```
engine/
  config.js      — Config loader (.heal-agent.yml + env vars + defaults)
  diagnose.js    — Diagnosis orchestrator (runs handler chain)
  fix.js         — Backend factory (routes to AI backend)
  commit.js      — Commit adapter (stage, commit, push/PR)
  index.js       — CLI entry point

handlers/
  node/          — Node.js handlers (lint, test, build, dependency)

backends/
  copilot-agent.js  — GitHub Issue + Copilot assignment
  copilot-cli.js    — Copilot CLI invocation
  llm-api.js        — Direct LLM API calls

adapters/
  github-actions/   — GitHub Actions composite action + reusable workflow
  azure-devops/     — Azure DevOps pipeline template
  gitlab-ci/        — GitLab CI template
  generic/          — Universal shell adapter

prompts/
  heal-prompt.md    — Fix prompt template
  diagnose-prompt.md — Diagnosis prompt template
```

---

## Safety

- **Path protection** — Protected files (`.github/`, `scripts/`, config files) are automatically reverted if modified.
- **Attempt limits** — Configurable max attempts prevent infinite heal loops.
- **Audit trail** — Every diagnosis and LLM response is saved to `.heal-audit/`.
- **Dry run mode** — Diagnose without applying any changes.
- **No destructive ops** — Agent never deletes tests, skips assertions, or adds `--force` flags.

---

## Adding Language Support

Create a handler directory under `handlers/<language>/` with an `index.js` that exports:

```js
module.exports = {
  handlers: [
    { name: 'lint', detect: (repoRoot, logPath) => { /* return diagnosis or null */ } },
    { name: 'test', detect: (repoRoot, logPath) => { /* ... */ } },
  ]
};
```

Each handler's `detect()` receives the repo root and CI log path, and returns a diagnosis object or `null` if the failure type doesn't match.
