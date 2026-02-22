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
 * Requires: GH_TOKEN with Copilot license (for GitHub Models access).
 */

const MODELS_API_HOST = 'models.inference.ai.azure.com';
const DEFAULT_MODEL = 'gpt-4o';

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

/**
 * Generate and apply a fix using the GitHub Models API.
 */
async function fix(diagnosis, context, config) {
  const { repoRoot } = context;
  const ghToken = context.copilotToken || process.env.COPILOT_TOKEN || context.ghPat || process.env.GH_PAT || process.env.GH_TOKEN;

  if (!ghToken) {
    throw new Error('GH_TOKEN, GH_PAT, or COPILOT_TOKEN is required for the copilot-cli backend.');
  }

  const model = process.env.HEAL_LLM_MODEL || config.llm?.model || DEFAULT_MODEL;
  const healPrompt = renderPrompt(diagnosis, context, config);
  const relevantFiles = readRelevantFiles(repoRoot, diagnosis);

  // Build file context string
  let fileContext = '';
  for (const [filePath, content] of Object.entries(relevantFiles)) {
    fileContext += `\n### ${filePath}\n\`\`\`\n${content}\n\`\`\`\n`;
  }

  const systemPrompt = [
    'You are a CI auto-healer. You fix code based on CI failure diagnostics.',
    'You MUST respond with ONLY a JSON array of file edits. No explanations.',
    'Each edit is an object with "file" (relative path) and "content" (the complete updated file content).',
    'Only include files that need changes. Write the COMPLETE file content, not a diff.',
    'Example response:',
    '```json',
    '[{"file": "src/app.js", "content": "const express = require(\'express\');\\n..."}]',
    '```',
  ].join('\n');

  const userPrompt = `${healPrompt}\n\n## Source Files\n${fileContext}`;

  console.log(`[copilot-cli] Calling GitHub Models API (model: ${model})...`);
  console.log(`[copilot-cli] Relevant files: ${Object.keys(relevantFiles).join(', ') || 'none'}`);

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
