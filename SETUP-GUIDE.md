# Setup Guide

Step-by-step instructions to integrate the Auto-Heal CI Agent into your repository.

---

## Prerequisites

| Requirement | Minimum Version | Purpose |
|------------|----------------|---------|
| Node.js | 20+ | Runtime for the application and tests |
| npm | 10+ | Package management |
| Git | 2.30+ | Version control |
| GitHub repo | — | Hosts Actions workflow |

### Backend-specific requirements

| Backend | Additional Requirement |
|---------|----------------------|
| `copilot-agent` | GitHub Copilot license (for the Copilot coding agent) + `GH_PAT` with `repo` scope |
| `copilot-cli` | GitHub Models API access + `GH_PAT` with `repo` scope |
| `llm-api` | API key for your chosen provider (OpenAI, Anthropic, Azure OpenAI, or GitHub Models) |

---

## Step 1: Add the GitHub Action to Your Workflow

Create or update `.github/workflows/ci.yml` in your repository:

```yaml
name: CI Pipeline
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run lint -- -f json -o lint-output.json || true
      - run: npm test -- --json --outputFile=test-results.json || true
      - run: npm run build 2>&1 | tee ci-output.log
      
      # Upload artifacts on failure for the heal job
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: ci-output
          path: |
            ci-output.log
            lint-output.json
            test-results.json

  auto-heal:
    needs: build-and-test
    if: |
      failure() &&
      vars.ENABLE_SELF_HEAL != 'false' &&
      github.run_attempt <= 3
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: ci-output
      - uses: your-org/Auto-heal-CI-Agent@main
        with:
          backend: copilot-agent       # or copilot-cli or llm-api
          language: node
          log-file: ci-output.log
          commit-mode: pr              # or push or none
          max-attempts: 3
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GH_PAT: ${{ secrets.GH_PAT }}

  fallback:
    needs: auto-heal
    if: failure() && github.run_attempt >= 3
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Create issue
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '🔴 Auto-heal failed after 3 attempts',
              body: `CI run: ${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
              labels: ['auto-heal-failed']
            });
```

---

## Step 2: Configure Secrets and Variables

Go to your repo → **Settings → Secrets and variables → Actions**.

### Secrets

| Name | Required For | Value |
|------|-------------|-------|
| `GH_PAT` | `copilot-agent`, `copilot-cli` | GitHub PAT with `repo` scope |
| `OPENAI_API_KEY` | `llm-api` (OpenAI) | Your OpenAI API key |
| `ANTHROPIC_API_KEY` | `llm-api` (Anthropic) | Your Anthropic API key |
| `AZURE_OPENAI_API_KEY` | `llm-api` (Azure OpenAI) | Your Azure OpenAI key |

> **Note:** You only need the secret(s) for the backend you choose to use.

### Variables

| Name | Default | Purpose |
|------|---------|---------|
| `ENABLE_SELF_HEAL` | `true` | Kill switch — set to `false` to disable healing |

---

## Step 3: Configure Workflow Permissions

Go to **Settings → Actions → General → Workflow permissions**:

- Select **Read and write permissions**
- Check **Allow GitHub Actions to create and approve pull requests** (if using `commit-mode: pr`)

---

## Step 4: Create the PAT (for `copilot-agent` or `copilot-cli`)

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. Click **Generate new token**
3. Configure:
   - **Token name:** `auto-heal-ci`
   - **Expiration:** 90 days (recommended)
   - **Repository access:** Select your repo(s)
   - **Permissions:**
     - **Contents:** Read and write
     - **Pull requests:** Read and write
     - **Issues:** Read and write
4. Click **Generate token** and save as `GH_PAT` in your repo secrets

---

## Step 5: Push and Watch It Work

```bash
git add -A
git commit -m "Add self-healing CI pipeline"
git push origin main
```

### What happens:

1. **Job 1 (Build & Test)** runs — if it fails, it uploads artifacts
2. **Job 2 (Auto-Heal)** activates:
   - Downloads the failure artifacts (logs, lint output, test results)
   - Runs the heal-agent engine: diagnose → fix → commit
   - Depending on the backend:
     - `copilot-agent`: Creates an issue and assigns the Copilot coding agent to generate a PR
     - `copilot-cli`: Calls GitHub Models API with full project context, applies file edits
     - `llm-api`: Calls your chosen LLM provider, parses and applies patches
   - Fix is committed via push or PR (based on `commit-mode`)
3. **CI re-triggers** automatically
4. Retries up to `max-attempts` times
5. **Job 3 (Fallback)** creates a GitHub Issue if all attempts fail

---

## Backend Configuration Examples

### Using `copilot-agent`

```yaml
- uses: your-org/Auto-heal-CI-Agent@main
  with:
    backend: copilot-agent
    language: node
    log-file: ci-output.log
    commit-mode: none    # copilot-agent creates its own PR
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    GH_PAT: ${{ secrets.GH_PAT }}
```

### Using `copilot-cli`

```yaml
- uses: your-org/Auto-heal-CI-Agent@main
  with:
    backend: copilot-cli
    language: node
    log-file: ci-output.log
    commit-mode: pr
    copilot-cli-model: gpt-4o    # optional, default: gpt-4o
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    GH_PAT: ${{ secrets.GH_PAT }}
```

### Using `llm-api` with OpenAI

```yaml
- uses: your-org/Auto-heal-CI-Agent@main
  with:
    backend: llm-api
    language: node
    log-file: ci-output.log
    commit-mode: push
    llm-provider: openai
    llm-model: gpt-4o
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

