# Setup Guide

Step-by-step instructions to get the self-healing CI/CD pipeline running in your repository.

---

## Prerequisites

| Requirement | Minimum Version | Purpose |
|------------|----------------|---------|
| Node.js | 20+ | Runtime for the sample app and Jest |
| npm | 10+ | Package management |
| Git | 2.30+ | Version control |
| GitHub repo | — | Hosts Actions workflow |
| GitHub Copilot license | Individual or Business | Powers the CLI |
| Copilot CLI | Latest | AI-driven code fixes |

---

## Step 1: Create the Repository

```bash
# Option A: Clone this repo
git clone https://github.com/<your-org>/Auto-heal-CI-Agent.git
cd Auto-heal-CI-Agent

# Option B: Use as a template
# Click "Use this template" on GitHub, then clone your new repo
```

---

## Step 2: Install Dependencies

```bash
npm install
```

Verify the app works locally:

```bash
npm start          # Server runs on port 3000
npm test           # Tests run (some will fail — deliberate)
npm run lint       # Lint runs (violations expected)
```

---

## Step 3: Create a GitHub Personal Access Token (PAT)

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. Click **Generate new token**
3. Configure:
   - **Token name:** `copilot-self-heal`
   - **Expiration:** 90 days (recommended)
   - **Repository access:** Select your repo
   - **Permissions:**
     - **Contents:** Read and write
     - **Pull requests:** Read and write (if using PR mode)
     - **Issues:** Read and write (for fallback issue creation)
   - **Account permissions:**
     - **Copilot:** Read (enables Copilot CLI authentication)
4. Click **Generate token** and copy the value

---

## Step 4: Configure Repository Secrets & Variables

Go to your repo → **Settings → Secrets and variables → Actions**

### Secrets

| Name | Value |
|------|-------|
| `COPILOT_TOKEN` | The PAT from Step 3 |

### Variables

| Name | Value | Purpose |
|------|-------|---------|
| `ENABLE_SELF_HEAL` | `true` | Set to `false` to disable healing (kill switch) |

---

## Step 5: Verify Workflow Permissions

Go to **Settings → Actions → General → Workflow permissions**:

- Select **Read and write permissions**
- Check **Allow GitHub Actions to create and approve pull requests**

---

## Step 6: Push and Trigger

```bash
git add -A
git commit -m "Initial commit with self-healing pipeline"
git push origin main
```

### What happens next:

1. **Job 1 (Build & Test)** runs and **fails** — deliberate bugs are in the code
2. **Job 2 (Auto-Heal)** activates:
   - Downloads failure artifacts
   - Installs Copilot CLI
   - Runs `scripts/heal.sh` which classifies the failure and invokes Copilot
   - Copilot reads the error context and applies a fix
   - Fix is validated, committed, and pushed
3. **CI re-triggers** automatically from the push
4. If all bugs are fixed, pipeline goes green
5. If not, it retries (up to 3 attempts total)
6. **Job 3 (Fallback)** creates a GitHub Issue if all attempts fail

---

## Step 7: Monitor

### In GitHub Actions

- Watch the workflow run in the **Actions** tab
- Each heal attempt uploads an artifact: `heal-audit-attempt-N`

### Audit Artifacts

Download the `heal-audit-attempt-*` artifacts to see:

| File | Contents |
|------|----------|
| `attempt-N.json` | Failure diagnosis, type, timestamp, result |
| `copilot-output-N.log` | Full Copilot CLI output |
| `validation-N.log` | Validation command output |

---

## Configuration Options

### Changing Max Retry Attempts

In `.github/workflows/ci.yml`, change the `--max-attempts` flag:

```yaml
bash scripts/heal.sh --max-attempts 5
```

And update the job condition:

```yaml
github.run_attempt <= 5
```

### Using PR Mode Instead of Direct Push

Change `--mode direct` to `--mode pr`:

```yaml
bash scripts/heal.sh --mode pr
```

This creates a pull request instead of pushing directly to the branch.

### Using the Reusable Workflow

In another repository, call the reusable workflow:

```yaml
jobs:
  ci:
    # ... your build/test job
  
  heal:
    needs: ci
    if: needs.ci.result == 'failure'
    uses: your-org/Auto-heal-CI-Agent/.github/workflows/heal-reusable.yml@main
    with:
      max-attempts: 3
      fix-delivery: pr
    secrets:
      copilot-token: ${{ secrets.COPILOT_TOKEN }}
```

---

## Troubleshooting

### Copilot CLI authentication fails

- Verify `COPILOT_TOKEN` secret is set correctly
- Ensure the PAT has **Copilot** account permission
- Check token hasn't expired

### Pipeline doesn't auto-heal

- Check `ENABLE_SELF_HEAL` variable is set to `true` (not `false`)
- Verify workflow permissions allow read/write
- Check attempt count hasn't exceeded max in `.heal-attempt-count`

### Changes are not committed

- Ensure workflow has `contents: write` permission
- Check `validate-changes.sh` output — protected files may have been reverted
- Copilot may not have made any edits (check `copilot-output-*.log`)

### Kill switch

To immediately stop all self-healing:

1. Go to **Settings → Secrets and variables → Actions → Variables**
2. Set `ENABLE_SELF_HEAL` to `false`
3. All subsequent heal jobs will skip immediately
