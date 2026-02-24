'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

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
  copilot: {
    botId: 'BOT_kgDOC9w8XQ',
  },
  maxAttempts: 3,
  autoMerge: false,
};

/**
 * Parse YAML configuration file content.
 */
function parseConfigYaml(text) {
  try {
    return yaml.load(text) || {};
  } catch (err) {
    console.error(`[config] Failed to parse .heal-agent.yml: ${err.message}`);
    return {};
  }
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

  if (raw.copilot && typeof raw.copilot === 'object') {
    config.copilot = { ...DEFAULTS.copilot, ...raw.copilot };
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
  const raw = parseConfigYaml(content);
  return normalizeConfig(raw);
}

module.exports = { loadConfig, DEFAULTS, parseConfigYaml, normalizeConfig };
