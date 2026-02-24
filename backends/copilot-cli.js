'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

/**
 * Copilot CLI backend.
 *
 * Invokes the GitHub Copilot CLI binary (@github/copilot) to diagnose and fix
 * CI failures. The binary edits files directly on disk.
 *
 * Central agents, skills, and instructions are staged into the consumer repo's
 * .github/ directory at runtime so the Copilot CLI binary discovers them.
 * Consumer-local files take priority (never overwritten).
 *
 * Requires: Fine-Grained PAT with Copilot access via COPILOT_GITHUB_TOKEN,
 * GH_TOKEN, or GITHUB_TOKEN environment variables.
 */

const ACTION_ROOT = process.env.HEAL_ACTION_PATH || path.join(__dirname, '..');

/* ------------------------------------------------------------------ */
/*  Utility helpers                                                    */
/* ------------------------------------------------------------------ */

function readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Strip YAML frontmatter (--- ... ---) from markdown content.
 * Returns { frontmatter: {key: value}, body: string }.
 */
function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: text };
  }
  const attrs = {};
  for (const line of match[1].split('\n')) {
    const kvMatch = line.match(/^\s*([\w-]+)\s*:\s*"?([^"]*)"?\s*$/);
    if (kvMatch) {
      attrs[kvMatch[1]] = kvMatch[2];
    }
  }
  return { frontmatter: attrs, body: match[2] };
}

/**
 * Simple glob matcher supporting `dir/**` and `**` patterns.
 */
function matchesGlob(filePath, pattern) {
  const normalized = filePath.replace(/\\/g, '/');
  if (pattern === '**' || pattern === '**/*') {
    return true;
  }
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return normalized.startsWith(prefix + '/') || normalized === prefix;
  }
  if (pattern.endsWith('/**/*')) {
    const prefix = pattern.slice(0, -5);
    return normalized.startsWith(prefix + '/');
  }
  return normalized === pattern;
}

/* ------------------------------------------------------------------ */
/*  Dynamic discovery functions                                        */
/* ------------------------------------------------------------------ */

/**
 * Discover all agent personas under {rootDir}/.github/agents/*.md.
 * Returns [{ name, description, content }].
 */
function discoverAgents(rootDir) {
  const agentsDir = path.join(rootDir, '.github', 'agents');
  if (!fs.existsSync(agentsDir)) {
    return [];
  }

  const agents = [];
  for (const file of fs.readdirSync(agentsDir)) {
    if (!file.endsWith('.md')) continue;
    const raw = readIfExists(path.join(agentsDir, file));
    if (!raw) continue;
    const { frontmatter, body } = parseFrontmatter(raw);
    agents.push({
      name: path.basename(file, '.md'),
      description: frontmatter.description || '',
      content: body.trim(),
    });
  }
  return agents;
}

/**
 * Discover all skills under {rootDir}/.github/skills/<name>/SKILL.md.
 * Returns [{ name, content }].
 */
function discoverSkills(rootDir) {
  const skillsDir = path.join(rootDir, '.github', 'skills');
  if (!fs.existsSync(skillsDir)) {
    return [];
  }

  const skills = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
    const raw = readIfExists(skillFile);
    if (!raw) continue;
    skills.push({
      name: entry.name,
      content: raw.trim(),
    });
  }
  return skills;
}

/**
 * Discover coding instructions from {rootDir}/.github/instructions/*.md
 * and {rootDir}/.github/copilot-instructions.md.
 *
 * Instructions with an `applyTo` frontmatter glob are only included when
 * at least one relevant file matches the pattern.
 *
 * Returns [{ name, content, applyTo? }].
 */
function discoverInstructions(rootDir, relevantFilePaths) {
  const results = [];

  // Global instructions (always included)
  const globalPath = path.join(rootDir, '.github', 'copilot-instructions.md');
  const globalRaw = readIfExists(globalPath);
  if (globalRaw) {
    results.push({ name: 'copilot-instructions', content: globalRaw.trim() });
  }

  // Scoped instructions
  const instrDir = path.join(rootDir, '.github', 'instructions');
  if (fs.existsSync(instrDir)) {
    for (const file of fs.readdirSync(instrDir)) {
      if (!file.endsWith('.md')) continue;
      const raw = readIfExists(path.join(instrDir, file));
      if (!raw) continue;

      const { frontmatter, body } = parseFrontmatter(raw);
      const applyTo = frontmatter.applyTo;

      // If applyTo is specified, only include when a relevant file matches
      if (applyTo) {
        const hasMatch = relevantFilePaths.some((fp) => matchesGlob(fp, applyTo));
        if (!hasMatch) continue;
      }

      results.push({
        name: path.basename(file, '.md'),
        content: body.trim(),
        applyTo,
      });
    }
  }

  return results;
}

