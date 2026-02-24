'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

/**
 * Post-fix validation — runs the validation commands from the diagnosis
 * to verify that the fix actually resolves the CI failure.
 *
 * Splits compound commands on ' && ', runs each sequentially, and
 * returns on first failure.
 */

/**
 * Run a single shell command and return a promise.
 *
 * @param {string} command - Full command string (e.g., 'npm run lint')
 * @param {string} cwd - Working directory
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<{passed: boolean, output: string, code: number|null}>}
 */
function runCommand(command, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const parts = command.trim().split(/\s+/);
    const bin = parts[0];
    const args = parts.slice(1);

    execFile(bin, args, {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    }, (err, stdout, stderr) => {
      const output = (stdout || '') + (stderr ? '\n' + stderr : '');
      if (err) {
        resolve({ passed: false, output, code: err.code || 1 });
      } else {
        resolve({ passed: true, output, code: 0 });
      }
    });
  });
}

/**
 * Validate a fix by running the validation command(s) from the diagnosis.
 *
 * @param {object} options
 * @param {string} options.repoRoot - Absolute path to repo root
 * @param {object} options.diagnosis - Diagnosis result (must have validationCommand)
 * @param {object} options.config - Loaded config
 * @param {number} [options.timeoutMs=120000] - Timeout per command in ms
 * @returns {Promise<{passed: boolean, output: string, command: string, failedStep?: string}>}
 */
async function validate({ repoRoot, diagnosis, config, timeoutMs = 120000 }) {
  const validationCommand = diagnosis.validationCommand;

  if (!validationCommand) {
    console.log('[validate] No validation command specified — skipping validation.');
    return { passed: true, output: '', command: '' };
  }

  // Split compound commands (e.g., 'npm run lint && npm test')
  const commands = validationCommand.split(' && ').map((c) => c.trim()).filter(Boolean);

  console.log(`[validate] Running ${commands.length} validation command(s)...`);

  const allOutput = [];

  for (const cmd of commands) {
    console.log(`[validate] Running: ${cmd}`);
    const result = await runCommand(cmd, repoRoot, timeoutMs);
    allOutput.push(`$ ${cmd}\n${result.output}`);

    if (!result.passed) {
      console.error(`[validate] FAILED: ${cmd} (exit code ${result.code})`);

      // Save validation output to audit
      saveAudit(repoRoot, allOutput.join('\n---\n'), 'failed');

      return {
        passed: false,
        output: allOutput.join('\n---\n'),
        command: validationCommand,
        failedStep: cmd,
      };
    }

    console.log(`[validate] PASSED: ${cmd}`);
  }

  console.log('[validate] All validation commands passed.');

  // Save validation output to audit
  saveAudit(repoRoot, allOutput.join('\n---\n'), 'passed');

  return {
    passed: true,
    output: allOutput.join('\n---\n'),
    command: validationCommand,
  };
}

/**
 * Save validation output to the audit directory.
 */
function saveAudit(repoRoot, output, status) {
  try {
    const auditDir = path.join(repoRoot, '.heal-audit');
    if (!fs.existsSync(auditDir)) {
      fs.mkdirSync(auditDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(auditDir, `validation-${status}-${Date.now()}.log`),
      output,
      'utf8'
    );
  } catch {
    // Non-critical — don't fail the pipeline for audit writes
  }
}

module.exports = { validate };
