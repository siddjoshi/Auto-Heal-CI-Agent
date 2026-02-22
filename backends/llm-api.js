'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

/**
 * LLM API backend.
 *
 * Calls an LLM provider (OpenAI, Anthropic, Azure OpenAI, GitHub Models)
 * to generate code patches, then applies them to disk.
 *
 * Fully platform-agnostic — works anywhere with an API key.
 */

/**
 * Provider-specific API configurations.
 */
const PROVIDERS = {
  openai: {
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    getHeaders: (apiKey) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    }),
    buildPayload: (model, messages) => ({
      model: model || 'gpt-4o',
      messages,
      temperature: 0.2,
      max_tokens: 4096,
    }),
    extractContent: (body) => body.choices?.[0]?.message?.content || '',
  },

  anthropic: {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    getHeaders: (apiKey) => ({
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }),
    buildPayload: (model, messages) => {
      const systemMsg = messages.find((m) => m.role === 'system');
      const userMsgs = messages.filter((m) => m.role !== 'system');
      return {
        model: model || 'claude-sonnet-4-20250514',
        system: systemMsg?.content || '',
        messages: userMsgs,
        max_tokens: 4096,
        temperature: 0.2,
      };
    },
    extractContent: (body) => {
      const textBlock = body.content?.find((b) => b.type === 'text');
      return textBlock?.text || '';
    },
  },

  'azure-openai': {
    hostname: null, // Set from endpoint env var
    path: null,     // Set from endpoint env var
    getHeaders: (apiKey) => ({
      'Content-Type': 'application/json',
      'api-key': apiKey,
    }),
    buildPayload: (model, messages) => ({
      messages,
      temperature: 0.2,
      max_tokens: 4096,
    }),
    extractContent: (body) => body.choices?.[0]?.message?.content || '',
  },

  'github-models': {
    hostname: 'models.inference.ai.azure.com',
    path: '/chat/completions',
    getHeaders: (apiKey) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    }),
    buildPayload: (model, messages) => ({
      model: model || 'gpt-4o',
      messages,
      temperature: 0.2,
      max_tokens: 4096,
    }),
    extractContent: (body) => body.choices?.[0]?.message?.content || '',
  },
};

/**
 * Make an HTTPS POST request.
 */
function httpsPost(hostname, urlPath, headers, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      hostname,
      path: urlPath,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(data) },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`API returned ${res.statusCode}: ${body.substring(0, 500)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`Failed to parse API response: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error('API request timed out'));
    });
    req.write(data);
    req.end();
  });
}

/**
 * Read source files mentioned in the diagnosis.
 */
function readRelevantFiles(repoRoot, diagnosis) {
  const contents = {};
  for (const filePath of (diagnosis.relevantFiles || [])) {
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
    try {
      if (fs.existsSync(absPath)) {
        contents[filePath] = fs.readFileSync(absPath, 'utf8');
      }
    } catch {
      // Skip unreadable files
    }
  }
  return contents;
}

/**
 * Parse code patches from LLM response.
 * Supports format: ```filepath\n<content>\n```
 */