/* ------------------------------------------------------------------ */
/*  Agent/skill staging for Copilot CLI discovery                      */
/* ------------------------------------------------------------------ */

/**
 * Stage central agents, skills, and instructions into the consumer repo's
 * .github/ directory so the Copilot CLI binary can discover them at runtime.
 *
 * Consumer-local files take priority (never overwritten).
 * Returns list of staged file paths for cleanup.
 */
function stageAgentsForDiscovery(repoRoot) {
  const stagedFiles = [];

  // Stage central agents (consumer-local takes priority)
  const centralAgentsDir = path.join(ACTION_ROOT, '.github', 'agents');
  if (fs.existsSync(centralAgentsDir)) {
    const consumerAgentsDir = path.join(repoRoot, '.github', 'agents');
    fs.mkdirSync(consumerAgentsDir, { recursive: true });

    for (const file of fs.readdirSync(centralAgentsDir)) {
      if (!file.endsWith('.md')) continue;
      const targetPath = path.join(consumerAgentsDir, file);
      if (!fs.existsSync(targetPath)) {
        fs.copyFileSync(path.join(centralAgentsDir, file), targetPath);
        stagedFiles.push(targetPath);
        console.log(`[copilot-cli] Staged central agent: ${path.basename(file, '.md')}`);
      } else {
        console.log(`[copilot-cli] Consumer has local agent: ${path.basename(file, '.md')} (using local)`);
      }
    }
  }

  // Stage central skills
  const centralSkillsDir = path.join(ACTION_ROOT, '.github', 'skills');
  if (fs.existsSync(centralSkillsDir)) {
    for (const entry of fs.readdirSync(centralSkillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sourceSkill = path.join(centralSkillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(sourceSkill)) continue;

      const targetDir = path.join(repoRoot, '.github', 'skills', entry.name);
      const targetPath = path.join(targetDir, 'SKILL.md');
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(sourceSkill, targetPath);
        stagedFiles.push(targetPath);
        console.log(`[copilot-cli] Staged central skill: ${entry.name}`);
      }
    }
  }

  // Stage central instructions
  const centralInstrDir = path.join(ACTION_ROOT, '.github', 'instructions');
  if (fs.existsSync(centralInstrDir)) {
    const targetInstrDir = path.join(repoRoot, '.github', 'instructions');
    fs.mkdirSync(targetInstrDir, { recursive: true });
    for (const file of fs.readdirSync(centralInstrDir)) {
      if (!file.endsWith('.md')) continue;
      const targetPath = path.join(targetInstrDir, file);
      if (!fs.existsSync(targetPath)) {
        fs.copyFileSync(path.join(centralInstrDir, file), targetPath);
        stagedFiles.push(targetPath);
        console.log(`[copilot-cli] Staged central instruction: ${file}`);
      }
    }
  }

  // Stage central copilot-instructions.md (merge with consumer's if both exist)
  const centralGlobal = path.join(ACTION_ROOT, '.github', 'copilot-instructions.md');
  const consumerGlobal = path.join(repoRoot, '.github', 'copilot-instructions.md');
  if (fs.existsSync(centralGlobal)) {
    const centralContent = fs.readFileSync(centralGlobal, 'utf8');
    if (fs.existsSync(consumerGlobal)) {
      const consumerContent = fs.readFileSync(consumerGlobal, 'utf8');
      if (!consumerContent.includes(centralContent.trim())) {
        const backupPath = consumerGlobal + '.heal-backup';
        fs.writeFileSync(backupPath, consumerContent, 'utf8');
        stagedFiles.push(backupPath);
        const merged = consumerContent + '\n\n---\n\n# Central Auto-Heal Instructions\n\n' + centralContent;
        fs.writeFileSync(consumerGlobal, merged, 'utf8');
        console.log('[copilot-cli] Merged central copilot-instructions.md with consumer');
      }
    } else {
      fs.mkdirSync(path.join(repoRoot, '.github'), { recursive: true });
      fs.copyFileSync(centralGlobal, consumerGlobal);
      stagedFiles.push(consumerGlobal);
      console.log('[copilot-cli] Staged central copilot-instructions.md');
    }
  }

  return stagedFiles;
}

