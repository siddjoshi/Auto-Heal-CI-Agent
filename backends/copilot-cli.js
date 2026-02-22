'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

/**
 * Copilot CLI backend.
 *
 * Calls the GitHub Models API to generate code fixes, then applies
 * them directly to files on disk. The engine commit step creates a PR.
 *
 * Dynamically discovers agent personas, skills, and coding instructions
 * from `.github/` directories in both the action repo (central) and the
 * consumer repo. Any future agents, skills, or instructions added to
 * either repo are automatically picked up — no code changes required.
 *
 * Requires: GH_TOKEN with Copilot license (for GitHub Models access).
 */

const MODELS_API_HOST = 'models.inference.ai.azure.com';
const DEFAULT_MODEL = 'gpt-4o';
const ACTION_ROOT = path.join(__dirname, '..');

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
 * Returns true if filePath matches the glob.
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
/*  System prompt builder                                              */
/* ------------------------------------------------------------------ */

/**
 * Build the full system prompt by discovering agents, skills, and
 * instructions from both the action repo and the consumer repo.
 */
function buildSystemPrompt(repoRoot, relevantFilePaths) {
  const sections = [];

  // Discover from both roots (action repo = central, consumer repo = project)
  const roots = [
    { label: 'central', dir: ACTION_ROOT },
    { label: 'project', dir: repoRoot },
  ];

  // De-duplicate when action root and consumer root are the same path
  const uniqueRoots = [];
  const seen = new Set();
  for (const root of roots) {
    const resolved = path.resolve(root.dir);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      uniqueRoots.push(root);
    }
  }

  const allAgents = [];
  const allSkills = [];
  const allInstructions = [];

  for (const root of uniqueRoots) {
    const agents = discoverAgents(root.dir);
    for (const agent of agents) {
      allAgents.push({ ...agent, source: root.label });
    }

    const skills = discoverSkills(root.dir);
    for (const skill of skills) {
      allSkills.push({ ...skill, source: root.label });
    }

    const instructions = discoverInstructions(root.dir, relevantFilePaths);
    for (const instr of instructions) {
      allInstructions.push({ ...instr, source: root.label });
    }
  }

  // Log discovery results
  console.log(`[copilot-cli] Agents loaded: ${allAgents.map((a) => `${a.name} (${a.source})`).join(', ') || 'none'}`);
  console.log(`[copilot-cli] Skills loaded: ${allSkills.map((s) => `${s.name} (${s.source})`).join(', ') || 'none'}`);
  console.log(`[copilot-cli] Instructions loaded: ${allInstructions.map((i) => `${i.name} (${i.source})`).join(', ') || 'none'}`);

  // --- Agent Personas ---
  if (allAgents.length > 0) {
    sections.push('# Agent Personas\n');
    for (const agent of allAgents) {
      sections.push(`## ${agent.name}\n${agent.content}\n`);
    }
  }

  // --- Skills ---
  if (allSkills.length > 0) {
    sections.push('# Skills\n');
    for (const skill of allSkills) {
      sections.push(`## ${skill.name}\n${skill.content}\n`);
    }
  }

  // --- Coding Instructions ---
  if (allInstructions.length > 0) {
    sections.push('# Coding Instructions\n');
    for (const instr of allInstructions) {
      const scope = instr.applyTo ? ` (applies to: ${instr.applyTo})` : ' (global)';
      sections.push(`## ${instr.name}${scope}\n${instr.content}\n`);
    }
  }

  // --- Output Format (always appended) ---
  sections.push([
    '# Output Format\n',
    'You MUST respond with ONLY a JSON array of file edits. No explanations outside the JSON.',
    'Each edit is an object with "file" (relative path) and "content" (the complete updated file content).',
    'Only include files that need changes. Write the COMPLETE file content, not a diff.',
    'Example response:',
    '```json',
    '[{"file": "src/app.js", "content": "const express = require(\'express\');\\n..."}]',
    '```',
  ].join('\n'));

  return sections.join('\n');
}

/* ------------------------------------------------------------------ */
/*  Prompt rendering & file reading                                    */
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

/* ------------------------------------------------------------------ */
/*  GitHub Models API                                                  */
/* ------------------------------------------------------------------ */

/**
 * Call the GitHub Models API (chat completions).
 */
function callModelsAPI(token, model, messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, messages, temperature: 0.2 });

    const options = {
      hostname: MODELS_API_HOST,
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Models API returned ${res.statusCode}: ${data}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Failed to parse Models API response: ${data.substring(0, 500)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error('Models API request timed out after 120s'));
    });
    req.write(body);
    req.end();
  });
}