function parsePatches(response) {
  const patches = [];
  const regex = /```(\S+)\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(response)) !== null) {
    const filePath = match[1];
    const content = match[2];

    // Skip non-file code blocks
    if (['json', 'bash', 'shell', 'diff', 'text', 'yaml', 'yml', 'md'].includes(filePath)) {
      continue;
    }

    // Must look like a file path
    if (filePath.includes('/') || filePath.includes('.')) {
      patches.push({ file: filePath, content });
    }
  }

  return patches;
}

/**
 * Apply patches to disk within allowed paths.
 */
function applyPatches(repoRoot, patches, allowedPaths) {
  const applied = [];
  const rejected = [];

  for (const patch of patches) {
    const isAllowed = allowedPaths.some((prefix) => patch.file.startsWith(prefix));
    if (!isAllowed) {
      rejected.push(patch.file);
      continue;
    }

    const absPath = path.join(repoRoot, patch.file);
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(absPath, patch.content, 'utf8');
    applied.push(patch.file);
  }

  return { applied, rejected };
}

/**
 * Build the LLM prompt from diagnosis and source files.
 */
function buildPrompt(diagnosis, sourceFiles, config) {
  const fileContents = Object.entries(sourceFiles)
    .map(([name, content]) => `### ${name}\n\`\`\`\n${content}\n\`\`\``)
    .join('\n\n');

  const systemPrompt = [
    'You are a CI/CD auto-healer. Fix the failing code based on the diagnosis below.',
    'Return ONLY the fixed files using this format for each file:',
    '',
    '```filepath/relative/to/repo.js',
    '<entire file content>',
    '```',
    '',
    'Rules:',
    `- Only modify files under: ${config.paths.allowed.join(', ')}`,
    '- Do NOT modify protected paths or configuration files.',
    '- Make minimal changes to fix the issue.',
    '- Do NOT delete or skip tests.',
    '- Match existing code style.',
  ].join('\n');

  const userPrompt = [
    `## Failure Type: ${diagnosis.type}`,
    '',
    '## Diagnosis',
    '```json',
    JSON.stringify(diagnosis, null, 2),
    '```',
    '',
    '## Source Files',
    fileContents,
    '',
    `## Validation Command: ${diagnosis.validationCommand}`,
  ].join('\n');

  return { systemPrompt, userPrompt };
}

/**
 * Call LLM API to generate fixes and apply them.
 */
async function fix(diagnosis, context, config) {
  const { repoRoot } = context;
  const llmConfig = config.llm || {};
  const providerName = llmConfig.provider || 'openai';
  const provider = PROVIDERS[providerName];

  if (!provider) {
    throw new Error(`Unknown LLM provider: ${providerName}. Supported: ${Object.keys(PROVIDERS).join(', ')}`);
  }

  // Determine API key from env
  const envKeyMap = {
    'openai': 'OPENAI_API_KEY',
    'anthropic': 'ANTHROPIC_API_KEY',
    'azure-openai': 'AZURE_OPENAI_API_KEY',
    'github-models': 'GITHUB_MODELS_API_KEY',
  };
  const apiKey = process.env[envKeyMap[providerName]] || process.env.LLM_API_KEY;

  if (!apiKey) {
    throw new Error(`API key not found. Set ${envKeyMap[providerName]} or LLM_API_KEY environment variable.`);
  }

  // Read source files mentioned in diagnosis
  const sourceFiles = readRelevantFiles(repoRoot, diagnosis);

  // Build prompt
  const { systemPrompt, userPrompt } = buildPrompt(diagnosis, sourceFiles, config);
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  // Determine hostname/path for azure-openai
  let hostname = provider.hostname;
  let urlPath = provider.path;

  if (providerName === 'azure-openai') {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    if (!endpoint) {
      throw new Error('AZURE_OPENAI_ENDPOINT environment variable is required for azure-openai provider.');
    }
    const url = new URL(endpoint);
    hostname = url.hostname;
    const deployment = llmConfig.model || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';
    urlPath = `${url.pathname}/openai/deployments/${deployment}/chat/completions?api-version=2024-02-15-preview`;
  }

  // Call LLM
  const payload = provider.buildPayload(llmConfig.model, messages);
  const headers = provider.getHeaders(apiKey);
  const response = await httpsPost(hostname, urlPath, headers, payload);
  const content = provider.extractContent(response);

  if (!content) {
    return { success: false, error: 'LLM returned empty response', applied: [], rejected: [] };
  }

  // Parse and apply patches
  const patches = parsePatches(content);
  if (patches.length === 0) {
    return { success: false, error: 'LLM response contained no applicable code patches', rawResponse: content, applied: [], rejected: [] };
  }

  const { applied, rejected } = applyPatches(repoRoot, patches, config.paths.allowed);

  // Save audit data
  const auditDir = path.join(repoRoot, '.heal-audit');
  if (!fs.existsSync(auditDir)) {
    fs.mkdirSync(auditDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(auditDir, `llm-response-${context.attempt || 1}.md`),
    content,
    'utf8'
  );

  return {
    success: applied.length > 0,
    applied,
    rejected,
    provider: providerName,
    model: llmConfig.model,
  };
}

module.exports = { fix, name: 'llm-api', parsePatches, applyPatches, readRelevantFiles };