/**
 * Clean up staged files after Copilot CLI run.
 */
function cleanupStagedFiles(repoRoot, stagedFiles) {
  for (const filePath of stagedFiles) {
    if (filePath.endsWith('.heal-backup')) {
      const originalPath = filePath.replace('.heal-backup', '');
      try {
        const backup = fs.readFileSync(filePath, 'utf8');
        fs.writeFileSync(originalPath, backup, 'utf8');
        fs.unlinkSync(filePath);
      } catch { /* ignore cleanup errors */ }
    } else {
      try {
        fs.unlinkSync(filePath);
      } catch { /* already cleaned */ }
    }
  }
  if (stagedFiles.length > 0) {
    console.log(`[copilot-cli] Cleaned up ${stagedFiles.length} staged file(s)`);
  }
}

/* ------------------------------------------------------------------ */
/*  Copilot CLI binary invocation                                      */
/* ------------------------------------------------------------------ */

/**
 * Find the Copilot CLI binary. Tries `copilot` directly, falls back to npx.
 * Returns { binary: string, useNpx: boolean }.
 */
function findCopilotBinary() {
  try {
    execFileSync('copilot', ['--version'], { stdio: 'pipe', encoding: 'utf8', timeout: 10000 });
    return { binary: 'copilot', useNpx: false };
  } catch { /* not found directly */ }

  try {
    execFileSync('npx', ['--yes', '@github/copilot', '--version'], { stdio: 'pipe', encoding: 'utf8', timeout: 30000 });
    return { binary: 'npx', useNpx: true };
  } catch { /* not found via npx */ }

  throw new Error('Copilot CLI not found. Install with: npm install -g @github/copilot');
}

/**
 * Invoke the Copilot CLI binary with the given prompt and agent.
 *
 * @param {string} prompt - The heal prompt text
 * @param {string} agentName - Agent name (matches .github/agents/<name>.md)
 * @param {string} repoRoot - Working directory for the copilot process
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function invokeCopilotCli(prompt, agentName, repoRoot) {
  return new Promise((resolve, reject) => {
    const { binary, useNpx } = findCopilotBinary();

    const args = useNpx
      ? ['--yes', '@github/copilot', '-p', prompt, `--agent=${agentName}`, '--allow-all-tools']
      : ['-p', prompt, `--agent=${agentName}`, '--allow-all-tools'];

    // Set up environment for auth
    const env = { ...process.env };
    const token = process.env.COPILOT_GITHUB_TOKEN
      || process.env.GH_TOKEN
      || process.env.GITHUB_TOKEN
      || process.env.GH_PAT;

    if (token) {
      env.COPILOT_GITHUB_TOKEN = token;
      env.GH_TOKEN = token;
      env.GITHUB_TOKEN = token;
    }

    // GHES support
    if (process.env.GH_HOST) {
      env.GH_HOST = process.env.GH_HOST;
    } else if (process.env.GITHUB_SERVER_URL && process.env.GITHUB_SERVER_URL !== 'https://github.com') {
      env.GH_HOST = process.env.GITHUB_SERVER_URL.replace(/^https?:\/\//, '');
    }

    console.log(`[copilot-cli] Invoking: ${binary} -p <prompt> --agent=${agentName} --allow-all-tools`);

    execFile(binary, args, {
      cwd: repoRoot,
      env,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 300000, // 5 minute timeout
    }, (err, stdout, stderr) => {
      if (err) {
        console.error(`[copilot-cli] Copilot CLI exited with code ${err.code || 'unknown'}`);
        if (stderr) console.error(`[copilot-cli] stderr: ${stderr.substring(0, 2000)}`);
        reject(new Error(`Copilot CLI failed (exit ${err.code}): ${stderr || err.message}`));
        return;
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Prompt building                                                    */
/* ------------------------------------------------------------------ */

/**
 * Render the heal prompt template with diagnosis data.
 */