---

## Action Inputs Reference

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `backend` | No | `copilot-agent` | AI backend: `copilot-agent`, `copilot-cli`, or `llm-api` |
| `language` | No | `node` | Project language (determines which handler set to use) |
| `log-file` | No | `ci-output.log` | Path to the CI output log file |
| `commit-mode` | No | `push` | How to deliver fixes: `push`, `pr`, or `none` |
| `attempt` | No | `${{ github.run_attempt }}` | Current attempt number |
| `max-attempts` | No | `3` | Maximum heal attempts before giving up |
| `dry-run` | No | `false` | If `true`, diagnose only — don't apply fixes |
| `llm-provider` | No | `github` | LLM provider for `llm-api` backend: `openai`, `anthropic`, `azure-openai`, `github` |
| `copilot-cli-model` | No | — | Model for `copilot-cli` backend |
| `llm-model` | No | — | Model for `llm-api` backend |

---

## Monitoring & Audit

### GitHub Actions tab

Watch the workflow in **Actions**. Each heal attempt uploads an artifact: `heal-audit-attempt-N`.

### Audit artifacts

| File | Contents |
|------|----------|
| `attempt-N.json` | Failure diagnosis, type, timestamp, result |
| `llm-response-N.txt` | Raw AI output |

---

## Troubleshooting

### Auto-heal doesn't trigger

- Verify `ENABLE_SELF_HEAL` is not set to `false`
- Ensure the build-and-test job actually **fails** (not just warnings)
- Check workflow permissions allow read/write
- Verify `github.run_attempt` hasn't exceeded `max-attempts`

### Backend authentication fails

- **copilot-agent / copilot-cli:** Verify `GH_PAT` is set and has `repo` scope
- **llm-api:** Verify the correct API key secret is set for your provider
- Check that tokens haven't expired

### Changes are not committed

- Ensure workflow has `contents: write` permission
- If using `commit-mode: pr`, ensure pull-requests permission is granted
- Check that the AI made changes to allowed paths only (`src/`, `tests/`)
- Protected files (`.github/`, config files) are automatically reverted

### Kill switch

To immediately stop all self-healing:

1. Go to **Settings → Secrets and variables → Actions → Variables**
2. Set `ENABLE_SELF_HEAL` to `false`
3. All subsequent heal jobs will skip immediately
