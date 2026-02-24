'use strict';

const { execFileSync } = require('child_process');

/**
 * Commit adapter — stages, commits, and pushes healed changes.
 *
 * Enforces allowed/protected path rules before committing.
 * Supports direct push and PR creation (via gh CLI).
 */

/**
 * Get list of changed files from git.
 */
function getChangedFiles(repoRoot) {
  try {
    const unstaged = execFileSync('git', ['diff', '--name-only'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    const all = `${unstaged}\n${staged}`.split('\n').filter(Boolean);
    return [...new Set(all)];
  } catch {
    return [];
  }
}

/**
 * Revert changes to protected files.
 */
function revertProtected(repoRoot, changedFiles, protectedPaths) {
  const reverted = [];
  for (const file of changedFiles) {
    const isProtected = protectedPaths.some((p) => file.startsWith(p) || file === p);
    if (isProtected) {
      try {
        execFileSync('git', ['checkout', '--', file], { cwd: repoRoot, stdio: 'pipe' });
        reverted.push(file);
      } catch {
        // Already clean or untracked
      }
    }
  }
  return reverted;
}

/**
 * Filter to only allowed files.
 */
function filterAllowed(changedFiles, allowedPaths) {
  return changedFiles.filter((file) =>
    allowedPaths.some((prefix) => file.startsWith(prefix))
  );
}

/**
 * Stage, commit, and push changes.
 *
 * @param {object} options
 * @param {string} options.repoRoot       - Absolute path to repo root
 * @param {object} options.config         - Loaded config
 * @param {object} options.context        - Runtime context (branch, attempt, etc.)
 * @param {string} [options.mode='push']  - 'push' for direct push, 'pr' for pull request
 * @returns {object} Result with committed files and push/PR status
 */
function commit({ repoRoot, config, context, mode = 'push' }) {
  const changedFiles = getChangedFiles(repoRoot);

  if (changedFiles.length === 0) {
    return { success: false, reason: 'No changed files detected' };
  }

  // Revert protected files
  const reverted = revertProtected(repoRoot, changedFiles, config.paths.protected);
  if (reverted.length > 0) {
    console.log(`[commit] Reverted ${reverted.length} protected file(s): ${reverted.join(', ')}`);
  }

  // Filter to allowed paths only
  const allowed = filterAllowed(getChangedFiles(repoRoot), config.paths.allowed);
  if (allowed.length === 0) {
    return { success: false, reason: 'No allowed files changed after filtering' };
  }

  // Stage allowed files
  for (const file of allowed) {
    execFileSync('git', ['add', file], { cwd: repoRoot, stdio: 'pipe' });
  }

  // Configure git identity if not already set
  try {
    execFileSync('git', ['config', 'user.name'], { cwd: repoRoot, stdio: 'pipe' });
  } catch {
    execFileSync('git', ['config', 'user.name', 'auto-heal-bot'], { cwd: repoRoot, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'auto-heal-bot@users.noreply.github.com'], { cwd: repoRoot, stdio: 'pipe' });
  }

  const attempt = context.attempt || 1;
  const commitMsg = `fix(auto-heal): ${context.diagnosisType || 'ci-failure'} (attempt ${attempt})`;

  // Commit
  try {
    execFileSync('git', ['commit', '-m', commitMsg], { cwd: repoRoot, stdio: 'pipe' });
  } catch (err) {
    return { success: false, reason: `git commit failed: ${err.message}` };
  }

  if (mode === 'pr') {
    return createPR(repoRoot, context, commitMsg, allowed);
  }

  // Direct push
  try {
    const branch = context.branch || getCurrentBranch(repoRoot);
    execFileSync('git', ['push', 'origin', branch], { cwd: repoRoot, stdio: 'pipe' });
    return { success: true, mode: 'push', files: allowed, branch };
  } catch (err) {
    return { success: false, reason: `git push failed: ${err.message}`, files: allowed };
  }
}

/**
 * Create a pull request with the fix.
 */
function createPR(repoRoot, context, commitMsg, files) {
  const attempt = context.attempt || 1;
  const healBranch = `auto-heal/attempt-${attempt}-${Date.now()}`;

  // Token strategy:
  //   git push    → relies on actions/checkout extraheader (GITHUB_TOKEN)
  //   gh pr create → uses GITHUB_TOKEN (Actions-provided, has pull-requests:write)
  //   Copilot CLI  → uses Fine-Grained PAT (GH_TOKEN / COPILOT_GITHUB_TOKEN)
  const prToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GH_PAT || context.ghPat;

  // Build env for gh pr create — use GITHUB_TOKEN
  const prEnv = {
    ...process.env,
    ...(prToken ? { GH_TOKEN: prToken } : {}),
    ...(context.ghHost ? { GH_HOST: context.ghHost } : {}),
  };

  try {
    execFileSync('git', ['checkout', '-b', healBranch], { cwd: repoRoot, stdio: 'pipe' });

    console.log(`[commit] Push via actions/checkout credentials`);
    console.log(`[commit] PR token: ${prToken ? prToken.substring(0, 8) + '...' : 'unset'}`);

    execFileSync('git', ['push', 'origin', healBranch], { cwd: repoRoot, stdio: 'pipe' });

    const prTitle = `Auto-heal: fix ${context.diagnosisType || 'ci-failure'} (attempt ${attempt})`;
    const prBody = [
      '## Auto-Heal Fix',
      '',
      `**Failure type:** ${context.diagnosisType || 'unknown'}`,
      `**Attempt:** ${attempt}`,
      `**Base branch:** ${context.branch || 'main'}`,
      '',
      '### Changed files',
      ...files.map((f) => `- \`${f}\``),
      '',
      '---',
      '*Created automatically by the self-healing CI pipeline.*',
    ].join('\n');

    const result = execFileSync(
      'gh',
      ['pr', 'create', '--base', context.branch || 'main', '--head', healBranch, '--title', prTitle, '--body', prBody],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: prEnv,
      }
    );

    return { success: true, mode: 'pr', branch: healBranch, files, prUrl: result.trim() };
  } catch (err) {
    return { success: false, mode: 'pr', reason: `PR creation failed: ${err.message}`, files };
  }
}

/**
 * Get current git branch.
 */
function getCurrentBranch(repoRoot) {
  try {
    return execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return 'main';
  }
}

/**
 * Get the git remote URL for 'origin'.
 */
function getRemoteUrl(repoRoot) {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

module.exports = { commit, getChangedFiles, revertProtected, filterAllowed };