/* ------------------------------------------------------------------ */
/*  Response parsing & application                                     */
/* ------------------------------------------------------------------ */

/**
 * Parse the model response to extract file edits.
 * Expects a JSON array: [{ "file": "path", "content": "full file content" }]
 */
function parseEdits(responseText) {
  // Extract JSON from markdown code fence if present
  const jsonMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : responseText;

  const parsed = JSON.parse(jsonStr.trim());

  if (!Array.isArray(parsed)) {
    throw new Error('Expected a JSON array of file edits');
  }

  for (const edit of parsed) {
    if (!edit.file || typeof edit.content !== 'string') {
      throw new Error('Each edit must have "file" (string) and "content" (string)');
    }
  }

  return parsed;
}

/**
 * Apply file edits to disk.
 */
function applyEdits(repoRoot, edits) {
  const applied = [];
  for (const edit of edits) {
    const absPath = path.join(repoRoot, edit.file);

    // Safety: only allow files under allowed directories
    const relPath = path.relative(repoRoot, absPath);
    if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
      console.log(`[copilot-cli] Skipping file outside repo: ${edit.file}`);
      continue;
    }
    if (relPath.startsWith('.github') || relPath.startsWith('scripts')) {
      console.log(`[copilot-cli] Skipping protected path: ${edit.file}`);
      continue;
    }

    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(absPath, edit.content, 'utf8');
    applied.push(edit.file);
    console.log(`[copilot-cli] Updated: ${edit.file}`);
  }
  return applied;
}

/* ------------------------------------------------------------------ */
/*  Main fix function                                                  */
/* ------------------------------------------------------------------ */

/**
 * Generate and apply a fix using the GitHub Models API.
 */
async function fix(diagnosis, context, config) {
  const { repoRoot } = context;
  const ghToken = context.copilotToken || process.env.COPILOT_TOKEN || context.ghPat || process.env.GH_PAT || process.env.GH_TOKEN;

  if (!ghToken) {
    throw new Error('GH_TOKEN, GH_PAT, or COPILOT_TOKEN is required for the copilot-cli backend.');
  }

  const model = process.env.HEAL_COPILOT_CLI_MODEL || process.env.HEAL_LLM_MODEL || config.llm?.model || DEFAULT_MODEL;
  const healPrompt = renderPrompt(diagnosis, context, config);
  const relevantFiles = readRelevantFiles(repoRoot, diagnosis);
  const relevantFilePaths = Object.keys(relevantFiles);

  // Build file context string
  let fileContext = '';
  for (const [filePath, content] of Object.entries(relevantFiles)) {
    fileContext += `\n### ${filePath}\n\`\`\`\n${content}\n\`\`\`\n`;
  }

  // Build system prompt from discovered agents, skills, and instructions
  const systemPrompt = buildSystemPrompt(repoRoot, relevantFilePaths);

  const userPrompt = `${healPrompt}\n\n## Source Files\n${fileContext}`;

  console.log(`[copilot-cli] Calling GitHub Models API (model: ${model})...`);
  console.log(`[copilot-cli] Relevant files: ${relevantFilePaths.join(', ') || 'none'}`);

  let response;
  try {
    response = await callModelsAPI(ghToken, model, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);
  } catch (err) {
    return { success: false, error: `Models API call failed: ${err.message}` };
  }

  const responseText = response.choices?.[0]?.message?.content;
  if (!responseText) {
    return { success: false, error: 'Models API returned empty response' };
  }

  // Save raw response for audit
  const auditDir = path.join(repoRoot, '.heal-audit');
  if (!fs.existsSync(auditDir)) {
    fs.mkdirSync(auditDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(auditDir, `copilot-cli-response-${context.attempt || 1}.json`),
    JSON.stringify(response, null, 2),
    'utf8'
  );

  // Parse and apply edits
  let edits;
  try {
    edits = parseEdits(responseText);
  } catch (err) {
    return { success: false, error: `Failed to parse model response: ${err.message}`, rawResponse: responseText };
  }

  if (edits.length === 0) {
    return { success: false, error: 'Model returned zero file edits' };
  }

  const applied = applyEdits(repoRoot, edits);
  console.log(`[copilot-cli] Applied ${applied.length} file edit(s)`);

  return { success: applied.length > 0, filesChanged: applied, model };
}

module.exports = { fix, name: 'copilot-cli' };
