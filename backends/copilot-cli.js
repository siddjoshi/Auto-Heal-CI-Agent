'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Copilot CLI backend.
 *
 * Invokes the Copilot CLI binary to diagnose and fix code on disk.
 * Works in any CI environment where the user has a Copilot license.
 *
 * Requires: @github/copilot npm package + COPILOT_TOKEN env var.
 */

/**
 * Render the heal prompt template with diagnosis data.
 */
function renderPrompt(diagnosis, context, config) {
  const promptPath = path.join(__dirname, '..', 'prompts', 'heal-prompt.md');
  let template = 'Fix the CI failure. Details: {{FAILURE_DETAILS}}';

  if (fs.existsSync(promptPath)) {
    template = fs.readFileSync(promptPath, 'utf8');
  }

  return template
    .replace(/\{\{FAILURE_TYPE\}\}/g, diagnosis.type)
    .replace(/\{\{ATTEMPT_NUMBER\}\}/g, String(context.attempt || 1))
    .replace(/\{\{MAX_ATTEMPTS\}\}/g, String(config.maxAttempts || 3))
    .replace(/\{\{BRANCH_NAME\}\}/g, context.branch || 'unknown')
    .replace(/\{\{COMMIT_SHA\}\}/g, context.commitSha || 'unknown')
    .replace(/\{\{VALIDATION_COMMAND\}\}/g, diagnosis.validationCommand || 'npm test')
    .replace(/\{\{FAILURE_DETAILS\}\}/g, JSON.stringify(diagnosis, null, 2))
    .replace(/\{\{CI_LOG_TAIL\}\}/g, context.logTail || 'No log available.');
}

/**
 * Invoke Copilot CLI to fix the code.
 */
async function fix(diagnosis, context, config) {
  const { repoRoot } = context;
  const agentName = context.copilotAgent || 'auto-healer';
  const prompt = renderPrompt(diagnosis, context, config);

  // Write prompt to temp file to avoid shell escaping issues
  const promptFile = path.join(repoRoot, '.heal-prompt-tmp.md');
  fs.writeFileSync(promptFile, prompt, 'utf8');

  // Determine copilot command
  let copilotCmd = 'copilot';
  try {
    execSync('which copilot || where copilot', { stdio: 'pipe' });
  } catch {
    copilotCmd = 'npx -y @github/copilot';
  }

  try {
    const output = execSync(
      `${copilotCmd} -p "$(cat "${promptFile}")" --agent=${agentName} --allow-all-tools`,
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          GH_TOKEN: context.copilotToken || process.env.COPILOT_TOKEN || process.env.GH_TOKEN,
        },
        encoding: 'utf8',
        timeout: 300000, // 5 minutes
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    // Save output for audit
    const auditDir = path.join(repoRoot, '.heal-audit');
    if (!fs.existsSync(auditDir)) {
      fs.mkdirSync(auditDir, { recursive: true });
    }
    fs.writeFileSync(path.join(auditDir, `copilot-output-${context.attempt || 1}.log`), output, 'utf8');

    return { success: true, output };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    // Clean up temp prompt file
    if (fs.existsSync(promptFile)) {
      fs.unlinkSync(promptFile);
    }
  }
}

module.exports = { fix, name: 'copilot-cli' };