function renderPrompt(diagnosis, context, config) {
  const promptPath = path.join(ACTION_ROOT, 'prompts', 'heal-prompt.md');
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
 * Read source files referenced in the diagnosis so the model has full context.
 */
function readRelevantFiles(repoRoot, diagnosis) {
  const files = {};
  const relevantFiles = diagnosis.relevantFiles || [];

  for (const filePath of relevantFiles) {
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
    if (fs.existsSync(absPath)) {
      files[path.relative(repoRoot, absPath)] = fs.readFileSync(absPath, 'utf8');
    }
  }

  return files;
}

/**
 * Build the complete prompt for the Copilot CLI.
 * Combines heal-prompt template + source files + path constraints.
 */
function buildCopilotPrompt(diagnosis, context, config) {
  const basePrompt = renderPrompt(diagnosis, context, config);
  const relevantFiles = readRelevantFiles(context.repoRoot, diagnosis);

  const parts = [basePrompt];

  if (Object.keys(relevantFiles).length > 0) {
    parts.push('\n## Source Files\n');
    for (const [filePath, content] of Object.entries(relevantFiles)) {
      parts.push(`### ${filePath}\n\`\`\`\n${content}\n\`\`\`\n`);
    }
  }

  if (config.paths) {
    parts.push('\n## File Constraints');
    parts.push(`Only modify files under: ${config.paths.allowed.join(', ')}`);
    parts.push(`Do NOT modify: ${config.paths.protected.join(', ')}`);
  }

  return parts.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Main fix function                                                  */
/* ------------------------------------------------------------------ */

/**
 * Generate and apply a fix using the GitHub Copilot CLI binary.
 */
async function fix(diagnosis, context, config) {
  const { repoRoot } = context;
  const agentName = config.copilot?.agentName || 'auto-healer';

  // Step 1: Stage central agents/skills/instructions for Copilot CLI discovery
  console.log('[copilot-cli] Staging central agents/skills/instructions...');
  let stagedFiles = [];
  try {
    stagedFiles = stageAgentsForDiscovery(repoRoot);
  } catch (err) {
    console.error(`[copilot-cli] Warning: Failed to stage some central files: ${err.message}`);
  }

  // Step 2: Build the prompt
  const prompt = buildCopilotPrompt(diagnosis, context, config);

  // Save prompt to audit
  const auditDir = path.join(repoRoot, '.heal-audit');
  if (!fs.existsSync(auditDir)) {
    fs.mkdirSync(auditDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(auditDir, `copilot-cli-prompt-${context.attempt || 1}.md`),
    prompt,
    'utf8'
  );

  // Step 3: Invoke Copilot CLI
  console.log(`[copilot-cli] Invoking Copilot CLI (agent: ${agentName})...`);
  let result;
  try {
    result = await invokeCopilotCli(prompt, agentName, repoRoot);
  } catch (err) {
    cleanupStagedFiles(repoRoot, stagedFiles);
    return { success: false, error: `Copilot CLI invocation failed: ${err.message}` };
  }

  // Save output to audit
  fs.writeFileSync(
    path.join(auditDir, `copilot-cli-output-${context.attempt || 1}.log`),
    result.stdout + '\n---STDERR---\n' + result.stderr,
    'utf8'
  );

  // Step 4: Clean up staged files
  cleanupStagedFiles(repoRoot, stagedFiles);

  // Step 5: Detect changed files
  let changedFiles = [];
  try {
    const diffOutput = execFileSync('git', ['diff', '--name-only'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    changedFiles = diffOutput.trim().split('\n').filter(Boolean);
  } catch { /* no changes */ }

  // Also check for new untracked files in allowed paths
  try {
    const untrackedOutput = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const untracked = untrackedOutput.trim().split('\n').filter(Boolean);
    const allowedUntracked = untracked.filter((f) =>
      config.paths.allowed.some((prefix) => f.startsWith(prefix))
    );
    changedFiles = [...new Set([...changedFiles, ...allowedUntracked])];
  } catch { /* ignore */ }

  if (changedFiles.length === 0) {
    return { success: false, error: 'Copilot CLI made no file changes' };
  }

  console.log(`[copilot-cli] Copilot CLI modified ${changedFiles.length} file(s): ${changedFiles.join(', ')}`);

  return {
    success: true,
    filesChanged: changedFiles,
    copilotOutput: result.stdout.substring(0, 5000),
  };
}

module.exports = { fix, name: 'copilot-cli' };
