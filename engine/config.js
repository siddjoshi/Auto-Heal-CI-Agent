'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_FILENAME = '.heal-agent.yml';

const DEFAULTS = {
  backend: 'copilot-agent',
  language: 'node',
  llm: {
    provider: 'openai',
    model: 'gpt-4o',
  },
  paths: {
    allowed: ['src/', 'tests/', 'lib/', 'test/'],
    protected: ['.github/', 'scripts/', '.env'],
  },
  commands: {
    lint: 'npm run lint',
    test: 'npm test',
    build: 'npm run build',
    install: 'npm ci',
  },
  maxAttempts: 3,
  autoMerge: false,
};

/**
 * Parse a simple YAML subset (key: value, nested objects, arrays with - prefix).
 * Avoids requiring a YAML library dependency.
 */
function parseSimpleYaml(text) {
  const result = {};
  const lines = text.split('\n');
  const stack = [{ indent: -1, obj: result }];

  for (const raw of lines) {
    const trimmed = raw.replace(/\r$/, '');
    if (!trimmed.trim() || trimmed.trim().startsWith('#')) continue;

    const indent = trimmed.search(/\S/);
    const content = trimmed.trim();

    // Pop stack to find parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    // Array item
    if (content.startsWith('- ')) {
      const val = content.slice(2).trim().replace(/^['"]|['"]$/g, '');
      if (!Array.isArray(parent)) {
        // Find the key that should hold this array
        const keys = Object.keys(parent);
        const lastKey = keys[keys.length - 1];
        if (lastKey && parent[lastKey] === null) {
          parent[lastKey] = [val];
          stack.push({ indent, obj: parent[lastKey] });
        }
      } else {
        parent.push(val);
      }
      continue;
    }

    // Key: value
    const colonIdx = content.indexOf(':');
    if (colonIdx === -1) continue;

    const key = content.slice(0, colonIdx).trim();
    const valStr = content.slice(colonIdx + 1).trim();

    if (valStr === '' || valStr === '|') {
      // Nested object or upcoming array
      parent[key] = null;
      const nested = {};
      parent[key] = nested;
      stack.push({ indent, obj: nested });
    } else {
      // Scalar value
      let val = valStr.replace(/^['"]|['"]$/g, '');
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (/^\d+$/.test(val)) val = parseInt(val, 10);
      parent[key] = val;
    }
  }

  return result;
}

/**
 * Normalize parsed YAML config into the standard schema.
 */
function normalizeConfig(raw) {
  const config = { ...DEFAULTS };

  if (raw.backend) config.backend = raw.backend;
  if (raw.language) config.language = raw.language;
  if (raw['max-attempts']) config.maxAttempts = raw['max-attempts'];
  if (raw.maxAttempts) config.maxAttempts = raw.maxAttempts;
  if (raw['auto-merge'] !== undefined) config.autoMerge = raw['auto-merge'];
  if (raw.autoMerge !== undefined) config.autoMerge = raw.autoMerge;

  if (raw.llm && typeof raw.llm === 'object') {
    config.llm = { ...DEFAULTS.llm, ...raw.llm };
  }

  if (raw.paths && typeof raw.paths === 'object') {
    config.paths = {
      allowed: Array.isArray(raw.paths.allowed) ? raw.paths.allowed : DEFAULTS.paths.allowed,
      protected: Array.isArray(raw.paths.protected) ? raw.paths.protected : DEFAULTS.paths.protected,
    };
  }

  if (raw.commands && typeof raw.commands === 'object') {
    config.commands = { ...DEFAULTS.commands, ...raw.commands };
  }

  return config;
}

/**
 * Load configuration from .heal-agent.yml in the given directory.
 * Falls back to defaults if no config file exists.
 */
function loadConfig(repoRoot) {
  const configPath = path.join(repoRoot, CONFIG_FILENAME);

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULTS };
  }

  const content = fs.readFileSync(configPath, 'utf8');
  const raw = parseSimpleYaml(content);
  return normalizeConfig(raw);
}

module.exports = { loadConfig, DEFAULTS, parseSimpleYaml, normalizeConfig };
